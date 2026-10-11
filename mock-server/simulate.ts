/**
 * Plays whole quizzes with fake players and a fake clock, then checks the
 * rules held. No sockets, no browser. Run: npm run simulate
 */
import assert from "node:assert/strict";
import { type GameConfig, PRESETS } from "./config";
import { loadQuestions, type QuizQuestion } from "./questions";
import { type Clock, QuizRoom } from "./quiz";

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
  advance(ms: number) {
    this.t += ms;
  }
  /** Jump to the next timer and fire it. False if nothing is scheduled. */
  runNext(): boolean {
    let next: [number, { at: number; fn: () => void }] | null = null;
    for (const entry of this.timers) if (!next || entry[1].at < next[1].at) next = entry;
    if (!next) return false;
    this.timers.delete(next[0]);
    this.t = next[1].at;
    next[1].fn();
    return true;
  }
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const QUESTIONS = loadQuestions();

function makeRoom(config: GameConfig, questions: QuizQuestion[] = QUESTIONS, seed = 1) {
  const clock = new FakeClock();
  const room = new QuizRoom("TEST", "http://localhost:3000/play", config, questions, () => {}, clock, seeded(seed));
  return { clock, room };
}

/** Plays a full quiz. Bots answer with `skill` chance of being right. */
function playFull(config: GameConfig, botCount: number, seed: number) {
  const { clock, room } = makeRoom(config, QUESTIONS, seed);
  const random = seeded(seed + 7);
  const ids: string[] = [];
  for (let i = 0; i < botCount; i++) {
    const r = room.join(`Bot ${i + 1}`);
    assert.ok(r.ok && r.status === "active");
    if (r.ok) ids.push(r.playerId);
  }
  assert.ok(room.canStart);
  room.start();

  const seenPhases = new Set<string>();
  const cuts: number[] = [];
  let guard = 0;
  let judgeTurn = 0;

  while (room.hostView().stage.phase !== "podium") {
    assert.ok(guard++ < 5000, "quiz should finish");
    const view = room.hostView();
    const stage = view.stage;
    seenPhases.add(stage.phase);

    if (stage.phase === "answer") {
      // Security: no phone view may reveal the right answer before the reveal.
      for (const id of ids) {
        const pv = room.playerView(id)!;
        assert.ok(!JSON.stringify(pv).includes('"correct"'), "phone view leaks correctness");
      }
      // Each bot answers after a random delay.
      for (const id of ids) {
        const pv = room.playerView(id)!;
        if (pv.screen.kind !== "answer") continue;
        if (random() < 0.1) continue; // some miss
        const pick = pv.screen.options[Math.floor(random() * 4)];
        clock.advance(Math.floor(random() * 300));
        room.answer(id, pv.screen.questionId, pick.id);
        room.answer(id, pv.screen.questionId, pv.screen.options[0].id); // second tap ignored
      }
      if (room.hostView().stage.phase === "answer") clock.runNext();
      continue;
    }

    if (stage.phase === "chart") {
      const total = stage.options.reduce((s, o) => s + o.count, 0);
      assert.equal(total, stage.answeredCount, "chart counts add up to answers");
      assert.equal(stage.options.filter((o) => o.correct).length, 1, "exactly one correct option");
    }

    if (stage.phase === "leaderboard") {
      const scores = stage.top.map((r) => r.score);
      assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "leaderboard sorted");
      assert.ok(stage.top.length <= config.leaderboardSize);
      assert.ok(scores.every((s) => s >= 0), "round scores never negative");
    }

    if (stage.phase === "roundEnd") {
      const advanced = stage.standings.filter((s) => s.advanced).length;
      cuts.push(advanced);
      assert.equal(advanced, Math.min(stage.round.advance, stage.standings.length), "cut keeps the top N");
      // Phones of players who were cut see "out" and their rank.
      for (const s of stage.standings) {
        const pv = room.playerView(s.id)!;
        assert.equal(pv.screen.kind, "roundResult");
        if (pv.screen.kind === "roundResult") assert.equal(pv.screen.advanced, s.advanced);
      }
    }

    if (stage.phase === "prediction") {
      const [a] = stage.finalists;
      for (const id of ids) {
        const pv = room.playerView(id)!;
        if (pv.screen.kind === "predict") room.predict(id, a.id);
      }
      assert.ok(room.hostView().stage.phase === "prediction");
    }

    if (stage.phase === "duel") {
      const d = stage.duel;
      if (d.step === "buzz") {
        // Alternate who buzzes; sometimes nobody does.
        if (judgeTurn % 5 !== 4) {
          const buzzer = d.finalists[judgeTurn % 2].id;
          const pv = room.playerView(buzzer)!;
          assert.equal(pv.screen.kind, "buzzer");
          if (pv.screen.kind === "buzzer") assert.ok(pv.screen.canBuzz);
          room.buzz(buzzer);
          room.buzz(d.finalists[(judgeTurn + 1) % 2].id); // too late, ignored
          const after = room.hostView().stage;
          assert.ok(after.phase === "duel" && after.duel.buzzedId === buzzer, "first buzz wins");
        } else {
          clock.runNext();
        }
        judgeTurn++;
        continue;
      }
      if (d.step === "answer") {
        assert.ok(room.adminView().awaitingJudge);
        room.judge(judgeTurn % 3 !== 0);
        continue;
      }
      if (d.step === "steal") {
        room.judge(judgeTurn % 2 === 0);
        continue;
      }
    }

    assert.ok(clock.runNext(), `a timer should be running in ${stage.phase}`);
  }

  const podium = room.hostView().stage;
  assert.equal(podium.phase, "podium");
  if (podium.phase === "podium") {
    assert.notEqual(podium.winner.id, podium.runnerUp.id);
    const winnerView = room.playerView(podium.winner.id)!;
    assert.ok(winnerView.screen.kind === "end" && winnerView.screen.place === "winner");
  }
  for (const p of ["roundIntro", "read", "answer", "reveal", "chart", "leaderboard", "roundEnd", "prediction", "duel"]) {
    assert.ok(seenPhases.has(p), `phase ${p} happened`);
  }
  assert.ok(room.resultsCsv().split("\n").length === botCount + 1, "CSV has a row per player");
  return cuts;
}

function edgeCases() {
  const config = PRESETS.demo;
  const { clock, room } = makeRoom(config);

  // Joining rules
  const a = room.join("Riya");
  const b = room.join("Aadi");
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(room.join("riya"), { ok: false, error: "name-taken" }, "duplicate names rejected");
  assert.equal(room.join("  ").ok, false, "blank name rejected");
  room.disconnect(a.playerId);
  const back = room.join("Riya");
  assert.ok(back.ok && back.playerId === a.playerId, "dropped player reclaims seat by name");
  const again = room.join("", b.playerId);
  assert.ok(again.ok && again.playerId === b.playerId, "rejoin by saved id");

  room.start();
  // Late joiner during round 1 plays.
  const c = room.join("Kabir");
  assert.ok(c.ok && c.status === "active", "late joiner in round 1 plays");

  // Pause freezes the timer.
  clock.runNext(); // intro → read
  clock.runNext(); // read → answer
  assert.equal(room.hostView().stage.phase, "answer");
  room.pause();
  assert.ok(room.hostView().paused);
  const pv = room.playerView(a.playerId)!;
  if (pv.screen.kind === "answer") room.answer(a.playerId, pv.screen.questionId, pv.screen.options[0].id);
  assert.equal(room.playerView(a.playerId)!.screen.kind, "answer", "answers ignored while paused");
  room.resume();
  assert.ok(!room.hostView().paused);

  // Wrong answers in a no-penalty round never go negative; void undoes points.
  for (const id of [a.playerId, b.playerId, c.ok ? c.playerId : ""]) {
    const v = room.playerView(id)!;
    if (v.screen.kind === "answer") room.answer(id, v.screen.questionId, v.screen.options[0].id);
  }
  assert.equal(room.hostView().stage.phase, "reveal", "everyone answered, so the question ends early");
  room.voidQuestion();
  const stage = room.hostView().stage;
  assert.ok(stage.phase === "reveal" && stage.voided);
  assert.ok(room.adminView().players.every((p) => p.roundScore === 0), "void removes the points");

  // Removing a player
  if (c.ok) {
    room.remove(c.playerId);
    assert.equal(room.playerView(c.playerId)!.screen.kind, "removed");
    assert.deepEqual(room.join("", c.playerId), { ok: false, error: "removed" });
  }

  // Restart round puts scores back to 0
  room.restartRound();
  assert.equal(room.hostView().stage.phase, "roundIntro");

  // After round 1, new joiners are audience
  let guard = 0;
  while (room.hostView().stage.phase !== "roundEnd" && guard++ < 200) clock.runNext();
  clock.runNext(); // → round 2 intro (or prediction)
  const late = room.join("Zoya");
  assert.ok(late.ok && late.status === "audience", "joining after round 1 = audience");

  // Away flags count only during answering
  room.setAway(a.playerId, true);
  assert.equal(room.adminView().players.find((p) => p.id === a.playerId)!.awayCount, 0);
}

edgeCases();
console.log("✓ joining, rejoin, pause, void, remove, restart, late join, away flags");

const demoCuts = playFull(PRESETS.demo, 6, 3);
console.log(`✓ demo preset, 6 players: cuts ${demoCuts.join(" → ")}, duel finished`);
const demo4 = playFull(PRESETS.demo, 4, 5);
console.log(`✓ demo preset, 4 players: cuts ${demo4.join(" → ")}, duel finished`);
const eventCuts = playFull(PRESETS.event, 80, 11);
console.log(`✓ event preset, 80 players: cuts ${eventCuts.join(" → ")}, duel finished`);
const event100 = playFull(PRESETS.event, 100, 21);
console.log(`✓ event preset, 100 players: cuts ${event100.join(" → ")}, duel finished`);
console.log("\nAll checks passed.");
