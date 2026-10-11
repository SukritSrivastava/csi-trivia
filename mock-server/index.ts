/**
 * MOCK game server: runs the whole quiz so the frontend can be built and
 * tested without the real backend. Started by `npm run dev`.
 *
 * Environment:
 *   GAME_PRESET     demo (default) or event
 *   ADMIN_PIN       organiser PIN for /admin (default 1234)
 *   GAME_PORT       default 3001
 *   WEB_PORT        default 3000
 *   PUBLIC_WEB_URL  site address for the join link once deployed
 *   CORS_ORIGIN     comma-separated allowed origins (default: any)
 */
import { createServer } from "node:http";
import { Server } from "socket.io";
import { loadConfig } from "./config";
import { getLanAddresses } from "./network";
import { loadQuestions } from "./questions";
import { type GameServer, RoomManager } from "./rooms";

const config = loadConfig();
const GAME_PORT = Number(process.env.GAME_PORT ?? 3001);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const ADMIN_PIN = process.env.ADMIN_PIN ?? "1234";

const lanIp = getLanAddresses()[0] ?? "localhost";
const webUrl = (process.env.PUBLIC_WEB_URL ?? `http://${lanIp}:${WEB_PORT}`).replace(/\/$/, "");
const joinUrl = `${webUrl}/play`;

// Fail fast if the question file is broken.
const questionCount = loadQuestions().length;

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const io: GameServer = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true },
  pingInterval: 10_000,
  pingTimeout: 15_000,
});

const rooms = new RoomManager(io, joinUrl, config, ADMIN_PIN);

io.on("connection", (socket) => {
  socket.on("host:create", (ack) => {
    const result = rooms.createRoom(socket);
    if (typeof ack === "function") ack(result);
  });
  socket.on("host:resume", (payload, ack) => {
    const ok = rooms.resumeHost(socket, String(payload?.roomCode ?? ""), String(payload?.hostToken ?? ""));
    if (typeof ack === "function") ack({ ok });
  });

  socket.on("player:join", (payload, ack) => {
    const result = rooms.join(socket, payload);
    if (typeof ack === "function") ack(result);
  });
  socket.on("player:answer", (p) =>
    rooms.asMember(socket, (room, id) => room.answer(id, String(p?.questionId ?? ""), String(p?.optionId ?? ""))),
  );
  socket.on("player:predict", (p) => rooms.asMember(socket, (room, id) => room.predict(id, String(p?.finalistId ?? ""))));
  socket.on("player:buzz", () => rooms.asMember(socket, (room, id) => room.buzz(id)));
  socket.on("player:away", (p) => rooms.asMember(socket, (room, id) => room.setAway(id, p?.away === true)));

  socket.on("admin:auth", (payload, ack) => {
    const ok = rooms.authAdmin(socket, String(payload?.roomCode ?? ""), String(payload?.pin ?? ""));
    if (typeof ack === "function") ack({ ok });
  });
  socket.on("admin:start", () => rooms.asAdmin(socket, (room) => room.start()));
  socket.on("admin:pause", () => rooms.asAdmin(socket, (room) => room.pause()));
  socket.on("admin:resume", () => rooms.asAdmin(socket, (room) => room.resume()));
  socket.on("admin:skip", () => rooms.asAdmin(socket, (room) => room.skip()));
  socket.on("admin:void", () => rooms.asAdmin(socket, (room) => room.voidQuestion()));
  socket.on("admin:remove", (p) => rooms.asAdmin(socket, (room) => room.remove(String(p?.playerId ?? ""))));
  socket.on("admin:restartRound", () => rooms.asAdmin(socket, (room) => room.restartRound()));
  socket.on("admin:judge", (p) => rooms.asAdmin(socket, (room) => room.judge(p?.correct === true)));
  socket.on("admin:results", (ack) => rooms.asAdmin(socket, (room) => {
      if (typeof ack === "function") ack(room.resultsCsv());
    }));

  socket.on("disconnect", () => rooms.disconnect(socket));
});

httpServer.listen(GAME_PORT, "0.0.0.0", () => {
  console.log(`\n  Mock game server on port ${GAME_PORT} (${config.name} preset, ${questionCount} questions)`);
  console.log(`  Projector:  http://localhost:${WEB_PORT}/host`);
  console.log(`  Organiser:  http://localhost:${WEB_PORT}/admin   (PIN ${ADMIN_PIN})`);
  console.log(`  Phones:     ${joinUrl}   (same Wi-Fi as this computer)\n`);
});
