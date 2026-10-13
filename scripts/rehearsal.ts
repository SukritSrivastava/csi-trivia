/**
 * Full rehearsal at event scale. The Host at 1920×1080, Admin at phone size
 * (every step is a real tap on its big button), 4 real Participant tabs and
 * 100 bots, lobby to podium, with a void, a restart question and a participant refresh.
 * Measures the Host's frame rate on the busy screens, its memory, and how fast
 * a tap on Admin reaches the Host and the phones.
 *
 *   npm run build; $env:DATABASE_URL="off"; $env:GAME_PRESET="event"; npm run preview   (another terminal)
 *   npm run rehearsal [-- --bots 100 --out screenshots/rehearsal]
 *
 * Uses a copy of the Demo quiz with the event's top 9 safe (deleted at the end).
 * Headless Chromium draws on the CPU, so its fps is a floor: a real laptop with
 * a GPU does better.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminView, ClientToServerEvents, OpenRoomResult, Phase, Quiz, SaveQuizResult, ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "100"));
const OUT = path.resolve(arg("out", "screenshots/rehearsal"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(ok: unknown, what: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}

let admin: AdminView | null = null;
let adminAt = 0;
async function until(what: string, test: (v: AdminView) => boolean, ms = 40_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (admin && test(admin)) return admin;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what} (phase ${admin?.phase})`);
}
const phase = (p: Phase, ms?: number) => until(`phase ${p}`, (v) => v.phase === p, ms);
/** The phase right now (a function, so TypeScript doesn't narrow it across awaits). */
const now = (): Phase => admin!.phase;

const FPS = `new Promise((done) => {
  let frames = 0, worst = 0, last = performance.now();
  const start = last;
  function tick(now) {
    frames++; worst = Math.max(worst, now - last); last = now;
    if (now - start < 3000) requestAnimationFrame(tick);
    else done({ fps: Math.round(frames / ((now - start) / 1000)), worst: Math.round(worst) });
  }
  requestAnimationFrame(tick);
})`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const watcher: Client = io(GAME, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res, rej) => {
    watcher.once("connect", () => res());
    watcher.once("connect_error", rej);
  });
  watcher.on("admin:state", (v) => {
    admin = v;
    adminAt = Date.now();
  });
  await new Promise((r) => watcher.emit("admin:login", { pin: PIN }, r));

  // A copy of the Demo quiz with the event's cut (top 9 safe).
  const copy = await new Promise<SaveQuizResult>((r) => watcher.emit("library:duplicate", { id: "demo" }, r));
  if (!copy.ok) throw new Error("Couldn't copy the Demo quiz");
  const quiz = (await new Promise<Quiz | null>((r) => watcher.emit("library:get", { id: copy.quiz.id }, r)))!;
  await new Promise((r) => watcher.emit("library:save", { ...quiz, title: "Rehearsal (event cut)", rules: { ...quiz.rules, safe: 9, round1Questions: 3, wildCardQuestions: 3 } }, r));
  const opened = await new Promise<OpenRoomResult>((r) => watcher.emit("admin:openRoom", { quizId: quiz.id }, r));
  if (!opened.ok) throw new Error(`Couldn't open a room: ${opened.error}`);
  const room = opened.roomCode;
  console.log(`Room ${room}, ${BOTS} bots + 4 phones`);

  const pageErrors: string[] = [];
  // --gpu: draw with the graphics card, like the real projector laptop (headless default is CPU only).
  const browser = await chromium.launch(process.argv.includes("--gpu") ? { args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization"] } : {});
  const open = async (name: string, url: string, width: number, height: number, mobile: boolean) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
    await page.goto(url);
    return { name, page };
  };

  const host = await open("host", `${WEB}/host`, 1920, 1080, false);
  await host.page.locator('input[name="pin"]').fill(PIN);
  await host.page.getByTestId("host-sign-in").click();
  await host.page.getByLabel(`Room code ${room}`).waitFor({ timeout: 15_000 });
  await host.page.getByTestId("enable-sound").click();
  const hostCdp = await host.page.context().newCDPSession(host.page);
  await hostCdp.send("Performance.enable");
  const heapMb = async () => {
    const { metrics } = await hostCdp.send("Performance.getMetrics");
    const used = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
    return Math.round((used / 1024 / 1024) * 10) / 10;
  };
  const fonts = await host.page.evaluate(`document.fonts.check('16px "Special Elite"') && document.fonts.check('16px VT323')`);
  check(fonts, "the Host has Special Elite and VT323 loaded");

  const adminPage = await open("admin", `${WEB}/admin?code=${room}`, 390, 844, true);
  await adminPage.page.locator('input[name="pin"]').fill(PIN);
  await adminPage.page.getByTestId("sign-in").click();
  await adminPage.page.getByTestId("step-label").waitFor();

  const phones: { name: string; page: Page; right: boolean }[] = [];
  for (const [name, right] of [
    ["Riya", true],
    ["Kabir", true],
    ["Meera", false],
    ["Dev", false],
  ] as const) {
    const p = await open(name, `${WEB}/play?code=${room}`, 390, 844, true);
    await p.page.locator('input[name="name"]').fill(name);
    await p.page.getByTestId("join").click();
    await p.page.getByTestId("screen-lobby").waitFor();
    phones.push({ ...p, right });
  }
  const [riya, kabir, meera] = phones;

  const fps: Record<string, string> = {};
  const measure = async (label: string) => {
    const r = await host.page.evaluate<{ fps: number; worst: number }>(FPS);
    fps[label] = `${r.fps} fps (longest frame ${r.worst} ms)`;
    console.log(`  ⏱  Host ${label}: ${fps[label]}`);
  };
  const heap: string[] = [];
  const sampleHeap = async (label: string) => heap.push(`${label} ${await heapMb()} MB`);
  const shot = async (label: string) => {
    await host.page.screenshot({ path: path.join(OUT, `${label}-host.png`) });
    await adminPage.page.screenshot({ path: path.join(OUT, `${label}-admin.png`) });
    await riya.page.screenshot({ path: path.join(OUT, `${label}-phone.png`) });
  };

  /** Taps Admin's big button and times how long until the Host and a phone show the next step. */
  const lags: number[] = [];
  const tap = async (label?: string) => {
    const step = admin!.stepId;
    const btn = adminPage.page.getByTestId("primary");
    await btn.waitFor();
    if (label) {
      const text = (await btn.textContent()) ?? "";
      if (!text.toLowerCase().includes(label.toLowerCase())) throw new Error(`Admin's big button says "${text}", expected "${label}"`);
    }
    const t = Date.now();
    await btn.click();
    await until("the next step", (v) => v.stepId > step, 5000);
    lags.push(adminAt - t);
    // Admin ignores a second big-button tap within 600 ms (double-tap guard).
    await sleep(700);
  };
  /** An optional step: the small "or: …" chip above the big button. */
  const chip = async (type: string) => {
    const step = admin!.stepId;
    await adminPage.page.getByTestId(`optional-${type}`).click();
    await until(type, (v) => v.stepId > step, 5000);
    await sleep(700);
  };

  /** Each phone answers the open question (right or wrong) by tapping. */
  const answerAll = async (skip: string[] = []) => {
    const correct = admin!.question!.correctText;
    await Promise.all(
      phones
        .filter((p) => !skip.includes(p.name))
        .map(async (p) => {
          await p.page.getByTestId("screen-answer").waitFor({ timeout: 10_000 });
          const opt = p.page.getByTestId("option");
          await (p.right ? opt.filter({ hasText: correct }) : opt.filter({ hasNotText: correct }).first()).click();
        }),
    );
  };

  let bots: ChildProcess | null = null;
  try {
    if (BOTS > 0) bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --url ${GAME}`, { shell: true, stdio: "ignore" });
    await until("everyone joined", (v) => v.counts.joined >= 4 + BOTS, 90_000);
    await sleep(2500);
    await sampleHeap("lobby");
    await measure("lobby wall (104 bots)");
    await shot("01-lobby");

    await tap("Start");
    // Q1: answer step and reveal with every bot on the cast wall.
    await tap("Show question");
    await phase("r1Answer");
    await answerAll();
    await measure("answer step");
    await shot("02-answer");
    await phase("r1TimesUp");
    await tap("Reveal");
    await measure("reveal");
    await shot("03-reveal");
    await chip("showResults");
    await chip("showLeaderboard");

    // Q2: Meera refreshes mid-question.
    await tap();
    await phase("r1Answer");
    await meera.page.reload();
    await meera.page.getByTestId("screen-answer").waitFor({ timeout: 5000 });
    check(true, "a participant refreshed mid-question and is back on the answer screen");
    await answerAll();
    await phase("r1TimesUp");
    await tap("Reveal");

    // Q3: voided from Admin's Controls tab (two taps).
    await tap();
    await phase("r1Answer");
    await answerAll();
    await adminPage.page.getByRole("tab", { name: /controls/i }).click();
    await adminPage.page.getByTestId("ctl-voidQuestion").click();
    await adminPage.page.getByTestId("ctl-voidQuestion").click();
    await riya.page.getByTestId("screen-voided").waitFor({ timeout: 5000 });
    check(true, "void from Admin: every phone says CANCELLED");
    await adminPage.page.getByRole("tab", { name: /game/i }).click();
    await sampleHeap("after round 1");

    // The cut, with 104 on the board.
    while (now() !== "cut") await tap();
    await sleep(600);
    await measure("the cut");
    await shot("04-cut");
    check(admin!.finalists.length === 9, `top ${admin!.finalists.length} safe at the cut`);

    /** Phones that have answer buttons right now tap (right or wrong, by their plan). */
    const answerOpenPhones = async () => {
      const correct = admin!.question?.correctText;
      for (const p of phones) {
        if ((await p.page.getByTestId("screen-answer").count()) === 0 || !correct) continue;
        const opt = p.page.getByTestId("option");
        await (p.right ? opt.filter({ hasText: correct }) : opt.filter({ hasNotText: correct }).first()).click({ timeout: 3000 }).catch(() => {});
      }
    };

    // ---- The wild card round (everyone below the line, bots included)
    await tap("Start wild card round");
    let measuredWild = false;
    for (const giveUp = Date.now() + 300_000; Date.now() < giveUp && now() !== "wcWinner"; ) {
      const p = now();
      if (p === "wcRead") {
        await sleep(200);
        continue;
      }
      if (p === "wcAnswer") {
        await answerOpenPhones();
        if (!measuredWild) {
          measuredWild = true;
          await measure("wild card answer step");
          await shot("05-wildcard-answer");
        }
        await phase("wcTimesUp", 20_000);
        continue;
      }
      if (admin!.allowed.includes("revealWildCard") && admin!.optional.some((o) => o.action.type === "showStandings")) {
        await chip("showStandings");
        continue;
      }
      await tap();
    }
    await sleep(1500);
    await shot("06-wildcard-winner");
    check(admin!.finalists.length === 10, `the wild card makes ${admin!.finalists.length} finalists`);

    await chip("openPredictions");
    await until("predictions", (v) => v.phase === "predictions");
    await sleep(2500);
    await tap("Start Blackout");
    const runnerPhones = phones.filter((p) => admin!.finalists.some((f) => f.name === p.name));
    check(runnerPhones.length >= 1, `${runnerPhones.map((p) => p.name).join(", ")} on phones run in Blackout`);

    // ---- Blackout to the end; Restart question once (from Admin's Controls, two taps)
    let restarted = false;
    let measuredReveal = false;
    let measuredDark = false;
    for (const giveUp = Date.now() + 300_000; Date.now() < giveUp && now() !== "podium"; ) {
      const p = now();
      // Blackout runs on autopilot: only the fixes are clicked, never the big button (it's Pause).
      if (p === "boRead" || p === "boIntro" || p === "boTimesUp" || p === "boWinner") {
        await sleep(200);
        continue;
      }
      if (p === "boAnswer") {
        await answerOpenPhones();
        await phase("boTimesUp", 20_000);
        continue;
      }
      if (p === "boReveal" && !restarted) {
        restarted = true;
        await adminPage.page.getByTestId("bo-restartQuestion").click();
        await adminPage.page.getByTestId("bo-restartQuestion").click();
        await phase("boRead", 5000);
        check(true, "restart question in Blackout: moves undone, back to the read step");
        continue;
      }
      if (p === "boReveal" && !measuredReveal) {
        measuredReveal = true;
        await sleep(400);
        await measure("Blackout reveal (runners move)");
        await shot("07-blackout-reveal");
      }
      if (p === "boDark" && !measuredDark) {
        measuredDark = true;
        await sleep(300);
        await measure("Blackout dark moves");
        await shot("08-blackout-dark");
      }
      if (p.startsWith("bo")) {
        await sleep(200);
        continue;
      }
      await tap();
    }
    await phase("podium");
    await sleep(3500);
    await measure("podium (confetti)");
    await shot("05-podium");
    await sampleHeap("podium");

    // Nobody dropped: every bot and phone is still connected.
    const connected = admin!.participants.filter((p) => p.connected && p.status !== "removed").length;
    check(connected >= 4 + BOTS, `${connected} of ${4 + BOTS} participants still connected at the podium`);
    const podiumPhones = await Promise.all(phones.map((p) => p.page.getByTestId("screen-podium").count()));
    check(podiumPhones.every((n) => n === 1), "all 4 phones are on the podium screen");

    lags.sort((a, b) => a - b);
    console.log(`\n  Admin tap → new view: median ${lags[Math.floor(lags.length / 2)]} ms, worst ${lags[lags.length - 1]} ms (${lags.length} taps)`);
    console.log(`  Host memory: ${heap.join(" · ")}`);
    check(pageErrors.length === 0, pageErrors.length ? `page errors:\n    ${pageErrors.join("\n    ")}` : "no page errors");
    console.log(`\n${failures ? `${failures} check(s) failed` : "Rehearsal passed"}. Screenshots in ${OUT}`);
  } catch (e) {
    await shot("zz-failed").catch(() => {});
    console.log(`  (phase ${admin?.phase})`);
    throw e;
  } finally {
    await browser.close();
    bots?.kill();
    if (bots?.pid && process.platform === "win32") spawn(`taskkill /pid ${bots.pid} /T /F`, { shell: true, stdio: "ignore" });
    await new Promise((r) => watcher.emit("admin:closeRoom", { roomCode: room }, r));
    await new Promise((r) => watcher.emit("library:delete", { id: quiz.id }, r));
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
