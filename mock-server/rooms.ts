/**
 * Glue between Socket.IO and the quiz rooms: which socket is the Host, which
 * are Participants and Admins, PIN sign-in, and pushing fresh views.
 *
 * Views: phones get theirs straight away, and only when it changed. The Host
 * and Admin views change on every single answer (counts), so between step
 * changes they're sent at most every SCREEN_THROTTLE_MS; a step change always
 * goes out immediately.
 */
import type { Server, Socket } from "socket.io";
import {
  type AdminAuthResult,
  type AdminCommandPayload,
  type AdminView,
  type ClientToServerEvents,
  type CommandResult,
  type HostView,
  type JoinResult,
  type ParticipantView,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerToClientEvents,
} from "../src/shared/protocol";
import type { GameConfig } from "./config";
import { loadQuestions } from "./questions";
import { type Clock, QuizRoom, realClock } from "./quiz";

export interface SocketData {
  roomCode?: string;
  role?: "host" | "participant" | "admin";
  participantId?: string;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface RoomEntry {
  room: QuizRoom;
  hostSocketId: string | null;
  hostLeftAt: number | null;
  participantSockets: Map<string, string>;
  adminSockets: Set<string>;
  /** Last view sent to each socket (without serverNow), so unchanged views aren't resent. */
  lastSent: Map<string, string>;
  flushQueued: boolean;
  screensSentAt: number;
  screensStep: number;
  screensTimer: NodeJS.Timeout | null;
}

export interface RoomManagerOptions {
  joinUrl: string;
  config: GameConfig;
  adminPin: string;
  questionsFile?: string;
  clock?: Clock;
  log?: (message: string) => void;
}

/** Host/Admin views between step changes: at most this often. */
const SCREEN_THROTTLE_MS = 150;
/** A room whose Host has been gone this long (and has no Admin) is closed. */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;
/**
 * Wrong PINs allowed per connection before that connection is refused. Per
 * connection, not per address: once deployed, everyone on the college Wi-Fi
 * can share one address, and a few guessers must never lock the quizmaster out.
 */
const PIN_ATTEMPTS = 5;

export class RoomManager {
  private rooms = new Map<string, RoomEntry>();
  private failedPins = new Map<string, number>();
  private sweeper: NodeJS.Timeout;
  private readonly log: (message: string) => void;

  constructor(
    private readonly io: GameServer,
    private readonly options: RoomManagerOptions,
  ) {
    this.log = options.log ?? (() => {});
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  get roomCount() {
    return this.rooms.size;
  }

  // ------------------------------------------------------------------ Host

  createRoom(socket: GameSocket) {
    const previous = socket.data.role === "host" ? socket.data.roomCode : undefined;
    if (previous && this.rooms.get(previous)?.hostSocketId === socket.id) {
      this.closeRoom(previous, "The Host started a new quiz. Join again with the new code.");
    }
    this.detach(socket);
    const code = this.newCode();
    // Re-read each time, so question edits apply to the next room without a restart.
    const questions = loadQuestions(this.options.questionsFile);
    const entry: RoomEntry = {
      room: new QuizRoom(
        code,
        this.options.joinUrl,
        this.options.config,
        questions,
        () => this.queueFlush(code),
        this.options.clock ?? realClock,
      ),
      hostSocketId: socket.id,
      hostLeftAt: null,
      participantSockets: new Map(),
      adminSockets: new Set(),
      lastSent: new Map(),
      flushQueued: false,
      screensSentAt: 0,
      screensStep: -1,
      screensTimer: null,
    };
    this.rooms.set(code, entry);
    socket.data = { roomCode: code, role: "host" };
    this.queueFlush(code);
    this.log(`[room ${code}] created (${this.options.config.name} preset, ${questions.length} questions in the file)`);
    return { roomCode: code, hostToken: entry.room.hostToken };
  }

  resumeHost(socket: GameSocket, roomCode: string, hostToken: string) {
    const entry = this.rooms.get(normaliseCode(roomCode));
    if (!entry || entry.room.hostToken !== hostToken) return false;
    this.detach(socket);
    if (entry.hostSocketId && entry.hostSocketId !== socket.id) entry.lastSent.delete(entry.hostSocketId);
    entry.hostSocketId = socket.id;
    entry.hostLeftAt = null;
    entry.lastSent.delete(socket.id);
    entry.screensStep = -1;
    socket.data = { roomCode: entry.room.code, role: "host" };
    this.queueFlush(entry.room.code);
    return true;
  }

  // ------------------------------------------------------------------ Participants

  join(socket: GameSocket, payload: { roomCode: string; name: string; participantId?: string }): JoinResult {
    const code = normaliseCode(payload.roomCode);
    const entry = this.rooms.get(code);
    if (!entry) return { ok: false, error: "room-not-found" };
    const result = entry.room.join(payload.name, payload.participantId);
    if (result.ok) {
      const sameSeat =
        socket.data.role === "participant" && socket.data.roomCode === code && socket.data.participantId === result.participantId;
      if (!sameSeat) this.detach(socket);
      const old = entry.participantSockets.get(result.participantId);
      if (old && old !== socket.id) entry.lastSent.delete(old);
      entry.participantSockets.set(result.participantId, socket.id);
      entry.lastSent.delete(socket.id);
      socket.data = { roomCode: code, role: "participant", participantId: result.participantId };
      this.queueFlush(code);
    }
    return result;
  }

  /** Runs `fn` with the room and participant this socket speaks for. */
  asParticipant(socket: GameSocket, fn: (room: QuizRoom, participantId: string) => void) {
    const { roomCode, role, participantId } = socket.data;
    if (role !== "participant" || !roomCode || !participantId) return;
    const entry = this.rooms.get(roomCode);
    if (!entry || entry.participantSockets.get(participantId) !== socket.id) return;
    fn(entry.room, participantId);
  }

  // ------------------------------------------------------------------ Admin

  authAdmin(socket: GameSocket, roomCode: string, pin: string): AdminAuthResult {
    const failures = this.failedPins.get(socket.id) ?? 0;
    if (failures >= PIN_ATTEMPTS) return { ok: false, error: "wrong-pin" };

    const entry = this.rooms.get(normaliseCode(roomCode));
    if (!entry) return { ok: false, error: "room-not-found" };
    if (pin !== this.options.adminPin) {
      this.failedPins.set(socket.id, failures + 1);
      return { ok: false, error: "wrong-pin" };
    }
    this.detach(socket);
    entry.adminSockets.add(socket.id);
    entry.lastSent.delete(socket.id);
    entry.screensStep = -1;
    socket.data = { roomCode: entry.room.code, role: "admin" };
    this.queueFlush(entry.room.code);
    return { ok: true, roomCode: entry.room.code };
  }

  adminCommand(socket: GameSocket, payload: AdminCommandPayload): CommandResult {
    const entry = this.adminEntry(socket);
    if (!entry) return { ok: false, reason: "not-signed-in" };
    const before = entry.room.stepId;
    const result = entry.room.command(payload.stepId, payload.action);
    if (result.ok) {
      const label = entry.room.adminView().stepLabel;
      this.log(`[room ${entry.room.code}] ${payload.action.type}${entry.room.stepId !== before ? ` → ${label}` : ""}`);
    }
    return result;
  }

  adminResults(socket: GameSocket) {
    return this.adminEntry(socket)?.room.resultsCsv() ?? null;
  }

  private adminEntry(socket: GameSocket) {
    const { roomCode, role } = socket.data;
    if (role !== "admin" || !roomCode) return undefined;
    const entry = this.rooms.get(roomCode);
    return entry && entry.adminSockets.has(socket.id) ? entry : undefined;
  }

  // ------------------------------------------------------------------ Lifecycle

  disconnect(socket: GameSocket) {
    this.failedPins.delete(socket.id);
    this.detach(socket);
  }

  /** Forgets whatever role this socket had (it's leaving, or taking a new role). */
  private detach(socket: GameSocket) {
    const { roomCode, role, participantId } = socket.data ?? {};
    const entry = roomCode ? this.rooms.get(roomCode) : undefined;
    if (!entry) return;
    entry.lastSent.delete(socket.id);
    if (role === "host" && entry.hostSocketId === socket.id) {
      entry.hostSocketId = null;
      entry.hostLeftAt = Date.now();
    }
    if (role === "admin") entry.adminSockets.delete(socket.id);
    if (role === "participant" && participantId && entry.participantSockets.get(participantId) === socket.id) {
      entry.participantSockets.delete(participantId);
      entry.room.disconnect(participantId);
    }
    socket.data = {};
  }

  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.rooms) {
      if (entry.hostLeftAt && entry.adminSockets.size === 0 && now - entry.hostLeftAt > ABANDONED_AFTER_MS) {
        this.closeRoom(code, "This quiz was closed because the Host left.");
      }
    }
  }

  closeRoom(code: string, reason: string) {
    const entry = this.rooms.get(code);
    if (!entry) return;
    for (const socketId of [...entry.participantSockets.values(), ...entry.adminSockets]) {
      this.io.to(socketId).emit("room:closed", { reason });
    }
    if (entry.screensTimer) clearTimeout(entry.screensTimer);
    entry.room.dispose();
    this.rooms.delete(code);
    this.log(`[room ${code}] closed: ${reason}`);
  }

  closeAll() {
    clearInterval(this.sweeper);
    for (const code of [...this.rooms.keys()]) this.closeRoom(code, "The quiz server is shutting down.");
  }

  // ------------------------------------------------------------------ Sending views

  private queueFlush(code: string) {
    const entry = this.rooms.get(code);
    if (!entry || entry.flushQueued) return;
    entry.flushQueued = true;
    queueMicrotask(() => {
      entry.flushQueued = false;
      if (this.rooms.get(code) === entry) this.flush(entry);
    });
  }

  /** True if this view differs from the last one sent to that socket. */
  private isNew(entry: RoomEntry, socketId: string, view: HostView | ParticipantView | AdminView) {
    // serverNow changes on every build, so compare without it.
    const key = JSON.stringify({ ...view, serverNow: 0 });
    if (entry.lastSent.get(socketId) === key) return false;
    entry.lastSent.set(socketId, key);
    return true;
  }

  private flush(entry: RoomEntry) {
    for (const [participantId, socketId] of entry.participantSockets) {
      const view = entry.room.participantView(participantId);
      if (view && this.isNew(entry, socketId, view)) this.io.to(socketId).emit("participant:state", view);
    }

    const stepChanged = entry.room.stepId !== entry.screensStep;
    const wait = SCREEN_THROTTLE_MS - (Date.now() - entry.screensSentAt);
    if (stepChanged || wait <= 0) {
      this.sendScreens(entry);
    } else if (!entry.screensTimer) {
      entry.screensTimer = setTimeout(() => {
        entry.screensTimer = null;
        if (this.rooms.get(entry.room.code) === entry) this.sendScreens(entry);
      }, wait);
    }
  }

  private sendScreens(entry: RoomEntry) {
    if (entry.screensTimer) {
      clearTimeout(entry.screensTimer);
      entry.screensTimer = null;
    }
    entry.screensSentAt = Date.now();
    entry.screensStep = entry.room.stepId;
    if (entry.hostSocketId) {
      const view = entry.room.hostView();
      if (this.isNew(entry, entry.hostSocketId, view)) this.io.to(entry.hostSocketId).emit("host:state", view);
    }
    if (entry.adminSockets.size) {
      const view = entry.room.adminView();
      for (const socketId of entry.adminSockets) {
        if (this.isNew(entry, socketId, view)) this.io.to(socketId).emit("admin:state", view);
      }
    }
  }

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}

function normaliseCode(code: unknown) {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .slice(0, ROOM_CODE_LENGTH + 2);
}
