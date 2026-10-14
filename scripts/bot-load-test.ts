/**
 * Load test: a whole quiz (final_quiz.json, event preset) with 100 bot phones.
 *
 *   npm run bot-load-test                       (100 bots, real timings: about 15 minutes)
 *   npm run bot-load-test -- --bots 150
 *   npm run bot-load-test -- --speed 0.25       (every timer 4× faster, for a quick try)
 *
 * Starts the game server in its own process (scripts/load-test-server.ts, so its
 * CPU and memory can be measured), opens a room with "Hermes final quiz" as
 * Admin, and connects the bots through the same Socket.IO events real phones
 * use. Admin clicks the big button (like the quizmaster) and skips Round 1's
 * question 5, so a spare plays. Bots answer at random times, some right, some
 * wrong, some deliberately late, some double-tapping; on multi-correct
 * questions they tick a random mix (some never lock in); about 10% drop and
 * rejoin mid-round, several times.
 *
 * Then it checks: every bot got every question it should and every round change;
 * every bot's Round 1 score, wild card tally and Blackout position match what
 * the rules say (worked out here, independently, from what each bot sent and
 * when); late answers were rejected; reconnecting bots kept their name and score;
 * no server errors. And reports server CPU and memory, and how long questions
 * took to reach the phones (p95 and max). Exit code 1 if any check fails.
 */
import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import type { AdminAction, AdminView, ClientToServerEvents, JoinResult, OpenRoomResult, ParticipantView, ServerToClientEvents } from "../src/shared/protocol";
import { multiPoints, PRESETS, round1Points } from "../server/config";
import { FINAL_QUIZ_ID } from "../server/finalQuiz";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BOTS = Number(arg("bots", "100"));
const SPEED = Number(arg("speed", "1"));
const SEED = Number(arg("seed", String(Date.now() % 100_000)));
const PIN = "4321";
/** Round 1 question (by number) the quizmaster skips, so a spare plays. */
const SKIP_AT = 5;
/** Questions where about 10% of the bots drop and rejoin (round, number): during the read step. */
const RECONNECT_AT = new Set(["1:3", "1:12", "2:2", "3:2"]);
/** An answer sent this close to the end of the answer time may land on either side: not checked strictly. */
const EDGE_MS = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A seeded random, so a failing run can be replayed with --seed.
let seed = SEED;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];

let failures = 0;
const results: string[] = [];
function check(ok: unknown, what: string) {
  const line = `  ${ok ? "✓" : "✗"} ${what}`;
  console.log(line);
  results.push(line);
  if (!ok) failures += 1;
}

// ----------------------------------------------------------------------------- the server

interface Stats {
  cpu: number;
  rss: number;
  heap: number;
  at: number;
}
const stats: Stats[] = [];
const serverErrors: string[] = [];
let server: ChildProcess | null = null;

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = fork(path.join(process.cwd(), "scripts", "load-test-server.ts"), [], {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, LOAD_TEST_SPEED: String(SPEED), LOAD_TEST_PIN: PIN, DATABASE_URL: "" },
      stdio: ["ignore", "inherit", "pipe", "ipc"],
    });
    server.stderr?.on("data", (d: Buffer) => serverErrors.push(`stderr: ${d.toString().trim()}`));
    server.on("message", (m: { type: string; port?: number; line?: string; message?: string; cpu?: number; rss?: number; heap?: number }) => {
      if (m.type === "ready") resolve(m.port!);
      else if (m.type === "stats") stats.push({ cpu: m.cpu!, rss: m.rss!, heap: m.heap!, at: Date.now() });
      else if (m.type === "error") serverErrors.push(m.message!);
      else if (m.type === "log" && /error|fail/i.test(m.line!)) serverErrors.push(`log: ${m.line}`);
    });
    server.on("exit", (code) => {
      if (code) serverErrors.push(`the server exited with code ${code}`);
      reject(new Error(`server exited (${code})`));
    });
  });
}

// ----------------------------------------------------------------------------- what Admin saw

interface RunInfo {
  id: string;
  round: 1 | 2 | 3;
  number: number;
  suddenDeath: boolean;
  multi: boolean;
  /** Right option texts. */
  right: Set<string>;
  voided: boolean;
  /** Who could answer it (Admin's answered !== null), from its time's up / reveal. */
  eligible: Set<string>;
}
const runs = new Map<string, RunInfo>();
let admin: AdminView | null = null;

function trackAdmin(v: AdminView) {
  admin = v;
  const q = v.question;
  if (!q) return;
  let r = runs.get(q.id);
  if (!r) {
    r = { id: q.id, round: q.round, number: q.number, suddenDeath: q.suddenDeath, multi: q.multi, right: new Set(q.options.filter((o) => o.correct).map((o) => o.text)), voided: false, eligible: new Set() };
    runs.set(q.id, r);
  }
  if (q.voided) r.voided = true;
  if (!["r1Read", "wcRead", "boRead"].includes(v.phase)) for (const p of v.participants) if (p.answered !== null) r.eligible.add(p.id);
}

// ----------------------------------------------------------------------------- bots

interface Sent {
  questionId: string;
  /** When the answer step started and ended (server clock; same machine). */
  start: number;
  endsAt: number;
  limit: number;
  options: string[];
  /** Single: the first option sent (a double tap sends a second one). Multi: the ticks. */
  picks: string[];
  /** When the answer / LOCK IN was sent; null = no answer (a miss), or a multi draft never locked. */
  sentAt: number | null;
  /** Multi: ticks sent but never locked in (the server sends them at time's up). */
  draft: boolean;
  late: boolean;
  doubleTap: boolean;
  /** The bot was disconnected while this question was open. */
  dropped: boolean;
  /** When the phone left this question's answer screen (time's up, or early when everyone had answered). */
  closedAt: number | null;
}

let joinUrl = "";
class Bot {
  socket!: Client;
  id = "";
  readonly accuracy = 0.4 + rand() * 0.45;
  /** Screens seen (kinds). */
  kinds = new Set<string>();
  /** Answer screens: questionId → what was offered and what this bot sent. */
  sent = new Map<string, Sent>();
  latencies: number[] = [];
  cutRank: number | null = null;
  wonWildCard = false;
  view: ParticipantView | null = null;
  timers = new Set<NodeJS.Timeout>();
  connected = false;
  reconnects = 0;
  /** Late answers whose phone, after time's up, didn't say "time's up" (should be 0). */
  lateAccepted = 0;

  constructor(readonly name: string) {}

  async connect(url: string, rejoin = false) {
    this.socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise<void>((res, rej) => {
      this.socket.once("connect", () => res());
      this.socket.once("connect_error", rej);
    });
    this.connected = true;
    this.socket.on("participant:state", (v) => this.onView(v));
    this.socket.on("disconnect", () => (this.connected = false));
    const result = await new Promise<JoinResult>((r) =>
      this.socket.emit("participant:join", { roomCode: joinUrl, name: rejoin ? "" : this.name, participantId: rejoin ? this.id : undefined }, r),
    );
    if (!result.ok) throw new Error(`${this.name} couldn't ${rejoin ? "rejoin" : "join"}: ${result.error}`);
    if (rejoin && result.participantId !== this.id) throw new Error(`${this.name} rejoined as someone else`);
    this.id = result.participantId;
  }

  drop() {
    this.socket.disconnect();
    this.connected = false;
    for (const s of this.sent.values()) if (s.sentAt === null && Date.now() < s.endsAt) s.dropped = true;
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.connected) fn();
    }, Math.max(0, ms));
    this.timers.add(t);
  }

  private onView(v: ParticipantView) {
    this.view = v;
    const s = v.screen;
    this.kinds.add(s.kind);
    if (s.kind === "cut") this.cutRank = s.rank;
    if (s.kind === "wcWinner") this.wonWildCard = s.you === "won";
    const last = this.sent.get(lastAnswerId(this) ?? "");
    if (last && last.closedAt === null && !(s.kind === "answer" && s.questionId === last.questionId)) last.closedAt = Date.now();
    // A late answer must never be taken: after time's up the phone says "time's up", never "locked in".
    if (s.kind === "lockedIn" && last?.late && last.sentAt !== null && !last.draft) this.lateAccepted += 1;
    if (s.kind !== "answer" || this.sent.has(s.questionId) || !v.timer) return;
    // A new question on this phone: how long it took to get here, then plan the answer.
    this.latencies.push(Date.now() - v.serverNow);
    const start = v.timer.endsAt - v.timer.durationMs;
    const rec: Sent = {
      questionId: s.questionId,
      start,
      endsAt: v.timer.endsAt,
      limit: v.timer.durationMs,
      options: s.options.map((o) => o.text),
      picks: [],
      sentAt: null,
      draft: false,
      late: false,
      doubleTap: false,
      dropped: false,
      closedAt: null,
    };
    this.sent.set(s.questionId, rec);
    const roll = rand();
    if (roll < 0.07) return; // never answers
    const late = roll < 0.14;
    const at = late ? rec.endsAt + 250 + rand() * 600 : start + rec.limit * (0.05 + rand() * 0.9);
    const qid = s.questionId;
    const ids = new Map(s.options.map((o) => [o.text, o.id]));

    if (s.multi) {
      // A random mix of ticks (at least one), sent as they're made; most lock in, some leave a draft.
      let ticks = s.options.filter(() => rand() < 0.5).map((o) => o.text);
      if (ticks.length === 0) ticks = [pick(s.options).text];
      const leaveDraft = !late && rand() < 0.15;
      // A late bot ticks late too (after time's up, so nothing reaches the server in time).
      const tickFrom = late ? rec.endsAt + 50 : start;
      ticks.forEach((_, i) =>
        this.later(tickFrom + ((at - tickFrom) * (i + 1)) / (ticks.length + 1) - Date.now(), () =>
          this.socket.emit("participant:select", { questionId: qid, optionIds: ticks.slice(0, i + 1).map((t) => ids.get(t)!) }),
        ),
      );
      rec.picks = ticks;
      rec.late = late;
      if (leaveDraft) {
        rec.draft = true;
        return;
      }
      this.later(at - Date.now(), () => {
        rec.sentAt = Date.now();
        this.socket.emit("participant:answer", { questionId: qid, optionIds: ticks.map((t) => ids.get(t)!) });
        // A double tap on LOCK IN: the second one must change nothing.
        if (rand() < 0.15) this.socket.emit("participant:answer", { questionId: qid, optionIds: [s.options[0].id] });
      });
      return;
    }

    this.later(at - Date.now(), () => {
      const run = runs.get(qid);
      const right = run ? s.options.filter((o) => run.right.has(o.text)) : [];
      const wrong = s.options.filter((o) => !right.includes(o));
      const choice = right.length && rand() < this.accuracy ? pick(right) : pick(wrong.length ? wrong : s.options);
      rec.picks = [choice.text];
      rec.sentAt = Date.now();
      rec.late = late;
      this.socket.emit("participant:answer", { questionId: qid, optionId: choice.id });
      // Double tap: a second (different) answer a moment later; the first one counts.
      if (rand() < 0.15) {
        rec.doubleTap = true;
        const other = s.options.find((o) => o !== choice)!;
        this.later(40 + rand() * 60, () => this.socket.emit("participant:answer", { questionId: qid, optionId: other.id }));
      }
    });
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.socket?.disconnect();
  }
}

function lastAnswerId(bot: Bot): string | null {
  const ids = [...bot.sent.keys()];
  return ids[ids.length - 1] ?? null;
}

// ----------------------------------------------------------------------------- the rules, worked out here

type Verdict = { accepted: boolean | "edge"; elapsed: number };
function verdict(s: Sent): Verdict | null {
  if (s.dropped) return null;
  if (s.draft) return { accepted: s.picks.length > 0, elapsed: s.limit }; // sent by the server at the full time
  if (s.sentAt === null) return null;
  const elapsed = Math.min(s.limit, Math.max(0, s.sentAt - s.start));
  // Time's up came early (everyone else had answered): judge against when this phone saw it end.
  const early = s.closedAt !== null && s.closedAt < s.endsAt - EDGE_MS;
  const end = early ? s.closedAt! : s.endsAt;
  const margin = early ? 250 : EDGE_MS;
  if (s.sentAt > end + margin) return { accepted: false, elapsed };
  if (s.sentAt > end - margin) return { accepted: "edge", elapsed };
  return { accepted: true, elapsed };
}

/** Round 1 points for one answer (the same rules as SPEC, computed here from what the bot sent). */
function r1Points(s: Sent, run: RunInfo): { points: number; edge: boolean } {
  const v = verdict(s);
  if (!v || v.accepted === false) return { points: 0, edge: false };
  let points: number;
  if (run.multi) {
    const found = s.picks.filter((t) => run.right.has(t)).length;
    points = multiPoints(v.elapsed, s.limit, found, run.right.size, s.picks.length - found);
  } else points = run.right.has(s.picks[0]) ? round1Points(v.elapsed, s.limit) : 0;
  return { points, edge: v.accepted === "edge" };
}

// ----------------------------------------------------------------------------- the run

function percentile(xs: number[], p: number) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`\nLoad test: ${BOTS} bots, final_quiz.json, event preset${SPEED !== 1 ? `, timers ×${SPEED}` : ", real timings"}, seed ${SEED}\n`);
  const port = await startServer();
  const url = `http://127.0.0.1:${port}`;
  const started = Date.now();

  // Admin: PIN, then a room with the night's quiz.
  const adminSocket: Client = io(url, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((r) => adminSocket.once("connect", () => r()));
  adminSocket.on("admin:state", trackAdmin);
  await new Promise((r) => adminSocket.emit("admin:login", { pin: PIN }, r));
  const opened = await new Promise<OpenRoomResult>((r) => adminSocket.emit("admin:openRoom", { quizId: FINAL_QUIZ_ID }, r));
  if (!opened.ok) throw new Error(`Couldn't open a room: ${opened.error} ${opened.problems?.join("; ") ?? ""}`);
  joinUrl = opened.roomCode;
  console.log(`  room ${opened.roomCode}`);

  // Bots join a few at a time, with unique names.
  const bots = Array.from({ length: BOTS }, (_, i) => new Bot(`Bot ${String(i + 1).padStart(3, "0")}`));
  for (let i = 0; i < bots.length; i += 10) await Promise.all(bots.slice(i, i + 10).map((b) => b.connect(url)));
  const until = async (what: string, test: (v: AdminView) => boolean, ms = 60_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (admin && test(admin)) return admin;
      await sleep(30);
    }
    throw new Error(`timed out waiting for ${what} (phase ${admin?.phase})`);
  };
  await until("everyone joined", (v) => v.counts.joined === BOTS);
  check(true, `${BOTS} bots joined with unique names`);

  const send = async (action: AdminAction) => {
    const step = admin!.stepId;
    const r = await new Promise<{ ok: boolean; reason?: string }>((res) => adminSocket.emit("admin:command", { stepId: step, action }, res));
    if (!r.ok && r.reason !== "stale-step") serverErrors.push(`Admin ${action.type} refused: ${r.reason}`);
    return r.ok;
  };

  // Reconnects: ~10% of the bots who play this question drop during the read step and rejoin 1–2.5 s later.
  const reconnectChecks: { name: string; scoreBefore: number; ok: boolean }[] = [];
  const reconnectsDone = new Set<string>();
  const reconnect = async (v: AdminView) => {
    const q = v.question!;
    const key = `${q.round}:${q.number}`;
    if (!RECONNECT_AT.has(key) || reconnectsDone.has(key)) return;
    reconnectsDone.add(key);
    const playing = new Set(
      v.participants.filter((p) => (q.round === 1 ? p.status === "playing" : q.round === 2 ? p.status === "wildcard" : p.status === "finalist" && p.blackout?.place === null)).map((p) => p.id),
    );
    const pool = bots.filter((b) => playing.has(b.id) && b.connected).sort(() => rand() - 0.5);
    const chosen = pool.slice(0, Math.max(1, Math.round(playing.size * 0.1)));
    await Promise.all(
      chosen.map(async (b) => {
        const before = admin!.participants.find((p) => p.id === b.id)!;
        b.drop();
        await sleep(1000 + rand() * 1500);
        await b.connect(url, true);
        b.reconnects += 1;
        await sleep(300);
        const after = admin!.participants.find((p) => p.id === b.id)!;
        reconnectChecks.push({ name: b.name, scoreBefore: before.score, ok: after.name === before.name && after.score === before.score && after.connected });
      }),
    );
  };

  // The quizmaster: the big button, a short pause before each click, and one skipped question.
  let skipped = false;
  let clickedStep = -1;
  let lastPhase = "";
  const phaseLog: string[] = [];
  const deadline = Date.now() + 60 * 60_000;
  while (admin!.phase !== "podium") {
    if (Date.now() > deadline) throw new Error("the game didn't finish within an hour");
    const v = admin!;
    if (v.phase !== lastPhase) {
      lastPhase = v.phase;
      phaseLog.push(v.phase);
    }
    if (["r1Read", "wcRead", "boRead"].includes(v.phase) && v.question) void reconnect(v);
    if (v.phase === "r1TimesUp" && v.question?.number === SKIP_AT && !skipped) {
      skipped = true;
      await sleep(500);
      await send({ type: "voidQuestion" });
      continue;
    }
    const autopilot = v.phase.startsWith("bo");
    const p = v.primary;
    if (!autopilot && p && v.allowed.includes(p.action.type) && clickedStep !== v.stepId) {
      clickedStep = v.stepId;
      await sleep(400 + rand() * 500);
      if (admin!.stepId === v.stepId) await send(p.action);
      continue;
    }
    await sleep(50);
  }
  const elapsedMin = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`  podium after ${elapsedMin} min`);
  await sleep(1500);

  // ------------------------------------------------------------------- checks
  const final = admin!;
  const byId = new Map(final.participants.map((p) => [p.id, p]));
  const allRuns = [...runs.values()];
  const r1Runs = allRuns.filter((r) => r.round === 1);
  const wcRuns = allRuns.filter((r) => r.round === 2);
  const boRuns = allRuns.filter((r) => r.round === 3);
  console.log(`\n  ${r1Runs.length} Round 1 questions shown (${r1Runs.filter((r) => r.voided).length} skipped), ${wcRuns.length} wild card, ${boRuns.length} Blackout`);

  check(r1Runs.length === 21 && r1Runs.filter((r) => r.voided).length === 1, "Round 1: question 5 skipped, so a spare played (21 shown, 20 counted)");

  // Every bot got every question it could answer, and every round change.
  let missing = 0;
  for (const r of allRuns) for (const id of r.eligible) if (!bots.find((b) => b.id === id)?.sent.has(r.id)) missing += 1;
  check(missing === 0, `every bot received every question it could answer (${allRuns.reduce((n, r) => n + r.eligible.size, 0)} deliveries, ${missing} missing)`);
  const roundChanges = bots.filter((b) => ["r1Intro", "cut", "podium"].every((k) => b.kinds.has(k)) && (b.kinds.has("wcStatus") || b.kinds.has("safeWatch")) && (b.kinds.has("runnerStatus") || b.kinds.has("blackoutWatch")));
  check(roundChanges.length === BOTS, `every bot saw every round change: intro, the cut, the wild card, Blackout, the podium (${roundChanges.length}/${BOTS})`);

  // Round 1 scores, worked out independently.
  let exact = 0;
  let within = 0;
  let worst = 0;
  const off: string[] = [];
  for (const b of bots) {
    let expected = 0;
    let edges = 0;
    let answers = 0;
    for (const r of r1Runs) {
      if (r.voided) continue;
      const s = b.sent.get(r.id);
      if (!s) continue;
      const { points, edge } = r1Points(s, r);
      expected += points;
      if (edge) edges += 1;
      if (points > 0) answers += 1;
    }
    const actual = byId.get(b.id)!.score;
    const diff = Math.abs(actual - expected);
    worst = Math.max(worst, diff);
    // 1 point a scored answer for message transit and rounding; an answer sent on the last few ms may go either way.
    if (diff === 0) exact += 1;
    if (diff <= answers + edges * 200) within += 1;
    else off.push(`${b.name}: server ${actual}, expected ${expected}`);
  }
  check(within === BOTS, `Round 1 scores match the rules for every bot (${exact} exact, the rest within 1 point an answer for transit; largest gap ${worst})${off.length ? `: ${off.slice(0, 5).join("; ")}` : ""}`);

  // Wild card tallies.
  const wcPlayers = bots.filter((b) => byId.get(b.id)!.wildCorrect !== null);
  let wcOk = 0;
  for (const b of wcPlayers) {
    let right = 0;
    let edge = 0;
    for (const r of wcRuns) {
      if (r.voided || r.suddenDeath) continue;
      const s = b.sent.get(r.id);
      const v = s && verdict(s);
      if (!s || !v || v.accepted === false || !r.right.has(s.picks[0])) continue;
      if (v.accepted === "edge") edge += 1;
      else right += 1;
    }
    const actual = byId.get(b.id)!.wildCorrect!;
    if (actual >= right && actual <= right + edge) wcOk += 1;
  }
  check(wcOk === wcPlayers.length, `wild card: every player's number right matches (${wcOk}/${wcPlayers.length})`);

  // Blackout positions: start (base gap + head start by Round 1 rank) plus every move.
  const cfg = PRESETS.event.blackout;
  const runners = bots.filter((b) => byId.get(b.id)!.blackout);
  let boOk = 0;
  for (const b of runners) {
    const me = byId.get(b.id)!;
    let pos = cfg.baseGap + (me.isWildCard ? cfg.headStart.wildCard : (me.rank ?? 99) <= 3 ? cfg.headStart.top3 : cfg.headStart.safe);
    let slack = 0;
    for (const r of boRuns) {
      if (r.voided) continue;
      const s = b.sent.get(r.id);
      const v = s && verdict(s);
      if (!s || !v || v.accepted === false) continue;
      if (v.accepted === "edge") slack += 3;
      const third = s.limit / 3;
      if (Math.abs(v.elapsed - third) < EDGE_MS || Math.abs(v.elapsed - 2 * third) < EDGE_MS) slack += 1;
      if (r.right.has(s.picks[0])) pos += v.elapsed < third ? 3 : v.elapsed < 2 * third ? 2 : 1;
      else if (pos > 0) pos -= 1;
    }
    if (Math.abs(me.blackout!.position - pos) <= slack) boOk += 1;
    else console.log(`    ${b.name}: Blackout position ${me.blackout!.position}, expected ${pos}`);
  }
  check(boOk === runners.length && runners.length >= 10, `Blackout: every runner's final position matches the moves (${boOk}/${runners.length})`);
  check(final.podium?.entries.filter((e) => e.place === 1).length === 1, `exactly one winner (${final.podium?.entries[0]?.name})`);

  // Late answers, double taps, reconnects.
  const lateSent = bots.reduce((n, b) => n + [...b.sent.values()].filter((s) => s.late && s.sentAt !== null).length, 0);
  const lateTaken = bots.reduce((n, b) => n + b.lateAccepted, 0);
  check(lateTaken === 0, `late answers rejected (${lateSent} sent after time's up, ${lateTaken} taken)`);
  const doubles = bots.reduce((n, b) => n + [...b.sent.values()].filter((s) => s.doubleTap).length, 0);
  check(within === BOTS, `double taps: only the first answer counts (${doubles} double taps, scores above match the first)`);
  check(reconnectChecks.length >= 4 && reconnectChecks.every((r) => r.ok), `reconnects: ${reconnectChecks.length} drops and rejoins mid-round, all kept their name and score${reconnectChecks.filter((r) => !r.ok).map((r) => ` ✗ ${r.name}`).join("")}`);

  check(serverErrors.length === 0, `no server errors or crashes${serverErrors.length ? `:\n    ${serverErrors.slice(0, 10).join("\n    ")}` : ""}`);

  // Server CPU and memory; how fast questions reached the phones.
  const cpu = stats.map((s) => s.cpu);
  const rss = stats.map((s) => s.rss / 1e6);
  const heap = stats.map((s) => s.heap / 1e6);
  const lat = bots.flatMap((b) => b.latencies);
  const report = [
    `  server CPU: average ${(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)).toFixed(1)}%, peak ${Math.max(...cpu).toFixed(0)}% (of one core)`,
    `  server memory: RSS ${rss[0]?.toFixed(0)} → ${rss[rss.length - 1]?.toFixed(0)} MB (peak ${Math.max(...rss).toFixed(0)}), heap ${heap[0]?.toFixed(0)} → ${heap[heap.length - 1]?.toFixed(0)} MB (peak ${Math.max(...heap).toFixed(0)})`,
    `  question delivery (server sends → phone receives), ${lat.length} deliveries: median ${percentile(lat, 50)} ms, p95 ${percentile(lat, 95)} ms, max ${Math.max(...lat)} ms`,
  ];
  console.log(`\n${report.join("\n")}`);
  check(percentile(lat, 95) < 500, "p95 question delivery under 500 ms");

  console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"} (${BOTS} bots, ${elapsedMin} min, seed ${SEED}).\n`);
  for (const b of bots) b.stop();
  adminSocket.disconnect();
  server?.removeAllListeners("exit");
  server?.kill();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  server?.kill();
  process.exit(1);
});
