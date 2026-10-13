/**
 * Plays whole quizzes and every edge case with fake participants and a fake
 * clock, and checks every rule in docs/SPEC.md (v3.1) held: Round 1, the cut, the
 * wild card round, predictions, Blackout on autopilot and the podium. No sockets, no
 * browser, runs in a few seconds. Run: npm run simulate
 */
import assert from "node:assert/strict";
import {
  type AdminAction,
  BOT_HEADS,
  BOT_LIGHTNESS,
  type CommandResult,
  hexToHsl,
  type LibraryQuestion,
  normalizeBotColor,
  PARTICIPANT_COLORS,
  type Phase,
  type Quiz,
  type QuizRules,
} from "../src/shared/protocol";
import { blankQuestion, cleanQuiz, importJson, importRows, importText, parseCsv, quizProblems, quizToCsv } from "../src/shared/quiz";
import { darknessStep, type GameConfig, PRESETS, R1_MAX_POINTS, R1_MIN_POINTS, round1Points } from "./config";
import { quizToGame } from "./library";
import { loadQuestions, type QuizQuestion } from "./questions";
import { type Clock, QuizRoom } from "./quiz";

// ============================================================================
// Test kit
// ============================================================================

class FakeClock implements Clock {
  private t = 1_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.timers.delete(handle as number);
  }
  /** Moves time forward, firing any timers that come due on the way. */
  advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      const next = this.earliest();
      if (!next || next[1].at > target) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = target;
  }
  /** Jumps to the next timer and fires it. False if nothing is scheduled. */
  runNext(): boolean {
    const next = this.earliest();
    if (!next) return false;
    this.timers.delete(next[0]);
    this.t = Math.max(this.t, next[1].at);
    next[1].fn();
    return true;
  }
  private earliest() {
    let next: [number, { at: number; fn: () => void }] | null = null;
    for (const entry of this.timers) if (!next || entry[1].at < next[1].at) next = entry;
    return next;
  }
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const FILE_QUESTIONS = loadQuestions();

/** A made-up question set with this many questions tagged for each round. */
function questionSet(r1: number, wc: number, bo: number): QuizQuestion[] {
  const make = (id: string, round: 1 | 2 | 3, i: number): QuizQuestion => ({
    id,
    round,
    text: `Question ${id}?`,
    image: i % 5 === 0 ? "/questions/hexagon.svg" : null,
    options: [`${id} option 1`, `${id} option 2`, `${id} option 3`, `${id} option 4`],
    correct: i % 4,
  });
  return [
    ...Array.from({ length: r1 }, (_, i) => make(`r1-${i + 1}`, 1, i)),
    ...Array.from({ length: wc }, (_, i) => make(`wc-${i + 1}`, 2, i)),
    ...Array.from({ length: bo }, (_, i) => make(`bo-${i + 1}`, 3, i)),
  ];
}
const EVENT_QUESTIONS = questionSet(20, 8, 15);

/** A small, predictable config: safe 3, 3 wild card questions, a Blackout with a slow dark. */
function testConfig(overrides: Partial<GameConfig> = {}, blackout: Partial<GameConfig["blackout"]> = {}): GameConfig {
  const base = PRESETS.demo;
  return { ...base, ...overrides, blackout: { ...base.blackout, baseGap: 3, darkness: [1], ...blackout } };
}

const BEFORE_REVEAL: Phase[] = ["r1Read", "r1Answer", "r1TimesUp", "wcRead", "wcAnswer", "wcTimesUp", "boRead", "boAnswer", "boTimesUp"];
const ANSWER_PHASES: Phase[] = ["r1Answer", "wcAnswer", "boAnswer"];

type Pick = "correct" | "wrong";

class Game {
  readonly clock = new FakeClock();
  readonly room: QuizRoom;
  readonly rng: () => number;

  constructor(
    readonly config: GameConfig,
    questions: QuizQuestion[] = FILE_QUESTIONS,
    seed = 1,
  ) {
    this.rng = seeded(seed + 99);
    this.room = new QuizRoom("TEST", "http://localhost:3000/play", config, questions, () => {}, this.clock, seeded(seed));
  }

  get phase() {
    return this.room.currentPhase;
  }
  admin() {
    return this.room.adminView();
  }
  host() {
    return this.room.hostView();
  }
  phone(id: string) {
    const view = this.room.participantView(id);
    assert.ok(view, `no view for ${id}`);
    return view;
  }
  screen(id: string) {
    return this.phone(id).screen;
  }
  person(id: string) {
    const p = this.admin().participants.find((x) => x.id === id);
    assert.ok(p, `no participant ${id}`);
    return p;
  }
  runner(id: string) {
    const r = this.admin().blackout?.runners.find((x) => x.id === id);
    assert.ok(r, `no runner ${id}`);
    return r;
  }
  mood(id: string) {
    const c = this.host().cast.find((x) => x.id === id);
    assert.ok(c, `${id} not in the cast in ${this.phase}`);
    return c.mood;
  }

  join(name: string): string {
    const r = this.room.join(name);
    if (!r.ok) throw new Error(`join ${name} failed: ${r.error}`);
    return r.participantId;
  }

  /** Runs an admin action from the current step and insists it worked. */
  do(action: AdminAction) {
    const result = this.room.command(this.room.stepId, action);
    assert.deepEqual(result, { ok: true }, `${action.type} in ${this.phase}: ${JSON.stringify(result)}`);
  }
  try(action: AdminAction): CommandResult {
    return this.room.command(this.room.stepId, action);
  }
  /** Clicks the big button; returns its label. */
  primary(): string {
    const p = this.admin().primary;
    assert.ok(p, `expected a primary button in ${this.phase}`);
    assert.ok(this.admin().allowed.includes(p.action.type), `primary ${p.action.type} must be allowed`);
    this.do(p.action);
    return p.label;
  }
  /** Lets the running timer run out. */
  tick() {
    assert.ok(this.clock.runNext(), `a timer should be running in ${this.phase}`);
  }
  /** Blackout's autopilot: lets the current step or hold run out, and checks where it went. */
  next(phase: Phase) {
    this.tick();
    this.expect(phase);
  }
  /** Blackout (autopilot): one question from its read step to the reveal. No Admin clicks. */
  runnerQuestion(plan: [string, Pick, number][]) {
    this.expect("boRead");
    this.tick();
    this.expect("boAnswer");
    for (const [id, pick, at] of [...plan].sort((a, b) => a[2] - b[2])) {
      if (this.phase !== "boAnswer") break;
      this.answerAt(id, pick, at);
    }
    if (this.phase === "boAnswer") this.tick();
    this.expect("boTimesUp");
    this.next("boReveal");
  }
  expect(phase: Phase, why = "") {
    assert.equal(this.phase, phase, why);
  }

  /** Taps an option on `id`'s phone: the right one or a wrong one. */
  answer(id: string, pick: Pick) {
    const s = this.screen(id);
    assert.equal(s.kind, "answer", `${this.person(id).name} should see options in ${this.phase}`);
    if (s.kind !== "answer") return;
    const correctText = this.admin().question!.correctText;
    const option = s.options.find((o) => (pick === "correct" ? o.text === correctText : o.text !== correctText))!;
    this.room.answer(id, s.questionId, option.id);
  }
  /** Taps an option exactly `elapsedMs` into the answer step. */
  answerAt(id: string, pick: Pick, elapsedMs: number) {
    const t = this.admin().timer!;
    const elapsed = t.durationMs - (t.endsAt - this.clock.now());
    assert.ok(elapsedMs >= elapsed, `can't answer at ${elapsedMs}ms: already ${elapsed}ms in`);
    this.clock.advance(elapsedMs - elapsed);
    this.answer(id, pick);
  }

  /**
   * Plays one wild card or Blackout question from its Show/Next click to the
   * reveal. `plan`: who answers, what, and when (ms into the answer step).
   */
  playQuestion(plan: [string, Pick, number][], startLabel?: string) {
    // The optional standings come first after a wild card reveal: show them, then go on.
    if (this.admin().primary?.action.type === "showStandings") this.do({ type: "showStandings" });
    const label = this.primary();
    if (startLabel) assert.equal(label, startLabel);
    this.tick(); // read → answer
    assert.ok(ANSWER_PHASES.includes(this.phase), `answering in ${this.phase}`);
    for (const [id, pick, at] of [...plan].sort((a, b) => a[2] - b[2])) {
      if (!ANSWER_PHASES.includes(this.phase)) break;
      this.answerAt(id, pick, at);
    }
    if (ANSWER_PHASES.includes(this.phase)) this.tick();
    this.do({ type: "revealAnswer" });
  }

  /** No phone (and no Host) may know the answer before its reveal, in any round. */
  checkNoLeaks(ids: string[]) {
    if (!BEFORE_REVEAL.includes(this.phase)) return;
    for (const id of ids) {
      const json = JSON.stringify(this.phone(id));
      assert.ok(!json.includes('"correct'), `phone view leaks the answer in ${this.phase}: ${json.slice(0, 300)}`);
    }
    const hostJson = JSON.stringify(this.host());
    assert.ok(!/"correct(Text|Index)?":(?!null)/.test(hostJson), `host view leaks the answer in ${this.phase}`);
    const bo = this.host().stage;
    if ("blackout" in bo) assert.ok(bo.blackout.runners.every((r) => r.delta === null), `no moves shown before the reveal (${this.phase})`);
  }

  /** In an answer step, every phone with options and the Host show the same 1–4 order. */
  checkOneOrder(ids: string[]) {
    const stage = this.host().stage;
    if (!("question" in stage) || !stage.question.options || !ANSWER_PHASES.includes(this.phase)) return;
    for (const id of ids) {
      const s = this.screen(id);
      if (s.kind === "answer") assert.deepEqual(s.options.map((o) => o.text), stage.question.options, `phones use the Host's 1–4 order (${this.phase})`);
    }
  }
}

/** Round 1 played so that ids[0] is best, ids[1] second, and so on (everyone right, earlier = faster). */
function playRound1InOrder(g: Game, ids: string[]) {
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  const count = g.admin().settings.round1Questions;
  for (let q = 0; q < count; q++) {
    g.tick(); // read → answer
    g.expect("r1Answer");
    ids.forEach((id, i) => {
      g.clock.advance(100 + i * 50);
      g.answer(id, "correct");
    });
    g.expect("r1TimesUp", "everyone answered, so time's up comes early");
    g.do({ type: "revealAnswer" });
    if (q < count - 1) g.do({ type: "nextQuestion" });
  }
  g.do({ type: "endRound1" });
  g.expect("cut");
}

/** A room at the cut: safe 3 (the first three names), the rest in the wild card round. */
function atTheCut(names: string[], config = testConfig(), questions: QuizQuestion[] = FILE_QUESTIONS) {
  const g = new Game(config, questions);
  const ids = names.map((n) => g.join(n));
  playRound1InOrder(g, ids);
  return { g, ids, safe: ids.slice(0, config.safe), wild: ids.slice(config.safe) };
}

/** Through the wild card round: `winner` gets every question right, everyone else wrong. */
function toBlackout(names: string[], winnerIndex: number, config = testConfig(), questions: QuizQuestion[] = FILE_QUESTIONS) {
  const { g, ids, safe, wild } = atTheCut(names, config, questions);
  g.do({ type: "startWildCard" });
  const winner = ids[winnerIndex];
  for (let q = 0; q < config.wildCard.questions; q++) {
    g.playQuestion(wild.map((id) => [id, id === winner ? "correct" : "wrong", 500] as [string, Pick, number]));
  }
  assert.ok(g.admin().allowed.includes("revealWildCard"), "the wild card is decided");
  g.do({ type: "showStandings" });
  assert.equal(g.admin().primary?.label, "Reveal wild card");
  g.do({ type: "revealWildCard" });
  return { g, ids, safe, wild, winner };
}

const results: string[] = [];
function test(name: string, fn: () => void) {
  fn();
  results.push(name);
  console.log(`✓ ${name}`);
}

// ============================================================================
// Joining and bots
// ============================================================================

test("joining: duplicate and blank names, rejoin by id and by name, room full", () => {
  const g = new Game({ ...PRESETS.demo, maxParticipants: 3 });
  const riya = g.join("Riya");
  g.join("Aadi");
  assert.deepEqual(g.room.join("  riya "), { ok: false, error: "name-taken" }, "duplicate names rejected, any case");
  assert.deepEqual(g.room.join("   "), { ok: false, error: "name-invalid" });
  const long = g.room.join("A".repeat(50));
  assert.ok(long.ok && g.person(long.participantId).name.length === 20, "names cut to 20 characters");
  assert.deepEqual(g.room.join("Kabir"), { ok: false, error: "room-full" });

  g.room.disconnect(riya);
  assert.equal(g.person(riya).connected, false);
  const back = g.room.join("RIYA");
  assert.ok(back.ok && back.participantId === riya, "a dropped phone takes its seat back by typing the same name");
  const byId = g.room.join("", riya);
  assert.ok(byId.ok && byId.participantId === riya, "rejoin with the saved id");
});

test("bots: any colour (wheel), shared bots allowed, names unique; lobby only", () => {
  const g = new Game(PRESETS.demo);
  const ids = Array.from({ length: 100 }, (_, i) => g.join(`P${i}`));
  const looks = () => ids.map((id) => g.phone(id).me);
  assert.equal(new Set(looks().slice(0, 12).map((m) => m.color)).size, 12, "starting bots are varied: the first 12 get 12 colours");
  assert.ok(looks().every((m) => PARTICIPANT_COLORS.includes(m.color as never) && BOT_HEADS.includes(m.head)), "100 people all get a bot");

  const p1 = g.phone(ids[1]).me;
  assert.deepEqual(g.room.setBot(ids[0], { color: p1.color, head: p1.head }), { ok: true }, "sharing a bot is fine");
  assert.deepEqual([g.phone(ids[0]).me.color, g.phone(ids[0]).me.head], [p1.color.toLowerCase(), p1.head]);
  assert.deepEqual(g.room.setBot(ids[2], { color: "#3A86FF", head: "visor" }), { ok: true });
  assert.equal(g.phone(ids[2]).me.color, "#3a86ff");
  assert.deepEqual(g.room.setBot(ids[3], { color: "#000000", head: "box" }), { ok: true });
  assert.equal(hexToHsl(g.phone(ids[3]).me.color).l >= BOT_LIGHTNESS.min, true, "black becomes visible grey");
  assert.equal(normalizeBotColor("#fff"), normalizeBotColor("#ffffff"), "#rgb short form works");
  assert.deepEqual(g.room.setBot(ids[0], { color: "red", head: "box" }), { ok: false, error: "invalid" });
  assert.deepEqual(g.room.setBot(ids[0], { color: p1.color, head: "wings" }), { ok: false, error: "invalid" });
  assert.ok(!g.room.join("p1").ok, "two people can't share a name");
  g.do({ type: "startQuiz" });
  assert.deepEqual(g.room.setBot(ids[0], { color: PARTICIPANT_COLORS[5], head: "box" }), { ok: false, error: "too-late" });
});

// ============================================================================
// Round 1
// ============================================================================

test("round 1 scoring: 200 down to 100 by speed (0s 200, 4s 150, 8s 100), wrong or none 0", () => {
  assert.deepEqual([R1_MAX_POINTS, R1_MIN_POINTS], [200, 100]);
  assert.deepEqual([0, 4000, 8000, 7999, 2000, 9000, -50].map((ms) => round1Points(ms, 8000)), [200, 150, 100, 100, 175, 100, 200], "linear, clamped to the answer time");
  const g = new Game(PRESETS.demo);
  const [now, half, last, wrong, none] = ["Now", "Half", "Last", "Wrong", "None"].map((n) => g.join(n));
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.answer(now, "correct");
  g.answerAt(half, "correct", 4000);
  g.answerAt(wrong, "wrong", 5000);
  g.answerAt(last, "correct", 8000 - 1);
  g.tick();
  g.expect("r1TimesUp");
  assert.deepEqual([now, half, last, wrong, none].map((id) => g.person(id).score), [200, 150, 100, 0, 0]);
  g.do({ type: "revealAnswer" });
  g.do({ type: "showLeaderboard" });
  const board = g.host().stage;
  assert.ok(board.phase === "r1Leaderboard" && board.rows.map((r) => r.score).join() === "200,150,100,0,0", "the leaderboard shows 100–200 a question");
  // Ties on points: the lower total answer time ranks higher (a miss counts as the full 8s).
  assert.deepEqual(board.phase === "r1Leaderboard" ? board.rows.slice(3).map((r) => r.id) : [], [wrong, none], "0 points each: the faster one first");
});

test("round 1: instant 200, last moment 100, wrong 0; early time's up; moods; one 1–4 order", () => {
  const g = new Game(PRESETS.demo);
  const fast = g.join("Fast");
  const slow = g.join("Slow");
  const wrong = g.join("Wrong");
  assert.ok(g.host().cast.every((c) => c.mood === "idle"), "idle in the lobby");
  assert.equal(g.admin().primary?.label, "Start quiz");
  g.do({ type: "startQuiz" });
  assert.equal(g.screen(fast).kind, "r1Intro");
  assert.equal(g.primary(), "Show question");
  g.expect("r1Read");
  assert.equal(g.host().timer?.durationMs, 8000, "8s to read");
  assert.equal(g.screen(fast).kind, "eyesUp");
  assert.equal(g.mood(fast), "idle", "idle while reading");
  const reading = g.host().stage;
  assert.ok(reading.phase === "r1Read" && reading.question.options === null, "no options on the Host while reading");
  assert.equal(g.admin().primary, null, "no primary button while the read timer runs");

  g.tick();
  g.expect("r1Answer");
  assert.equal(g.host().timer?.durationMs, 8000, "8s to answer");
  assert.equal(g.mood(fast), "thinking");
  g.checkNoLeaks([fast, slow, wrong]);
  g.checkOneOrder([fast, slow, wrong]);
  g.answer(fast, "correct");
  assert.equal(g.mood(fast), "locked", "locked in, no hint of right or wrong");
  g.clock.advance(7999);
  g.answer(slow, "correct");
  g.answer(wrong, "wrong");
  g.expect("r1TimesUp", "everyone answered: time's up straight away");
  assert.equal(g.person(fast).score, 200);
  assert.equal(g.person(slow).score, 100);
  assert.equal(g.person(wrong).score, 0);
  g.checkNoLeaks([fast, slow, wrong]);

  assert.equal(g.primary(), "Reveal answer");
  assert.deepEqual([g.mood(fast), g.mood(wrong)], ["right", "wrong"]);
  assert.deepEqual(
    [fast, slow, wrong].map((id) => {
      const s = g.screen(id);
      return s.kind === "result" ? s.outcome : s.kind;
    }),
    ["correct", "correct", "wrong"],
  );
  const reveal = g.host().stage;
  assert.ok(reveal.phase === "r1Reveal" && reveal.correctText === "Large Language Model" && reveal.correctIndex !== null);

  assert.equal(g.primary(), "Show results");
  const res = g.host().stage;
  assert.ok(res.phase === "r1Results" && res.options.reduce((s, o) => s + o.count, 0) === 3);
  if (res.phase === "r1Results") assert.deepEqual(res.options.map((o) => o.number), [1, 2, 3, 4]);
  assert.equal(g.primary(), "Show leaderboard");
  const board = g.host().stage;
  assert.ok(board.phase === "r1Leaderboard" && board.rows.map((r) => r.name).join() === "Fast,Slow,Wrong");
  assert.equal(g.primary(), "Next question");
  g.expect("r1Read");
});

test("round 1 answers: first tap wins; read time, pause, wrong id and removed are ignored", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  const b = g.join("B");
  const c = g.join("C");
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  assert.equal(g.screen(a).kind, "eyesUp", "no options during the read");
  g.tick();
  const s = g.screen(a);
  assert.ok(s.kind === "answer");
  if (s.kind !== "answer") return;
  assert.ok(s.options.every((o) => o.id.length >= 8 && !/^[0-3]$/.test(o.id)), "option ids are opaque");
  g.room.answer(a, "not-this-question", s.options[0].id);
  assert.equal(g.screen(a).kind, "answer", "an answer for another question is ignored");
  g.do({ type: "pause" });
  g.room.answer(a, s.questionId, s.options[0].id);
  assert.equal(g.screen(a).kind, "answer", "answers are ignored while paused");
  g.do({ type: "resume" });
  g.room.answer(a, s.questionId, s.options[0].id);
  g.room.answer(a, s.questionId, s.options[1].id);
  const locked = g.screen(a);
  assert.ok(locked.kind === "lockedIn" && locked.choiceText === s.options[0].text, "first tap wins");
  g.do({ type: "removeParticipant", participantId: c });
  assert.equal(g.screen(c).kind, "removed");
  g.answer(b, "wrong");
  g.expect("r1TimesUp", "removing the last one waiting doesn't block the early end");
});

test("round 1: disconnected phones don't hold up time's up, but a full drop lets the timer run", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  const b = g.join("B");
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.answer(a, "correct");
  g.room.disconnect(b);
  g.expect("r1TimesUp", "everyone still connected has answered");
  g.do({ type: "revealAnswer" });
  g.do({ type: "nextQuestion" });
  g.tick();
  g.room.disconnect(a);
  g.expect("r1Answer", "with every phone gone, the timer keeps running");
  g.tick();
  g.expect("r1TimesUp");
});

test("late joiners: play from the next question in round 1, audience after the cut", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  const b = g.join("B");
  g.do({ type: "startQuiz" });
  const c = g.join("C");
  assert.equal(g.person(c).status, "playing", "joined at the intro: plays question 1");
  g.do({ type: "showQuestion" });
  const d = g.join("D");
  g.tick();
  assert.equal(g.screen(d).kind, "answer", "joined during the read: plays this question");
  const e = g.join("E");
  assert.equal(g.screen(e).kind, "nextQuestion", "joined while answering: next question");
  for (const id of [a, b, c, d]) g.answer(id, "wrong");
  g.expect("r1TimesUp", "time's up without waiting for E");
  g.do({ type: "revealAnswer" });
  g.do({ type: "nextQuestion" });
  g.tick();
  assert.equal(g.screen(e).kind, "answer", "E plays question 2");
  g.answer(e, "wrong");
  g.tick();
  g.do({ type: "revealAnswer" });
  g.do({ type: "endRound1" });
  g.expect("cut", "round 1 can end early");
  // Everyone on 0 points: total answer time decides; question 1 counts as the full 8s for E.
  assert.equal(g.person(e).rank, 5);
  const f = g.join("F");
  assert.equal(g.person(f).status, "audience");
  assert.equal(g.screen(f).kind, "audience");
});

// ============================================================================
// The cut
// ============================================================================

test("the cut: top 9 safe by points then time, everyone else in the wild card round; ranks shown only here", () => {
  const config: GameConfig = { ...PRESETS.event, round1: { ...PRESETS.event.round1, questions: 2 } };
  const g = new Game(config, EVENT_QUESTIONS);
  const ids = Array.from({ length: 12 }, (_, i) => g.join(`P${i + 1}`));
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  for (let q = 0; q < 2; q++) {
    g.tick();
    // P1–P8 right in order; P9 wrong fast, P10 wrong slow, P11 and P12 don't answer.
    ids.slice(0, 8).forEach((id) => {
      g.clock.advance(200);
      g.answer(id, "correct");
    });
    g.answer(ids[8], "wrong");
    g.clock.advance(3000);
    g.answer(ids[9], "wrong");
    g.tick();
    g.do({ type: "revealAnswer" });
    if (q === 0) g.do({ type: "nextQuestion" });
  }
  g.do({ type: "endRound1" });
  const stage = g.host().stage;
  assert.ok(stage.phase === "cut");
  if (stage.phase !== "cut") return;
  assert.deepEqual(stage.standings.map((s) => s.name), ids.map((_, i) => `P${i + 1}`));
  assert.deepEqual(stage.standings.map((s) => s.finalist), [...Array(9).fill(true), false, false, false]);
  assert.equal(stage.standings[8].score, 0, "P9 is safe on 0 points: faster than P10–P12");
  assert.ok(stage.standings[9].timeMs > stage.standings[8].timeMs, "the cut carries the tie-break time");
  assert.deepEqual([stage.safeCount, stage.wildCardCount, stage.wildCardSkipped], [9, 3, false]);
  const nine = g.screen(ids[8]);
  assert.ok(nine.kind === "cut" && nine.outcome === "safe" && nine.rank === 9 && nine.of === 12);
  const ten = g.screen(ids[9]);
  assert.ok(ten.kind === "cut" && ten.outcome === "wildcard" && ten.rank === 10);
  assert.equal(g.person(ids[9]).status, "wildcard");
  assert.equal(g.mood(ids[0]), "right", "safe bots glow at the cut");
  assert.equal(g.mood(ids[9]), "idle", "wild card players wait (nobody is out yet)");
  assert.equal(g.admin().primary?.label, "Start wild card round");
  g.do({ type: "startWildCard" });
  assert.ok(!JSON.stringify(g.screen(ids[9])).includes('"rank"'), "no Round 1 rank on phones after the cut");
});

test("the cut: fewer than 10 played → everyone is a finalist and the wild card round is skipped", () => {
  const g = new Game({ ...PRESETS.event, round1: { ...PRESETS.event.round1, questions: 1 } }, EVENT_QUESTIONS);
  const ids = Array.from({ length: 8 }, (_, i) => g.join(`P${i + 1}`));
  playRound1InOrder(g, ids);
  const stage = g.host().stage;
  assert.ok(stage.phase === "cut" && stage.wildCardSkipped && stage.wildCardCount === 0);
  assert.ok(ids.every((id) => g.person(id).status === "finalist"));
  assert.equal(g.admin().primary?.label, "Open predictions");
  assert.ok(g.admin().allowed.includes("startBlackout") && !g.admin().allowed.includes("startWildCard"));
  const s = g.screen(ids[7]);
  assert.ok(s.kind === "cut" && s.outcome === "safe");
  g.do({ type: "startBlackout" });
  assert.equal(g.admin().blackout?.runners.length, 8, "all 8 run");
});

// ============================================================================
// Wild card round
// ============================================================================

test("wild card: only wild card players answer; safe finalists watch; tallies; most correct wins; standings", () => {
  const { g, ids, safe, wild } = atTheCut(["A", "B", "C", "D", "E", "F"]);
  const [d, e, f] = wild;
  g.do({ type: "startWildCard" });
  g.expect("wcIntro");
  assert.deepEqual(g.host().cast.map((c) => c.id), wild, "the cast is the wild card players only");
  const intro = g.host().stage;
  assert.ok(intro.phase === "wcIntro" && intro.wildCard.safe.length === 3 && intro.wildCard.players === 3);
  assert.equal(g.screen(safe[0]).kind, "safeWatch");
  const st = g.screen(d);
  assert.ok(st.kind === "wcStatus" && st.right === 0 && st.asked === 0);

  // Q1: D right, E right (slower), F wrong. A safe finalist tries to answer: ignored.
  assert.equal(g.primary(), "Show question");
  g.tick();
  g.expect("wcAnswer");
  g.checkNoLeaks(ids);
  g.checkOneOrder(ids);
  assert.equal(g.screen(safe[0]).kind, "safeWatch", "finalists don't get options");
  const wcAnswer = g.host().stage;
  assert.ok(wcAnswer.phase === "wcAnswer" && wcAnswer.wildCard.expected === 3 && wcAnswer.wildCard.standings.length === 0, "no live tally on the Host");
  const opts = g.screen(d);
  if (opts.kind === "answer") g.room.answer(safe[0], opts.questionId, opts.options[0].id);
  assert.equal(g.person(safe[0]).answered, null, "a finalist's answer is ignored");
  g.answerAt(d, "correct", 1000);
  assert.equal(g.mood(d), "locked");
  g.answerAt(e, "correct", 3000);
  g.answerAt(f, "wrong", 4000);
  g.expect("wcTimesUp", "everyone in the wild card round answered");
  g.checkNoLeaks(ids);
  g.do({ type: "revealAnswer" });
  assert.deepEqual([g.mood(d), g.mood(f)], ["right", "wrong"]);
  const r = g.screen(d);
  assert.ok(r.kind === "result" && r.round === 2 && r.outcome === "correct" && r.tally?.right === 1 && r.tally.asked === 1, "\"1 of 1 right\"");
  const rf = g.screen(f);
  assert.ok(rf.kind === "result" && rf.outcome === "wrong" && rf.correctText.length > 0);
  assert.equal(g.primary(), "Show standings");
  const standings = g.host().stage;
  assert.ok(standings.phase === "wcStandings");
  if (standings.phase === "wcStandings") {
    assert.deepEqual(standings.wildCard.standings.map((s) => [s.name, s.correct]), [["D", 1], ["E", 1], ["F", 0]], "most correct, then faster");
  }

  // Q2: E right, D wrong, F none. Q3: E right, D right, F wrong → E 3, D 2, F 0.
  g.playQuestion([[e, "correct", 500], [d, "wrong", 500]], "Next question");
  g.playQuestion([[e, "correct", 500], [d, "correct", 500], [f, "wrong", 500]], "Next question");
  assert.equal(g.person(e).wildCorrect, 3);
  assert.equal(g.person(d).wildCorrect, 2);
  assert.equal(g.admin().primary?.label, "Show standings");
  assert.ok(g.admin().allowed.includes("revealWildCard"), "decided after the planned questions");
  g.do({ type: "revealWildCard" });
  g.expect("wcWinner");
  assert.equal(g.person(e).status, "finalist");
  assert.equal(g.person(e).isWildCard, true);
  assert.deepEqual([g.person(d).status, g.person(f).status], ["audience", "audience"]);
  assert.deepEqual([g.mood(e), g.mood(d)], ["right", "out"], "the rest power down");
  const won = g.screen(e);
  assert.ok(won.kind === "wcWinner" && won.you === "won");
  const lost = g.screen(d);
  assert.ok(lost.kind === "wcWinner" && lost.you === "lost" && lost.winner?.id === e);
  assert.deepEqual(g.admin().finalists.map((x) => x.id), [...safe, e], "the wild card takes the last seat");
});

test("wild card: tie on correct → lower total time (wrong / miss = the full 8s) wins", () => {
  const { g, wild } = atTheCut(["A", "B", "C", "D", "E"]);
  const [d, e] = wild;
  g.do({ type: "startWildCard" });
  // D: right at 1s, wrong, right at 6s = 2 correct, 1 + 8 + 6 = 15s. E: right 2s, right 2s, miss = 2 correct, 2 + 2 + 8 = 12s.
  g.playQuestion([[d, "correct", 1000], [e, "correct", 2000]]);
  g.playQuestion([[d, "wrong", 1000], [e, "correct", 2000]]);
  g.playQuestion([[d, "correct", 6000]]);
  assert.deepEqual([g.person(d).wildCorrect, g.person(e).wildCorrect], [2, 2]);
  assert.deepEqual([g.person(d).wildTimeMs, g.person(e).wildTimeMs], [15000, 12000]);
  assert.ok(g.admin().allowed.includes("revealWildCard"));
  g.do({ type: "revealWildCard" });
  assert.equal(g.person(e).isWildCard, true, "E wins on time");
});

test("wild card: exact tie → sudden death among the tied only; all wrong stay in; first right wins", () => {
  const { g, wild } = atTheCut(["A", "B", "C", "D", "E", "F"]);
  const [d, e, f] = wild;
  g.do({ type: "startWildCard" });
  for (let q = 0; q < 3; q++) g.playQuestion([[d, "correct", 1000], [e, "correct", 1000], [f, "wrong", 1000]]);
  assert.equal(g.admin().primary?.label, "Show standings");
  assert.ok(g.admin().allowed.includes("nextQuestion") && !g.admin().allowed.includes("revealWildCard"), "an exact tie isn't decided");
  assert.match(g.admin().hint ?? "", /sudden death/);
  g.do({ type: "showStandings" });
  assert.equal(g.admin().primary?.label, "Next question (sudden death)");
  g.primary();
  g.tick();
  const sd = g.host().stage;
  assert.ok(sd.phase === "wcAnswer" && sd.question.suddenDeath && sd.question.number === 4);
  assert.match(g.admin().stepLabel, /sudden death 1 of 3/);
  assert.equal(g.screen(f).kind, "wcStatus", "F isn't in the sudden death");
  // Both wrong: both stay in.
  g.answer(d, "wrong");
  g.answer(e, "wrong");
  g.do({ type: "revealAnswer" });
  assert.deepEqual(g.admin().wildCard?.suddenDeath?.alive.map((t) => t.id).sort(), [d, e].sort());
  // Next: E right, D wrong → E wins.
  g.playQuestion([[e, "correct", 500], [d, "wrong", 500]], "Next question (sudden death)");
  assert.equal(g.admin().primary?.label, "Show standings");
  assert.ok(g.admin().allowed.includes("revealWildCard"));
  const out = g.screen(d);
  assert.ok(out.kind === "result");
  g.do({ type: "showStandings" });
  const status = g.screen(d);
  assert.ok(status.kind === "wcStatus" && status.suddenDeath === "out");
  g.do({ type: "revealWildCard" });
  assert.equal(g.person(e).isWildCard, true);
});

test("wild card: sudden death capped at 3, then total time, then the better Round 1 rank", () => {
  const { g, wild } = atTheCut(["A", "B", "C", "D", "E"]);
  const [d, e] = wild;
  g.do({ type: "startWildCard" });
  for (let q = 0; q < 3; q++) g.playQuestion([[d, "correct", 1000], [e, "correct", 1000]]);
  for (let q = 0; q < 3; q++) g.playQuestion([[d, "wrong", 1000], [e, "wrong", 1000]], "Next question (sudden death)");
  assert.ok(g.admin().allowed.includes("revealWildCard"), "decided after 3 sudden-death questions");
  g.do({ type: "revealWildCard" });
  assert.equal(g.person(d).isWildCard, true, "same total time: the better Round 1 rank (D, 4th) wins");
});

test("wild card: nobody right → the 10th-ranked (best outside the safe seats) takes it", () => {
  const { g, wild } = atTheCut(["A", "B", "C", "D", "E", "F"]);
  g.do({ type: "startWildCard" });
  for (let q = 0; q < 3; q++) g.playQuestion(wild.map((id) => [id, "wrong", 500] as [string, Pick, number]));
  g.do({ type: "revealWildCard" });
  assert.equal(g.person(wild[0]).isWildCard, true);
  const stage = g.host().stage;
  assert.ok(stage.phase === "wcWinner" && stage.wildCard.fallback && stage.wildCard.winner?.id === wild[0]);
});

// ============================================================================
// Predictions
// ============================================================================

test("predictions: 10 finalists; audience backs one and can change until Start Blackout; finalists can't back", () => {
  const config: GameConfig = { ...PRESETS.event, round1: { ...PRESETS.event.round1, questions: 1 }, wildCard: { ...PRESETS.event.wildCard, questions: 1 } };
  const g = new Game(config, EVENT_QUESTIONS);
  const ids = Array.from({ length: 14 }, (_, i) => g.join(`P${i + 1}`));
  playRound1InOrder(g, ids);
  g.do({ type: "startWildCard" });
  g.playQuestion(ids.slice(9).map((id, i) => [id, i === 2 ? "correct" : "wrong", 500] as [string, Pick, number]));
  g.do({ type: "revealWildCard" });
  assert.equal(g.admin().finalists.length, 10);
  assert.equal(g.admin().finalists[9].id, ids[11], "the wild card sits last");
  g.do({ type: "openPredictions" });
  const fan = ids[13];
  const s = g.screen(fan);
  assert.ok(s.kind === "backFinalist" && s.finalists.length === 10);
  g.room.back(fan, ids[0]);
  g.room.back(fan, ids[11]);
  assert.equal(g.person(fan).backingId, ids[11], "can change");
  g.room.back(ids[0], ids[1]);
  assert.equal(g.person(ids[0]).backingId, null, "finalists can't back anyone");
  const stage = g.host().stage;
  assert.ok(stage.phase === "predictions" && stage.backing.counts[ids[11]] === 1 && stage.backing.backers === 1);
  g.do({ type: "startBlackout" });
  g.room.back(fan, ids[0]);
  assert.equal(g.person(fan).backingId, ids[11], "locked once Blackout starts");
});

// ============================================================================
// Blackout (autopilot)
// ============================================================================

/** Flow buttons the quizmaster never gets in Blackout: the autopilot does all of it. */
const FLOW_ACTIONS: AdminAction[] = [{ type: "showQuestion" }, { type: "nextQuestion" }, { type: "revealAnswer" }, { type: "advanceDarkness" }, { type: "showWinner" }];

function assertNoFlowButtons(g: Game) {
  for (const action of FLOW_ACTIONS) assert.deepEqual(g.try(action), { ok: false, reason: "not-allowed" }, `${action.type} is not allowed in ${g.phase}`);
}

test("blackout autopilot: one click; 6s intro, 5s read, 10s answer, holds; +3/+2/+1 by thirds of 10s, −1 wrong, 0 none; nobody caught at the reveal", () => {
  const config = testConfig({ safe: 5 }, { baseGap: 2, darkness: [1] });
  const h = config.blackout.holds;
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  const { g, ids } = toBlackout(names, 5, config);
  g.do({ type: "startBlackout" });
  g.expect("boIntro");
  assert.equal(g.admin().timer?.durationMs, h.introMs, "the intro holds 6s");
  assert.deepEqual(g.admin().primary, { action: { type: "pause" }, label: "Pause" }, "the big button is Pause during the autopilot");
  assert.equal(g.admin().autopilot?.step, "intro");
  assertNoFlowButtons(g);
  const [a, b, c, d, e, f] = ids;
  // Ranks 1–3 → +2, ranks 4–5 → +1, the wild card (F) → +0.
  assert.deepEqual(g.admin().blackout!.runners.map((r) => [r.name, r.position, r.headStart]), [
    ["A", 4, 2],
    ["B", 4, 2],
    ["C", 4, 2],
    ["D", 3, 1],
    ["E", 3, 1],
    ["F", 2, 0],
  ]);
  const ready = g.screen(f);
  assert.ok(ready.kind === "runnerStatus" && ready.alive && ready.gap === 2 && ready.headStart === 0 && ready.nextUp === "question");
  assert.equal(g.screen(ids[6]).kind, "blackoutWatch", "the audience watches");

  g.next("boRead");
  assert.equal(g.host().timer?.durationMs, 5000, "5s read");
  assert.match(g.admin().stepLabel, /^Blackout, question 1: reading \(autopilot\)$/);
  assertNoFlowButtons(g);
  const eyes = g.screen(a);
  assert.ok(eyes.kind === "eyesUp" && eyes.round === 3 && eyes.gap === 4 && eyes.questionCount === null);
  g.next("boAnswer");
  assert.equal(g.host().timer?.durationMs, 10_000, "10s to answer");
  g.checkNoLeaks(ids);
  g.checkOneOrder(ids);
  assertNoFlowButtons(g);
  const preview = g.admin().darkPreview!;
  assert.deepEqual([preview.steps, preview.to, preview.catches.length, preview.exact], [1, 1, 0, false], "Admin sees where the dark goes next");
  assert.equal(g.mood(a), "thinking");
  g.answerAt(a, "correct", 1000);
  g.answerAt(b, "correct", 5000);
  g.answerAt(c, "correct", 9000);
  g.answerAt(d, "correct", 9900);
  g.answerAt(e, "wrong", 9950);
  // F doesn't answer.
  const locked = g.screen(a);
  assert.ok(locked.kind === "lockedIn" && locked.gap === 4 && locked.choiceNumber >= 1 && locked.choiceNumber <= 4);
  g.next("boTimesUp");
  assert.equal(g.host().timer?.durationMs, h.timesUpMs, "time's up holds 1.5s");
  g.checkNoLeaks(ids);
  assert.deepEqual([g.mood(a), g.mood(f)], ["locked", "idle"]);
  g.next("boReveal");
  assert.equal(g.host().timer?.durationMs, h.revealMs + h.revealPerRunnerMs * 6, "the reveal holds 3s + 0.15s per runner");
  assert.deepEqual(g.admin().blackout!.runners.map((r) => [r.name, r.delta, r.position]), [
    ["A", 3, 7],
    ["B", 2, 6],
    ["C", 1, 5],
    ["D", 1, 4],
    ["E", -1, 2],
    ["F", 0, 2],
  ]);
  assert.deepEqual([g.mood(a), g.mood(e), g.mood(f)], ["right", "wrong", "idle"], "no answer → idle");
  const res = g.screen(e);
  assert.ok(res.kind === "runnerResult" && res.outcome === "wrong" && res.delta === -1 && res.gap === 2 && res.correctText);
  const miss = g.screen(f);
  assert.ok(miss.kind === "runnerResult" && miss.outcome === "missed" && miss.delta === 0 && miss.position === 2, "no answer: stays put");
  assert.ok(g.admin().blackout!.runners.every((r) => r.alive), "nobody is caught at the reveal");
  assert.equal(g.admin().darkPreview?.exact, true, "after the moves the preview is final");
  assertNoFlowButtons(g);
  g.next("boDark");
  assert.equal(g.host().timer?.durationMs, h.darkMs + h.darkPerStepMs * 1, "the dark's hold: 2.5s + 0.25s per step, nobody caught");
  g.next("boRead");
  assert.equal(g.admin().question?.number, 2, "the next question started by itself");
});

test("blackout autopilot: catches when the dark moves (position ≤ dark); catch order; one left → winner moment → podium, no clicks", () => {
  const config = testConfig({ safe: 3 }, { baseGap: 1, darkness: [2] });
  const h = config.blackout.holds;
  const { g, ids, winner } = toBlackout(["A", "B", "C", "D", "E"], 3, config);
  const [a, b, c] = ids;
  g.do({ type: "startBlackout" });
  g.next("boRead");
  // Start: A, B, C at 3 (rank +2), the wild card D at 1. The dark moves 2 per question.
  // Q1: A +3 (6), B wrong (2), C none (3), D none (1). Dark → 2: B (2) and D (1) caught.
  g.runnerQuestion([[a, "correct", 500], [b, "wrong", 500]]);
  assert.deepEqual(g.admin().darkPreview!.catches.map((x) => x.id).sort(), [b, winner].sort(), "Admin's preview names who the dark will catch");
  g.next("boDark");
  assert.equal(g.host().timer?.durationMs, h.darkMs + h.darkPerStepMs * 2 + h.darkCaughtMs, "a catch holds 1.5s longer");
  const bo = g.admin().blackout!;
  assert.deepEqual([bo.dark, bo.darkFrom], [2, 0]);
  assert.deepEqual([...bo.caughtThisQuestion].sort(), [b, winner].sort());
  assert.deepEqual([g.mood(b), g.mood(winner), g.mood(a)], ["out", "out", "idle"]);
  // Same question: B was further ahead (2) than D (1) before the dark moved → B places higher.
  assert.deepEqual([g.runner(b).place, g.runner(winner).place], [3, 4]);
  const gone = g.screen(b);
  assert.ok(gone.kind === "runnerStatus" && !gone.alive && gone.caughtNow && gone.place === 3);
  const still = g.screen(a);
  assert.ok(still.kind === "runnerStatus" && still.alive && still.gap === 4 && still.nextUp === "question");

  // Q2: caught runners can't answer. A right fast (9), C wrong (2). Dark → 4: C caught → A wins.
  g.next("boRead");
  g.next("boAnswer");
  assert.equal(g.screen(b).kind, "runnerStatus", "caught runners get no options");
  g.answer(a, "correct");
  g.answer(c, "wrong");
  g.expect("boTimesUp", "ends early when every runner still running has answered");
  g.next("boReveal");
  g.next("boDark");
  assert.equal(g.admin().blackout!.over, true);
  const last = g.screen(a);
  assert.ok(last.kind === "runnerStatus" && last.nextUp === "winner");
  g.next("boWinner");
  assert.equal(g.host().timer?.durationMs, h.winnerMs, "the winner moment holds 7s");
  const moment = g.host().stage;
  assert.ok(moment.phase === "boWinner" && moment.blackout.winner?.id === a);
  assert.equal(g.mood(a), "right");
  assertNoFlowButtons(g);
  g.next("podium");
  const podium = g.host().stage;
  assert.ok(podium.phase === "podium" && podium.basis === "blackout");
  if (podium.phase === "podium") assert.deepEqual(podium.entries.map((e) => e.id), [a, c, b, winner], "caught later ranks higher");
  const won = g.screen(a);
  assert.ok(won.kind === "podium" && won.place === 1);
  const fourth = g.screen(winner);
  assert.ok(fourth.kind === "podium" && fourth.place === 4);
  assert.equal(g.admin().autopilot, null, "the autopilot is done");
});

test("blackout autopilot: everyone caught at once → the best by catch order wins", () => {
  const config = testConfig({ safe: 2 }, { baseGap: 1, darkness: [9] });
  const { g, ids } = toBlackout(["A", "B", "C", "D"], 2, config);
  g.do({ type: "startBlackout" });
  g.next("boRead");
  const [a, b, c] = ids;
  // A 3 → 4 (slow right), B 3 → 6 (fast right), C 1 → 1 (none). Dark → 9: all caught. B was furthest ahead.
  g.runnerQuestion([[a, "correct", 9000], [b, "correct", 100]]);
  g.next("boDark");
  assert.equal(g.admin().blackout!.alive, 0);
  assert.equal(g.admin().blackout!.winner?.id, b);
  g.next("boWinner");
  g.next("podium");
  const p = g.host().stage;
  assert.ok(p.phase === "podium" && p.entries.map((e) => e.id).join() === [b, a, c].join());
});

test("blackout autopilot: questions run out with 2+ running → furthest ahead, then lower time, then Round 1 rank", () => {
  // The event preset doesn't reuse questions: 2 Blackout questions only.
  const config = testConfig({ name: "event", safe: 3 }, { baseGap: 6, darkness: [1] });
  const { g, ids } = toBlackout(["A", "B", "C", "D", "E"], 3, config, questionSet(3, 6, 2));
  g.do({ type: "startBlackout" });
  g.next("boRead");
  const [a, b, c, d] = ids;
  // Everyone far ahead of the dark. A and B tie on position; B's answers were faster.
  g.runnerQuestion([[a, "correct", 3000], [b, "correct", 2900], [c, "wrong", 500], [d, "correct", 9000]]);
  assert.equal(g.admin().autopilot?.questionsLeft, 1);
  g.next("boDark");
  g.next("boRead");
  g.runnerQuestion([[a, "correct", 500], [b, "correct", 400], [c, "correct", 9000], [d, "correct", 9000]]);
  assert.equal(g.admin().blackout!.questionsLeft, 0);
  g.next("boDark");
  assert.equal(g.admin().blackout!.over, true, "out of questions ends it");
  assert.equal(g.admin().blackout!.alive, 4, "nobody was caught");
  assert.equal(g.runner(a).position, g.runner(b).position, "A and B are level");
  assert.equal(g.admin().blackout!.winner?.id, b, "level on position: lower total time wins");
  g.next("boWinner");
  g.next("podium");
  const p = g.host().stage;
  assert.ok(p.phase === "podium" && p.entries[0].id === b && p.entries[1].id === a);
});

test("blackout: DARKNESS_STEPS past the end of the list repeat its last value", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 12, 40].map((n) => darknessStep(PRESETS.event, n)), [1, 2, 2, 3, 3, 3, 3]);
  const config = testConfig({ safe: 2 }, { baseGap: 20, darkness: [1, 3] });
  const h = config.blackout.holds;
  const { g, ids } = toBlackout(["A", "B", "C", "D"], 2, config);
  g.do({ type: "startBlackout" });
  const darks: number[] = [];
  for (let q = 0; q < 4; q++) {
    g.next("boRead");
    g.runnerQuestion(ids.slice(0, 3).map((id) => [id, "correct", 500] as [string, Pick, number]));
    g.next("boDark");
    darks.push(g.admin().blackout!.dark);
  }
  assert.deepEqual(darks, [1, 4, 7, 10], "1, then 3 for every question after");
  assert.equal(g.host().timer?.durationMs, h.darkMs + h.darkPerStepMs * 3);
});

test("blackout autopilot: Pause in every step freezes the clock; Resume carries on from the same moment", () => {
  const config = testConfig({ safe: 2 }, { baseGap: 1, darkness: [2] });
  const { g, ids } = toBlackout(["A", "B", "C", "D"], 2, config);
  const [a] = ids;
  g.do({ type: "startBlackout" });
  const visited = new Set<Phase>();
  while (g.phase !== "podium") {
    const phase = g.phase;
    g.clock.advance(300);
    const before = g.admin().timer!;
    const left = before.endsAt - g.clock.now();
    g.do({ type: "pause" });
    assert.ok(g.host().paused && g.admin().autopilot?.paused, `paused in ${phase}`);
    assert.equal(g.admin().timer?.remainingMs, left, `frozen in ${phase}`);
    assert.deepEqual(g.admin().primary, { action: { type: "resume" }, label: "Resume" });
    g.clock.advance(60_000);
    g.expect(phase, `nothing moves while paused (${phase})`);
    assert.equal(g.admin().autopilot?.nextInMs, left);
    g.do({ type: "resume" });
    assert.equal(g.admin().timer!.endsAt - g.clock.now(), left, `resume continues from the same moment (${phase})`);
    visited.add(phase);
    if (phase === "boAnswer") g.answer(a, "correct");
    g.tick();
  }
  for (const phase of ["boIntro", "boRead", "boAnswer", "boTimesUp", "boReveal", "boDark", "boWinner"] as Phase[]) assert.ok(visited.has(phase), `paused in ${phase}`);
});

test("blackout autopilot: Skip, +5s, Restart question, Void, Remove participant and End quiz now; it carries on by itself", () => {
  const config = testConfig({ safe: 3 }, { baseGap: 1, darkness: [2] });
  const h = config.blackout.holds;
  const { g, ids, winner } = toBlackout(["A", "B", "C", "D", "E"], 3, config);
  const [a, b, c] = ids;
  g.do({ type: "startBlackout" });
  g.do({ type: "skipTimer" });
  g.expect("boRead", "Skip ends the intro now");
  assert.ok(!g.admin().allowed.includes("addTime"), "+5s only while answering");
  g.do({ type: "skipTimer" });
  g.expect("boAnswer");
  g.do({ type: "addTime" });
  assert.equal(g.admin().timer?.durationMs, 15_000);
  g.answerAt(a, "correct", 4500); // the first third of 15s ends at 5s
  g.answerAt(b, "wrong", 4600);
  g.do({ type: "skipTimer" });
  g.expect("boTimesUp");
  g.do({ type: "skipTimer" });
  g.expect("boReveal");
  assert.equal(g.runner(a).delta, 3, "+5s widens the thirds");
  const oldId = g.admin().question!.id;
  g.do({ type: "restartQuestion" });
  g.expect("boRead", "restart question replays it");
  assert.deepEqual([g.runner(a).position, g.runner(b).position], [3, 3], "its moves are undone");
  assert.ok(g.admin().question!.id !== oldId && g.admin().question!.number === 1, "same number, fresh ids");

  g.runnerQuestion([[a, "correct", 500], [b, "wrong", 500]]);
  g.next("boDark");
  assert.deepEqual([g.runner(b).alive, g.runner(winner).alive], [false, false]);
  assert.ok(!g.admin().allowed.includes("restartQuestion"), "no restart once the dark has moved");
  assert.equal(g.try({ type: "restartQuestion" }).ok, false);

  g.next("boRead");
  g.do({ type: "voidQuestion" });
  g.expect("boReveal");
  assert.equal(g.host().timer?.durationMs, h.voidMs);
  const vs = g.screen(a);
  assert.ok(vs.kind === "runnerResult" && vs.outcome === "voided" && vs.delta === 0);
  assert.equal(g.admin().blackout!.dark, 2, "void: the dark doesn't move");
  assert.equal(g.admin().darkPreview, null);
  g.next("boRead");
  assert.equal(g.admin().question?.number, 2, "the next question takes the voided one's number");

  // Removing a runner that leaves one running: the winner moment comes straight away.
  g.do({ type: "removeParticipant", participantId: c });
  g.expect("boWinner");
  assert.equal(g.admin().blackout!.winner?.id, a);
  g.next("podium");
  const p = g.host().stage;
  assert.ok(p.phase === "podium" && !p.entries.some((x) => x.id === c), "removed runners aren't placed");

  const t = toBlackout(["A", "B", "C", "D", "E"], 3, config);
  t.g.do({ type: "startBlackout" });
  t.g.next("boRead");
  t.g.next("boAnswer");
  t.g.do({ type: "endQuiz" });
  t.g.expect("podium", "End quiz now goes straight to the podium");
  assert.equal(t.g.clock.runNext(), false, "no autopilot timer left running");
});

test("blackout autopilot: a stale Pause or Skip is ignored; a double tap never skips two steps", () => {
  const config = testConfig({ safe: 2 }, { baseGap: 4, darkness: [1] });
  const { g } = toBlackout(["A", "B", "C", "D"], 2, config);
  g.do({ type: "startBlackout" });
  g.next("boRead");
  const reading = g.room.stepId;
  g.next("boAnswer");
  assert.deepEqual(g.room.command(reading, { type: "pause" }), { ok: false, reason: "stale-step" }, "a Pause aimed at a step that has passed does nothing");
  assert.deepEqual(g.room.command(reading, { type: "skipTimer" }), { ok: false, reason: "stale-step" });
  assert.equal(g.admin().paused, false);
  const answering = g.room.stepId;
  assert.deepEqual(g.room.command(answering, { type: "skipTimer" }), { ok: true });
  assert.deepEqual(g.room.command(answering, { type: "skipTimer" }), { ok: false, reason: "stale-step" }, "the second tap of a double tap is ignored");
  g.expect("boTimesUp");
  const at = g.room.stepId;
  assert.deepEqual(g.room.command(at, { type: "pause" }), { ok: true });
  assert.deepEqual(g.room.command(at, { type: "pause" }), { ok: false, reason: "not-allowed" }, "already paused");
  assert.deepEqual(g.room.command(at - 5, { type: "resume" }), { ok: true }, "Resume works from any step");
});

// ============================================================================
// Fixing mistakes, in every round
// ============================================================================

test("void and restart question: round 1 and the wild card", () => {
  // Round 1
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  const b = g.join("B");
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.answer(a, "correct");
  g.answer(b, "correct");
  g.do({ type: "revealAnswer" });
  g.do({ type: "voidQuestion" });
  assert.equal(g.person(a).score, 0, "void takes the points back");
  assert.equal(g.screen(a).kind, "voided");
  const voided = g.host().stage;
  assert.ok(voided.phase === "r1Reveal" && voided.voided && voided.correctText === null);
  assert.equal(g.admin().primary?.label, "Next question");
  g.do({ type: "nextQuestion" });
  g.tick();
  const old = g.screen(a);
  g.answer(a, "correct");
  g.answer(b, "wrong");
  g.do({ type: "revealAnswer" });
  const oldId = g.admin().question!.id;
  g.do({ type: "restartQuestion" });
  assert.equal(g.person(a).score, 0, "restart takes the points back");
  g.tick();
  const fresh = g.screen(a);
  assert.ok(fresh.kind === "answer" && fresh.questionId !== oldId, "a restarted question gets new ids");
  if (old.kind === "answer") g.room.answer(a, old.questionId, old.options[0].id);
  assert.equal(g.screen(a).kind, "answer", "an answer to the old run is ignored");

  // Wild card: void → doesn't count and the next question takes its number; restart → undone.
  const w = atTheCut(["A", "B", "C", "D", "E"]);
  const [d, e] = w.wild;
  w.g.do({ type: "startWildCard" });
  w.g.playQuestion([[d, "correct", 500], [e, "wrong", 500]]);
  w.g.do({ type: "voidQuestion" });
  assert.equal(w.g.person(d).wildCorrect, 0, "a voided wild card question doesn't count");
  assert.equal(w.g.screen(d).kind, "voided");
  w.g.primary();
  assert.equal(w.g.admin().question?.number, 1, "the next question takes its number");
  w.g.tick();
  w.g.answer(d, "correct");
  w.g.answer(e, "correct");
  w.g.do({ type: "revealAnswer" });
  assert.equal(w.g.person(e).wildCorrect, 1);
  w.g.do({ type: "restartQuestion" });
  assert.deepEqual([w.g.person(d).wildCorrect, w.g.person(e).wildCorrect], [0, 0], "restart undoes the tallies");
  w.g.expect("wcRead");
});

test("restart round: Round 1 to 0, wild card tallies to 0, Blackout back to the start (the autopilot starts again)", () => {
  const w = atTheCut(["A", "B", "C", "D", "E"]);
  w.g.do({ type: "restartRound" });
  w.g.expect("r1Intro", "restart Round 1 from the cut");
  assert.ok(w.g.admin().participants.every((p) => p.score === 0 && p.status === "playing"));

  const x = atTheCut(["A", "B", "C", "D", "E"]);
  x.g.do({ type: "startWildCard" });
  x.g.playQuestion([[x.wild[0], "correct", 500]]);
  x.g.do({ type: "restartRound" });
  x.g.expect("wcIntro");
  assert.equal(x.g.person(x.wild[0]).wildCorrect, 0);

  const config = testConfig({ safe: 3 }, { baseGap: 1, darkness: [2] });
  const t = toBlackout(["A", "B", "C", "D", "E"], 3, config);
  t.g.do({ type: "startBlackout" });
  t.g.next("boRead");
  t.g.runnerQuestion([[t.ids[0], "correct", 500]]);
  t.g.next("boDark");
  t.g.do({ type: "restartRound" });
  t.g.expect("boIntro");
  assert.equal(t.g.admin().timer?.durationMs, config.blackout.holds.introMs);
  const bo = t.g.admin().blackout!;
  assert.ok(bo.dark === 0 && bo.runners.every((r) => r.alive && r.position === r.headStart + 1), "positions back to the start");
  t.g.next("boRead");
  assert.equal(t.g.admin().question?.number, 1);
});

test("remove: a wild card player mid-round; seat hand-over before the first Blackout question; a runner mid-chase", () => {
  // Wild card: removing the leader just takes them out.
  const w = atTheCut(["A", "B", "C", "D", "E", "F"]);
  const [d, e, f] = w.wild;
  w.g.do({ type: "startWildCard" });
  w.g.playQuestion([[d, "correct", 500], [e, "wrong", 500], [f, "wrong", 500]]);
  w.g.do({ type: "removeParticipant", participantId: d });
  w.g.playQuestion([[e, "correct", 500], [f, "wrong", 500]]);
  w.g.playQuestion([[e, "wrong", 500], [f, "wrong", 500]]);
  w.g.do({ type: "revealWildCard" });
  assert.equal(w.g.person(e).isWildCard, true, "the round carried on without the removed leader");

  // Before the first Blackout question: a removed safe finalist's seat goes to the wild card runner-up.
  w.g.do({ type: "openPredictions" });
  w.g.room.back(f, w.safe[0]);
  w.g.do({ type: "removeParticipant", participantId: w.safe[0] });
  assert.equal(w.g.person(f).status, "finalist", "the wild card runner-up takes the seat");
  assert.equal(w.g.person(f).backingId, null, "picks for the removed one are cleared");
  assert.equal(w.g.admin().finalists.length, 4);

  // At the cut (before the wild card round): the next Round 1 rank takes the seat.
  const c = atTheCut(["A", "B", "C", "D", "E"]);
  c.g.do({ type: "removeParticipant", participantId: c.safe[1] });
  assert.equal(c.g.person(c.wild[0]).status, "finalist", "4th place moves up to safe");
  assert.deepEqual(c.g.admin().finalists.map((x) => x.id), [c.safe[0], c.safe[2], c.wild[0]]);

  // Mid-Blackout: a removed runner leaves the chase and isn't placed; no seat hand-over.
  const config = testConfig({ safe: 3 }, { baseGap: 4, darkness: [1] });
  const t = toBlackout(["A", "B", "C", "D", "E"], 3, config);
  t.g.do({ type: "startBlackout" });
  t.g.next("boRead");
  t.g.runnerQuestion([[t.ids[0], "correct", 500]]);
  t.g.do({ type: "removeParticipant", participantId: t.ids[1] });
  assert.equal(t.g.admin().blackout!.runners.length, 3, "out of the chase");
  assert.equal(t.g.admin().finalists.length, 3, "no promotion once Blackout has started");
  t.g.next("boDark");
  t.g.do({ type: "endQuiz" });
  const p = t.g.host().stage;
  assert.ok(p.phase === "podium" && !p.entries.some((x) => x.id === t.ids[1]), "removed runners aren't placed");
});

test("end quiz now: before the cut, during the wild card round, during Blackout", () => {
  const g = new Game(PRESETS.demo);
  const [a, b] = ["A", "B"].map((n) => g.join(n));
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.answer(a, "wrong");
  g.answer(b, "correct");
  g.do({ type: "endQuiz" });
  const p = g.host().stage;
  assert.ok(p.phase === "podium" && p.basis === "round1" && p.entries[0].id === b);
  assert.deepEqual(g.room.join("Late"), { ok: false, error: "quiz-ended" });

  const w = atTheCut(["A", "B", "C", "D", "E"]);
  w.g.do({ type: "startWildCard" });
  w.g.do({ type: "endQuiz" });
  const q = w.g.host().stage;
  assert.ok(q.phase === "podium" && q.basis === "wildcard" && q.entries.map((e) => e.id).join() === w.safe.join(), "the safe finalists by Round 1 rank");

  const config = testConfig({ safe: 3 }, { baseGap: 1, darkness: [2] });
  const t = toBlackout(["A", "B", "C", "D", "E"], 3, config);
  t.g.do({ type: "startBlackout" });
  t.g.next("boRead");
  t.g.runnerQuestion([[t.ids[2], "correct", 500], [t.ids[0], "wrong", 500]]);
  t.g.next("boDark");
  t.g.do({ type: "endQuiz" });
  const r = t.g.host().stage;
  assert.ok(r.phase === "podium" && r.basis === "blackout");
  if (r.phase === "podium") assert.deepEqual(r.entries.map((e) => e.id).slice(0, 2), [t.ids[2], t.ids[1]], "still running by position, then caught ones");
});

test("timers: pause freezes, resume continues, +5 seconds, skip; points use the extended time", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  g.join("B");
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.clock.advance(3000);
  g.do({ type: "pause" });
  assert.ok(g.host().paused && g.phone(a).paused);
  assert.equal(g.host().timer?.remainingMs, 5000);
  g.clock.advance(60_000);
  g.expect("r1Answer", "nothing moves while paused");
  g.do({ type: "addTime" });
  assert.equal(g.host().timer?.remainingMs, 10_000, "+5s while paused");
  g.do({ type: "resume" });
  g.do({ type: "addTime" });
  assert.equal(g.host().timer?.durationMs, 18_000);
  g.answer(a, "correct");
  g.do({ type: "skipTimer" });
  g.expect("r1TimesUp");
  assert.equal(g.person(a).score, 183, "speed points use the extended time: 200 − 100 × 3/18");
});

test("stepId: stale or repeated commands are ignored (Pause and Skip too; Reveal wild card)", () => {
  const g = new Game(PRESETS.demo);
  g.join("A");
  g.join("B");
  const step = g.room.stepId;
  assert.deepEqual(g.room.command(step, { type: "startQuiz" }), { ok: true });
  assert.deepEqual(g.room.command(step, { type: "startQuiz" }), { ok: false, reason: "stale-step" });
  const intro = g.room.stepId;
  assert.deepEqual(g.room.command(intro, { type: "showQuestion" }), { ok: true });
  const reading = g.room.stepId;
  g.tick();
  assert.deepEqual(g.room.command(reading, { type: "skipTimer" }), { ok: false, reason: "stale-step" }, "a late Skip doesn't skip the answer step");
  assert.deepEqual(g.room.command(reading, { type: "pause" }), { ok: false, reason: "stale-step" }, "a late Pause is ignored");
  assert.deepEqual(g.room.command(g.room.stepId, { type: "pause" }), { ok: true });
  assert.deepEqual(g.try({ type: "revealAnswer" }), { ok: false, reason: "not-allowed" });

  const w = atTheCut(["A", "B", "C", "D", "E"]);
  w.g.do({ type: "startWildCard" });
  for (let q = 0; q < 3; q++) w.g.playQuestion([[w.wild[0], "correct", 500]]);
  const at = w.g.room.stepId;
  assert.deepEqual(w.g.room.command(at, { type: "revealWildCard" }), { ok: true });
  assert.deepEqual(w.g.room.command(at, { type: "revealWildCard" }), { ok: false, reason: "stale-step" });
});

test("room code and sound toggles; results CSV with the v3 columns", () => {
  const config = testConfig({ safe: 2 }, { baseGap: 1, darkness: [3] });
  const { g, ids } = toBlackout(["=cmd|evil", 'Rahul "R", S', "C", "D"], 2, config);
  g.do({ type: "setRoomCodeVisible", visible: false });
  assert.equal(g.host().roomCodeVisible, false);
  g.do({ type: "setSound", on: false });
  assert.equal(g.host().soundOn, false);
  g.do({ type: "startBlackout" });
  g.next("boRead");
  g.runnerQuestion([[ids[0], "correct", 500]]);
  while (g.phase !== "podium") g.tick();
  const { csv, filename } = g.room.resultsCsv();
  assert.equal(filename, "hermes-quiz-TEST-results.csv");
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Place,Name,Result,Round 1 score,Round 1 rank,Wild card correct,Wild card time (s),Blackout place,Blackout final position,Backed,Called it,Left page");
  assert.equal(lines.length, 5);
  assert.ok(lines[1].includes("'=cmd|evil") && lines[1].includes(",winner,"), "the winner first; formulas neutralised");
  assert.ok(lines.some((l) => l.includes('"Rahul ""R"", S"')), "quotes and commas escaped");
  assert.ok(lines.some((l) => l.includes(",wildcard,") || l.includes(",finalist,")));
});

test("page-leave flag counts only while a question is open, and only for Admin", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  g.join("B");
  g.room.setPageHidden(a, true);
  g.room.setPageHidden(a, false);
  assert.equal(g.person(a).leftPageCount, 0, "not counted in the lobby");
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.room.setPageHidden(a, true);
  assert.equal(g.person(a).leftPageCount, 1);
  assert.ok(!JSON.stringify(g.phone(a)).includes("leftPage") && !JSON.stringify(g.host()).includes("leftPage"));
});

// ============================================================================
// The quiz library
// ============================================================================

function libraryQuiz(): Quiz {
  const q = (text: string, extra: Partial<LibraryQuestion> = {}): LibraryQuestion => ({
    ...blankQuestion(),
    text,
    options: [`${text} one`, `${text} two`, `${text} three`, `${text} four`],
    correct: 1,
    ...extra,
  });
  const rules: QuizRules = {
    round1Questions: 2,
    round1ReadSeconds: 5,
    round1AnswerSeconds: 9,
    safe: 2,
    wildCardQuestions: 1,
    blackoutReadSeconds: 4,
    blackoutAnswerSeconds: 7,
  };
  return {
    id: "lib",
    title: "Library test",
    rules,
    round1: [q("First"), q("Second", { readSeconds: 3, openSeconds: 20 }), q("Spare")],
    wildcard: [q("Wild", { openSeconds: 6 }), q("Wild spare")],
    blackout: [q("Dark one"), q("Dark two"), q("Dark spare")],
    updatedAt: 0,
  };
}

test("quiz library: a quiz's settings and per-question timers reach the game; each list feeds its round", () => {
  const quiz = libraryQuiz();
  assert.deepEqual(quizProblems(quiz), []);
  const { config, questions } = quizToGame(quiz, PRESETS.event);
  const g = new Game(config, questions);
  const ids = ["Riya", "Aadi", "Kabir", "Zoya"].map((n) => g.join(n));
  assert.equal(g.admin().settings.round1Questions, 2, "plays the first 2; the third is a spare");
  assert.equal(g.admin().settings.safeCount, 2);
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  assert.equal(g.admin().timer?.durationMs, 5000, "quiz read time");
  g.tick();
  assert.equal(g.admin().timer?.durationMs, 9000, "quiz answer time");
  ids.forEach((id, i) => {
    g.clock.advance(100 + i * 100);
    g.answer(id, "correct");
  });
  g.do({ type: "revealAnswer" });
  g.do({ type: "nextQuestion" });
  assert.equal(g.admin().question?.text, "Second");
  assert.equal(g.admin().timer?.durationMs, 3000, "question 2's own read time");
  g.tick();
  assert.equal(g.admin().timer?.durationMs, 20000, "question 2's own answer time");
  ids.forEach((id, i) => {
    g.clock.advance(100 + i * 100);
    g.answer(id, "correct");
  });
  g.do({ type: "revealAnswer" });
  g.do({ type: "endRound1" });
  g.do({ type: "startWildCard" });
  g.do({ type: "showQuestion" });
  assert.equal(g.admin().question?.text, "Wild", "the Wild card list");
  assert.equal(g.admin().timer?.durationMs, 5000, "the wild card uses Round 1's read time");
  g.tick();
  assert.equal(g.admin().timer?.durationMs, 6000, "the wild question's own answer time");
  g.answer(ids[2], "correct");
  g.answer(ids[3], "wrong");
  g.do({ type: "revealAnswer" });
  g.do({ type: "revealWildCard" });
  g.do({ type: "startBlackout" });
  g.next("boRead");
  assert.equal(g.admin().question?.text, "Dark one", "the Blackout list");
  assert.equal(g.admin().timer?.durationMs, 4000, "Blackout read time");
  g.tick();
  assert.equal(g.admin().timer?.durationMs, 7000, "Blackout answer time");
  assert.equal(g.admin().blackout?.questionsLeft, 2, "Blackout plays its whole list, spares too");
});

test("quiz library: checks, imports, export round trip, cleaning network input, quizzes saved before v3", () => {
  const quiz = libraryQuiz();
  const empty: Quiz = { ...quiz, title: " ", round1: [], wildcard: [], blackout: [] };
  const problems = quizProblems(empty);
  assert.ok(problems.some((p) => p.includes("title")) && problems.some((p) => p.includes("Round 1 question")) && problems.some((p) => p.includes("Blackout question")));
  assert.ok(quizProblems(quiz, 12).some((p) => p.includes("Blackout needs at least 12 questions")), "the event asks for 12+ Blackout questions");
  assert.deepEqual(quizProblems(quiz, 3), []);

  const text = importText(
    "What does LLM stand for?\n* Large Language Model\nLinear Logic Machine\nLayered Learning Matrix\nLong-term Language Memory\n\n" +
      "# Wild card\nWho makes Claude?\nOpenAI\nAnthropic *\nGoogle\nMeta\n\n# Blackout\nPick B\nA) one\nB) two\nC) three\nD) four\nAnswer: B\n\nOnly three\na\nb\nc",
    "round1",
  );
  assert.deepEqual([text.round1.length, text.wildcard.length, text.blackout.length], [1, 1, 1]);
  assert.deepEqual([text.wildcard[0].correct, text.blackout[0].correct], [1, 1]);
  assert.ok(text.problems.length === 1 && text.problems[0].includes("exactly 4 answers"));

  const csv = 'question,A,B,C,D,correct,round,read seconds,answer seconds\r\n"Comma, ""quoted""",w,x,y,z,C,,,12\r\nWild,p,q,r,s,4,wild card,,\r\nDark,p,q,r,s,1,blackout,,\r\nOld,p,q,r,s,2,buzzer,,\r\n';
  const sheet = importRows(parseCsv(csv), "round1");
  assert.deepEqual([sheet.round1[0].correct, sheet.round1[0].openSeconds], [2, 12]);
  assert.deepEqual(sheet.wildcard.map((q) => q.text), ["Wild", "Old"], "old \"buzzer\" rows land in the Wild card list");
  assert.equal(sheet.blackout[0].text, "Dark");

  const json = importJson(JSON.stringify({ questions: [{ text: "J1", options: ["a", "b", "c", "d"], correct: 3, round: 3 }, { text: "J2", options: ["a", "b", "c", "d"], correct: 0, round: 2 }] }), "round1");
  assert.deepEqual([json.blackout[0].text, json.wildcard[0].text], ["J1", "J2"]);
  const back = importRows(parseCsv(quizToCsv(quiz)), "round1");
  assert.deepEqual(back.round1.map((q) => [q.text, q.correct, q.readSeconds, q.openSeconds]), quiz.round1.map((q) => [q.text, q.correct, q.readSeconds, q.openSeconds]));
  assert.deepEqual([back.wildcard.length, back.blackout.length], [2, 3]);

  assert.equal(cleanQuiz("nope", quiz.rules), null);
  const cleaned = cleanQuiz({ id: "c1", title: `  ${"T".repeat(200)}  `, rules: { safe: 4 }, round1: [{ text: " hi \n there ", options: ["a"], correct: 9, image: "javascript:alert(1)" }], wildcard: [], blackout: [] }, quiz.rules)!;
  assert.equal(cleaned.title.length, 80);
  assert.equal(cleaned.rules.safe, 4);
  assert.deepEqual([cleaned.round1[0].text, cleaned.round1[0].correct, cleaned.round1[0].image], ["hi there", 3, null]);

  // A quiz saved before v3: buzzer list → Wild card, Blackout empty, rules from the fallback (Round 1's kept).
  const legacy = cleanQuiz(
    { id: "old", title: "Old", updatedAt: 5, rules: { round1Questions: 2, finalists: 6, buzzerQuestions: 4 }, round1: quiz.round1, buzzer: quiz.wildcard },
    quiz.rules,
    true,
  )!;
  assert.deepEqual([legacy.wildcard.length, legacy.blackout.length, legacy.rules.round1Questions, legacy.rules.safe, legacy.updatedAt], [2, 0, 2, 2, 5]);
  assert.ok(quizProblems(legacy).some((p) => p.includes("Blackout")), "an old quiz needs Blackout questions before it can be played");
});

// ============================================================================
// Full games
// ============================================================================

function playFull(label: string, config: GameConfig, questions: QuizQuestion[], count: number, seed: number, checkCoverage = true) {
  const g = new Game(config, questions, seed);
  const rng = g.rng;
  const ids = Array.from({ length: count }, (_, i) => g.join(`Player ${i + 1}`));
  const accuracy = new Map(ids.map((id) => [id, 0.4 + rng() * 0.45]));
  const seen = new Set<Phase>();
  let guard = 0;
  let views = 0;
  const start = performance.now();
  let slowestRefresh = 0;
  let blackoutClicks = 0;

  while (g.phase !== "podium") {
    assert.ok(guard++ < 20_000, `${label}: the quiz should finish`);
    seen.add(g.phase);
    const t0 = performance.now();
    g.host();
    const admin = g.admin();
    for (const id of ids) g.room.participantView(id);
    slowestRefresh = Math.max(slowestRefresh, performance.now() - t0);
    views += ids.length;
    assert.ok(admin.stepLabel.length > 0);
    if (admin.primary) assert.ok(admin.allowed.includes(admin.primary.action.type), `${label}: primary allowed in ${g.phase}`);
    g.checkNoLeaks(ids);

    // Blackout: after Start Blackout nothing is clicked; the big button is Pause.
    if (["boIntro", "boRead", "boTimesUp", "boReveal", "boDark", "boWinner"].includes(g.phase)) {
      assert.equal(admin.primary?.action.type, "pause", `${label}: Pause is the big button in ${g.phase}`);
      if (g.phase === "boDark") {
        const bo = admin.blackout!;
        assert.ok(bo.runners.filter((r) => !r.alive).every((r) => r.place !== null), `${label}: caught runners have a place`);
      }
      g.tick();
      continue;
    }
    switch (g.phase) {
      case "r1Read":
      case "wcRead":
        g.tick();
        continue;
      case "r1Answer":
      case "wcAnswer":
      case "boAnswer": {
        g.checkOneOrder(ids);
        const phase = g.phase;
        // Real players answer anywhere in the answer time (keen ones early): spread the taps out.
        const limit = g.admin().timer!.durationMs;
        const taps = ids
          .filter((id) => g.screen(id).kind === "answer" && rng() >= 0.08) // some never answer
          .map((id) => ({ id, at: Math.floor(limit * Math.min(0.98, rng() * rng() * 1.6 + 0.03)) }))
          .sort((a, b) => a.at - b.at);
        for (const { id, at } of taps) {
          if (g.phase !== phase) break;
          const t = g.admin().timer!;
          const elapsed = t.durationMs - (t.endsAt - g.clock.now());
          if (at > elapsed) g.clock.advance(at - elapsed);
          if (g.phase !== phase) break;
          g.answer(id, rng() < accuracy.get(id)! ? "correct" : "wrong");
        }
        if (g.phase === phase) g.tick();
        continue;
      }
      case "r1Reveal":
        if (rng() < 0.3 && admin.allowed.includes("nextQuestion")) {
          g.do({ type: "nextQuestion" });
          continue;
        }
        break;
      case "cut": {
        const stage = g.host().stage;
        if (stage.phase === "cut") {
          const played = stage.standings.length;
          assert.equal(stage.standings.filter((s) => s.finalist).length, Math.min(config.safe, played) + (played <= config.safe ? played - Math.min(config.safe, played) : 0), `${label}: top ${config.safe} safe`);
        }
        break;
      }
      case "wcReveal":
        if (rng() < 0.5 && admin.allowed.includes("showStandings")) {
          g.do({ type: "showStandings" });
          continue;
        }
        break;
      case "wcWinner":
        assert.equal(g.admin().finalists.length, Math.min(config.safe + 1, count), `${label}: ${config.safe + 1} finalists`);
        g.do({ type: "openPredictions" });
        continue;
      case "predictions": {
        const finalists = g.admin().finalists.map((f) => f.id);
        for (const id of ids) if (g.screen(id).kind === "backFinalist") g.room.back(id, finalists[Math.floor(rng() * finalists.length)]);
        // One click: the autopilot takes it from here to the podium.
        g.do({ type: "startBlackout" });
        blackoutClicks += 1;
        continue;
      }
    }
    g.primary();
  }

  const podium = g.host().stage;
  assert.ok(podium.phase === "podium" && podium.basis === "blackout", `${label}: the podium after Blackout`);
  assert.equal(blackoutClicks, 1, `${label}: one Start Blackout click, then the podium came by itself`);
  if (podium.phase === "podium") {
    assert.equal(podium.entries.length, Math.min(config.safe + 1, count), `${label}: every finalist placed`);
    assert.deepEqual(podium.entries.map((e) => e.place), podium.entries.map((_, i) => i + 1), `${label}: places 1…n`);
    const winners = podium.entries.filter((e) => e.place === 1);
    assert.equal(winners.length, 1, `${label}: exactly one winner`);
    assert.equal(g.host().cast.filter((c) => c.mood === "right").length, 1, `${label}: one winning bot`);
  }
  if (checkCoverage) {
    for (const phase of ["r1Intro", "r1Read", "r1Answer", "r1TimesUp", "r1Reveal", "cut", "wcIntro", "wcRead", "wcAnswer", "wcTimesUp", "wcReveal", "wcWinner", "predictions", "boIntro", "boRead", "boAnswer", "boTimesUp", "boReveal", "boDark", "boWinner"] as Phase[]) {
      assert.ok(seen.has(phase), `${label}: phase ${phase} happened`);
    }
  }
  for (const id of ids) assert.equal(g.screen(id).kind, "podium");
  assert.equal(g.room.resultsCsv().csv.split("\r\n").length, count + 1, `${label}: CSV row per participant`);
  const bo = g.admin().blackout!;
  return {
    summary: `${label}: ${views} phone views in ${(performance.now() - start).toFixed(0)}ms, slowest full refresh ${slowestRefresh.toFixed(1)}ms, Blackout over after ${bo.questionNumber} questions`,
    suddenDeath: seen.has("wcRead") && !!g.admin().wildCard?.suddenDeath,
    blackoutLength: bo.questionNumber,
  };
}

const summaries = [
  playFull("demo preset, 5 participants", PRESETS.demo, FILE_QUESTIONS, 5, 5),
  playFull("demo preset, 8 participants", PRESETS.demo, FILE_QUESTIONS, 8, 9),
  playFull("event preset, 100 participants", PRESETS.event, EVENT_QUESTIONS, 100, 21),
];
for (const s of summaries) console.log(`✓ full game, ${s.summary}`);

// 50 full 100-player event games: no exceptions, exactly one winner, the podium on its own.
const seeds = 50;
let suddenDeaths = 0;
const lengths: number[] = [];
for (let seed = 100; seed < 100 + seeds; seed++) {
  const r = playFull("event seed", PRESETS.event, EVENT_QUESTIONS, 100, seed, false);
  if (r.suddenDeath) suddenDeaths += 1;
  lengths.push(r.blackoutLength);
}
const demoLengths: number[] = [];
for (let seed = 300; seed < 340; seed++) demoLengths.push(playFull("demo seed", PRESETS.demo, FILE_QUESTIONS, 4 + (seed % 6), seed, false).blackoutLength);
lengths.sort((a, b) => a - b);
demoLengths.sort((a, b) => a - b);
console.log(
  `✓ ${seeds} more 100-player event games (Blackout lasted ${lengths[0]}–${lengths[lengths.length - 1]} questions, median ${lengths[Math.floor(lengths.length / 2)]}; ` +
    `${suddenDeaths} wild card sudden deaths) and 40 demo games (Blackout median ${demoLengths[20]}, ${demoLengths.filter((n) => n <= 6).length} of 40 within 6 questions)`,
);
console.log(`\nAll ${results.length + summaries.length + 1} checks passed.`);
