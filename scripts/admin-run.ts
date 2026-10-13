/**
 * Runs a whole demo game from the Admin screen only, in a real browser, and
 * takes screenshots of Admin in every major state at 390×844, 360×740 and
 * 1440×900 (three Admin devices signed in at once, so it also checks they
 * stay in sync).
 *
 *   npm run dev                 (in another terminal: web on :3000, game on :3001)
 *   npm run admin-run [-- --bots 30] [--out screenshots/admin]
 *
 * Along the way it checks: sign in (room code prefilled, a wrong PIN, a
 * refresh), a fast double tap advances one step only, pause / resume (button
 * and P key), +5s, skip, void in Round 1 and the wild card round, restart
 * question, the optional steps as "or:" chips (results, leaderboard, standings,
 * predictions), remove (two taps), the cut table, the wild card standings and
 * winner, and Blackout on autopilot: ONE Start Blackout click, then (only
 * fixes, never a flow click) pause / resume in the answer step (big button)
 * and in the dark's hold (P key), +5 s, skip a hold, void one question,
 * restart one, a double Space that pauses once, a refresh of Admin mid-chase,
 * and the podium arriving by itself.
 *
 * Five scripted players (Riya, Kabir, Zoya, Aadi, Meera) answer right at once
 * in Round 1 and the wild card round; in Blackout Riya answers right fast,
 * Kabir and Meera right but slow, Zoya wrong, Aadi not at all, so the dark
 * catches runners. `npm run bots` fills the room.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminView, ClientToServerEvents, OpenRoomResult, ParticipantView, Phase, ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "30"));
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
  console.log(`  ✓ ${what}`);
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
/** Every phase the watcher saw, in order (to prove the autopilot ran by itself). */
const phases: Phase[] = [];

async function waitFor(what: string, test: (v: AdminView) => boolean, ms = 25_000): Promise<AdminView> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (adminView && test(adminView)) return adminView;
    await sleep(40);
  }
  throw new Error(`Timed out waiting for: ${what} (phase ${adminView?.phase})`);
}
const waitPhase = (phase: Phase, ms?: number) => waitFor(`phase ${phase}`, (v) => v.phase === phase, ms);

/** How each scripted player answers in Blackout: delay in ms, or "wrong", or null (no answer). */
const BLACKOUT_PLAN: Record<string, number | "wrong" | null> = { Riya: 200, Kabir: 7800, Meera: 7600, Zoya: "wrong", Aadi: null };

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
      const s = v.screen;
      if (s.kind === "answer" && !this.answered.has(s.questionId) && adminView?.question) {
        this.answered.add(s.questionId);
        const correct = adminView.question.correctText;
        const right = s.options.find((o) => o.text === correct);
        const wrong = s.options.find((o) => o.text !== correct);
        const plan = s.round === 3 ? BLACKOUT_PLAN[this.name] : 0;
        if (plan === null) return;
        const option = plan === "wrong" ? wrong : right;
        const delay = typeof plan === "number" ? plan : 300;
        if (option) setTimeout(() => this.socket.emit("participant:answer", { questionId: s.questionId, optionId: option.id }), delay);
      }
      if (s.kind === "backFinalist" && !s.backedId && s.finalists[0]) {
        this.socket.emit("participant:back", { finalistId: s.finalists[0].id });
      }
    });
    const res = await new Promise<{ ok: boolean; participantId?: string }>((r) => this.socket.emit("participant:join", { roomCode: room, name: this.name }, r));
    if (!res.ok || !res.participantId) throw new Error(`${this.name} couldn't join`);
    this.id = res.participantId;
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
  console.log(`  📸 ${state}`);
}

/** Phone layout: open a tab first (Game / Controls / People). */
async function tab(d: Device, name: "game" | "controls" | "people") {
  if (!d.wide) await d.page.getByTestId(`tab-${name}`).click();
}

async function label(d: Device, testId: string, expect: string) {
  const el = d.page.getByTestId(testId);
  await el.waitFor({ state: "visible" });
  let text = "";
  for (let i = 0; i < 50 && !text.toLowerCase().includes(expect.toLowerCase()); i++) {
    text = ((await el.textContent()) ?? "").trim();
    if (!text.toLowerCase().includes(expect.toLowerCase())) await sleep(100);
  }
  check(text.toLowerCase().includes(expect.toLowerCase()), `${testId} says "${expect}"`);
}

/** Clicks the big button (after a person's pause, not a double tap) and waits for the step to move. */
async function primary(d: Device, expectLabel?: string) {
  if (expectLabel) await label(d, "primary", expectLabel);
  await sleep(700); // the store ignores a second tap within 600 ms
  const before = adminView!.stepId;
  await d.page.getByTestId("primary").click();
  await waitFor("step to move on", (v) => v.stepId !== before);
}

/** Clicks an "or: …" chip above the big button. */
async function optional(d: Device, type: string) {
  const chip = d.page.getByTestId(`optional-${type}`);
  await chip.waitFor({ state: "visible" });
  await sleep(700);
  const before = adminView!.stepId;
  await chip.click();
  try {
    await waitFor(`${type} to happen`, (v) => v.stepId !== before, 4000);
  } catch {
    // Say what the page showed (a refusal toast, a disabled chip) before giving up.
    await d.page.screenshot({ path: path.join(OUT, `fail-${type}-${d.name}.png`) });
    const toast = await d.page.getByTestId("command-error").textContent().catch(() => null);
    const disabled = await chip.isDisabled();
    throw new Error(`the ${type} chip did nothing (toast: ${toast ?? "none"}, disabled: ${disabled}, phase ${adminView?.phase})`);
  }
  check(true, `"or: …" chip: ${type}`);
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

  // A watching Admin socket opens a room with the Demo quiz; a Host socket shows it.
  const watcher = await connect();
  watcher.on("admin:state", (v) => {
    adminView = v;
    if (phases[phases.length - 1] !== v.phase) phases.push(v.phase);
  });
  await new Promise((r) => watcher.emit("admin:login", { pin: PIN }, r));
  const opened = await new Promise<OpenRoomResult>((r) => watcher.emit("admin:openRoom", { quizId: "demo" }, r));
  if (!opened.ok) throw new Error(`Couldn't open a room with the Demo quiz: ${opened.error} ${opened.problems?.join("; ") ?? ""}`);
  const roomCode = opened.roomCode;
  /** Unique per run, and deleted at the end, so runs don't pile up in the library. */
  const QUIZ_TITLE = `Admin run ${roomCode}`;
  console.log(`\nRoom ${roomCode}`);
  const host = await connect();
  await new Promise((r) => host.emit("host:auth", { pin: PIN, roomCode }, r));

  const players = ["Riya", "Kabir", "Zoya", "Aadi", "Meera"].map((n) => new Player(n));
  for (const p of players) await p.join(roomCode);

  let bots: ChildProcess | null = null;
  if (BOTS > 0) {
    bots = spawn(`npx tsx scripts/bots.ts --room ${roomCode} --count ${BOTS} --url ${GAME} --pin ${PIN} --accuracy 0.3-0.6 --slow`, { shell: true, stdio: "ignore" });
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
    // ---- sign in: the code prefilled, a wrong PIN first (clear error), then the right one
    await phone.page.locator('input[name="pin"]').waitFor();
    await shot(devices, "00-sign-in");
    for (const d of devices) check((await d.page.getByTestId("room-code").inputValue()) === roomCode, `${d.name}: the room code is prefilled from ?code=`);
    await phone.page.locator('input[name="pin"]').fill("0000");
    await phone.page.getByTestId("sign-in").click();
    await phone.page.getByText("Wrong PIN").waitFor();
    check(true, "wrong PIN shows a clear error");
    for (const d of devices) {
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
    check((await laptop.page.getByTestId("step-label").textContent())?.includes("intro"), "the laptop Admin is in sync");

    // ---- Q1: pause in the read step (P key on the laptop), resume (button on the phone)
    await primary(phone, "Show question");
    await waitPhase("r1Read");
    await label(phone, "primary-wait", "Reading");
    await laptop.page.keyboard.press("p");
    await waitFor("paused", (v) => v.paused);
    await label(phone, "paused", "PAUSED: TAP RESUME");
    await shot(devices, "02-paused-round1");
    await phone.page.getByTestId("quick-pause").click();
    await waitFor("resumed", (v) => !v.paused);
    check(true, "pause with P, resume with the button");

    // answering: the button counts down; +5s
    await waitPhase("r1Answer");
    await label(phone, "primary-wait", "Answering");
    const before = adminView!.timer!.durationMs;
    await small.page.getByTestId("quick-addTime").click();
    await waitFor("+5s", (v) => (v.timer?.durationMs ?? 0) > before);
    check(true, "+5s added to the answer timer");
    await waitFor("some answers", (v) => (v.counts.answered ?? 0) >= players.length);
    await shot(devices, "03-round1-answering");

    await waitPhase("r1TimesUp", 30_000);
    await primary(phone, "Reveal answer");
    await waitPhase("r1Reveal");
    await phone.page.getByTestId("optional-showResults").waitFor();
    check(await phone.page.getByText("✓ correct").first().isVisible(), "the right answer is filled mint with ✓ correct");
    await shot(devices, "04-round1-reveal");
    await optional(phone, "showResults");

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
    await optional(phone, "showLeaderboard");
    check(adminView!.phase === "r1Leaderboard", "or: Show leaderboard put the leaderboard up");

    // ---- Q3 (last): straight through, then End round 1
    await primary(phone, "Next question");
    await waitPhase("r1TimesUp", 30_000);
    await primary(phone, "Reveal answer");
    await primary(phone, "End round 1");
    await waitPhase("cut");
    await phone.page.getByTestId("cut").waitFor();
    check((await phone.page.getByTestId("cut-row").count()) === Math.min(20, adminView!.cut!.standings.length), "the cut table lists the top 20");
    const topScore = adminView!.cut!.standings[0].score;
    check(topScore > 0 && topScore <= 600, `Round 1 scores are 100–200 a question (top: ${topScore} over 3)`);
    await shot(devices, "05-the-cut");

    // ---- The wild card round, from the phone
    const safeNames = adminView!.finalists.map((f) => f.name);
    check(safeNames.length === 3, `the cut: ${safeNames.length} safe (${safeNames.join(", ")})`);
    await primary(phone, "Start wild card round");
    await waitPhase("wcIntro");
    await primary(phone, "Show question");
    await waitPhase("wcAnswer");
    await shot(devices, "06-wildcard-answering");
    await waitPhase("wcTimesUp", 30_000);
    await primary(phone, "Reveal answer");
    await waitPhase("wcReveal");
    // Void the first wild card question; the next one takes its number.
    await tab(phone, "controls");
    await twoTaps(phone, "ctl-voidQuestion");
    await waitFor("wild card voided", (v) => v.stepLabel.includes("cancelled"));
    check(true, "void in the wild card round");
    await tab(phone, "game");
    await primary(phone, "Next question");
    check(adminView!.question?.number === 1, "the next wild card question takes the voided one's number");
    await waitPhase("wcTimesUp", 30_000);
    await primary(phone, "Reveal answer");
    await optional(phone, "showStandings");
    await phone.page.getByTestId("wild-card").waitFor();
    await shot(devices, "07-wildcard-standings");
    for (let guard = 0; guard < 10 && !adminView!.allowed.includes("revealWildCard"); guard++) {
      await primary(phone);
      await waitFor("wild card question done", (v) => v.phase === "wcTimesUp" || v.phase === "wcReveal", 30_000);
      if (adminView!.phase === "wcTimesUp") await primary(phone, "Reveal answer");
      await waitPhase("wcReveal");
    }
    await primary(phone, "Reveal wild card");
    await waitPhase("wcWinner");
    await phone.page.getByTestId("wild-card-winner").waitFor();
    check(adminView!.finalists.length === 4, "the wild card makes 4 finalists in the demo");
    await shot(devices, "08-wildcard-winner");

    await optional(phone, "openPredictions");
    await waitPhase("predictions");
    await phone.page.getByTestId("predictions").waitFor();
    await sleep(600);
    await shot(devices, "09-predictions");

    // ---- Blackout: ONE click, then only fixes
    await primary(phone, "Start Blackout");
    const flowClicksAt = phases.length;
    await waitPhase("boIntro");
    await label(phone, "primary", "Pause");
    await phone.page.getByTestId("autopilot").waitFor();
    check((await phone.page.getByTestId("runner-row").count()) === 4, "the distance ladder lists every runner");

    // Q1 answer step: pause with the big button, resume (it turns alarm red)
    await waitPhase("boAnswer", 20_000);
    await phone.page.getByTestId("dark-preview").waitFor();
    await shot(devices, "10-blackout-answering");
    await sleep(700);
    await phone.page.getByTestId("primary").click();
    await waitFor("paused in the answer step", (v) => v.paused && v.phase === "boAnswer");
    await label(phone, "primary", "Resume");
    check((await phone.page.getByTestId("primary").getAttribute("class"))?.includes("bg-alarm"), "RESUME is filled alarm red");
    const frozen = adminView!.timer!.remainingMs!;
    await sleep(1500);
    check(adminView!.phase === "boAnswer" && adminView!.timer?.remainingMs === frozen, "the autopilot waits while paused");
    await shot(devices, "11-blackout-paused");
    await sleep(700);
    await phone.page.getByTestId("primary").click();
    await waitFor("resumed", (v) => !v.paused);
    check(Math.abs(adminView!.timer!.endsAt - adminView!.serverNow - frozen) < 800, "resume carries on from the same moment");
    // +5 s while answering
    const d0 = adminView!.timer!.durationMs;
    await phone.page.getByTestId("bo-addTime").click();
    await waitFor("+5 s in Blackout", (v) => (v.timer?.durationMs ?? 0) === d0 + 5000);
    check(true, "+5 s during the Blackout answer step");

    await waitPhase("boReveal", 30_000);
    await sleep(500);
    await shot(devices, "12-blackout-reveal");
    // The dark's hold: pause and resume with the P key on the laptop, then skip the hold.
    await waitPhase("boDark", 20_000);
    // Pause first (the hold is ~3 s), then the screenshot of the dark's hold.
    await laptop.page.keyboard.press("p");
    await waitFor("paused in the dark's hold", (v) => v.paused && v.phase === "boDark");
    await shot(devices, "13-blackout-dark-paused");
    await laptop.page.keyboard.press("p");
    await waitFor("resumed", (v) => !v.paused);
    check(true, "pause / resume in the dark's hold (P key)");
    await phone.page.getByTestId("bo-skipTimer").click();
    await waitFor("skipped the hold", (v) => v.phase === "boRead" || v.phase === "boWinner");
    check(true, "Skip ended the dark's hold now");

    if (adminView!.phase === "boRead") {
      // Q2: void it while it's read (two taps): nobody moves, the next question takes its number.
      const number = adminView!.question!.number;
      const darkBefore = adminView!.blackout!.dark;
      await twoTaps(phone, "bo-voidQuestion");
      await waitFor("voided", (v) => v.phase === "boReveal");
      check(adminView!.blackout!.dark === darkBefore, "void: the dark stays");
      await waitFor("next question by itself", (v) => v.phase === "boRead" && v.question?.number === number, 15_000);
      check(true, "after a void the next question came by itself, with the same number");

      // Restart it in the answer step: positions back, fresh ids.
      await waitPhase("boAnswer", 15_000);
      const id = adminView!.question!.id;
      const positions = adminView!.blackout!.runners.map((r) => r.position).join();
      await twoTaps(phone, "bo-restartQuestion");
      await waitFor("restarted", (v) => v.phase === "boRead" && v.question?.id !== id);
      check(adminView!.blackout!.runners.map((r) => r.position).join() === positions, "restart question: positions as before, fresh ids");

      // A double Space on the laptop pauses once (the second tap is ignored).
      await sleep(700);
      await laptop.page.keyboard.press(" ");
      await laptop.page.keyboard.press(" ");
      await sleep(900);
      check(adminView!.paused, "a double Space paused once (and didn't resume)");
      await sleep(700);
      await laptop.page.keyboard.press(" ");
      await waitFor("resumed", (v) => !v.paused);

      // Refresh Admin mid-chase: same place, the autopilot kept running.
      const stepBefore = adminView!.stepId;
      await small.page.reload();
      await small.page.getByTestId("autopilot").waitFor({ timeout: 15_000 });
      check(adminView!.stepId >= stepBefore, "Admin refreshed mid-Blackout lands back on the autopilot");
    }

    // The podium arrives by itself: no flow click since Start Blackout.
    await waitPhase("boWinner", 240_000);
    await waitPhase("podium", 20_000);
    const flow = phases.slice(flowClicksAt);
    check(flow.includes("boDark") && flow.includes("boWinner"), `the autopilot ran ${flow.filter((p) => p === "boRead").length} question reads and the winner moment by itself`);
    await tab(phone, "game");
    const winner = adminView!.podium?.entries[0];
    await phone.page.getByTestId("podium").waitFor();
    check(winner && (await phone.page.getByTestId("podium").textContent())?.includes(winner.name), `podium names the winner (${winner?.name})`);
    await shot(devices, "14-podium");

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
    await shot([phone, small], "15-participants");

    // ---- Quiz library on the phone: leave the room, make a quiz, open a room with it
    await tab(phone, "controls");
    await phone.page.getByTestId("ctl-leave").click();
    await phone.page.getByTestId("quiz-list").waitFor();
    await phone.page.getByTestId("room-row").first().waitFor({ timeout: 10_000 });
    check(true, "Leave room → home screen lists the open room");
    await shot([phone], "16-home");

    await phone.page.getByTestId("new-quiz").click();
    await phone.page.getByTestId("quiz-title").fill(QUIZ_TITLE);
    await phone.page.getByTestId("add-question").click();
    await phone.page.getByTestId("q-save").click();
    check((await phone.page.getByRole("alert").filter({ hasText: "empty" }).count()) > 0, "an empty question can't be saved (says why)");
    await phone.page.getByTestId("q-text").fill("Which planet is known as the Red Planet?");
    for (const [i, text] of ["Venus", "Jupiter", "Mars", "Saturn"].entries()) await phone.page.getByTestId(`q-option-${i}`).fill(text);
    await phone.page.getByTestId("q-correct-2").click();
    await phone.page.getByTestId("q-save").click();
    await phone.page.getByTestId("question-card").first().waitFor();
    check((await phone.page.getByTestId("question-card").first().textContent())?.includes("✓ Mars"), "the new question shows its right answer");

    await phone.page.getByTestId("import-questions").click();
    await phone.page.getByText("Fill in the example").click();
    await phone.page.getByTestId("import-preview").waitFor();
    check((await phone.page.getByTestId("import-add").textContent())?.includes("4 QUESTIONS"), "pasted text: 4 questions found (2 Round 1, 1 wild card, 1 Blackout)");
    await phone.page.getByTestId("import-add").click();
    check((await phone.page.getByTestId("question-card").count()) === 3, "Round 1 list now has 3 questions");
    // Blackout plays until one runner is left: this server wants at least 8 (demo) Blackout questions.
    const blackoutText = Array.from({ length: 7 }, (_, i) => `Dark question ${i + 2}?\n* right ${i}\nwrong a${i}\nwrong b${i}\nwrong c${i}`).join("\n\n");
    await phone.page.getByTestId("import-questions").click();
    await phone.page.getByTestId("import-text").fill(`# Blackout\n${blackoutText}`);
    await phone.page.getByTestId("import-preview").waitFor();
    await phone.page.getByTestId("import-add").click();

    await phone.page.getByTestId("editor-tab-settings").click();
    await phone.page.getByTestId("ready").waitFor();
    check((await phone.page.getByTestId("ready").textContent())?.includes("Wild card is set to"), "Settings says what's missing (wild card count > list)");
    await phone.page.getByTestId("rule-wildCardQuestions").fill("1");
    await phone.page.getByTestId("ready").getByText("Yes.").waitFor();
    check((await phone.page.getByTestId("rule-blackoutQuestions").textContent())?.includes("8"), "Blackout shows its list length (no count to set)");
    await shot([phone], "17-settings");
    await phone.page.getByTestId("save-state").filter({ hasText: "Saved" }).waitFor({ timeout: 10_000 });
    check(true, "the quiz saves by itself");

    await phone.page.getByTestId("editor-back").click();
    const card = phone.page.getByTestId("quiz-card").filter({ hasText: QUIZ_TITLE });
    await card.getByText("Ready to play").waitFor();
    await card.getByTestId("open-room").click();
    await phone.page.getByTestId("room-quiz").filter({ hasText: QUIZ_TITLE }).waitFor();
    check(true, "Open room → a new room playing the new quiz, straight into its lobby");

    // ---- The projector: PIN, then the newest open room
    const rooms = await new Promise<{ roomCode: string; quizTitle: string }[] | null>((r) => watcher.emit("admin:rooms", r));
    const newest = rooms?.[0];
    check(newest?.quizTitle === QUIZ_TITLE, "the new room is the newest");
    const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await projector.goto(`${WEB}/host`);
    await projector.locator('input[name="pin"]').fill("0000");
    await projector.getByTestId("host-sign-in").click();
    await projector.getByText("Wrong PIN").waitFor();
    check(true, "projector: a wrong PIN is refused");
    await projector.locator('input[name="pin"]').fill(PIN);
    await projector.getByTestId("host-sign-in").click();
    await projector.getByLabel(`Room code ${newest!.roomCode}`).waitFor({ timeout: 15_000 });
    check(true, `projector: the right PIN shows the newest room (${newest!.roomCode})`);

    console.log(`\nAll ${checks} checks passed. Screenshots in ${OUT}\n`);
  } finally {
    // Leave the library and the room list as they were: delete this run's quiz, close its rooms.
    const quizzes = await new Promise<{ id: string; title: string }[] | null>((r) => watcher.emit("library:list", r));
    for (const q of quizzes?.filter((q) => q.title === QUIZ_TITLE) ?? []) await new Promise((r) => watcher.emit("library:delete", { id: q.id }, r));
    const open = await new Promise<{ roomCode: string; quizTitle: string }[] | null>((r) => watcher.emit("admin:rooms", r));
    for (const room of open?.filter((x) => x.roomCode === roomCode || x.quizTitle === QUIZ_TITLE) ?? []) {
      await new Promise((r) => watcher.emit("admin:closeRoom", { roomCode: room.roomCode }, r));
    }
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
