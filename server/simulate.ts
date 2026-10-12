/**
 * Plays whole quizzes and every edge case with fake participants and a fake
 * clock, and checks every rule in docs/SPEC.md held. No sockets, no browser,
 * runs in about a second. Run: npm run simulate
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
} from "../src/shared/protocol";
import { blankQuestion, cleanQuiz, importJson, importRows, importText, parseCsv, quizProblems, quizToCsv } from "../src/shared/quiz";
import { type GameConfig, PRESETS } from "./config";
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
  get pending() {
    return this.timers.size;
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

/** A made-up question set the size of the real event. */
function eventQuestions(round1: number, round2: number): QuizQuestion[] {
  const make = (id: string, round: 1 | 2 | null, i: number): QuizQuestion => ({
    id,
    round,
    text: `Question ${id}?`,
    image: i % 5 === 0 ? "/questions/hexagon.svg" : null,
    options: [`${id} option 1`, `${id} option 2`, `${id} option 3`, `${id} option 4`],
    correct: i % 4,
  });
  return [
    ...Array.from({ length: round1 }, (_, i) => make(`r1-${i + 1}`, 1, i)),
    ...Array.from({ length: round2 }, (_, i) => make(`r2-${i + 1}`, 2, i)),
  ];
}

const BEFORE_REVEAL: Phase[] = ["r1Read", "r1Answer", "r1TimesUp", "r2Read", "r2BuzzOpen", "r2Answering"];

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
  expect(phase: Phase, why = "") {
    assert.equal(this.phase, phase, why);
  }

  answer(id: string, pick: "correct" | "wrong") {
    const s = this.screen(id);
    assert.equal(s.kind, "answer", `${this.person(id).name} should see options`);
    if (s.kind !== "answer") return;
    const correctText = this.admin().question!.correctText;
    const option = s.options.find((o) => (pick === "correct" ? o.text === correctText : o.text !== correctText))!;
    this.room.answer(id, s.questionId, option.id);
  }

  buzz(id: string) {
    const s = this.screen(id);
    this.room.buzz(id, s.kind === "buzzer" ? s.questionId ?? "" : "");
  }

  /** No phone (and no Host) may know the answer before the reveal. */
  checkNoLeaks(ids: string[]) {
    if (!BEFORE_REVEAL.includes(this.phase)) return;
    for (const id of ids) {
      const json = JSON.stringify(this.phone(id));
      assert.ok(!json.includes('"correct'), `phone view leaks the answer in ${this.phase}: ${json.slice(0, 300)}`);
    }
    const hostJson = JSON.stringify(this.host());
    assert.ok(!/"correct(Text)?":(?!null)/.test(hostJson), `host view leaks the answer in ${this.phase}`);
  }
}

/** Round 1 played so that ids[0] is best, ids[1] second, and so on (everyone answers right, faster = earlier). */
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

function setupBuzzerRound(names = ["Riya", "Aadi", "Kabir", "Zoya"]) {
  const g = new Game(PRESETS.demo);
  const ids = names.map((n) => g.join(n));
  playRound1InOrder(g, ids);
  const finalists = ids.slice(0, 3);
  const audience = ids.slice(3);
  g.do({ type: "openPredictions" });
  g.do({ type: "startBuzzerRound" });
  g.expect("r2Intro");
  return { g, ids, finalists, audience };
}

const results: string[] = [];
function test(name: string, fn: () => void) {
  fn();
  results.push(name);
  console.log(`✓ ${name}`);
}

// ============================================================================
// Joining
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

test("bots: any colour (wheel), shared bots allowed, names unique; lobby only; moods follow the game; one 1–4 answer order", () => {
  const g = new Game(PRESETS.demo);
  const ids = Array.from({ length: 100 }, (_, i) => g.join(`P${i}`));
  const looks = () => ids.map((id) => g.phone(id).me);
  assert.equal(new Set(looks().slice(0, 12).map((m) => m.color)).size, 12, "starting bots are varied: the first 12 get 12 colours");
  assert.ok(looks().every((m) => PARTICIPANT_COLORS.includes(m.color as never) && BOT_HEADS.includes(m.head)), "100 people all get a bot");

  // Sharing is fine: copy someone else's exact bot.
  const p1 = g.phone(ids[1]).me;
  assert.deepEqual(g.room.setBot(ids[0], { color: p1.color, head: p1.head }), { ok: true });
  assert.deepEqual([g.phone(ids[0]).me.color, g.phone(ids[0]).me.head], [p1.color.toLowerCase(), p1.head], "same colour and head as P1");
  const lobby = g.screen(ids[0]);
  assert.ok(lobby.kind === "lobby" && !("botPicker" in lobby), "nothing to lock or grey out any more");

  // Any colour from the wheel; very dark ones are brightened so they show on the dark screens.
  assert.deepEqual(g.room.setBot(ids[2], { color: "#3A86FF", head: "visor" }), { ok: true });
  assert.equal(g.phone(ids[2]).me.color, "#3a86ff");
  assert.deepEqual(g.room.setBot(ids[3], { color: "#000000", head: "box" }), { ok: true });
  assert.equal(hexToHsl(g.phone(ids[3]).me.color).l >= BOT_LIGHTNESS.min, true, "black becomes visible grey");
  assert.deepEqual(g.room.setBot(ids[4], { color: "#140028", head: "box" }), { ok: true });
  const dark = hexToHsl(g.phone(ids[4]).me.color);
  assert.ok(Math.abs(dark.h - 270) < 3 && dark.l >= BOT_LIGHTNESS.min - 0.5, "a dark purple stays purple, just lighter");
  assert.equal(normalizeBotColor("#fff"), normalizeBotColor("#ffffff"), "#rgb short form works");
  assert.ok(hexToHsl(normalizeBotColor("#ffffff")!).l <= BOT_LIGHTNESS.max + 0.5, "pure white is toned down a little");
  assert.deepEqual(g.room.setBot(ids[0], { color: "red", head: "box" }), { ok: false, error: "invalid" });
  assert.deepEqual(g.room.setBot(ids[0], { color: "#12345", head: "box" }), { ok: false, error: "invalid" });
  assert.deepEqual(g.room.setBot(ids[0], { color: p1.color, head: "wings" }), { ok: false, error: "invalid" });

  // Names stay unique (case-insensitive), whatever the bots.
  const dupe = g.room.join("p1");
  assert.ok(!dupe.ok && dupe.error === "name-taken", "two people can't share a name");

  const g2 = new Game(PRESETS.demo);
  const a = g2.join("A");
  const b = g2.join("B");

  // Moods on the Host.
  const mood = (game: Game, id: string) => game.host().cast.find((c) => c.id === id)!.mood;
  assert.ok(g2.host().cast.every((c) => c.mood === "idle"), "idle in the lobby");
  g2.do({ type: "startQuiz" });
  assert.deepEqual(g2.room.setBot(a, { color: PARTICIPANT_COLORS[5], head: "box" }), { ok: false, error: "too-late" });
  g2.do({ type: "showQuestion" });
  assert.equal(mood(g2, a), "idle", "idle while reading");
  const reading = g2.host().stage;
  assert.ok(reading.phase === "r1Read" && reading.question.options === null, "no options on the Host while reading");
  g2.tick();
  assert.equal(mood(g2, a), "thinking");
  const answering = g2.host().stage;
  const phoneA = g2.screen(a);
  const phoneB = g2.screen(b);
  assert.ok(answering.phase === "r1Answer" && answering.question.options?.length === 4, "Host shows the 4 options, numbered 1–4");
  assert.ok(phoneA.kind === "answer" && phoneB.kind === "answer");
  assert.deepEqual(phoneA.options.map((o) => o.text), answering.question.options, "phones show the Host's order");
  assert.deepEqual(phoneB.options.map((o) => o.text), answering.question.options);
  g2.answer(a, "correct");
  assert.equal(mood(g2, a), "locked", "locked in, still no hint of right or wrong");
  assert.equal(mood(g2, b), "thinking");
  g2.answer(b, "wrong");
  g2.do({ type: "revealAnswer" });
  assert.equal(mood(g2, a), "right");
  assert.equal(mood(g2, b), "wrong");
});

// ============================================================================
// Round 1
// ============================================================================

test("round 1 scoring: instant ≈ 1000, last moment ≈ 500, wrong 0; early time's up", () => {
  const g = new Game(PRESETS.demo);
  const fast = g.join("Fast");
  const slow = g.join("Slow");
  const wrong = g.join("Wrong");
  assert.equal(g.admin().primary?.label, "Start quiz");
  g.do({ type: "startQuiz" });
  g.expect("r1Intro");
  assert.equal(g.screen(fast).kind, "r1Intro");
  assert.equal(g.primary(), "Show question");
  g.expect("r1Read");
  assert.equal(g.host().timer?.durationMs, 8000, "8s to read");
  assert.equal(g.screen(fast).kind, "eyesUp");
  assert.equal(g.admin().primary, null, "no primary button while the read timer runs");

  g.tick();
  g.expect("r1Answer");
  assert.equal(g.host().timer?.durationMs, 8000, "8s to answer");
  g.checkNoLeaks([fast, slow, wrong]);
  g.answer(fast, "correct");
  g.clock.advance(7999);
  g.answer(slow, "correct");
  g.answer(wrong, "wrong");
  g.expect("r1TimesUp", "everyone answered: time's up straight away");
  assert.equal(g.person(fast).score, 1000);
  assert.equal(g.person(slow).score, 500);
  assert.equal(g.person(wrong).score, 0);
  const lock = g.screen(fast);
  assert.ok(lock.kind === "lockedIn" && lock.timeUp, "phones say locked in, time's up");
  g.checkNoLeaks([fast, slow, wrong]);

  assert.equal(g.primary(), "Reveal answer");
  assert.deepEqual(
    [fast, slow, wrong].map((id) => {
      const s = g.screen(id);
      return s.kind === "result" ? s.outcome : s.kind;
    }),
    ["correct", "correct", "wrong"],
  );
  const reveal = g.host().stage;
  assert.ok(reveal.phase === "r1Reveal" && reveal.correctText === "Large Language Model");

  assert.equal(g.primary(), "Show results");
  const results = g.host().stage;
  assert.ok(results.phase === "r1Results");
  if (results.phase === "r1Results") {
    assert.equal(results.options.reduce((s, o) => s + o.count, 0), 3, "chart counts every answer");
    assert.equal(results.options.filter((o) => o.correct).length, 1);
    assert.deepEqual(results.options.map((o) => o.letter), ["A", "B", "C", "D"]);
  }
  assert.equal(g.primary(), "Show leaderboard");
  const board = g.host().stage;
  assert.ok(board.phase === "r1Leaderboard");
  if (board.phase === "r1Leaderboard") {
    assert.deepEqual(board.rows.map((r) => r.name), ["Fast", "Slow", "Wrong"]);
    assert.deepEqual(board.rows.map((r) => r.previousRank), [null, null, null], "no previous rank on question 1");
    assert.equal(board.rows[0].change, 1000);
  }
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
  assert.equal(new Set(s.options.map((o) => o.id)).size, 4);
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
  const host = g.host().stage;
  assert.ok(host.phase === "r1TimesUp" && host.answered === 0 && host.expected === 2);
});

test("late joiners: play from the next question in round 1, audience after it", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  g.join("B");
  g.do({ type: "startQuiz" });
  const c = g.join("C");
  assert.equal(g.person(c).status, "playing", "joined at the intro: plays question 1");
  g.do({ type: "showQuestion" });
  const d = g.join("D");
  g.tick();
  assert.equal(g.screen(d).kind, "answer", "joined during the read: plays this question");
  const e = g.join("E");
  assert.equal(g.screen(e).kind, "nextQuestion", "joined while answering: next question");
  const host = g.host().stage;
  assert.ok(host.phase === "r1Answer" && host.expected === 4, "the late joiner isn't waited for");
  for (const id of [a, g.admin().participants[1].id, c, d]) g.answer(id, "wrong");
  g.expect("r1TimesUp", "time's up without waiting for E");
  assert.equal(g.person(e).answered, null);

  g.do({ type: "revealAnswer" });
  assert.equal(g.screen(e).kind, "nextQuestion");
  g.do({ type: "nextQuestion" });
  g.tick();
  assert.equal(g.screen(e).kind, "answer", "E plays question 2");
  g.answer(e, "wrong");
  g.tick();
  g.do({ type: "revealAnswer" });
  g.do({ type: "endRound1" });
  g.expect("cut", "round 1 can end early");

  // Everyone has 0 points, so total answer time decides. E answered question 2
  // instantly, but question 1 (before E joined) counts as the full 8s: E ranks last.
  assert.equal(g.person(e).rank, 5);
  const f = g.join("F");
  assert.equal(g.person(f).status, "audience");
  assert.equal(g.person(f).joinedLate, true);
  assert.equal(g.screen(f).kind, "audience");
  g.do({ type: "openPredictions" });
  assert.equal(g.screen(f).kind, "backFinalist", "late joiners can back a finalist");
});

test("the cut: top 6 by points, ties broken by total answer time; ranks shown only here", () => {
  const g = new Game({ ...PRESETS.event, round1: { ...PRESETS.event.round1, questions: 2 } }, eventQuestions(2, 10));
  const ids = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"].map((n) => g.join(n));
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  for (let q = 0; q < 2; q++) {
    g.tick();
    // P1–P5 right; P6 wrong fast, P7 wrong slow, P8 doesn't answer.
    ids.slice(0, 5).forEach((id) => {
      g.clock.advance(200);
      g.answer(id, "correct");
    });
    g.answer(ids[5], "wrong");
    g.clock.advance(3000);
    g.answer(ids[6], "wrong");
    g.tick(); // P8 never answers
    g.expect("r1TimesUp");
    g.do({ type: "revealAnswer" });
    if (q === 0) g.do({ type: "nextQuestion" });
  }
  assert.equal(g.admin().primary?.label, "Show results", "results are still the next suggested step");
  assert.ok(g.admin().allowed.includes("endRound1") && !g.admin().allowed.includes("nextQuestion"), "last question: End round 1, no Next");
  assert.match(g.admin().hint ?? "", /End round 1/);
  g.do({ type: "endRound1" });
  const stage = g.host().stage;
  assert.ok(stage.phase === "cut");
  if (stage.phase !== "cut") return;
  assert.deepEqual(stage.standings.map((s) => s.name), ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
  assert.deepEqual(stage.standings.map((s) => s.finalist), [true, true, true, true, true, true, false, false]);
  assert.equal(stage.standings[5].score, 0, "P6 is in on 0 points: faster than P7 and P8");

  const six = g.screen(ids[5]);
  assert.ok(six.kind === "cut" && six.madeIt && six.rank === 6 && six.of === 8);
  const seven = g.screen(ids[6]);
  assert.ok(seven.kind === "cut" && !seven.madeIt && seven.rank === 7);
  assert.equal(g.person(ids[6]).status, "audience");
  assert.equal(g.person(ids[0]).status, "finalist");
  for (const id of ids) {
    // Ranks appear on phones only at the cut.
    const json = JSON.stringify(g.screen(id));
    assert.ok(json.includes('"rank"'));
  }
  g.do({ type: "openPredictions" });
  assert.ok(!JSON.stringify(g.screen(ids[6])).includes('"rank"'), "no rank on phones after the cut");
});

// ============================================================================
// Predictions
// ============================================================================

test("predictions: audience backs a finalist and can change; locked once the buzzer round starts", () => {
  const { g, ids, finalists } = (() => {
    const g = new Game(PRESETS.demo);
    const ids = ["A", "B", "C", "D", "E", "F"].map((n) => g.join(n));
    playRound1InOrder(g, ids);
    return { g, ids, finalists: ids.slice(0, 3) };
  })();
  const [, , , d, e, f] = ids;
  g.room.back(d, finalists[0]);
  assert.equal(g.person(d).backingId, null, "no backing before predictions open");
  assert.equal(g.primary(), "Open predictions");
  const s = g.screen(d);
  assert.ok(s.kind === "backFinalist" && s.finalists.length === 3);
  assert.equal(g.screen(finalists[0]).kind, "finalist");
  g.room.back(d, finalists[0]);
  g.room.back(e, finalists[0]);
  g.room.back(f, finalists[1]);
  g.room.back(d, finalists[2]); // changed their mind
  g.room.back(finalists[1], finalists[0]); // finalists can't back
  g.room.back(e, "nobody");
  const stage = g.host().stage;
  assert.ok(stage.phase === "predictions");
  if (stage.phase === "predictions") {
    assert.deepEqual(stage.backing.counts, { [finalists[0]]: 1, [finalists[1]]: 1, [finalists[2]]: 1 });
    assert.equal(stage.backing.backers, 3);
    assert.equal(stage.backing.audience, 3);
  }
  assert.equal(g.primary(), "Start buzzer round");
  g.room.back(d, finalists[0]);
  assert.equal(g.person(d).backingId, finalists[2], "backing is locked once the buzzer round starts");
});

// ============================================================================
// Buzzer round
// ============================================================================

test("buzzer: read locks buzzers, first buzz wins, wrong → locked out → reopen, correct +1, undo", () => {
  const { g, ids, finalists, audience } = setupBuzzerRound();
  const [f1, f2, f3] = finalists;
  assert.equal(g.primary(), "Show question");
  g.expect("r2Read");
  const read = g.host().stage;
  assert.ok(read.phase === "r2Read" && read.round2.question.options.length === 4, "Host shows the 4 options");
  assert.equal(g.host().timer?.durationMs, 5000, "5s read");
  g.checkNoLeaks(ids);
  g.buzz(f1);
  g.expect("r2Read", "buzzers are locked during the read");
  const locked = g.screen(f1);
  assert.ok(locked.kind === "buzzer" && !locked.canBuzz);

  g.tick();
  g.expect("r2BuzzOpen");
  assert.equal(g.host().timer?.durationMs, 15000, "15s buzz window");
  const open = g.screen(f1);
  assert.ok(open.kind === "buzzer" && open.canBuzz);
  const watch = g.screen(audience[0]);
  assert.ok(watch.kind === "buzzerWatch" && watch.finalists.length === 3);

  g.buzz(f1);
  g.buzz(f2); // too late
  g.expect("r2Answering");
  assert.equal(g.admin().round2?.buzzedBy?.id, f1, "first buzz wins the turn");
  assert.equal(g.host().timer?.durationMs, 10000, "10s to say the answer");
  g.checkNoLeaks(ids);
  assert.ok(g.admin().question?.correctText, "Admin sees the answer to judge");
  g.tick();
  g.expect("r2Answering", "the countdown running out never marks the answer");
  assert.equal(g.admin().round2?.answerTimeUp, true);

  g.do({ type: "markWrong" });
  g.expect("r2BuzzOpen", "buzzers reopen for the others");
  assert.equal(g.host().timer?.durationMs, 10000, "10s reopen window");
  assert.equal(g.person(f1).points, 0, "no points lost for a wrong answer");
  const out = g.screen(f1);
  assert.ok(out.kind === "buzzer" && out.lockedOut && !out.canBuzz && out.myResult === "wrong");
  assert.ok(g.admin().canUndo, "undo is offered after the mark");
  g.buzz(f1);
  g.expect("r2BuzzOpen", "a locked-out finalist can't buzz again");

  g.buzz(f2);
  g.expect("r2Answering");
  assert.equal(g.admin().canUndo, false, "a new buzz ends the chance to undo");
  g.do({ type: "markCorrect" });
  g.expect("r2Reveal");
  assert.equal(g.person(f2).points, 1);
  const reveal = g.host().stage;
  assert.ok(reveal.phase === "r2Reveal" && reveal.round2.outcome?.kind === "correct" && reveal.round2.correct !== null);
  const mine = g.screen(f2);
  assert.ok(mine.kind === "buzzer" && mine.myResult === "correct");

  // Undo the correct mark: point gone, back to judging f2.
  assert.equal(g.admin().lastMark?.by.id, f2);
  g.do({ type: "undoMark" });
  g.expect("r2Answering");
  assert.equal(g.person(f2).points, 0);
  assert.equal(g.admin().round2?.buzzedBy?.id, f2);
  assert.deepEqual(g.admin().round2?.wrong.map((w) => w.id), [f1], "the earlier wrong mark stays");
  g.do({ type: "markCorrect" });
  assert.equal(g.person(f2).points, 1);
  assert.equal(g.primary(), "Show scores");
  const scores = g.host().stage;
  assert.ok(scores.phase === "r2Scores" && scores.finalists[0].id === f2, "scores sorted best first");
  assert.equal(g.admin().primary?.label, "Next question");
  assert.equal(g.admin().allowed.includes("undoMark"), false, "no undo after moving on");
  void f3;
});

test("buzzer: everyone wrong → reveal, nobody scores; undo the last wrong; nobody buzzes → reveal", () => {
  const { g, finalists } = setupBuzzerRound();
  const [f1, f2, f3] = finalists;
  g.do({ type: "showQuestion" });
  g.tick();
  for (const f of [f1, f2, f3]) {
    g.buzz(f);
    g.do({ type: "markWrong" });
  }
  g.expect("r2Reveal");
  const r = g.host().stage;
  assert.ok(r.phase === "r2Reveal" && r.round2.outcome?.kind === "nobody" && r.round2.outcome.reason === "allWrong");
  assert.deepEqual(finalists.map((f) => g.person(f).points), [0, 0, 0]);

  g.do({ type: "undoMark" });
  g.expect("r2Answering");
  assert.equal(g.admin().round2?.buzzedBy?.id, f3);
  assert.deepEqual(g.admin().round2?.wrong.map((w) => w.id), [f1, f2]);
  g.do({ type: "markWrong" });
  g.expect("r2Reveal");

  g.do({ type: "nextQuestion" });
  g.tick(); // read → buzzers open
  g.tick(); // 15s, nobody buzzes
  g.expect("r2Reveal");
  const t = g.host().stage;
  assert.ok(t.phase === "r2Reveal" && t.round2.outcome?.kind === "nobody" && t.round2.outcome.reason === "timeUp");
  assert.equal(g.admin().canUndo, false, "nothing to undo");
});

test("buzzer: tie for 1st after the last question → sudden death between the tied only", () => {
  const { g, finalists, audience } = setupBuzzerRound();
  const [f1, f2, f3] = finalists;
  const playQuestion = (winner: string | null) => {
    g.tick();
    if (winner) {
      g.buzz(winner);
      g.do({ type: "markCorrect" });
    } else g.tick();
    g.expect("r2Reveal");
  };
  g.do({ type: "showQuestion" });
  playQuestion(f1);
  g.do({ type: "nextQuestion" });
  playQuestion(f2);
  g.do({ type: "nextQuestion" });
  playQuestion(null);
  assert.equal(g.primary(), "Show scores");
  assert.equal(g.admin().primary?.label, "Start sudden death", "tie for 1st");
  assert.match(g.admin().hint ?? "", /Tie for 1st/);
  g.do({ type: "startSuddenDeath" });
  g.expect("suddenDeath");
  const intro = g.host().stage;
  assert.ok(intro.phase === "suddenDeath" && intro.tied.map((t) => t.id).sort().join() === [f1, f2].sort().join());
  const out = g.screen(f3);
  assert.ok(out.kind === "buzzer" && out.step === "suddenDeath" && !out.inPlay);

  g.do({ type: "showQuestion" });
  const q = g.host().stage;
  assert.ok(q.phase === "r2Read" && q.round2.question.suddenDeath && q.round2.question.number === 1);
  g.tick();
  g.buzz(f3);
  g.expect("r2BuzzOpen", "only the tied finalists can buzz");
  g.buzz(f1);
  g.do({ type: "markWrong" });
  g.tick(); // f2 doesn't buzz in the reopen window
  g.expect("r2Reveal");
  assert.equal(g.admin().primary?.label, "Show scores");
  g.do({ type: "nextQuestion" }); // another sudden-death question
  const q2 = g.host().stage;
  assert.ok(q2.phase === "r2Read" && q2.round2.question.number === 2);
  g.tick();
  g.buzz(f2);
  g.do({ type: "markCorrect" });
  assert.equal(g.admin().round2?.winner?.id, f2);
  assert.equal(g.primary(), "Show scores");
  assert.equal(g.primary(), "Show winner");
  g.expect("podium");
  const podium = g.host().stage;
  assert.ok(podium.phase === "podium" && podium.basis === "buzzer");
  if (podium.phase === "podium") {
    assert.deepEqual(podium.entries.map((e) => e.id), [f2, f1, f3], "sudden-death winner first");
  }
  const win = g.screen(f2);
  assert.ok(win.kind === "podium" && win.place === 1);
  const third = g.screen(f3);
  assert.ok(third.kind === "podium" && third.place === 3);
  const fan = g.screen(audience[0]);
  assert.ok(fan.kind === "podium" && fan.place === null);
});

// ============================================================================
// Admin controls
// ============================================================================

test("timers: pause freezes, resume continues, +5 seconds, skip", () => {
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
  assert.ok(g.admin().allowed.includes("resume") && !g.admin().allowed.includes("pause"));
  g.clock.advance(60_000);
  g.expect("r1Answer", "nothing moves while paused");
  g.do({ type: "addTime" });
  assert.equal(g.host().timer?.remainingMs, 10_000, "+5s while paused");
  g.do({ type: "resume" });
  assert.equal(g.host().timer?.endsAt, g.clock.now() + 10_000);
  g.do({ type: "addTime" });
  assert.equal(g.host().timer?.endsAt, g.clock.now() + 15_000, "+5s while running");
  assert.equal(g.host().timer?.durationMs, 18_000);
  g.answer(a, "correct");
  g.do({ type: "skipTimer" });
  g.expect("r1TimesUp");
  // Answered 3s into an 18s window (8s + two "+5s"): 500 + 500 × (1 − 3/18) ≈ 917.
  assert.equal(g.person(a).score, 917, "speed points use the extended time");

  // Pause also stops buzzing; +5s restarts an expired spoken-answer countdown.
  const { g: b, finalists } = setupBuzzerRound();
  b.do({ type: "showQuestion" });
  b.tick();
  b.do({ type: "pause" });
  b.buzz(finalists[0]);
  b.expect("r2BuzzOpen", "no buzzing while paused");
  b.do({ type: "resume" });
  b.buzz(finalists[0]);
  b.tick();
  assert.equal(b.host().timer, null);
  b.do({ type: "addTime" });
  assert.equal(b.host().timer?.durationMs, 5000, "a fresh 5s to finish the answer");
  assert.equal(b.admin().round2?.answerTimeUp, false);
  b.do({ type: "skipTimer" });
  assert.equal(b.admin().round2?.answerTimeUp, true);
  b.expect("r2Answering");
});

test("stepId: a stale or repeated command is ignored, so a double tap never skips two steps", () => {
  const g = new Game(PRESETS.demo);
  g.join("A");
  g.join("B");
  const step = g.room.stepId;
  assert.deepEqual(g.room.command(step, { type: "startQuiz" }), { ok: true });
  assert.deepEqual(g.room.command(step, { type: "startQuiz" }), { ok: false, reason: "stale-step" });
  const intro = g.room.stepId;
  assert.deepEqual(g.room.command(intro, { type: "showQuestion" }), { ok: true });
  assert.deepEqual(g.room.command(intro, { type: "showQuestion" }), { ok: false, reason: "stale-step" });
  g.expect("r1Read");
  const reading = g.room.stepId;
  g.tick(); // the read timer ran out on its own...
  assert.deepEqual(g.room.command(reading, { type: "skipTimer" }), { ok: false, reason: "stale-step" }, "...so a late Skip doesn't skip the answer step");
  g.expect("r1Answer");
  assert.deepEqual(g.room.command(reading, { type: "pause" }), { ok: true }, "pause works whatever the step");
  assert.deepEqual(g.try({ type: "revealAnswer" }), { ok: false, reason: "not-allowed" });

  const { g: b, finalists } = setupBuzzerRound();
  b.do({ type: "showQuestion" });
  b.tick();
  b.buzz(finalists[0]);
  const judging = b.room.stepId;
  assert.deepEqual(b.room.command(judging, { type: "markCorrect" }), { ok: true });
  assert.deepEqual(b.room.command(judging, { type: "markCorrect" }), { ok: false, reason: "stale-step" }, "no double point");
  assert.equal(b.person(finalists[0]).points, 1);
});

test("void and restart: points undone; a voided buzzer question is replaced", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("A");
  const b = g.join("B");
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.answer(a, "correct");
  g.answer(b, "correct");
  g.do({ type: "revealAnswer" });
  assert.ok(g.person(a).score > 0);
  g.do({ type: "voidQuestion" });
  assert.equal(g.person(a).score, 0, "void takes the points back");
  assert.equal(g.screen(a).kind, "voided");
  const voided = g.host().stage;
  assert.ok(voided.phase === "r1Reveal" && voided.voided && voided.correctText === null);
  assert.ok(!g.admin().allowed.includes("showResults"), "no results for a voided question");
  assert.equal(g.admin().primary?.label, "Next question");

  g.do({ type: "nextQuestion" });
  g.tick();
  const oldScreen = g.screen(a);
  g.answer(a, "correct");
  g.answer(b, "wrong");
  g.do({ type: "revealAnswer" });
  g.do({ type: "showResults" });
  g.do({ type: "showLeaderboard" });
  const oldQuestionId = g.admin().question!.id;
  g.do({ type: "restartQuestion" });
  g.expect("r1Read");
  assert.equal(g.person(a).score, 0, "restart takes the points back");
  g.tick();
  const fresh = g.screen(a);
  assert.ok(fresh.kind === "answer" && fresh.questionId !== oldQuestionId, "a restarted question gets new ids");
  if (oldScreen.kind === "answer") g.room.answer(a, oldScreen.questionId, oldScreen.options[0].id);
  assert.equal(g.screen(a).kind, "answer", "an answer to the old run is ignored");
  g.answer(a, "correct");
  g.answer(b, "correct");
  g.do({ type: "revealAnswer" });
  g.do({ type: "nextQuestion" });
  g.tick();
  g.tick();
  g.do({ type: "revealAnswer" });
  g.do({ type: "endRound1" });
  g.do({ type: "restartRound" });
  g.expect("r1Intro", "restart round 1 from the cut");
  assert.ok(g.admin().participants.every((p) => p.score === 0 && p.status === "playing" && p.rank !== null));

  // Buzzer round
  const { g: r, finalists } = setupBuzzerRound();
  r.do({ type: "showQuestion" });
  r.tick();
  r.buzz(finalists[0]);
  r.do({ type: "markCorrect" });
  r.do({ type: "voidQuestion" });
  assert.equal(r.person(finalists[0]).points, 0);
  const v = r.host().stage;
  assert.ok(v.phase === "r2Reveal" && v.round2.outcome?.kind === "voided");
  r.do({ type: "nextQuestion" });
  const replaced = r.host().stage;
  assert.ok(replaced.phase === "r2Read" && replaced.round2.question.number === 1, "the replacement is still question 1");
  r.tick();
  r.buzz(finalists[1]);
  r.do({ type: "markCorrect" });
  r.do({ type: "restartQuestion" });
  r.expect("r2Read");
  assert.equal(r.person(finalists[1]).points, 0, "restart takes the point back");
  r.tick();
  r.buzz(finalists[2]);
  r.do({ type: "markCorrect" });
  r.do({ type: "restartRound" });
  r.expect("r2Intro");
  assert.ok(finalists.every((f) => r.person(f).points === 0), "restart round: buzzer points back to 0");
});

test("remove: early time's up, next-best takes an empty final seat, a buzzer's turn passes on", () => {
  const g = new Game(PRESETS.demo);
  const ids = ["A", "B", "C", "D", "E"].map((n) => g.join(n));
  playRound1InOrder(g, ids);
  const [a, b, c, d, e] = ids;
  g.do({ type: "openPredictions" });
  g.room.back(d, c);
  g.room.back(e, a);
  g.do({ type: "removeParticipant", participantId: c });
  assert.equal(g.person(c).status, "removed");
  assert.equal(g.person(d).status, "finalist", "4th place takes the empty seat before the buzzer round");
  assert.equal(g.person(e).backingId, a);
  assert.deepEqual(g.admin().finalists.map((f) => f.id), [a, b, d]);
  assert.deepEqual(g.room.join("", c), { ok: false, error: "removed" });
  assert.deepEqual(g.room.join("C"), { ok: false, error: "removed" });

  g.do({ type: "startBuzzerRound" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.buzz(a);
  g.do({ type: "removeParticipant", participantId: a });
  g.expect("r2BuzzOpen", "the removed buzzer's turn goes back to the others");
  assert.deepEqual(g.admin().finalists.map((f) => f.id), [b, d], "no promotion once the buzzer round started");
  g.buzz(b);
  g.do({ type: "markCorrect" });
  g.do({ type: "showScores" });
  g.do({ type: "nextQuestion" });
});

test("end quiz now: from round 1 (round 1 ranking) and from the buzzer round", () => {
  const g = new Game(PRESETS.demo);
  const [a, b] = ["A", "B"].map((n) => g.join(n));
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  g.tick();
  g.answer(a, "wrong");
  g.answer(b, "correct");
  g.do({ type: "endQuiz" });
  g.expect("podium");
  const p = g.host().stage;
  assert.ok(p.phase === "podium" && p.basis === "round1" && p.entries[0].id === b);
  assert.deepEqual(g.room.join("Late"), { ok: false, error: "quiz-ended" });
  const s = g.screen(a);
  assert.ok(s.kind === "podium" && s.place === 2 && s.winner?.id === b);
  assert.equal(g.admin().primary, null);

  const { g: r, finalists } = setupBuzzerRound();
  r.do({ type: "showQuestion" });
  r.tick();
  r.buzz(finalists[2]);
  r.do({ type: "markCorrect" });
  r.do({ type: "endQuiz" });
  const q = r.host().stage;
  assert.ok(q.phase === "podium" && q.basis === "buzzer" && q.entries[0].id === finalists[2]);
});

test("room code and sound toggles; results CSV", () => {
  const g = new Game(PRESETS.demo);
  const a = g.join("=cmd|evil");
  g.join('Rahul "R", S');
  g.do({ type: "setRoomCodeVisible", visible: false });
  assert.equal(g.host().roomCodeVisible, false);
  g.do({ type: "setSound", on: false });
  assert.equal(g.host().soundOn, false);
  const { csv, filename } = g.room.resultsCsv();
  assert.equal(filename, "hermes-quiz-TEST-results.csv");
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3, "header + a row per participant");
  assert.ok(lines.some((l) => l.includes("'=cmd|evil")), "names that look like formulas are neutralised");
  assert.ok(lines.some((l) => l.includes('"Rahul ""R"", S"')), "quotes and commas escaped");
  void a;
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
  assert.equal(g.person(a).pageHidden, true);
  assert.ok(!JSON.stringify(g.phone(a)).includes("leftPage") && !JSON.stringify(g.host()).includes("leftPage"));
});

// ============================================================================
// The quiz library: a quiz's own settings and timers, checks, imports
// ============================================================================

function libraryQuiz(): Quiz {
  const q = (text: string, extra: Partial<LibraryQuestion> = {}): LibraryQuestion => ({
    ...blankQuestion(),
    text,
    options: [`${text} one`, `${text} two`, `${text} three`, `${text} four`],
    correct: 1,
    ...extra,
  });
  return {
    id: "lib",
    title: "Library test",
    rules: {
      round1Questions: 2,
      round1ReadSeconds: 5,
      round1AnswerSeconds: 9,
      finalists: 2,
      buzzerQuestions: 1,
      buzzerReadSeconds: 4,
      buzzWindowSeconds: 11,
      spokenAnswerSeconds: 7,
      reopenSeconds: 8,
    },
    round1: [q("First"), q("Second", { readSeconds: 3, openSeconds: 20 }), q("Spare")],
    buzzer: [q("Buzz", { openSeconds: 6 }), q("Buzz spare")],
    updatedAt: 0,
  };
}

test("quiz library: a quiz's own settings and per-question timers reach the game", () => {
  const quiz = libraryQuiz();
  assert.deepEqual(quizProblems(quiz), []);
  const { config, questions } = quizToGame(quiz, PRESETS.event);
  const g = new Game(config, questions);
  const ids = ["Riya", "Aadi", "Kabir"].map((n) => g.join(n));
  assert.equal(g.admin().settings.round1Questions, 2, "plays the first 2; the third is a spare");
  assert.equal(g.admin().settings.finalistCount, 2);
  g.do({ type: "startQuiz" });
  g.do({ type: "showQuestion" });
  assert.equal(g.admin().timer?.durationMs, 5000, "quiz read time");
  g.tick();
  assert.equal(g.admin().timer?.durationMs, 9000, "quiz answer time");
  ids.forEach((id) => g.answer(id, "correct"));
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
  assert.equal(g.admin().primary?.label, "Show results");
  assert.ok(g.admin().allowed.includes("endRound1") && !g.admin().allowed.includes("nextQuestion"), "that was the last question played");
  g.do({ type: "endRound1" });
  assert.equal(g.admin().finalists.length, 2, "the quiz's finalist count");
  g.do({ type: "startBuzzerRound" });
  g.do({ type: "showQuestion" });
  assert.equal(g.admin().timer?.durationMs, 4000, "buzzer read time");
  g.tick();
  assert.equal(g.admin().timer?.durationMs, 6000, "the buzz question's own buzz window");
  g.buzz(g.admin().finalists[0].id);
  assert.equal(g.admin().timer?.durationMs, 7000, "spoken answer time");
  g.do({ type: "markWrong" });
  assert.equal(g.admin().timer?.durationMs, 8000, "reopen window");
});

test("quiz library: checks, the three import formats, export round trip, cleaning network input", () => {
  // Checks
  const quiz = libraryQuiz();
  const empty: Quiz = { ...quiz, title: " ", round1: [], buzzer: [] };
  assert.ok(quizProblems(empty).some((p) => p.includes("title")) && quizProblems(empty).some((p) => p.includes("Round 1 question")));
  const broken: Quiz = { ...quiz, round1: [{ ...quiz.round1[0], options: ["a", "A", "b", "c"] }, ...quiz.round1.slice(1)] };
  assert.ok(quizProblems(broken).some((p) => p.includes("must all be different")));
  assert.ok(quizProblems({ ...quiz, rules: { ...quiz.rules, round1Questions: 9 } }).some((p) => p.includes("the list has 3")));

  // Pasted text: * marks, "Answer: B", "A)" prefixes, # Buzzer section, a block with 3 answers
  const text = importText(
    "What does LLM stand for?\n* Large Language Model\nLinear Logic Machine\nLayered Learning Matrix\nLong-term Language Memory\n\n" +
      "Q2) Pick B\nA) one\nB) two\nC) three\nD) four\nAnswer: B\n\n# Buzzer\nWho makes Claude?\nOpenAI\nAnthropic *\nGoogle\nMeta\n\nOnly three\na\nb\nc",
    "round1",
  );
  assert.equal(text.round1.length, 2);
  assert.equal(text.round1[0].correct, 0);
  assert.deepEqual([text.round1[1].text, text.round1[1].options[0], text.round1[1].correct], ["Pick B", "one", 1]);
  assert.equal(text.buzzer.length, 1);
  assert.equal(text.buzzer[0].correct, 1);
  assert.ok(text.problems.length === 1 && text.problems[0].includes("exactly 4 answers"));

  // Spreadsheet (CSV with quotes, commas, a round column and seconds)
  const csv = 'question,A,B,C,D,correct,round,read seconds,answer seconds\r\n"Comma, ""quoted"" question",w,x,y,z,C,,,12\r\nBuzz one,p,q,r,s,4,buzzer,,\r\nBad row,a,b,c,d,E,,,\r\n';
  const sheet = importRows(parseCsv(csv), "round1");
  assert.deepEqual([sheet.round1[0].text, sheet.round1[0].correct, sheet.round1[0].openSeconds], ['Comma, "quoted" question', 2, 12]);
  assert.deepEqual([sheet.buzzer[0].text, sheet.buzzer[0].correct], ["Buzz one", 3]);
  assert.ok(sheet.problems.length === 1 && sheet.problems[0].startsWith("Row 4"));
  assert.ok(importRows([["foo", "bar"], ["1", "2"]], "round1").problems[0].includes("Couldn't find these columns"));

  // JSON: data/questions.json style, and a quiz exported from the editor
  const json = importJson(JSON.stringify({ questions: [{ text: "J1", options: ["a", "b", "c", "d"], correct: 3, round: 2 }, { text: "J2", options: ["a", "b", "c", "d"], correct: 0 }] }), "round1");
  assert.deepEqual([json.buzzer[0].text, json.buzzer[0].correct, json.round1[0].text], ["J1", 3, "J2"]);
  assert.equal(importJson(JSON.stringify(quiz), "round1").round1.length, 3);
  assert.ok(importJson("{oops", "round1").problems[0].includes("valid JSON"));

  // Export → import gives the same questions back
  const back = importRows(parseCsv(quizToCsv(quiz)), "round1");
  assert.deepEqual(back.round1.map((q) => [q.text, q.options, q.correct, q.readSeconds, q.openSeconds]), quiz.round1.map((q) => [q.text, q.options, q.correct, q.readSeconds, q.openSeconds]));
  assert.deepEqual(back.buzzer.map((q) => q.text), quiz.buzzer.map((q) => q.text));

  // Network input is cleaned: whitespace, lengths, bad image paths, missing rules
  assert.equal(cleanQuiz("nope", quiz.rules), null);
  assert.equal(cleanQuiz({ ...quiz, id: "../x" }, quiz.rules), null);
  const cleaned = cleanQuiz(
    { id: "c1", title: `  ${"T".repeat(200)}  `, rules: { finalists: 4 }, round1: [{ text: " hi \n there ", options: ["a"], correct: 9, image: "javascript:alert(1)" }] },
    quiz.rules,
  )!;
  assert.equal(cleaned.title.length, 80);
  assert.equal(cleaned.rules.finalists, 4);
  assert.equal(cleaned.rules.round1AnswerSeconds, quiz.rules.round1AnswerSeconds, "missing rules fall back");
  assert.deepEqual([cleaned.round1[0].text, cleaned.round1[0].options, cleaned.round1[0].correct, cleaned.round1[0].image], ["hi there", ["a", "", "", ""], 3, null]);
  assert.deepEqual(cleaned.buzzer, []);
});

// ============================================================================
// Full games
// ============================================================================

function playFull(label: string, config: GameConfig, questions: QuizQuestion[], count: number, seed: number, checkCoverage = true) {
  const g = new Game(config, questions, seed);
  const rng = g.rng;
  const ids = Array.from({ length: count }, (_, i) => g.join(`Player ${i + 1}`));
  const seen = new Set<Phase>();
  let guard = 0;
  let views = 0;
  const start = performance.now();
  let distinctOrders = 0;
  let slowestRefresh = 0;

  while (g.phase !== "podium") {
    assert.ok(guard++ < 20_000, `${label}: the quiz should finish`);
    seen.add(g.phase);
    // A full refresh after a change: Host + Admin + every phone, as the server does it.
    const t0 = performance.now();
    g.host();
    const admin = g.admin();
    for (const id of ids) g.room.participantView(id);
    slowestRefresh = Math.max(slowestRefresh, performance.now() - t0);
    assert.ok(admin.stepLabel.length > 0);
    if (admin.primary) assert.ok(admin.allowed.includes(admin.primary.action.type), `${label}: primary allowed in ${g.phase}`);
    g.checkNoLeaks(ids);
    // Every phone always has a screen.
    for (const id of ids) {
      g.phone(id);
      views += 1;
    }

    switch (g.phase) {
      case "r1Read":
      case "r2Read":
        g.tick();
        continue;
      case "r1Answer": {
        const orders = new Set<string>();
        for (const id of ids) {
          const s = g.screen(id);
          if (s.kind !== "answer") continue;
          orders.add(s.options.map((o) => o.text).join("|"));
          if (rng() < 0.1) continue; // some never answer
          g.clock.advance(Math.floor(rng() * 60));
          if (g.phase !== "r1Answer") break;
          g.answer(id, rng() < 0.6 ? "correct" : "wrong");
        }
        distinctOrders = Math.max(distinctOrders, orders.size);
        const hostStage = g.host().stage;
        if (orders.size === 1 && hostStage.phase === "r1Answer") {
          assert.equal([...orders][0], hostStage.question.options?.join("|"), `${label}: phones use the Host's 1–4 order`);
        }
        if (g.phase === "r1Answer") g.tick();
        continue;
      }
      case "r1Reveal":
        if (rng() < 0.3 && admin.allowed.includes("nextQuestion")) {
          g.do({ type: "nextQuestion" }); // skip the optional steps sometimes
          continue;
        }
        break;
      case "r1Leaderboard": {
        const stage = g.host().stage;
        if (stage.phase === "r1Leaderboard") {
          const scores = stage.rows.map((r) => r.score);
          assert.deepEqual(scores, [...scores].sort((x, y) => y - x), `${label}: leaderboard sorted`);
          assert.ok(stage.rows.length <= config.leaderboardSize);
        }
        break;
      }
      case "r1Results": {
        const stage = g.host().stage;
        if (stage.phase === "r1Results") {
          assert.equal(stage.options.reduce((s, o) => s + o.count, 0), stage.answered, `${label}: chart adds up`);
        }
        break;
      }
      case "cut": {
        const stage = g.host().stage;
        if (stage.phase === "cut") {
          assert.equal(stage.standings.filter((s) => s.finalist).length, Math.min(config.finalists, count), `${label}: top N`);
        }
        break;
      }
      case "predictions": {
        const finalists = g.admin().finalists.map((f) => f.id);
        for (const id of ids) if (g.screen(id).kind === "backFinalist") g.room.back(id, finalists[Math.floor(rng() * finalists.length)]);
        break;
      }
      case "r2BuzzOpen": {
        const left = g.admin().round2!.finalists.filter((f) => f.inPlay && !f.lockedOut);
        if (rng() < 0.85 && left.length) g.buzz(left[Math.floor(rng() * left.length)].id);
        else g.tick();
        continue;
      }
      case "r2Answering":
        g.do({ type: rng() < 0.55 ? "markCorrect" : "markWrong" });
        continue;
    }
    g.primary();
  }

  const podium = g.host().stage;
  assert.ok(podium.phase === "podium" && podium.basis === "buzzer");
  if (podium.phase === "podium") {
    assert.equal(podium.entries.length, Math.min(config.finalists, count));
    const points = podium.entries.map((e) => e.points);
    assert.ok(points[0] >= Math.max(...points), `${label}: winner has the most points`);
    assert.equal(new Set(podium.entries.map((e) => e.place)).size, podium.entries.length);
  }
  for (const phase of (checkCoverage ? ["r1Intro", "r1Read", "r1Answer", "r1TimesUp", "r1Reveal", "r1Results", "r1Leaderboard", "cut", "predictions", "r2Intro", "r2Read", "r2BuzzOpen", "r2Answering", "r2Reveal", "r2Scores"] : []) as Phase[]) {
    assert.ok(seen.has(phase), `${label}: phase ${phase} happened`);
  }
  for (const id of ids) assert.equal(g.screen(id).kind, "podium");
  assert.equal(g.room.resultsCsv().csv.split("\r\n").length, count + 1, `${label}: CSV row per participant`);
  assert.ok(distinctOrders <= 1, `${label}: every phone shows the options in the same order as the Host`);

  const suddenDeath = seen.has("suddenDeath") ? ", went to sudden death" : "";
  return `${label}: ${views} phone views in ${(performance.now() - start).toFixed(0)}ms, slowest full refresh ${slowestRefresh.toFixed(1)}ms${suddenDeath}`;
}

const event = eventQuestions(20, 12);
const summaries = [
  playFull("demo preset, 4 participants", PRESETS.demo, FILE_QUESTIONS, 4, 5),
  playFull("demo preset, 6 participants", PRESETS.demo, FILE_QUESTIONS, 6, 9),
  playFull("event preset, 80 participants", PRESETS.event, event, 80, 11),
  playFull("event preset, 100 participants", PRESETS.event, event, 100, 21),
];
// Many seeds, so ties and sudden death happen somewhere.
let suddenDeaths = 0;
for (let seed = 100; seed < 160; seed++) {
  if (playFull("demo seed", PRESETS.demo, FILE_QUESTIONS, 3 + (seed % 5), seed, false).includes("sudden death")) suddenDeaths += 1;
}
for (const s of summaries) console.log(`✓ full game, ${s}`);
console.log(`✓ 60 more random demo games (${suddenDeaths} went to sudden death)`);
assert.ok(suddenDeaths > 0, "sudden death should come up in random games");
console.log(`\nAll ${results.length + summaries.length + 1} checks passed.`);
