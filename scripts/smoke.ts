/**
 * End-to-end check over real Socket.IO: npm run smoke
 *
 * Starts its own mock game server on a spare port (demo preset, timers sped
 * up), then plays a whole demo quiz the way the browsers would: a Host, an
 * Admin and 4 Participants, driven only through Admin commands. Checks the key
 * views along the way, including a phone that reconnects mid-question.
 * Runs on its own; `npm run dev` doesn't need to be running.
 */
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import type {
  AdminAction,
  AdminView,
  ClientToServerEvents,
  CommandResult,
  HostView,
  JoinResult,
  ParticipantScreen,
  ParticipantView,
  ServerToClientEvents,
} from "../src/shared/protocol";
import { PRESETS, withTimingScale } from "../mock-server/config";
import { startGameServer } from "../mock-server/server";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const WAIT_MS = 6000;
const PIN = "4321";

// ---------------------------------------------------------------- helpers

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = io(url, { transports: ["websocket"], reconnection: false, forceNew: true });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function within<T>(promise: Promise<T>, what: string, ms = WAIT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for: ${what}`)), ms)),
  ]);
}

/** Keeps the latest view a socket received and lets the test wait for one that matches. */
class Latest<T> {
  value: T | null = null;
  private waiters: { test: (v: T) => boolean; resolve: (v: T) => void }[] = [];
  push(v: T) {
    this.value = v;
    this.waiters = this.waiters.filter((w) => {
      if (!w.test(v)) return true;
      w.resolve(v);
      return false;
    });
  }
  until(test: (v: T) => boolean, what: string): Promise<T> {
    if (this.value && test(this.value)) return Promise.resolve(this.value);
    return within(new Promise<T>((resolve) => this.waiters.push({ test, resolve })), what);
  }
}

/** Screens shown before an answer is revealed: these must never contain it. */
function beforeReveal(screen: ParticipantScreen) {
  if (["eyesUp", "answer", "lockedIn", "timesUp", "nextQuestion"].includes(screen.kind)) return true;
  return (screen.kind === "buzzer" || screen.kind === "buzzerWatch") && ["read", "buzzOpen", "answering"].includes(screen.step);
}

let leakChecks = 0;

class Phone {
  view = new Latest<ParticipantView>();
  id = "";
  constructor(
    public socket: Client,
    readonly name: string,
  ) {
    this.listen();
  }
  listen() {
    this.socket.on("participant:state", (v) => {
      if (beforeReveal(v.screen)) {
        leakChecks += 1;
        assert.ok(!JSON.stringify(v).includes('"correct'), `${this.name}'s phone got the answer early: ${v.screen.kind}`);
      }
      this.view.push(v);
    });
  }
  until(kind: ParticipantScreen["kind"] | ((s: ParticipantScreen) => boolean), what = "") {
    const test = typeof kind === "function" ? kind : (s: ParticipantScreen) => s.kind === kind;
    return this.view.until((v) => test(v.screen), `${this.name}: ${what || String(kind)}`);
  }
  get screen() {
    return this.view.value!.screen;
  }
}

// ---------------------------------------------------------------- the run

async function main() {
  const started = Date.now();
  const server = await startGameServer({
    port: 0,
    host: "127.0.0.1",
    config: withTimingScale(PRESETS.demo, 0.1),
    adminPin: PIN,
    joinUrl: "http://localhost:3000/play",
  });
  const url = `http://127.0.0.1:${server.port}`;
  const sockets: Client[] = [];
  const open = async () => {
    const s = await connect(url);
    sockets.push(s);
    return s;
  };
  const step = (text: string) => console.log(`✓ ${text}`);

  try {
    // ---- Host creates a room
    const hostSocket = await open();
    const host = new Latest<HostView>();
    hostSocket.on("host:state", (v) => host.push(v));
    const created = await within(new Promise<{ roomCode: string; hostToken: string }>((r) => hostSocket.emit("host:create", r)), "host:create");
    assert.match(created.roomCode, /^[A-Z]{4}$/);
    await host.until((v) => v.stage.phase === "lobby" && v.roomCode === created.roomCode, "host lobby");
    step(`Host created room ${created.roomCode}`);

    // ---- Admin signs in
    const adminSocket = await open();
    const admin = new Latest<AdminView>();
    adminSocket.on("admin:state", (v) => admin.push(v));
    const auth = (roomCode: string, pin: string) =>
      within(new Promise((r) => adminSocket.emit("admin:auth", { roomCode, pin }, r)), "admin:auth");
    assert.deepEqual(await auth(created.roomCode, "0000"), { ok: false, error: "wrong-pin" });
    assert.deepEqual(await auth("ZZZZ", PIN), { ok: false, error: "room-not-found" });
    assert.deepEqual(await auth(created.roomCode.toLowerCase(), PIN), { ok: true, roomCode: created.roomCode });
    await admin.until((v) => v.phase === "lobby", "admin lobby");
    step("Admin: wrong PIN and wrong room refused, right PIN signs in");

    /** Sends a command from the current step and checks it was accepted. */
    const command = async (action: AdminAction) => {
      const stepId = admin.value!.stepId;
      const result = await within(
        new Promise((r) => adminSocket.emit("admin:command", { stepId, action }, r)),
        `admin:command ${action.type}`,
      );
      assert.deepEqual(result, { ok: true }, `${action.type} from ${admin.value!.phase}`);
      return stepId;
    };
    const phase = (p: AdminView["phase"], extra: (v: AdminView) => boolean = () => true) =>
      admin.until((v) => v.phase === p && extra(v), `admin phase ${p}`);

    // ---- 4 participants join
    const names = ["Riya", "Aadi", "Kabir", "Zoya"];
    const phones: Phone[] = [];
    for (const name of names) {
      const phone = new Phone(await open(), name);
      const result = await within(
        new Promise<JoinResult>((r) => phone.socket.emit("participant:join", { roomCode: created.roomCode, name }, r)),
        `join ${name}`,
      );
      if (!result.ok) throw new Error(`${name} couldn't join: ${result.error}`);
      phone.id = result.participantId;
      phones.push(phone);
    }
    const dupe = await within(
      new Promise((r) => phones[0].socket.emit("participant:join", { roomCode: created.roomCode, name: "riya" }, r)),
      "duplicate join",
    );
    assert.deepEqual(dupe, { ok: false, error: "name-taken" });
    await Promise.all(phones.map((p) => p.until((s) => s.kind === "lobby" && s.joined === 4, "lobby, 4 joined")));
    await host.until((v) => v.participants.length === 4, "4 names on the Host");
    step("4 participants joined; a duplicate name was refused");

    // ---- Bad input never crashes the server
    adminSocket.emit("admin:command", { stepId: 1, action: { type: "explode" } } as never, (r) =>
      assert.deepEqual(r, { ok: false, reason: "invalid" }),
    );
    phones[0].socket.emit("participant:answer", { questionId: 42, optionId: null } as never);
    phones[1].socket.emit("admin:command", { stepId: admin.value!.stepId, action: { type: "startQuiz" } }, (r) =>
      assert.deepEqual(r, { ok: false, reason: "not-signed-in" }, "a phone can't send admin commands"),
    );

    // ---- Round 1
    const [riya, aadi, kabir, zoya] = phones;
    await command({ type: "startQuiz" });
    await phase("r1Intro");
    await Promise.all(phones.map((p) => p.until("r1Intro")));
    step("Start quiz → Round 1 intro on every phone");

    const answer = async (phone: Phone, correct: boolean) => {
      const s = (await phone.until("answer")).screen;
      if (s.kind !== "answer") return;
      const correctText = admin.value!.question!.correctText;
      const option = s.options.find((o) => (correct ? o.text === correctText : o.text !== correctText))!;
      phone.socket.emit("participant:answer", { questionId: s.questionId, optionId: option.id });
      await phone.until("lockedIn");
    };

    // A second Admin device signs in; both press "Show question" at the same moment.
    const admin2Socket = await open();
    const admin2 = new Latest<AdminView>();
    admin2Socket.on("admin:state", (v) => admin2.push(v));
    const auth2 = await within(
      new Promise((r) => admin2Socket.emit("admin:auth", { roomCode: created.roomCode, pin: PIN }, r)),
      "second admin",
    );
    assert.deepEqual(auth2, { ok: true, roomCode: created.roomCode });
    await admin2.until((v) => v.stepId === admin.value!.stepId, "second Admin in sync");
    const sameStep = admin.value!.stepId;
    const press = (socket: Client) =>
      within(
        new Promise<CommandResult>((r) => socket.emit("admin:command", { stepId: sameStep, action: { type: "showQuestion" } }, r)),
        "simultaneous press",
      );
    const presses = await Promise.all([press(adminSocket), press(admin2Socket)]);
    assert.equal(presses.filter((r) => r.ok).length, 1, "exactly one of two simultaneous presses counts");
    assert.ok(presses.some((r) => !r.ok && r.reason === "stale-step"));
    await admin2.until((v) => v.phase === "r1Read", "second Admin follows along");
    step("Two Admin devices: both pressed Show question at once, it happened exactly once, both stay in sync");

    for (let q = 1; q <= 3; q++) {
      if (q > 1) await command({ type: "nextQuestion" });
      await phase("r1Read");
      await Promise.all(phones.map((p) => p.until("eyesUp")));
      await phase("r1Answer");
      await Promise.all(phones.map((p) => p.until("answer")));

      if (q === 2) {
        // Zoya's phone drops mid-question and comes back with its saved id.
        // Pause first: otherwise the 3 phones still connected answer and time's up comes early.
        await command({ type: "pause" });
        await admin.until((v) => v.paused, "paused");
        await zoya.until((s) => s.kind === "answer" && zoya.view.value!.paused, "paused banner on the phone");
        const before = zoya.screen;
        zoya.socket.disconnect();
        await admin.until((v) => v.participants.find((p) => p.id === zoya.id)?.connected === false, "Zoya shows offline");
        zoya.socket = await open();
        zoya.view = new Latest<ParticipantView>();
        zoya.listen();
        const rejoin = await within(
          new Promise((r) => zoya.socket.emit("participant:join", { roomCode: created.roomCode, name: "", participantId: zoya.id }, r)),
          "rejoin",
        );
        assert.deepEqual(rejoin, { ok: true, participantId: zoya.id, roomCode: created.roomCode, status: "playing" });
        const back = (await zoya.until("answer", "same question after reconnecting")).screen;
        assert.ok(back.kind === "answer" && before.kind === "answer" && back.questionId === before.questionId);
        await command({ type: "resume" });
        await admin.until((v) => !v.paused, "resumed");
        step("Paused; Zoya's phone dropped mid-question, rejoined and got the same question back; resumed");
      }
      await answer(riya, true);
      await answer(aadi, q !== 2);
      await answer(kabir, false);
      await answer(zoya, true);
      await phase("r1TimesUp");
      await command({ type: "revealAnswer" });
      await phase("r1Reveal");
      const outcomes = await Promise.all(phones.map((p) => p.until("result")));
      const got = outcomes.map((v) => (v.screen.kind === "result" ? v.screen.outcome : ""));
      assert.deepEqual(got, ["correct", q !== 2 ? "correct" : "wrong", "wrong", "correct"]);
      if (q === 1) {
        await command({ type: "showResults" });
        await host.until((v) => v.stage.phase === "r1Results", "results chart");
        await command({ type: "showLeaderboard" });
        const board = await host.until((v) => v.stage.phase === "r1Leaderboard", "leaderboard");
        assert.ok(board.stage.phase === "r1Leaderboard" && board.stage.rows.length === 4);
      }
    }
    const zoyaScore = admin.value!.participants.find((p) => p.id === zoya.id)!.score;
    assert.ok(zoyaScore > 1000, "Zoya kept her points through the reconnect");
    step("Round 1: 3 questions, early time's up, reveal, results, leaderboard");

    await command({ type: "endRound1" });
    const cut = await host.until((v) => v.stage.phase === "cut", "the cut");
    if (cut.stage.phase !== "cut") throw new Error("expected the cut");
    const finalistIds = cut.stage.standings.filter((s) => s.finalist).map((s) => s.id);
    assert.equal(finalistIds.length, 3, "demo preset: top 3");
    assert.equal(cut.stage.standings[3].id, kabir.id, "Kabir (all wrong) misses the cut");
    const kabirCut = await kabir.until("cut");
    assert.ok(kabirCut.screen.kind === "cut" && !kabirCut.screen.madeIt && kabirCut.screen.rank === 4);
    step(`The cut: ${cut.stage.standings.map((s) => `${s.rank}. ${s.name}${s.finalist ? " ✔" : ""}`).join(", ")}`);

    // ---- Predictions
    await command({ type: "openPredictions" });
    await kabir.until("backFinalist");
    const [f1, f2] = finalistIds;
    kabir.socket.emit("participant:back", { finalistId: f2 });
    kabir.socket.emit("participant:back", { finalistId: f1 }); // changed his mind
    await host.until((v) => v.stage.phase === "predictions" && v.stage.backing.counts[f1] === 1, "backing on the Host");
    step("Predictions: Kabir backed a finalist (and changed his mind)");

    // ---- Buzzer round
    const byId = (id: string) => phones.find((p) => p.id === id)!;
    const buzz = (id: string) => {
      const s = byId(id).screen;
      byId(id).socket.emit("participant:buzz", { questionId: s.kind === "buzzer" ? s.questionId ?? "" : "" });
    };
    const buzzersOpen = (ids: string[]) =>
      Promise.all(ids.map((id) => byId(id).until((s) => s.kind === "buzzer" && s.canBuzz, "BUZZ button live")));

    await command({ type: "startBuzzerRound" });
    await phase("r2Intro");
    await command({ type: "showQuestion" });
    const read = await host.until((v) => v.stage.phase === "r2Read", "buzzer question on Host");
    assert.ok(read.stage.phase === "r2Read" && read.stage.round2.question.options.length === 4 && read.stage.round2.correct === null);
    await phase("r2BuzzOpen");
    await buzzersOpen(finalistIds);
    buzz(f1);
    buzz(f2);
    await phase("r2Answering", (v) => v.round2?.buzzedBy?.id === f1);
    const judgingStep = admin.value!.stepId;
    await command({ type: "markWrong" });
    await phase("r2BuzzOpen");
    await byId(f1).until((s) => s.kind === "buzzer" && s.lockedOut, "locked out");
    buzz(f2);
    await phase("r2Answering", (v) => v.round2?.buzzedBy?.id === f2);
    await command({ type: "markCorrect" });
    await phase("r2Reveal");
    const stale = await within(
      new Promise((r) => adminSocket.emit("admin:command", { stepId: judgingStep, action: { type: "markCorrect" } }, r)),
      "stale command",
    );
    assert.deepEqual(stale, { ok: false, reason: "stale-step" });
    await byId(f2).until((s) => s.kind === "buzzer" && s.myResult === "correct", "f2 sees it was right");
    step("Buzzer Q1: first buzz wins, Wrong → locked out → reopen, Correct +1; a stale double-mark was ignored");

    await command({ type: "showScores" });
    await command({ type: "nextQuestion" });
    await phase("r2Reveal", (v) => v.round2?.outcome?.kind === "nobody");
    step("Buzzer Q2: nobody buzzed → answer revealed, nobody scores");

    await command({ type: "nextQuestion" });
    await phase("r2BuzzOpen");
    await buzzersOpen(finalistIds);
    buzz(f1);
    await phase("r2Answering");
    await command({ type: "markCorrect" });
    await phase("r2Reveal");
    await command({ type: "showScores" });
    const scores = await phase("r2Scores");
    assert.equal(scores.primary?.label, "Start sudden death", "1–1 tie for first");
    await command({ type: "startSuddenDeath" });
    await phase("suddenDeath");
    await command({ type: "showQuestion" });
    await phase("r2BuzzOpen");
    const third = finalistIds[2];
    await byId(third).until((s) => s.kind === "buzzer" && !s.inPlay, "3rd finalist sits out sudden death");
    buzz(f1);
    await phase("r2Answering");
    await command({ type: "markCorrect" });
    await phase("r2Reveal", (v) => v.round2?.winner?.id === f1);
    await command({ type: "showWinner" });
    const podium = await host.until((v) => v.stage.phase === "podium", "podium");
    assert.ok(podium.stage.phase === "podium" && podium.stage.entries[0].id === f1 && podium.stage.calledIt === 1);
    const winnerPhone = await byId(f1).until("podium");
    assert.ok(winnerPhone.screen.kind === "podium" && winnerPhone.screen.place === 1);
    const fan = await kabir.until("podium");
    assert.ok(fan.screen.kind === "podium" && fan.screen.calledIt === true);
    step("Tie → sudden death between the two leaders → winner on the podium; Kabir called it");

    // ---- Results, Host refresh, toggles
    const results = await within(new Promise<{ csv: string; filename: string } | null>((r) => adminSocket.emit("admin:results", r)), "CSV");
    assert.ok(results && results.csv.split("\r\n").length === 5, "CSV: header + 4 rows");
    const host2Socket = await open();
    const host2 = new Latest<HostView>();
    host2Socket.on("host:state", (v) => host2.push(v));
    const resumed = await within(new Promise((r) => host2Socket.emit("host:resume", created, r)), "host:resume");
    assert.deepEqual(resumed, { ok: true });
    await host2.until((v) => v.stage.phase === "podium", "resumed Host shows the podium");
    await command({ type: "setRoomCodeVisible", visible: false });
    await command({ type: "setSound", on: false });
    await host2.until((v) => !v.roomCodeVisible && !v.soundOn, "toggles reach the Host");
    step("Results CSV, Host refresh resumes the same room, room code and sound toggles");

    console.log(`\nSmoke test passed in ${((Date.now() - started) / 1000).toFixed(1)}s (${leakChecks} phone views checked for answer leaks).`);
  } finally {
    for (const s of sockets) s.disconnect();
    await server.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`\n✗ Smoke test failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  },
);
