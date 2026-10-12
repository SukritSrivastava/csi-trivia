/**
 * Plays a whole demo game against `npm run dev` and screenshots the projector
 * (/host) in every state at 1920×1080 and 1366×768.
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal)
 *   npx tsx scripts/host-shots.ts [--bots 30] [--out screenshots/host]
 *
 * Six scripted players (four always right, two always wrong, so the cut has
 * people below the line) plus `npm run bots` for a crowd (no buzzing).
 * Everything is driven over sockets as Admin; the browser only watches.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminAction, AdminView, ClientToServerEvents, OpenRoomResult, ParticipantView, Phase, ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "30"));
const OUT = path.resolve(arg("out", "screenshots/host"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const connect = () =>
  new Promise<Client>((resolve, reject) => {
    const s: Client = io(GAME, { transports: ["websocket"], forceNew: true });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });

let admin: AdminView | null = null;
async function until(what: string, test: (v: AdminView) => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (admin && test(admin)) return admin;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${what} (phase ${admin?.phase})`);
}
const phase = (p: Phase, ms?: number) => until(`phase ${p}`, (v) => v.phase === p, ms);

class Player {
  socket!: Client;
  id = "";
  view: ParticipantView | null = null;
  done = new Set<string>();
  constructor(
    readonly name: string,
    readonly right: boolean,
    readonly delayMs: number,
  ) {}
  async join(room: string) {
    this.socket = await connect();
    this.socket.on("participant:state", (v) => {
      this.view = v;
      const s = v.screen;
      if (s.kind === "answer" && !this.done.has(s.questionId) && admin?.question) {
        this.done.add(s.questionId);
        const correct = admin.question.correctText;
        const pick = s.options.find((o) => (this.right ? o.text === correct : o.text !== correct));
        setTimeout(() => pick && this.socket.emit("participant:answer", { questionId: s.questionId, optionId: pick.id }), this.delayMs);
      }
      if (s.kind === "backFinalist" && !s.backedId && s.finalists[0]) this.socket.emit("participant:back", { finalistId: s.finalists[0].id });
    });
    const r = await new Promise<{ ok: boolean; participantId?: string }>((res) => this.socket.emit("participant:join", { roomCode: room, name: this.name }, res));
    if (!r.ok) throw new Error(`${this.name} couldn't join`);
    this.id = r.participantId!;
  }
  buzz() {
    const s = this.view?.screen;
    if (s?.kind === "buzzer" && s.questionId) this.socket.emit("participant:buzz", { questionId: s.questionId });
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const watcher = await connect();
  watcher.on("admin:state", (v) => (admin = v));
  await new Promise((r) => watcher.emit("admin:login", { pin: PIN }, r));
  const opened = await new Promise<OpenRoomResult>((r) => watcher.emit("admin:openRoom", { quizId: "demo" }, r));
  if (!opened.ok) throw new Error(`Couldn't open a room: ${opened.error}`);
  const room = opened.roomCode;
  console.log(`Room ${room}`);
  const send = async (action: AdminAction) => {
    const r = await new Promise<{ ok: boolean; reason?: string }>((res) => watcher.emit("admin:command", { stepId: admin!.stepId, action }, res));
    if (!r.ok) throw new Error(`${action.type} refused: ${r.reason}`);
  };

  const pageErrors: string[] = [];
  /** Frames per second over 2 s on the big screen (headless, so only a rough guide). */
  // A string, so the compiler can't inject helpers that don't exist in the page.
  const fps = () =>
    pages[0].page.evaluate<number>(`new Promise((done) => {
      let frames = 0;
      const start = performance.now();
      function tick() {
        frames++;
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
        else done(Math.round(frames / 2));
      }
      requestAnimationFrame(tick);
    })`);
  const browser = await chromium.launch();
  const pages: { name: string; page: Page }[] = [];
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
  ]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await page.goto(`${WEB}/host`);
    page.on("pageerror", (e) => pageErrors.push(`${w}x${h}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && pageErrors.push(`${w}x${h} console: ${m.text()}`));
    pages.push({ name: `${w}x${h}`, page });
  }
  const shot = async (state: string, wait = 600) => {
    await sleep(wait);
    for (const p of pages) await p.page.screenshot({ path: path.join(OUT, `${state}-${p.name}.png`) });
    console.log(`  📸 ${state}`);
  };

  let bots: ChildProcess | null = null;
  try {
    await shot("00-pin", 1500);
    for (const p of pages) {
      await p.page.locator('input[name="pin"]').fill(PIN);
      await p.page.getByTestId("host-sign-in").click();
      await p.page.getByLabel(`Room code ${room}`).waitFor({ timeout: 15_000 });
    }
    // Turn the sound on (a click), so every sound below really plays.
    await pages[0].page.getByTestId("enable-sound").click();
    await pages[0].page.getByTestId("enable-sound").waitFor({ state: "detached", timeout: 5000 });
    console.log("  sound enabled on the 1920 screen");

    const players = [
      new Player("Riya", true, 300),
      new Player("Kabir", true, 700),
      new Player("Zoya", true, 1100),
      new Player("Aadi", true, 1500),
      new Player("Meera", false, 900),
      new Player("Dev", false, 1300),
    ];
    for (const p of players) await p.join(room);
    if (BOTS > 0) bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --buzz 0 --url ${GAME}`, { shell: true, stdio: "ignore" });
    await until("everyone joined", (v) => v.counts.joined >= players.length + BOTS, 60_000);
    await shot("01-lobby", 1500);

    await send({ type: "startQuiz" });
    await shot("02-round1-intro", 1600);

    // Question 1: read, answer (paused once), time's up, reveal, results, leaderboard.
    await send({ type: "showQuestion" });
    await phase("r1Read");
    await shot("03-read", 1500);
    await phase("r1Answer");
    await shot("04-answer", 1800);
    console.log(`  fps during the answer step: ${await fps()}`);
    await send({ type: "pause" });
    await shot("05-paused", 500);
    await send({ type: "resume" });
    await phase("r1TimesUp");
    await shot("06-times-up", 900);
    await send({ type: "revealAnswer" });
    console.log(`  fps during the reveal (cast hopping and shaking): ${await fps()}`);
    await shot("07-reveal", 300);
    await send({ type: "showResults" });
    await shot("08-results", 2000);
    await send({ type: "showLeaderboard" });
    await shot("09-leaderboard", 2500);

    // Questions 2 and 3, straight through.
    for (let q = 0; q < 2; q++) {
      await send({ type: "nextQuestion" });
      await phase("r1TimesUp");
      await send({ type: "revealAnswer" });
      await sleep(400);
    }
    await send({ type: "endRound1" });
    await phase("cut");
    await shot("10-cut", 4800);

    await send({ type: "openPredictions" });
    await shot("11-predictions", 2000);
    await send({ type: "startBuzzerRound" });
    await shot("12-buzzer-intro", 1500);

    await send({ type: "showQuestion" });
    await phase("r2Read");
    await shot("13-buzzer-read", 1000);
    await phase("r2BuzzOpen");
    await shot("14-buzzers-open", 700);
    const finalist = players.find((p) => admin!.finalists.some((f) => f.id === p.id))!;
    finalist.buzz();
    await phase("r2Answering");
    await shot("15-buzzed", 1100);
    await send({ type: "markCorrect" });
    await phase("r2Reveal");
    await shot("16-buzzer-reveal", 2500);
    await send({ type: "showScores" });
    await shot("17-scores", 1800);

    await send({ type: "endQuiz" });
    await phase("podium");
    await shot("18-podium", 3600);

    // The two projector frames from public/finaldesign.html, next to ours.
    const ref = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })).newPage();
    await ref.goto(`${WEB}/finaldesign.html`);
    await ref.waitForTimeout(800);
    await ref.locator(".tv.e").nth(0).screenshot({ path: path.join(OUT, "ref-answer.png") });
    await ref.locator(".tv.e").nth(1).screenshot({ path: path.join(OUT, "ref-read.png") });
    const img = (f: string) => `data:image/png;base64,${readFileSync(path.join(OUT, f)).toString("base64")}`;
    const cmp = await (await browser.newContext({ viewport: { width: 1960, height: 600 } })).newPage();
    await cmp.setContent(
      `<body style="margin:0;background:#0f0d14;color:#ccc;font:14px sans-serif;padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px">${[
        ["ref-read.png", "design: read step"],
        ["03-read-1920x1080.png", "app: read step"],
        ["ref-answer.png", "design: answer step"],
        ["04-answer-1920x1080.png", "app: answer step"],
      ]
        .map(([f, t]) => `<figure style="margin:0"><img src="${img(f)}" style="width:100%"><figcaption>${t}</figcaption></figure>`)
        .join("")}</body>`,
    );
    await cmp.screenshot({ path: path.join(OUT, "compare.png"), fullPage: true });
    console.log("  📸 compare.png (design | app)");
    console.log(pageErrors.length ? `\nPage errors:\n  ${pageErrors.join("\n  ")}` : "\nNo page errors.");
    console.log(`Done. Screenshots in ${OUT}`);
  } finally {
    await browser.close();
    bots?.kill();
    if (bots?.pid && process.platform === "win32") spawn(`taskkill /pid ${bots.pid} /T /F`, { shell: true, stdio: "ignore" });
    await new Promise((r) => watcher.emit("admin:closeRoom", { roomCode: room }, r));
    watcher.disconnect();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
