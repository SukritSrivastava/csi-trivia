/**
 * The Blackout autopilot on the projector, beat by beat: plays a quick game
 * with 10 runners (a throwaway quiz: 1 Round 1 question, 9 safe, 1 wild card
 * question) against `npm run dev`, then screenshots the Host at 1920×1080 and
 * 1366×768 through every autopilot step, several frames per beat (so the
 * sequence shows the motion), measures the frame rate during the reveal and
 * the dark, checks that Pause freezes the scene and that a refreshed Host
 * lands on the current step, and reports each beat's animation time against
 * the server's hold.
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal)
 *   npm run blackout-shots [-- --bots 14 --out screenshots/blackout]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminAction, AdminView, ClientToServerEvents, LibraryQuestion, OpenRoomResult, Phase, SaveQuizResult, ServerToClientEvents } from "../src/shared/protocol";
import { PRESETS } from "../server/config";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "14"));
const OUT = path.resolve(arg("out", "screenshots/blackout"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(ok: unknown, what: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}

let admin: AdminView | null = null;
async function until(what: string, test: (v: AdminView) => boolean, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (admin && test(admin)) return admin;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what} (phase ${admin?.phase})`);
}
const phase = (p: Phase, ms?: number) => until(`phase ${p}`, (v) => v.phase === p, ms);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const watcher: Client = io(GAME, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res, rej) => {
    watcher.once("connect", () => res());
    watcher.once("connect_error", rej);
  });
  watcher.on("admin:state", (v) => (admin = v));
  const ask = <T>(event: string, payload?: unknown) =>
    new Promise<T>((r) => (watcher.emit as (...a: unknown[]) => void)(event, ...(payload === undefined ? [] : [payload]), r));
  await ask("admin:login", { pin: PIN });

  // A throwaway quiz: 1 Round 1 question, 9 safe, 1 wild card question, enough Blackout questions.
  const mk = (text: string, correct = 1): LibraryQuestion => ({
    id: Math.random().toString(36).slice(2, 12),
    text,
    options: [`${text} A`, `${text} B`, `${text} C`, `${text} D`],
    correct,
    image: null,
    readSeconds: null,
    openSeconds: null,
  });
  const made = await ask<SaveQuizResult>("library:create", { title: "Blackout shots" });
  if (!made.ok) throw new Error("couldn't create the quiz");
  const quizId = made.quiz.id;
  const blackoutQs = [
    "Which company makes Claude?",
    "What does GPU stand for?",
    "Which protocol lets an agent call tools over a standard interface?",
    "What is a token in a language model?",
    "Which file format is used to describe this quiz's questions?",
    "What does RAM stand for?",
    "Which planet is the Red Planet?",
    "How many bits in a byte?",
    "What does HTTP stand for?",
    "Which key ends a line in a terminal?",
    "What does CPU stand for?",
    "Which language is Next.js written in?",
  ];
  const saved = await ask<SaveQuizResult>("library:save", {
    ...made.quiz,
    rules: { ...made.quiz.rules, round1Questions: 1, safe: 9, wildCardQuestions: 1 },
    round1: [mk("Warm-up: what does LLM stand for?")],
    wildcard: [mk("Wild card: what does AI stand for?")],
    blackout: blackoutQs.map((t, i) => mk(t, i % 4)),
  });
  if (!saved.ok) throw new Error(`couldn't save the quiz: ${saved.error}`);
  const opened = await ask<OpenRoomResult>("admin:openRoom", { quizId });
  if (!opened.ok) throw new Error(`couldn't open a room: ${opened.error} ${opened.problems?.join("; ") ?? ""}`);
  const room = opened.roomCode;
  console.log(`Room ${room}`);
  const send = async (action: AdminAction) => {
    const step = admin!.stepId;
    const r = await new Promise<{ ok: boolean; reason?: string }>((res) => watcher.emit("admin:command", { stepId: step, action }, res));
    if (!r.ok) throw new Error(`${action.type} refused: ${r.reason}`);
    await until("the next step", (v) => v.stepId !== step, 2000).catch(() => {});
  };

  const browser = await chromium.launch({ args: ["--disable-gpu-vsync"] });
  const pages: { name: string; page: Page }[] = [];
  const pageErrors: string[] = [];
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
  ]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`${WEB}/host`);
    await page.locator('input[name="pin"]').fill(PIN);
    await page.getByTestId("host-sign-in").click();
    pages.push({ name: `${w}x${h}`, page });
  }
  const [big] = pages;
  const shot = async (name: string, all = true) => {
    for (const p of all ? pages : [big]) await p.page.screenshot({ path: path.join(OUT, `${name}-${p.name}.png`) });
    console.log(`  📸 ${name}`);
  };
  const fps = (ms: number) =>
    big.page.evaluate<{ fps: number; worst: number }>(`new Promise((done) => {
      let frames = 0, last = performance.now(), worst = 0;
      const start = last;
      function tick(t) {
        frames++; worst = Math.max(worst, t - last); last = t;
        if (t - start < ${ms}) requestAnimationFrame(tick); else done({ fps: Math.round(frames / (${ms} / 1000)), worst: Math.round(worst) });
      }
      requestAnimationFrame(tick);
    })`);

  let bots: ChildProcess | null = null;
  try {
    bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --url ${GAME} --pin ${PIN} --accuracy 0.45-0.85`, { shell: true, stdio: "ignore" });
    await until("bots joined", (v) => v.counts.joined >= BOTS, 60_000);
    await send({ type: "startQuiz" });
    await send({ type: "showQuestion" });
    await phase("r1TimesUp", 40_000);
    await send({ type: "revealAnswer" });
    await send({ type: "endRound1" });
    await phase("cut");
    await send({ type: "startWildCard" });
    await send({ type: "showQuestion" });
    await phase("wcTimesUp", 40_000);
    await send({ type: "revealAnswer" });
    for (let i = 0; i < 5 && !admin!.allowed.includes("revealWildCard"); i++) {
      await send({ type: "nextQuestion" });
      await phase("wcTimesUp", 40_000);
      await send({ type: "revealAnswer" });
    }
    await send({ type: "revealWildCard" });
    await phase("wcWinner");
    await sleep(1200);
    await shot("00-wildcard-sweep-start", false);
    await sleep(1500);
    await shot("01-wildcard-winner");

    // ---- Blackout: one click, then watch.
    await send({ type: "startBlackout" });
    check(admin!.blackout!.runners.length === 10, `10 runners on the track (${admin!.blackout!.runners.length})`);
    await sleep(300);
    await shot("10-intro-a", false);
    await sleep(1800);
    await shot("10-intro-b", false);
    await sleep(2200);
    await shot("10-intro-c");
    await phase("boRead");
    await sleep(400);
    await shot("11-read");
    await phase("boAnswer");
    await sleep(1500);
    await shot("12-answer");
    // Pause mid-answer: the scene freezes; Resume carries on.
    await send({ type: "pause" });
    await sleep(500);
    await shot("13-paused", false);
    await send({ type: "resume" });
    await phase("boTimesUp", 30_000);
    await sleep(150);
    await shot("14-times-up", false);

    // The reveal: the beat measured, frames along the way.
    await phase("boReveal", 10_000);
    const revealHold = admin!.timer!.durationMs;
    const revealFps = fps(1500);
    await sleep(300);
    await shot("15-reveal-a", false);
    await sleep(700);
    await shot("15-reveal-b", false);
    const rf = await revealFps;
    await sleep(800);
    await shot("15-reveal-c");

    // The dark.
    await phase("boDark", 10_000);
    const darkHold = admin!.timer!.durationMs;
    const steps = admin!.blackout!.dark - admin!.blackout!.darkFrom;
    const darkFps = fps(1500);
    await sleep(500);
    await shot("16-dark-a", false);
    await sleep(500);
    await shot("16-dark-b", false);
    const df = await darkFps;
    await sleep(900);
    await shot("16-dark-c");

    const n = admin!.blackout!.alive;
    const revealAnim = 350 + 150 * 9 + 650 + 1200 * 0.6;
    const caughtCount = admin!.blackout!.caughtThisQuestion.length;
    // Rows dying (450 + 250 per step), then the catch flicker (900 ms, only if someone was caught), then the banner (500 + 400).
    const darkAnim = 450 + steps * 250 + (caughtCount ? 900 : 0) + 900;
    console.log(`  ⏱  reveal: animation ≈ ${revealAnim} ms of a ${revealHold} ms hold (${Math.round((revealAnim / revealHold) * 100)}%), ${rf.fps} fps (worst frame ${rf.worst} ms)`);
    console.log(`  ⏱  dark (${steps} step${steps === 1 ? "" : "s"}): animation ≈ ${darkAnim} ms of a ${darkHold} ms hold (${Math.round((darkAnim / darkHold) * 100)}%), ${df.fps} fps (worst frame ${df.worst} ms); ${n} still running`);

    // A Host refresh mid-chase lands on the current step.
    await phase("boRead", 20_000);
    await big.page.reload();
    await big.page.locator('input[name="pin"]').fill(PIN, { timeout: 2500 }).catch(() => {});
    await big.page.getByTestId("host-sign-in").click({ timeout: 1000 }).catch(() => {});
    await big.page.getByTestId("blackout-scene").waitFor({ timeout: 15_000 });
    check(true, "a refreshed Host lands back in the Blackout scene");
    await shot("17-after-refresh", false);

    // Watch the rest: a catch frame, then the winner and the podium (no clicks).
    let caughtShot = false;
    let round = 0;
    for (;;) {
      const v = await until("the next beat", (x) => x.phase === "boDark" || x.phase === "boWinner" || x.phase === "podium", 240_000);
      if (v.phase !== "boDark") break;
      round++;
      if (!caughtShot && v.blackout!.caughtThisQuestion.length) {
        caughtShot = true;
        await sleep(1700);
        await shot("18-caught");
      }
      await until("the dark's hold to end", (x) => x.phase !== "boDark", 20_000);
    }
    await phase("boWinner", 120_000);
    await sleep(800);
    await shot("19-winner-a", false);
    await sleep(2200);
    await shot("19-winner-b");
    await phase("podium", 20_000);
    await sleep(2500);
    await shot("20-podium");
    check(pageErrors.length === 0, pageErrors.length ? `page errors: ${pageErrors.join(" | ")}` : "no page errors");
    console.log(`  (${round} more questions after the refresh)`);
    console.log(`  holds (server/config.ts): reveal 3000 + 150 × runners, dark 2500 + 250 × steps (+1500 caught); preset ${PRESETS.demo.name}`);
    console.log(`\n${failures ? `${failures} check(s) failed` : "Blackout shots done"}. Screenshots in ${OUT}`);
  } finally {
    await browser.close();
    bots?.kill();
    if (bots?.pid && process.platform === "win32") spawn(`taskkill /pid ${bots.pid} /T /F`, { shell: true, stdio: "ignore" });
    await ask("admin:closeRoom", { roomCode: room });
    await ask("library:delete", { id: quizId });
    watcher.disconnect();
  }
  if (failures) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
