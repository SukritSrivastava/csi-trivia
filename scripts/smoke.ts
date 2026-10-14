/**
 * End-to-end check over real Socket.IO: npm run smoke
 *
 * Starts its own game server on a spare port (demo preset, timers sped
 * up), then plays a whole demo quiz the way the browsers would: a Host, an
 * Admin and 5 Participants, driven only through Admin commands: Round 1, the
 * cut, the wild card round, predictions, Blackout (one click, then the
 * autopilot runs it to the podium, with a pause and a double-tapped Skip on the
 * way) and the podium. Checks the key views along the way, including a phone
 * that reconnects mid-question.
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
  LibraryQuestion,
  OpenRoomResult,
  ParticipantScreen,
  ParticipantView,
  QuizSummary,
  SaveQuizResult,
  ServerToClientEvents,
} from "../src/shared/protocol";
import { newId } from "../src/shared/quiz";
import { PRESETS } from "../server/config";
import { startGameServer } from "../server/server";

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
  return ["eyesUp", "answer", "lockedIn", "timesUp", "nextQuestion", "safeWatch", "wcStatus", "runnerStatus", "blackoutWatch"].includes(screen.kind);
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
    config: PRESETS.demo,
    timingScale: 0.1,
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
    // ---- Admin signs in with the PIN only
    const adminSocket = await open();
    const admin = new Latest<AdminView>();
    adminSocket.on("admin:state", (v) => admin.push(v));
    /** Emits an Admin event with an ack (typed loosely: the test checks the replies itself). */
    const ask = <T>(event: string, payload?: unknown) =>
      within(
        new Promise<T>((r) => (adminSocket.emit as (...a: unknown[]) => void)(event, ...(payload === undefined ? [] : [payload]), r)),
        event,
      );
    assert.deepEqual(await ask("admin:login", { pin: "0000" }), { ok: false, error: "wrong-pin" });
    assert.equal(await ask("library:list"), null, "no library before the PIN");
    assert.deepEqual(await ask("admin:login", { pin: PIN }), { ok: true });
    const earlyHost = await open();
    assert.deepEqual(
      await within(new Promise((r) => earlyHost.emit("host:auth", { pin: PIN }, r)), "host:auth (no room yet)"),
      { ok: false, error: "no-room" },
      "the projector waits until a room is open",
    );
    const library = await ask<QuizSummary[] | null>("library:list");
    assert.ok(library?.some((q) => q.id === "demo" && q.title === "Demo quiz" && q.problems.length === 0), "the Demo quiz is in the library, ready");
    step("Admin: wrong PIN refused, no library before the PIN; the Demo quiz is ready");

    // ---- Quiz library round trip: a new quiz can't open until it's complete, then plays its own settings
    const made = await ask<SaveQuizResult>("library:create", { title: "Smoke quiz" });
    assert.ok(made.ok);
    const notReady = await ask<OpenRoomResult>("admin:openRoom", { quizId: made.quiz.id });
    assert.ok(!notReady.ok && notReady.error === "not-ready" && (notReady.problems?.length ?? 0) > 0, "an empty quiz can't open a room");
    const mk = (text: string): LibraryQuestion => ({ id: newId(), text, options: [`${text} A`, `${text} B`, `${text} C`, `${text} D`], correct: 2, image: null, readSeconds: null, openSeconds: 7 });
    const saved = await ask<SaveQuizResult>("library:save", {
      ...made.quiz,
      rules: { ...made.quiz.rules, round1Questions: 1, safe: 2, wildCardQuestions: 1 },
      round1: [mk("First"), mk("Spare")],
      wildcard: [mk("Wild")],
      // Blackout plays until one runner is left: the demo preset asks for 8 questions.
      blackout: Array.from({ length: PRESETS.demo.blackout.minQuestions }, (_, i) => mk(`Dark ${i + 1}`)),
    });
    assert.ok(saved.ok && saved.quiz.round1.length === 2 && saved.quiz.round1[0].openSeconds === 7);
    assert.ok((await ask<QuizSummary[]>("library:list")).find((q) => q.id === made.quiz.id)?.problems.length === 0, "now it's ready");
    const smokeRoom = await ask<OpenRoomResult>("admin:openRoom", { quizId: made.quiz.id });
    assert.ok(smokeRoom.ok);
    await admin.until(
      (v) => v.quizTitle === "Smoke quiz" && v.settings.safeCount === 2 && v.settings.round1Questions === 1 && v.settings.wildCardQuestions === 1,
      "the room plays the quiz's own settings",
    );
    assert.deepEqual(await ask("library:delete", { id: made.quiz.id }), { ok: true });
    assert.ok(!(await ask<QuizSummary[]>("library:list")).some((q) => q.id === made.quiz.id));
    assert.deepEqual(await ask("admin:closeRoom", { roomCode: smokeRoom.roomCode }), { ok: true });
    assert.ok(!(await ask<{ roomCode: string }[]>("admin:rooms")).some((r) => r.roomCode === smokeRoom.roomCode), "a closed room is gone");
    step("Library: create, refuse to open while incomplete, save, open with its own settings, delete; close the room");

    // ---- Admin opens a room with the Demo quiz
    const opened = await ask<OpenRoomResult>("admin:openRoom", { quizId: "demo" });
    if (!opened.ok) throw new Error(`admin:openRoom failed: ${opened.error}`);
    const created = { roomCode: opened.roomCode };
    assert.match(created.roomCode, /^[A-Z]{4}$/);
    await admin.until((v) => v.phase === "lobby" && v.quizTitle === "Demo quiz", "admin lobby");
    const rooms = await ask<{ roomCode: string }[]>("admin:rooms");
    assert.equal(rooms[0].roomCode, created.roomCode, "the newest room is listed first");

    // ---- Host: the PIN, then the newest open room
    const hostSocket = await open();
    const host = new Latest<HostView>();
    hostSocket.on("host:state", (v) => host.push(v));
    const hostAuth = (payload: { pin: string; roomCode?: string }) => within(new Promise((r) => hostSocket.emit("host:auth", payload, r)), "host:auth");
    assert.deepEqual(await hostAuth({ pin: "0000" }), { ok: false, error: "wrong-pin" });
    assert.deepEqual(await hostAuth({ pin: PIN }), { ok: true, roomCode: created.roomCode });
    await host.until((v) => v.stage.phase === "lobby" && v.roomCode === created.roomCode, "host lobby");
    step(`Admin opened room ${created.roomCode} with the Demo quiz; the Host (PIN) shows it`);

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
    const names = ["Riya", "Aadi", "Kabir", "Zoya", "Dev"];
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
    await Promise.all(phones.map((p) => p.until((s) => s.kind === "lobby" && s.joined === 5, "lobby, 5 joined")));
    await host.until((v) => v.participants.length === 5, "5 names on the Host");
    // Bots in the lobby: any colour, shared bots are fine; locked once the quiz starts.
    const bot = (phone: Phone, look: { color: string; head: string }) =>
      within(new Promise((r) => phone.socket.emit("participant:bot", look as never, r)), "participant:bot");
    assert.deepEqual(await bot(phones[0], { color: "#4cc9f0", head: "antenna" }), { ok: true });
    assert.deepEqual(await bot(phones[1], { color: "#4cc9f0", head: "antenna" }), { ok: true }, "the same bot twice is fine");
    assert.deepEqual(await bot(phones[1], { color: "nope", head: "antenna" }), { ok: false, error: "invalid" });
    step("5 participants joined; a duplicate name was refused; bots: shared ok, invalid refused");

    // ---- Bad input never crashes the server
    adminSocket.emit("admin:command", { stepId: 1, action: { type: "explode" } } as never, (r) =>
      assert.deepEqual(r, { ok: false, reason: "invalid" }),
    );
    phones[0].socket.emit("participant:answer", { questionId: 42, optionId: null } as never);
    phones[1].socket.emit("admin:command", { stepId: admin.value!.stepId, action: { type: "startQuiz" } }, (r) =>
      assert.deepEqual(r, { ok: false, reason: "not-signed-in" }, "a phone can't send admin commands"),
    );

    // ---- Round 1
    const [riya, aadi, kabir, zoya, dev] = phones;
    await command({ type: "startQuiz" });
    assert.deepEqual(await bot(phones[2], { color: "#ff5fa2", head: "horns" }), { ok: false, error: "too-late" }, "bots lock at Start quiz");
    await phase("r1Intro");
    await Promise.all(phones.map((p) => p.until("r1Intro")));
    step("Start quiz → Round 1 intro on every phone");

    const answer = async (phone: Phone, correct: boolean) => {
      const s = (await phone.until("answer")).screen;
      if (s.kind !== "answer") return;
      const correctText = admin.value!.question!.correctText;
      const option = s.options.find((o) => (correct ? o.text === correctText : o.text !== correctText))!;
      phone.socket.emit("participant:answer", { questionId: s.questionId, optionId: option.id });
      // Blackout keeps the options up with the tap locked; if that was the last answer the phone may already be waiting.
      await phone.until((x) => x.kind === "lockedIn" || (x.kind === "answer" && x.chosenId !== null) || x.kind === "runnerStatus", "locked in");
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
      await answer(dev, false);
      await phase("r1TimesUp");
      await command({ type: "revealAnswer" });
      await phase("r1Reveal");
      const outcomes = await Promise.all(phones.map((p) => p.until("result")));
      const got = outcomes.map((v) => (v.screen.kind === "result" ? v.screen.outcome : ""));
      assert.deepEqual(got, ["correct", q !== 2 ? "correct" : "wrong", "wrong", "correct", "wrong"]);
      if (q === 1) {
        await command({ type: "showResults" });
        await host.until((v) => v.stage.phase === "r1Results", "results chart");
        await command({ type: "showLeaderboard" });
        const board = await host.until((v) => v.stage.phase === "r1Leaderboard", "leaderboard");
        assert.ok(board.stage.phase === "r1Leaderboard" && board.stage.rows.length === 5);
      }
    }
    const zoyaScore = admin.value!.participants.find((p) => p.id === zoya.id)!.score;
    assert.ok(zoyaScore > 200 && zoyaScore <= 600, "Zoya kept her points through the reconnect (100–200 a question)");
    step("Round 1: 3 questions, early time's up, reveal, results, leaderboard");

    await command({ type: "endRound1" });
    const cut = await host.until((v) => v.stage.phase === "cut", "the cut");
    if (cut.stage.phase !== "cut") throw new Error("expected the cut");
    const safeIds = cut.stage.standings.filter((s) => s.finalist).map((s) => s.id);
    assert.equal(safeIds.length, 3, "demo preset: top 3 safe");
    assert.deepEqual([...safeIds].sort(), [riya.id, aadi.id, zoya.id].sort());
    assert.deepEqual([cut.stage.wildCardCount, cut.stage.wildCardSkipped], [2, false]);
    const kabirCut = await kabir.until("cut");
    assert.ok(kabirCut.screen.kind === "cut" && kabirCut.screen.outcome === "wildcard");
    const riyaCut = await riya.until("cut");
    assert.ok(riyaCut.screen.kind === "cut" && riyaCut.screen.outcome === "safe" && riyaCut.screen.rank === 1);
    step(`The cut: ${cut.stage.standings.map((s) => `${s.rank}. ${s.name}${s.finalist ? " (safe)" : ""}`).join(", ")}`);

    // ---- Wild card round: Kabir gets them all right, Dev all wrong. A safe finalist's answer is ignored.
    await command({ type: "startWildCard" });
    await phase("wcIntro");
    await riya.until("safeWatch");
    for (let q = 1; q <= 3; q++) {
      await command({ type: q === 1 ? "showQuestion" : "nextQuestion" });
      await phase("wcRead");
      await kabir.until("eyesUp");
      await phase("wcAnswer");
      const ks = (await kabir.until("answer")).screen;
      if (q === 1 && ks.kind === "answer") {
        riya.socket.emit("participant:answer", { questionId: ks.questionId, optionId: ks.options[0].id });
      }
      await answer(kabir, true);
      await answer(dev, false);
      await phase("wcTimesUp");
      await command({ type: "revealAnswer" });
      const r = (await kabir.until("result")).screen;
      assert.ok(r.kind === "result" && r.round === 2 && r.outcome === "correct" && r.tally?.right === q, `Kabir: ${q} of ${q} right`);
    }
    assert.equal(admin.value!.participants.find((p) => p.id === riya.id)!.wildCorrect, null, "the safe finalist never played the wild card");
    await command({ type: "showStandings" });
    await host.until((v) => v.stage.phase === "wcStandings" && v.stage.wildCard.standings[0]?.id === kabir.id, "standings on the Host");
    await command({ type: "revealWildCard" });
    await host.until((v) => v.stage.phase === "wcWinner" && v.stage.wildCard.winner?.id === kabir.id, "the wild card on the Host");
    const kw = await kabir.until("wcWinner");
    assert.ok(kw.screen.kind === "wcWinner" && kw.screen.you === "won");
    const dw = await dev.until("wcWinner");
    assert.ok(dw.screen.kind === "wcWinner" && dw.screen.you === "lost");
    step("Wild card round: 3 questions, a safe finalist's answer ignored, Kabir won the last seat");

    // ---- Predictions: Dev (audience) backs Riya, after changing his mind
    await command({ type: "openPredictions" });
    await dev.until("backFinalist");
    dev.socket.emit("participant:back", { finalistId: aadi.id });
    dev.socket.emit("participant:back", { finalistId: riya.id });
    await host.until((v) => v.stage.phase === "predictions" && v.stage.backing.counts[riya.id] === 1 && v.stage.finalists.length === 4, "backing on the Host");
    step("Predictions: Dev backed a finalist (and changed his mind)");

    // ---- Blackout: Riya right every time, Aadi right twice then wrong, Zoya wrong, Kabir silent then wrong.
    await command({ type: "startBlackout" });
    const intro = await phase("boIntro");
    assert.deepEqual(
      intro.blackout!.runners.map((r) => [r.name, r.headStart]),
      [
        ["Riya", 2],
        ["Zoya", 2],
        ["Aadi", 2],
        ["Kabir", 0],
      ].filter((x) => intro.blackout!.runners.some((r) => r.name === x[0])).sort((a, b) => {
        const ia = intro.blackout!.runners.findIndex((r) => r.name === a[0]);
        const ib = intro.blackout!.runners.findIndex((r) => r.name === b[0]);
        return ia - ib;
      }),
      "head starts: the top 3 +2, the wild card 0",
    );
    await kabir.until((s) => s.kind === "runnerStatus" && s.alive && s.headStart === 0, "Kabir ready, no head start");
    // The only Blackout click was Start Blackout: the flow buttons are refused from here on.
    const rawCommand = (action: AdminAction, stepId = admin.value!.stepId) =>
      within(new Promise<CommandResult>((r) => adminSocket.emit("admin:command", { stepId, action }, r)), `admin:command ${action.type}`);
    for (const type of ["showQuestion", "revealAnswer", "advanceDarkness", "nextQuestion", "showWinner"] as const) {
      assert.deepEqual(await rawCommand({ type }), { ok: false, reason: "not-allowed" }, `${type} is refused during the autopilot`);
    }
    assert.equal(admin.value!.primary?.label, "Pause");
    let sawBack = false;
    let sawCatch = false;
    let pausedOnce = false;
    let skippedOnce = false;
    let lastQuestion = "";
    let q = 0;
    for (;;) {
      const v = await admin.until((x) => x.phase === "podium" || x.phase === "boWinner" || (x.phase === "boAnswer" && x.question?.id !== lastQuestion), "the next Blackout question (autopilot)");
      if (v.phase !== "boAnswer") break;
      q += 1;
      assert.ok(q <= 8, "Blackout ends within its 8 questions");
      lastQuestion = v.question!.id;
      assert.ok(v.autopilot?.running && v.autopilot.step === "answer" && v.darkPreview !== null, "Admin sees the autopilot and the catch preview");
      const alive = new Set(v.blackout!.runners.filter((r) => r.alive).map((r) => r.id));
      if (alive.has(riya.id)) await answer(riya, true);
      if (alive.has(aadi.id)) await answer(aadi, q <= 2);
      if (alive.has(zoya.id)) await answer(zoya, false);
      if (alive.has(kabir.id) && q > 1) await answer(kabir, false);
      const reveal = await phase("boReveal", (x) => x.question?.id === lastQuestion);
      const zr = reveal.blackout!.runners.find((r) => r.id === zoya.id)!;
      if (zr.alive && zr.delta === -1) {
        sawBack = true;
        const zs = (await zoya.until("runnerStatus", "Zoya waits after the reveal")).screen;
        assert.ok(zs.kind === "runnerStatus" && zs.alive, "after the reveal a runner's phone just waits");
      }
      if (!skippedOnce && admin.value!.phase === "boReveal") {
        // A double-tapped Skip ends the reveal's hold once, never two steps.
        const at = admin.value!.stepId;
        const taps = await Promise.all([rawCommand({ type: "skipTimer" }, at), rawCommand({ type: "skipTimer" }, at)]);
        assert.equal(taps.filter((r) => r.ok).length, 1, "a double-tapped Skip counts once");
        skippedOnce = true;
      }
      const dark = await phase("boDark", (x) => x.question?.id === lastQuestion);
      if (!pausedOnce) {
        // Pause in the dark's hold: every screen freezes; Resume carries on from the same moment.
        await command({ type: "pause" });
        await host.until((x) => x.paused && x.stage.phase === "boDark", "the Host shows paused");
        await new Promise((r) => setTimeout(r, 1200));
        assert.equal(admin.value!.phase, "boDark", "nothing moves while paused");
        await command({ type: "resume" });
        pausedOnce = true;
      }
      if (dark.blackout!.caughtThisQuestion.length) sawCatch = true;
      if (dark.blackout!.caughtThisQuestion.includes(zoya.id)) {
        const zs = (await zoya.until((x) => x.kind === "runnerStatus" && !x.alive, "Zoya caught")).screen;
        assert.ok(zs.kind === "runnerStatus" && zs.caughtNow && zs.place !== null);
      }
    }
    await phase("podium");
    assert.ok(pausedOnce && skippedOnce, "paused, resumed and skipped once on the way");
    assert.ok(sawBack, "a wrong answer moved a runner back");
    assert.ok(sawCatch, "the dark caught someone");
    const podium = await host.until((v) => v.stage.phase === "podium", "podium");
    assert.ok(podium.stage.phase === "podium" && podium.stage.basis === "blackout" && podium.stage.entries[0].id === riya.id && podium.stage.calledIt === 1);
    const lines = await Promise.all(phones.map((p) => p.until("podium")));
    const riyaP = lines[0].screen;
    assert.ok(riyaP.kind === "podium" && riyaP.place === 1);
    const devP = lines[4].screen;
    assert.ok(devP.kind === "podium" && devP.calledIt === true && devP.place === null, "Dev called it");
    step(`Blackout: one click, then the autopilot ran ${q} questions to the podium (paused and resumed once, a double Skip counted once); Zoya moved back, the dark caught runners, Riya won; Dev called it`);

    // ---- Results, Host refresh, toggles
    const results = await within(new Promise<{ csv: string; filename: string } | null>((r) => adminSocket.emit("admin:results", r)), "CSV");
    const rows = results!.csv.split("\r\n");
    assert.equal(rows.length, 6, "CSV: header + 5 rows");
    assert.ok(rows[0].includes("Wild card correct") && rows[0].includes("Blackout place") && rows[0].includes("Blackout final position"), "the v3 columns");
    assert.ok(rows[1].includes("Riya") && rows[1].includes(",winner,"));
    const host2Socket = await open();
    const host2 = new Latest<HostView>();
    host2Socket.on("host:state", (v) => host2.push(v));
    const resumed = await within(new Promise((r) => host2Socket.emit("host:auth", { pin: PIN, roomCode: created.roomCode }, r)), "host:auth");
    assert.deepEqual(resumed, { ok: true, roomCode: created.roomCode });
    await host2.until((v) => v.stage.phase === "podium", "resumed Host shows the podium");
    await command({ type: "setRoomCodeVisible", visible: false });
    await command({ type: "setSound", on: false });
    await host2.until((v) => !v.roomCodeVisible && !v.soundOn, "toggles reach the Host");
    step("Results CSV with the v3 columns, Host refresh resumes the same room, room code and sound toggles");

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
