/**
 * npm run db-check: plays a short game over real Socket.IO with the results
 * database switched on (an in-memory Postgres, pg-mem), then checks what was
 * saved in the backend tables (rooms, players, game_history): scores, ranks,
 * one answer row per player per question, and a voided question's rows gone.
 * Also the quiz library in the database (quizzes, quiz_images): the Demo quiz
 * seeded on first start, and an image upload round trip over HTTP.
 */
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { io, type Socket } from "socket.io-client";
import { PRESETS } from "../server/config";
import { Database, type Queryable } from "../server/db";
import { PostgresLibrary } from "../server/library";
import { startGameServer } from "../server/server";
import {
  type AdminAction,
  type AdminView,
  type ClientToServerEvents,
  IMAGE_PIN_HEADER,
  IMAGE_UPLOAD_PATH,
  type OpenRoomResult,
  type ParticipantView,
  type ServerToClientEvents,
} from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool() as unknown as Queryable;
  const errors: string[] = [];
  const database = new Database(pool, (m) => errors.push(m));

  const server = await startGameServer({
    port: 0,
    host: "127.0.0.1",
    config: PRESETS.demo,
    timingScale: 0.1,
    adminPin: "1234",
    joinUrl: "http://localhost:3000/play",
    database,
    library: new PostgresLibrary(database),
  });
  const url = `http://127.0.0.1:${server.port}`;
  const connect = () =>
    new Promise<Client>((resolve) => {
      const s: Client = io(url, { transports: ["websocket"], forceNew: true });
      s.once("connect", () => resolve(s));
    });

  const sockets: Client[] = [];
  try {
    // ---- The quiz library lives in the database too: the Demo quiz was seeded there
    const stored = mem.public.many("SELECT id, title FROM quizzes") as { id: string; title: string }[];
    assert.deepEqual(stored, [{ id: "demo", title: "Demo quiz" }]);
    console.log("✓ quizzes: the Demo quiz was saved to the database on first start");

    // ---- An image upload goes into quiz_images and comes back byte for byte
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const wrongPin = await fetch(`${url}${IMAGE_UPLOAD_PATH}`, { method: "POST", headers: { [IMAGE_PIN_HEADER]: "0000" }, body: png });
    assert.equal(wrongPin.status, 401, "image upload needs the PIN");
    const up = await fetch(`${url}${IMAGE_UPLOAD_PATH}`, { method: "POST", headers: { [IMAGE_PIN_HEADER]: "1234", "content-type": "image/png" }, body: png });
    const { url: imagePath } = (await up.json()) as { url: string };
    assert.match(imagePath, /^\/images\/[a-f0-9]{20}$/);
    const back = await fetch(`${url}${imagePath}`);
    assert.equal(back.headers.get("content-type"), "image/png");
    assert.ok(Buffer.from(await back.arrayBuffer()).equals(png), "the image comes back unchanged");
    const notImage = await fetch(`${url}${IMAGE_UPLOAD_PATH}`, { method: "POST", headers: { [IMAGE_PIN_HEADER]: "1234" }, body: "<svg onload=alert(1)>" });
    assert.equal(notImage.status, 415, "only JPEG/PNG/WebP are accepted");
    console.log("✓ quiz_images: upload needs the PIN, only real images, served back unchanged");

    // ---- Admin opens a room with the Demo quiz
    const admin = await connect();
    sockets.push(admin);
    let view: AdminView | null = null;
    admin.on("admin:state", (v) => (view = v));
    await new Promise((r) => admin.emit("admin:login", { pin: "1234" }, r));
    const opened = await new Promise<OpenRoomResult>((r) => admin.emit("admin:openRoom", { quizId: "demo" }, r));
    if (!opened.ok) throw new Error(`couldn't open a room: ${opened.error}`);
    const roomCode = opened.roomCode;
    const until = async (test: (v: AdminView) => boolean, what: string) => {
      for (let i = 0; i < 200; i++) {
        if (view && test(view)) return view;
        await sleep(20);
      }
      throw new Error(`timed out: ${what}`);
    };
    const send = async (action: AdminAction) => {
      const v = view!;
      const res = await new Promise<{ ok: boolean }>((r) => admin.emit("admin:command", { stepId: v.stepId, action }, r));
      assert.ok(res.ok, `${action.type} refused`);
    };

    // Riya always right, Kabir always wrong, Zoya never answers.
    const plan: Record<string, "right" | "wrong" | "none"> = { Riya: "right", Kabir: "wrong", Zoya: "none" };
    for (const name of Object.keys(plan)) {
      const s = await connect();
      sockets.push(s);
      s.on("participant:state", (pv: ParticipantView) => {
        if (pv.screen.kind !== "answer" || plan[name] === "none" || !view?.question) return;
        const correct = view.question.correctText;
        const option = pv.screen.options.find((o) => (plan[name] === "right" ? o.text === correct : o.text !== correct));
        if (option) s.emit("participant:answer", { questionId: pv.screen.questionId, optionId: option.id });
      });
      await new Promise((r) => s.emit("participant:join", { roomCode, name }, r));
    }

    await until((v) => v.counts.joined === 3, "3 joined");
    await send({ type: "startQuiz" });
    // Q1: played and kept. Q2: played, then voided. Q3: played and kept.
    for (let q = 0; q < 3; q++) {
      await until((v) => v.allowed.includes(q === 0 ? "showQuestion" : "nextQuestion"), "ready for a question");
      await send({ type: q === 0 ? "showQuestion" : "nextQuestion" });
      await until((v) => v.phase === "r1TimesUp", "time's up");
      await send({ type: "revealAnswer" });
      await until((v) => v.phase === "r1Reveal", "reveal");
      if (q === 1) {
        await send({ type: "voidQuestion" });
        await until((v) => v.stepLabel.includes("cancelled"), "voided");
      }
    }
    await send({ type: "endRound1" });
    await until((v) => v.phase === "cut", "cut");
    const expected = view!.participants;

    await server.close(); // closing the room saves it one last time
    await database.drain();

    const rows = <T>(sql: string) => mem.public.many(sql) as T[];
    const rooms = rows<{ room_code: string; game_state: string }>("SELECT room_code, game_state FROM rooms");
    assert.equal(rooms.length, 1);
    assert.match(rooms[0].room_code, new RegExp(`^${roomCode}-\\d{4}-\\d{2}-\\d{2}T`));
    assert.equal(rooms[0].game_state, "cut");
    console.log(`✓ rooms: ${rooms[0].room_code} saved at step "${rooms[0].game_state}"`);

    const players = rows<{ player_id: string; name: string; score: number; status: string; round1_rank: number }>(
      "SELECT player_id, name, score, status, round1_rank FROM players ORDER BY round1_rank",
    );
    assert.equal(players.length, 3);
    for (const p of expected) {
      const saved = players.find((r) => r.player_id === p.id)!;
      assert.ok(saved, `${p.name} saved`);
      assert.equal(saved.name, p.name);
      assert.equal(saved.score, p.score);
      assert.equal(saved.status, p.status);
      assert.equal(saved.round1_rank, p.rank);
    }
    console.log(`✓ players: ${players.map((p) => `${p.round1_rank}. ${p.name} ${p.score} (${p.status})`).join(", ")}`);

    const history = rows<{ question_index: number; player_id: string; selected_option: number | null; is_correct: boolean; points_awarded: number; round: number }>(
      "SELECT question_index, player_id, selected_option, is_correct, points_awarded, round FROM game_history",
    );
    const byName = (id: string) => expected.find((p) => p.id === id)!.name;
    assert.equal(history.length, 6, "3 players × 2 kept questions");
    assert.ok(!history.some((h) => h.question_index === 1), "voided question's rows were removed");
    for (const h of history) {
      const name = byName(h.player_id);
      assert.equal(h.round, 1);
      if (name === "Riya") assert.ok(h.is_correct && h.points_awarded >= 500);
      if (name === "Kabir") assert.ok(!h.is_correct && h.points_awarded === 0 && h.selected_option !== null);
      if (name === "Zoya") assert.ok(!h.is_correct && h.selected_option === null);
    }
    const riyaTotal = history.filter((h) => byName(h.player_id) === "Riya").reduce((s, h) => s + h.points_awarded, 0);
    assert.equal(riyaTotal, expected.find((p) => p.name === "Riya")!.score, "answer log adds up to the score");
    console.log(`✓ game_history: ${history.length} answers for questions 0 and 2; question 1 (voided) removed; points add up`);

    assert.deepEqual(errors, [], "no database errors");
    console.log("\nDatabase check passed.");
  } finally {
    for (const s of sockets) s.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
