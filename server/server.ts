/**
 * Starts the game server: an HTTP server (GET /health, question images) with
 * Socket.IO on top. Used by `npm run dev` / `start:game` (via index.ts) and by
 * the tests (on a spare port).
 *
 * Every payload from a browser is checked here before it reaches the quiz or
 * the library, so a bad or malicious message can never crash the server.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import {
  ADMIN_ACTION_TYPES,
  type AdminAction,
  type AdminActionType,
  type BotResult,
  IMAGE_PIN_HEADER,
  IMAGE_UPLOAD_PATH,
  NAME_MAX_LENGTH,
  type OpenRoomResult,
  type Quiz,
  QUIZ_LIMITS,
  type QuizSummary,
  type SaveQuizResult,
} from "../src/shared/protocol";
import { cleanQuiz, newId, quizProblems } from "../src/shared/quiz";
import type { GameConfig } from "./config";
import type { Database } from "./db";
import { defaultRules, ensureDemoQuiz, type LibraryStore, MemoryLibrary } from "./library";
import type { Clock } from "./quiz";
import { type GameServer, type GameSocket, RoomManager } from "./rooms";

export interface GameServerOptions {
  /** 0 = any free port. */
  port: number;
  host?: string;
  /** Base settings; each quiz in the library overrides its own timings and counts. */
  config: GameConfig;
  adminPin: string;
  /** Address phones open, shown on the Host (e.g. http://192.168.1.5:3000/play). */
  joinUrl: string;
  /** Allowed browser origins (default: any). */
  corsOrigin?: string[];
  /** data/questions.json: the Demo quiz is made from it when the library is empty. */
  questionsFile?: string;
  clock?: Clock;
  log?: (message: string) => void;
  /** Saves results to Postgres (see db.ts). Optional. */
  database?: Database | null;
  /** Where quizzes are kept (default: in memory, for tests). */
  library?: LibraryStore;
  /** Tests only: every room's timers run at this speed (0.1 = ten times faster). */
  timingScale?: number;
}

export interface RunningGameServer {
  port: number;
  io: GameServer;
  rooms: RoomManager;
  library: LibraryStore;
  close(): Promise<void>;
}

const IMAGE_TYPES: [string, (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

export async function startGameServer(options: GameServerOptions): Promise<RunningGameServer> {
  /** New on every start: screens compare it to spot a restart (server:hello). */
  const BOOT_ID = randomUUID();
  const library = options.library ?? new MemoryLibrary();
  await ensureDemoQuiz(library, options.config, options.questionsFile);
  const log = options.log ?? (() => {});
  const allowed = options.corsOrigin && options.corsOrigin.length ? options.corsOrigin : null;
  const corsFor = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    return origin && (!allowed || allowed.includes(origin)) ? origin : allowed ? allowed[0] : "*";
  };

  /** Wrong PINs per address on the image upload (it has no socket to count on). */
  const uploadFailures = new Map<string, { count: number; since: number }>();

  async function uploadImage(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: object) => {
      res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": corsFor(req) });
      res.end(JSON.stringify(body));
    };
    const ip = req.socket.remoteAddress ?? "?";
    const f = uploadFailures.get(ip);
    if (f && Date.now() - f.since < 10 * 60_000 && f.count >= 10) return send(429, { error: "Too many wrong PINs. Try again in 10 minutes." });
    if (req.headers[IMAGE_PIN_HEADER] !== options.adminPin) {
      uploadFailures.set(ip, f && Date.now() - f.since < 10 * 60_000 ? { ...f, count: f.count + 1 } : { count: 1, since: Date.now() });
      return send(401, { error: "Wrong PIN." });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > QUIZ_LIMITS.imageBytes) return send(413, { error: "That image is too big (max 2.5 MB)." });
      chunks.push(chunk as Buffer);
    }
    const bytes = Buffer.concat(chunks);
    const mime = IMAGE_TYPES.find(([, test]) => bytes.length > 12 && test(bytes))?.[0];
    if (!mime) return send(415, { error: "Use a JPEG, PNG or WebP image." });
    try {
      const id = await library.putImage({ bytes, mime });
      send(200, { url: `/images/${id}` });
    } catch (error) {
      log(`[library] couldn't save an image: ${error instanceof Error ? error.message : String(error)}`);
      send(500, { error: "Couldn't save the image. Try again." });
    }
  }

  const httpServer = createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === "/health") {
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
      res.end("ok");
      return;
    }
    if (url === IMAGE_UPLOAD_PATH && req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": corsFor(req),
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": `content-type, ${IMAGE_PIN_HEADER}`,
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }
    if (url === IMAGE_UPLOAD_PATH && req.method === "POST") {
      void uploadImage(req, res);
      return;
    }
    const image = url.match(/^\/images\/([a-f0-9]{20})$/);
    if (image && req.method === "GET") {
      library.getImage(image[1]).then(
        (found) => {
          if (!found) {
            res.writeHead(404, { "access-control-allow-origin": "*" });
            res.end();
            return;
          }
          res.writeHead(200, {
            "content-type": found.mime,
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "access-control-allow-origin": "*",
          });
          res.end(found.bytes);
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io: GameServer = new Server(httpServer, {
    cors: { origin: allowed ?? true },
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 15_000,
    // A whole quiz (up to 2 × 200 questions) is saved in one message.
    maxHttpBufferSize: 1024 * 1024,
  });

  const rooms = new RoomManager(io, {
    joinUrl: options.joinUrl,
    config: options.config,
    adminPin: options.adminPin,
    clock: options.clock,
    log: options.log,
    database: options.database,
    timingScale: options.timingScale,
  });

  const fallbackRules = defaultRules(options.config);
  const summary = (q: Quiz): QuizSummary => ({
    id: q.id,
    title: q.title,
    round1: q.round1.length,
    buzzer: q.buzzer.length,
    updatedAt: q.updatedAt,
    problems: quizProblems(q),
  });
  /** Runs a library call for a signed-in socket; logs and answers `failed` if the store throws. */
  const withLibrary = <T>(socket: GameSocket, ack: unknown, failed: NoInfer<T>, run: () => Promise<T>) => {
    if (typeof ack !== "function") return;
    if (!rooms.isAuthed(socket)) return (ack as (r: T) => void)(failed);
    run().then(
      (r) => (ack as (r: T) => void)(r),
      (error) => {
        log(`[library] ${error instanceof Error ? error.message : String(error)}`);
        (ack as (r: T) => void)(failed);
      },
    );
  };
  const saveFailed: SaveQuizResult = { ok: false, error: "not-signed-in" };

  io.on("connection", (socket) => {
    socket.data = {};
    socket.emit("server:hello", { bootId: BOOT_ID });

    socket.on("host:auth", (payload, ack) => {
      if (typeof ack !== "function") return;
      ack(rooms.authHost(socket, str(payload?.pin, 40), str(payload?.roomCode, 10) || undefined));
    });

    // ---- Admin: sign in, rooms, library
    socket.on("admin:login", (payload, ack) => {
      if (typeof ack !== "function") return;
      ack(rooms.checkPin(socket, str(payload?.pin, 40)) ? { ok: true } : { ok: false, error: "wrong-pin" });
    });
    socket.on("admin:rooms", (ack) => {
      if (typeof ack === "function") ack(rooms.isAuthed(socket) ? rooms.listRooms() : null);
    });
    socket.on("admin:closeRoom", (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!rooms.isAuthed(socket)) return ack({ ok: false });
      ack({ ok: rooms.closeRoom(str(payload?.roomCode, 10).toUpperCase(), "The quizmaster closed this room.") });
    });
    socket.on("admin:openRoom", (payload, ack) =>
      withLibrary<OpenRoomResult>(socket, ack, { ok: false, error: "not-signed-in" }, async () => {
        const quiz = await library.get(str(payload?.quizId, 40));
        if (!quiz) return { ok: false, error: "not-found" };
        const problems = quizProblems(quiz);
        if (problems.length) return { ok: false, error: "not-ready", problems };
        return { ok: true, roomCode: rooms.openRoom(socket, quiz) };
      }),
    );
    socket.on("library:list", (ack) =>
      withLibrary<QuizSummary[] | null>(socket, ack, null, async () => (await library.list()).sort((a, b) => b.updatedAt - a.updatedAt).map(summary)),
    );
    socket.on("library:get", (payload, ack) => withLibrary<Quiz | null>(socket, ack, null, () => library.get(str(payload?.id, 40))));
    socket.on("library:create", (payload, ack) =>
      withLibrary<SaveQuizResult>(socket, ack, saveFailed, async () => {
        const quiz: Quiz = {
          id: newId(),
          title: str(payload?.title, QUIZ_LIMITS.title).trim() || "New quiz",
          rules: fallbackRules,
          round1: [],
          buzzer: [],
          updatedAt: Date.now(),
        };
        await library.save(quiz);
        log(`[library] created "${quiz.title}"`);
        return { ok: true, quiz };
      }),
    );
    socket.on("library:duplicate", (payload, ack) =>
      withLibrary<SaveQuizResult>(socket, ack, saveFailed, async () => {
        const original = await library.get(str(payload?.id, 40));
        if (!original) return { ok: false, error: "not-found" };
        const quiz: Quiz = { ...structuredClone(original), id: newId(), title: `${original.title} (copy)`.slice(0, QUIZ_LIMITS.title), updatedAt: Date.now() };
        await library.save(quiz);
        return { ok: true, quiz };
      }),
    );
    socket.on("library:save", (payload, ack) =>
      withLibrary<SaveQuizResult>(socket, ack, saveFailed, async () => {
        const quiz = cleanQuiz(payload, fallbackRules);
        if (!quiz) return { ok: false, error: "invalid" };
        await library.save(quiz);
        log(`[library] saved "${quiz.title}" (${quiz.round1.length} + ${quiz.buzzer.length} questions)`);
        return { ok: true, quiz };
      }),
    );
    socket.on("library:delete", (payload, ack) =>
      withLibrary<{ ok: boolean }>(socket, ack, { ok: false }, async () => {
        const ok = await library.remove(str(payload?.id, 40));
        return { ok };
      }),
    );

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
        library,
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
