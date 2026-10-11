/**
 * Starts a mock game server: an HTTP server (GET /health) with Socket.IO on top.
 * Used by `npm run dev` (via index.ts) and by `npm run smoke` (on a spare port).
 *
 * Every payload from a browser is checked here before it reaches the quiz, so a
 * bad or malicious message can never crash the server.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { ADMIN_ACTION_TYPES, type AdminAction, type AdminActionType, type BotResult, NAME_MAX_LENGTH } from "../src/shared/protocol";
import type { GameConfig } from "./config";
import type { Clock } from "./quiz";
import { type GameServer, RoomManager } from "./rooms";

export interface GameServerOptions {
  /** 0 = any free port. */
  port: number;
  host?: string;
  config: GameConfig;
  adminPin: string;
  /** Address phones open, shown on the Host (e.g. http://192.168.1.5:3000/play). */
  joinUrl: string;
  /** Allowed browser origins (default: any). */
  corsOrigin?: string[];
  questionsFile?: string;
  clock?: Clock;
  log?: (message: string) => void;
}

export interface RunningGameServer {
  port: number;
  io: GameServer;
  rooms: RoomManager;
  close(): Promise<void>;
}

export function startGameServer(options: GameServerOptions): Promise<RunningGameServer> {
  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io: GameServer = new Server(httpServer, {
    cors: { origin: options.corsOrigin && options.corsOrigin.length ? options.corsOrigin : true },
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 64 * 1024,
  });

  const rooms = new RoomManager(io, {
    joinUrl: options.joinUrl,
    config: options.config,
    adminPin: options.adminPin,
    questionsFile: options.questionsFile,
    clock: options.clock,
    log: options.log,
  });

  io.on("connection", (socket) => {
    socket.data = {};

    socket.on("host:create", (ack) => {
      if (typeof ack !== "function") return;
      try {
        ack(rooms.createRoom(socket));
      } catch (error) {
        // Most likely a broken data/questions.json: say so in the terminal.
        options.log?.(`Couldn't create a room: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    socket.on("host:resume", (payload, ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: rooms.resumeHost(socket, str(payload?.roomCode, 10), str(payload?.hostToken, 100)) });
    });

    socket.on("participant:join", (payload, ack) => {
      if (typeof ack !== "function") return;
      const participantId = str(payload?.participantId, 40) || undefined;
      ack(rooms.join(socket, { roomCode: str(payload?.roomCode, 10), name: str(payload?.name, NAME_MAX_LENGTH * 3), participantId }));
    });
    socket.on("participant:bot", (payload, ack) => {
      if (typeof ack !== "function") return;
      let result: BotResult = { ok: false, error: "invalid" };
      rooms.asParticipant(socket, (room, id) => {
        result = room.setBot(id, { color: str(payload?.color, 10), head: str(payload?.head, 10) });
      });
      ack(result);
    });
    socket.on("participant:answer", (payload) =>
      rooms.asParticipant(socket, (room, id) => room.answer(id, str(payload?.questionId, 40), str(payload?.optionId, 40))),
    );
    socket.on("participant:buzz", (payload) => rooms.asParticipant(socket, (room, id) => room.buzz(id, str(payload?.questionId, 40))));
    socket.on("participant:back", (payload) => rooms.asParticipant(socket, (room, id) => room.back(id, str(payload?.finalistId, 40))));
    socket.on("participant:visibility", (payload) =>
      rooms.asParticipant(socket, (room, id) => room.setPageHidden(id, payload?.hidden === true)),
    );

    socket.on("admin:auth", (payload, ack) => {
      if (typeof ack !== "function") return;
      ack(rooms.authAdmin(socket, str(payload?.roomCode, 10), str(payload?.pin, 40)));
    });
    socket.on("admin:command", (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const action = parseAction(payload?.action);
      const stepId = payload?.stepId;
      if (!action || typeof stepId !== "number" || !Number.isFinite(stepId)) {
        reply({ ok: false, reason: "invalid" });
        return;
      }
      reply(rooms.adminCommand(socket, { stepId, action }));
    });
    socket.on("admin:results", (ack) => {
      if (typeof ack === "function") ack(rooms.adminResults(socket));
    });

    socket.on("disconnect", () => rooms.disconnect(socket));
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host ?? "0.0.0.0", () => {
      httpServer.off("error", reject);
      const { port } = httpServer.address() as AddressInfo;
      resolve({
        port,
        io,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            rooms.closeAll();
            io.close(() => done());
          }),
      });
    });
  });
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Checks an admin action from the network; null if it isn't a valid one. */
export function parseAction(raw: unknown): AdminAction | null {
  if (!raw || typeof raw !== "object") return null;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string" || !ADMIN_ACTION_TYPES.includes(type as AdminActionType)) return null;
  const r = raw as Record<string, unknown>;
  switch (type as AdminActionType) {
    case "removeParticipant":
      return typeof r.participantId === "string" ? { type: "removeParticipant", participantId: r.participantId.slice(0, 40) } : null;
    case "setRoomCodeVisible":
      return typeof r.visible === "boolean" ? { type: "setRoomCodeVisible", visible: r.visible } : null;
    case "setSound":
      return typeof r.on === "boolean" ? { type: "setSound", on: r.on } : null;
    default:
      return { type } as AdminAction;
  }
}
