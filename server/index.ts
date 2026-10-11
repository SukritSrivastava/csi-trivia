/**
 * Game server: holds every room and talks to the TV and phones over Socket.IO.
 * Run with `npm run dev` (starts this and the Next.js site together).
 */
import { createServer } from "node:http";
import { Server } from "socket.io";
import { getLanAddresses } from "./network";
import { type GameServer, RoomManager } from "./rooms";

const GAME_PORT = Number(process.env.GAME_PORT ?? 3001);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);

// Where phones should go to join. In production set PUBLIC_WEB_URL to your real site.
const lanIp = getLanAddresses()[0] ?? "localhost";
const webUrl = process.env.PUBLIC_WEB_URL ?? `http://${lanIp}:${WEB_PORT}`;
const joinUrl = `${webUrl.replace(/\/$/, "")}/play`;

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
  // Any origin in development. In production, set CORS_ORIGIN to your site's URL.
  cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true },
  // Phones drop out when the screen locks; notice within ~25s.
  pingInterval: 10_000,
  pingTimeout: 15_000,
});

const rooms = new RoomManager(io, joinUrl);

io.on("connection", (socket) => {
  socket.on("host:create", (ack) => {
    const result = rooms.createRoom(socket);
    if (typeof ack === "function") ack(result);
  });

  socket.on("host:resume", (payload, ack) => {
    const ok = rooms.resumeHost(socket, String(payload?.roomCode ?? ""), String(payload?.hostToken ?? ""));
    if (typeof ack === "function") ack({ ok });
  });

  socket.on("host:settings", (settings) => rooms.updateSettings(socket, settings));
  socket.on("host:skip", () => rooms.skip(socket));

  socket.on("player:join", (payload, ack) => {
    const result = rooms.join(socket, payload);
    if (typeof ack === "function") ack(result);
  });

  socket.on("player:start", () => rooms.start(socket));
  socket.on("player:restart", () => rooms.restart(socket));
  socket.on("player:answer", (payload) => rooms.answer(socket, payload));
  socket.on("player:vote", (payload) => rooms.vote(socket, payload));

  socket.on("disconnect", () => rooms.disconnect(socket));
});

httpServer.listen(GAME_PORT, "0.0.0.0", () => {
  console.log(`\n  Game server ready on port ${GAME_PORT}`);
  console.log(`  TV:     http://localhost:${WEB_PORT}/host`);
  console.log(`  Phones: ${joinUrl}  (same Wi-Fi as this computer)\n`);
});
