/**
 * Plays whole games with fake players and a fake clock, then checks the rules
 * held. No sockets, no browser: run it with `npm run simulate`.
 *
 * Useful whenever you change server/game.ts: if this still passes, the core
 * loop (join → answer → vote → reveal → scores → end) still works.
 */
import assert from "node:assert/strict";
import { type Clock, MISSING_ANSWER_TEXT, ROUNDS, Room } from "./game";
import type { HostView } from "../src/shared/protocol";

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
  /** Jump to the next timer and fire it. Returns false when nothing is scheduled. */
  runNext(): boolean {
    let nextId = -1;
    let nextAt = Infinity;
    for (const [id, timer] of this.timers) {
      if (timer.at < nextAt) {
        nextAt = timer.at;
        nextId = id;
      }
    }
    if (nextId === -1) return false;
    const { fn } = this.timers.get(nextId)!;
    this.timers.delete(nextId);
    this.t = nextAt;
    fn();
    return true;
  }
}

/** Small seeded random so a failing run can be replayed. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function playGame(seed: number, playerCount: number, opts: { lazyPlayer?: boolean } = {}) {
  const clock = new FakeClock();
  const random = seeded(seed);
  const room = new Room("TEST", "http://localhost:3000/play", () => {}, clock, random);

  const ids: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const res = room.join(`Player ${i + 1}`);
    assert.ok(res.ok, "join should succeed");
    if (res.ok) ids.push(res.playerId);
  }
  // Rule checks on joining
  assert.deepEqual(room.join("player 1"), { ok: false, error: "name-taken" }, "names are case-insensitive");
  assert.equal(room.join("   ").ok, false, "blank names are rejected");
  const vip = room.hostView().players.find((p) => p.isVip)!;
  assert.equal(vip.id, ids[0], "first player is VIP");

  // Only the VIP can start
  room.start(ids[1]);
  assert.equal(room.hostView().stage.phase, "lobby", "non-VIP cannot start");
  room.start(ids[0]);
  assert.equal(room.hostView().stage.phase, "intro");

  // A late joiner becomes audience
  const late = room.join("Latecomer");
  assert.ok(late.ok && late.role === "audience", "joining mid-game puts you in the audience");
  const audienceId = late.ok ? late.playerId : "";

  const phases: string[] = [];
  let pointsAwarded = 0;
  let forfeits = 0;
  let guard = 0;

  while (room.hostView().stage.phase !== "end") {
    assert.ok(guard++ < 500, "game should finish");
    const view: HostView = room.hostView();
    const stage = view.stage;
    if (phases.at(-1) !== stage.phase) phases.push(stage.phase);

    if (stage.phase === "answer") {
      // Everyone answers whatever their phone shows, until no prompts are left.
      for (const id of ids) {
        if (opts.lazyPlayer && id === ids[1]) continue; // this one never answers
        for (let n = 0; n < 5; n++) {
          const pv = room.playerView(id)!;
          if (pv.screen.kind !== "answer") break;
          room.submitAnswer(id, pv.screen.promptId, `answer from ${pv.me.name} #${n}`);
        }
      }
      if (!opts.lazyPlayer) {
        assert.notEqual(room.hostView().stage.phase, "answer", "answer phase ends early once everyone is done");
      } else {
        clock.runNext(); // wait out the timer for the lazy player
      }
      continue;
    }

    if (stage.phase === "vote") {
      for (const id of ids) {
        const pv = room.playerView(id)!;
        if (pv.screen.kind !== "vote") continue;
        const pick = pv.screen.options[Math.floor(random() * pv.screen.options.length)];
        // Nobody may vote for their own answer
        room.vote(id, pick.id);
        room.vote(id, pick.id); // double votes are ignored
      }
      const av = room.playerView(audienceId)!;
      if (av.screen.kind === "vote") room.vote(audienceId, av.screen.options[0].id);
      if (room.hostView().stage.phase === "vote") clock.runNext();
      continue;
    }

    if (stage.phase === "reveal") {
      for (const r of stage.results) {
        pointsAwarded += r.points;
        if (r.text === MISSING_ANSWER_TEXT) {
          forfeits++;
          assert.equal(r.points, 0, "a missing answer scores nothing");
        }
        assert.ok(!r.voterIds.includes(r.authorId), "no one votes for themselves");
      }
    }

    assert.ok(clock.runNext(), `a timer should be running in ${stage.phase}`);
  }

  const final = room.hostView();
  const totalScore = final.players.reduce((sum, p) => sum + p.score, 0);
  assert.equal(totalScore, pointsAwarded, "scores add up to the points shown on reveal screens");
  assert.equal(phases.filter((p) => p === "intro").length, ROUNDS.length, "every round has an intro");
  const end = final.stage.phase === "end" ? final.stage : null;
  assert.ok(end && end.winnerIds.length >= 1, "there is a winner");

  const vipEnd = room.playerView(ids[0])!;
  assert.equal(vipEnd.screen.kind, "end");
  room.restart(ids[0]);
  assert.equal(room.hostView().stage.phase, "lobby", "VIP can restart");
  assert.ok(room.hostView().players.every((p) => p.score === 0), "restart resets scores");

  if (opts.lazyPlayer) assert.ok(forfeits > 0, "the lazy player's duels are shown as forfeits");
  return { phases, totalScore };
}

function reconnectRules() {
  const clock = new FakeClock();
  const room = new Room("TEST", "http://x/play", () => {}, clock, seeded(1));
  const a = room.join("Asha");
  const b = room.join("Bilal");
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;

  room.disconnect(a.playerId);
  assert.equal(room.hostView().players.find((p) => p.isVip)?.id, b.playerId, "VIP moves when the VIP leaves the lobby");

  const back = room.join("whatever", a.playerId);
  assert.ok(back.ok && back.playerId === a.playerId, "same phone rejoins by saved id");

  room.disconnect(b.playerId);
  const byName = room.join("bilal");
  assert.ok(byName.ok && byName.playerId === b.playerId, "a dropped player can rejoin by typing the same name");
}

reconnectRules();
for (const [seed, count] of [
  [1, 3],
  [2, 4],
  [3, 5],
  [4, 8],
] as const) {
  const { totalScore } = playGame(seed, count);
  console.log(`✓ ${count} players: full game finished, ${totalScore} points awarded`);
}
playGame(9, 4, { lazyPlayer: true });
console.log("✓ a player who never answers forfeits and the game still finishes");
console.log("✓ reconnect, VIP hand-off and rejoin-by-name work");
console.log("\nAll checks passed.");
