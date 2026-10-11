/**
 * Runs a whole demo game from the Admin screen only, in a real browser, and
 * takes screenshots of Admin in every major state at 390Ã—844, 360Ã—740 and
 * 1440Ã—900 (three Admin devices signed in at once, so it also checks they
 * stay in sync).
 *
 *   npm run dev                 (in another terminal: web on :3000, game on :3001)
 *   npx tsx scripts/admin-run.ts [--bots 24] [--out screenshots/admin]
 *
 * Along the way it checks: a fast double tap advances one step only, pause /
 * resume (button and P key), +5s, skip timer, void, restart question, remove
 * (two taps), a wrong buzz then a correct one, undo (U key), end quiz now.
 * Five scripted players (Riya, Kabir, Zoya, Aadi, Meera) always answer right
 * at once, so they make the final; `npm run bots` fills the room (no buzzing).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminView, ClientToServerEvents, ParticipantView, Phase, ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "24"));
const OUT = path.resolve(arg("out", "screenshots/admin"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const SIZES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x740", width: 360, height: 740 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
function check(ok: unknown, what: string) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  checks++;
  console.log(`  âœ“ ${what}`);
}

// ---------------------------------------------------------------------------
// Sockets: host, a watching admin, scripted players
// ---------------------------------------------------------------------------

const connect = () =>
  new Promise<Client>((resolve, reject) => {
    const s: Client = io(GAME, { transports: ["websocket"], forceNew: true });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });

let adminView: AdminView | null = null;

async function waitFor(what: string, test: (v: AdminView) => boolean, ms = 25_000): Promise<AdminView> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (adminView && test(adminView)) return adminView;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${what} (phase ${adminView?.phase})`);
}
const waitPhase = (phase: Phase, ms?: number) => waitFor(`phase ${phase}`, (v) => v.phase === phase, ms);

class Player {
  socket!: Client;
  id = "";
  view: ParticipantView | null = null;
  answered = new Set<string>();
  constructor(readonly name: string) {}

  async join(room: string) {
    this.socket = await connect();
    this.socket.on("participant:state", (v) => {
      this.view = v;
      // Round 1: answer the right one straight away (the watching admin knows it).
      if (v.screen.kind === "answer" && !this.answered.has(v.screen.questionId) && adminView?.question) {
        const correct = adminView.question.correctText;
        const option = v.screen.options.find((o) => o.text === correct);
        if (option) {
          this.answered.add(v.screen.questionId);
          this.socket.emit("participant:answer", { questionId: v.screen.questionId, optionId: option.id });
        }
      }
      if (v.screen.kind === "backFinalist" && !v.screen.backedId && v.screen.finalists[0]) {
        this.socket.emit("participant:back", { finalistId: v.screen.finalists[0].id });
      }
    });
    const res = await new Promise<{ ok: boolean; participantId?: string }>((r) => this.socket.emit("participant:join", { roomCode: room, name: this.name }, r));
    if (!res.ok || !res.participantId) throw new Error(`${this.name} couldn't join`);
    this.id = res.participantId;
  }

  buzz() {
    const s = this.view?.screen;
    if (s?.kind === "buzzer" && s.questionId) this.socket.emit("participant:buzz", { questionId: s.questionId });
  }
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

type Device = { name: string; page: Page; wide: boolean };

async function shot(devices: Device[], state: string) {
  await sleep(450); // let views land and transitions settle
  for (const d of devices) {
    await d.page.screenshot({ path: path.join(OUT, `${state}-${d.name}.png`) });
  }
  console.log(`  ðŸ“¸ ${state}`);
}

/** Phone layout: open a tab first (Game / Controls / People). */
async function tab(d: Device, name: "game" | "controls" | "people") {
  if (!d.wide) await d.page.getByTestId(`tab-${name}`).click();
}

async function primary(d: Device, expectLabel?: string) {
  const btn = d.page.getByTestId("primary");
  await btn.waitFor({ state: "visible" });
  if (expectLabel) {
    // The page may draw the new step a moment after the watcher socket hears of it.
    let label = "";
    for (let i = 0; i < 50 && label.toLowerCase() !== expectLabel.toLowerCase(); i++) {
      label = ((await btn.textContent()) ?? "").trim();
      if (label.toLowerCase() !== expectLabel.toLowerCase()) await sleep(100);
    }
    check(label.toLowerCase() === expectLabel.toLowerCase(), `primary button says "${expectLabel}"`);
  }
  await sleep(700); // a person's next click, not a double tap (the store ignores taps within 600 ms)
  const before = adminView!.stepId;
  await btn.click();
  await waitFor("step to move on", (v) => v.stepId !== before);
}

async function twoTaps(d: Device, testId: string) {
  const btn = d.page.getByTestId(testId);
  await btn.click();
  check((await btn.getAttribute("data-armed")) === "true", `${testId}: first tap arms it, nothing sent yet`);
  await btn.click();
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });

  const host = await connect();
  const { roomCode } = await new Promise<{ roomCode: string; hostToken: string }>((r) => host.emit("host:create", r));
  console.log(`\nRoom ${roomCode}`);

  const watcher = await connect();
  watcher.on("admin:state", (v) => (adminView = v));
  await new Promise((r) => watcher.emit("admin:auth", { roomCode, pin: PIN }, r));

  const players = ["Riya", "Kabir", "Zoya", "Aadi", "Meera"].map((n) => new Player(n));
  for (const p of players) await p.join(roomCode);

  let bots: ChildProcess | null = null;
  if (BOTS > 0) {
    bots = spawn(`npx tsx scripts/bots.ts --room ${roomCode} --count ${BOTS} --buzz 0 --url ${GAME}`, { shell: true, stdio: "ignore" });
  }

  const browser = await chromium.launch();
  const devices: Device[] = [];
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.width < 1000 ? 2 : 1, hasTouch: s.width < 1000 });
    const page = await ctx.newPage();
    await page.goto(`${WEB}/admin?code=${roomCode}`);
    devices.push({ name: s.name, page, wide: s.width >= 1024 });
  }
  const [phone, small, laptop] = devices;

  try {
    // ---- sign in: a wrong PIN first (clear error), then the right one
    await phone.page.locator('input[name="pin"]').fill("0000");
    await phone.page.getByTestId("sign-in").click();
    await phone.page.getByText("Wrong PIN").waitFor();
    check(true, "wrong PIN shows a clear error");
    for (const d of devices) {
      check((await d.page.locator('input[name="code"]').inputValue()) === roomCode, `${d.name}: room code prefilled from ?code=`);
      await d.page.locator('input[name="pin"]').fill(PIN);
      await d.page.getByTestId("sign-in").click();
      await d.page.getByTestId("step-label").waitFor();
    }
    await phone.page.reload();
    await phone.page.getByTestId("step-label").waitFor();
    check(true, "still signed in after a refresh");

    // ---- lobby
    await waitFor(`${players.length + BOTS} joined`, (v) => v.counts.joined >= players.length + BOTS, 30_000);
    await shot(devices, "01-lobby");

    // Remove a bot from the laptop (second tap confirms)
    const victim = adminView!.participants.find((p) => p.name.startsWith("Bot"));
    if (victim) {
      const row = laptop.page.getByTestId("participant-row").filter({ hasText: victim.name });
      await row.getByTestId("remove").click();
      check((await row.getByTestId("remove").textContent()) === "Tap again", "remove asks for a second tap");
      await sleep(3300);
      check((await row.getByTestId("remove").textContent()) === "Remove", "the confirm cancels itself after 3 s");
      await row.getByTestId("remove").click();
      await row.getByTestId("remove").click();
      await waitFor("removal", (v) => v.participants.find((p) => p.id === victim.id)?.status === "removed");
      check(true, `removed ${victim.name}`);
    }

    // ---- Start quiz, with a fast double tap: exactly one step
    const startStep = adminView!.stepId;
    await phone.page.getByTestId("primary").dblclick();
    await waitPhase("r1Intro");
    await sleep(800);
    check(adminView!.phase === "r1Intro" && adminView!.stepId === startStep + 1, "double tap on Start quiz moved exactly one step");
    // Other devices followed
    check((await laptop.page.getByTestId("step-label").textContent())?.includes("intro"), "the laptop Admin is in sync");

    // ---- Q1: pause in the read step (P key on the laptop), resume (button on the phone)
    await primary(phone, "Show question");
    await waitPhase("r1Read");
    await laptop.page.keyboard.press("p");
    await waitFor("paused", (v) => v.paused);
    await phone.page.getByTestId("paused").waitFor();
    await shot(devices, "02-paused");
    await phone.page.getByTestId("quick-pause").click();
    await waitFor("resumed", (v) => !v.paused);
    check(true, "pause with P, resume with the button");

    // answering + +5s
    await waitPhase("r1Answer");
    const before = adminView!.timer!.durationMs;
    await small.page.getByTestId("quick-addTime").click();
    await waitFor("+5s", (v) => (v.timer?.durationMs ?? 0) > before);
    check(true, "+5s added to the answer timer");
    await waitFor("some answers", (v) => (v.counts.answered ?? 0) >= players.length);
    await shot(devices, "03-answering");

    await waitPhase("r1TimesUp", 30_000);
    await primary(phone, "Reveal answer");
    await waitPhase("r1Reveal");
    await shot(devices, "04-reveal");

    // Void Q1 from the Controls tab (two taps)
    await tab(phone, "controls");
    await twoTaps(phone, "ctl-voidQuestion");
    await waitFor("voided", (v) => v.stepLabel.includes("cancelled"));
    check(true, "void question (second tap) cancelled Q1");
    await tab(phone, "game");

    // ---- Q2: restart it in the read step, then skip the answer timer
    await primary(phone, "Next question");
    await waitPhase("r1Read");
    const q2 = adminView!.question!.id;
    await tab(phone, "controls");
    await twoTaps(phone, "ctl-restartQuestion");
    await waitFor("restarted", (v) => v.phase === "r1Read" && v.question?.id !== q2);
    check(true, "restart question replays it with a new run id");
    await tab(phone, "game");
    await waitPhase("r1Answer");
    await waitFor("my players answered", (v) => (v.counts.answered ?? 0) >= players.length);
    await phone.page.getByTestId("quick-skipTimer").click();
    await waitPhase("r1TimesUp");
    check(true, "skip timer ended the answer step");
    await primary(phone, "Reveal answer");
    await primary(phone, "Show results");
    await primary(phone, "Show leaderboard");

    // ---- Q3 (last): straight through, then End round 1
    await primary(phone, "Next question");
    await waitPhase("r1TimesUp", 30_000);
    await primary(phone, "Reveal answer");
    await waitPhase("r1Reveal");
    await primary(phone, "Show results");
    await primary(phone, "Show leaderboard");
    await primary(phone, "End round 1");
    await waitPhase("cut");
    await shot(devices, "05-end-of-round-1");

    await primary(phone, "Open predictions");
    await waitPhase("predictions");
    await sleep(600);
    await shot(devices, "06-predictions");

    // ---- buzzer round: wrong buzz, then a correct one, undo, correct again
    await primary(phone, "Start buzzer round");
    await primary(phone, "Show question");
    await waitPhase("r2BuzzOpen");
    await shot(devices, "07-buzzers-open");

    const finalists = adminView!.finalists.map((f) => players.find((p) => p.id === f.id)).filter((p): p is Player => !!p);
    check(finalists.length >= 2, `scripted players made the final (${finalists.map((f) => f.name).join(", ")})`);
    finalists[0].buzz();
    await waitPhase("r2Answering");
    await phone.page.getByTestId("judge").waitFor();
    await shot(devices, "08-judging");

    await laptop.page.keyboard.press("w");
    await waitFor("reopened", (v) => v.phase === "r2BuzzOpen" && v.round2!.wrong.length === 1);
    check(true, `W marked ${finalists[0].name} wrong; buzzers reopened`);
    await phone.page.getByTestId("undo").waitFor();
    check(true, "Undo last mark is visible after Wrong");

    finalists[1].buzz();
    await waitPhase("r2Answering");
    await phone.page.getByTestId("judge-correct").click();
    await waitPhase("r2Reveal");
    check(adminView!.finalists.find((f) => f.id === finalists[1].id)!.points === 1, `Correct gave ${finalists[1].name} +1`);
    await laptop.page.keyboard.press("u");
    await waitPhase("r2Answering");
    check(adminView!.finalists.find((f) => f.id === finalists[1].id)!.points === 0, "U undid the mark (point back, judging again)");
    await sleep(700); // same button on the same device: not a double tap
    await phone.page.getByTestId("judge-correct").click();
    await waitPhase("r2Reveal");
    await shot(devices, "09-buzzer-reveal");

    // Fast double tap on the laptop's Space key: one step only
    const revealStep = adminView!.stepId;
    await laptop.page.keyboard.press(" ");
    await laptop.page.keyboard.press(" ");
    await waitFor("scores", (v) => v.phase === "r2Scores");
    await sleep(800);
    check(adminView!.stepId === revealStep + 1, "Space pressed twice fast moved exactly one step");

    // ---- End quiz now (two taps) â†’ podium
    await tab(phone, "controls");
    await twoTaps(phone, "ctl-endQuiz");
    await waitPhase("podium");
    await tab(phone, "game");
    const winner = adminView!.podium?.entries[0];
    check(winner && (await phone.page.getByTestId("podium").textContent())?.includes(winner.name), `podium names the winner (${winner?.name})`);
    await shot(devices, "10-podium");

    // Participants panel on the phone (search + filter)
    await tab(phone, "people");
    await phone.page.getByTestId("participant-search").fill("bot 0");
    await sleep(300);
    const shown = await phone.page.getByTestId("participant-row").count();
    check(shown > 0 && shown < players.length + BOTS, `search filters the list (${shown} rows for "bot 0")`);
    await phone.page.getByTestId("participant-search").fill("");
    await phone.page.getByTestId("filter-finalist").click();
    await sleep(300);
    check((await phone.page.getByTestId("participant-row").count()) === adminView!.finalists.length, "Finalists filter shows the finalists");
    await shot([phone, small], "11-participants");

    console.log(`\nAll ${checks} checks passed. Screenshots in ${OUT}\n`);
  } finally {
    await browser.close();
    bots?.kill();
    if (bots?.pid && process.platform === "win32") spawn(`taskkill /pid ${bots.pid} /T /F`, { shell: true, stdio: "ignore" });
    for (const p of players) p.socket?.disconnect();
    watcher.disconnect();
    host.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
