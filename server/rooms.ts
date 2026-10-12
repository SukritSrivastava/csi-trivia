/**
 * Glue between Socket.IO and the quiz rooms: PIN sign-in, which sockets are
 * Hosts, Participants and Admins, opening rooms from the quiz library, and
 * pushing fresh views.
 *
 * Rooms are opened by Admin (admin:openRoom) with a frozen copy of a quiz. The
 * Host (projector) signs in with the same PIN and shows a room; several Host
 * screens may show the same room. A room nobody is watching (no Host, no Admin)
 * closes after ABANDONED_AFTER_MS.
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
  type HostAuthResult,
  type HostView,
  type JoinResult,
  type OpenRoomSummary,
  type ParticipantView,
  type Quiz,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerToClientEvents,
} from "../src/shared/protocol";
import { type GameConfig, withTimingScale } from "./config";
import type { Database, RoomRecorder } from "./db";
import { quizToGame } from "./library";
import { type Clock, QuizRoom, realClock } from "./quiz";

export interface SocketData {
  roomCode?: string;
  role?: "host" | "participant" | "admin";
  participantId?: string;
  /** Passed the PIN (admin:login, admin:auth or host:auth): may use the quiz library. */
  authed?: boolean;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface RoomEntry {
  room: QuizRoom;
  openedAt: number;
  hostSockets: Set<string>;
  /** When the last Host and Admin left (null while someone is watching). */
  emptySince: number | null;
  participantSockets: Map<string, string>;
  adminSockets: Set<string>;
  /** Last view sent to each socket (without serverNow), so unchanged views aren't resent. */
  lastSent: Map<string, string>;
  flushQueued: boolean;
  screensSentAt: number;
  screensStep: number;
  screensTimer: NodeJS.Timeout | null;
  /** Saves to the database (null without DATABASE_URL). */
  recorder: RoomRecorder | null;
  saveTimer: NodeJS.Timeout | null;
}

export interface RoomManagerOptions {
  joinUrl: string;
  /** Base settings (scoring, room size…); each quiz overrides its own timings and counts. */
  config: GameConfig;
  adminPin: string;
  clock?: Clock;
  log?: (message: string) => void;
  /** Saves results to Postgres when set (DATABASE_URL). */
  database?: Database | null;
  /** Tests only: run every timer of every room at this speed (0.1 = ten times faster). */
  timingScale?: number;
}

/** The room is saved to the database at most this often while it changes. */
const SAVE_EVERY_MS = 2000;

/** Host/Admin views between step changes: at most this often. */
const SCREEN_THROTTLE_MS = 150;
/** A room with no Host and no Admin for this long is closed. */
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

  // ------------------------------------------------------------------ PIN

  /** Checks the PIN for this socket (5 wrong tries and it's refused). */
  checkPin(socket: GameSocket, pin: string): boolean {
    const failures = this.failedPins.get(socket.id) ?? 0;
    if (failures >= PIN_ATTEMPTS) return false;
    if (pin !== this.options.adminPin) {
      this.failedPins.set(socket.id, failures + 1);
      return false;
    }
    socket.data.authed = true;
    return true;
  }

  isAuthed(socket: GameSocket) {
    return socket.data.authed === true;
  }

  // ------------------------------------------------------------------ Rooms

  /** Opens a room playing a frozen copy of `quiz`, and signs `socket` into it as Admin. */
  openRoom(socket: GameSocket, quiz: Quiz): string {
    const code = this.newCode();
    let { config, questions } = quizToGame(quiz, this.options.config);
    const scale = this.options.timingScale;
    if (scale) {
      const s = (ms: number | undefined) => (ms === undefined ? undefined : Math.max(50, Math.round(ms * scale)));
      config = withTimingScale(config, scale);
      questions = questions.map((q) => ({ ...q, readMs: s(q.readMs), openMs: s(q.openMs) }));
    }
    const entry: RoomEntry = {
      room: new QuizRoom(code, this.options.joinUrl, config, questions, () => this.queueFlush(code), this.options.clock ?? realClock),
      openedAt: Date.now(),
      hostSockets: new Set(),
      emptySince: null,
      participantSockets: new Map(),
      adminSockets: new Set(),
      lastSent: new Map(),
      flushQueued: false,
      screensSentAt: 0,
      screensStep: -1,
      screensTimer: null,
      recorder: this.options.database?.forRoom(code) ?? null,
      saveTimer: null,
    };
    entry.room.recorder = entry.recorder;
    entry.room.quizTitle = quiz.title;
    this.rooms.set(code, entry);
    this.attachAdmin(socket, entry);
    this.log(`[room ${code}] opened with "${quiz.title}" (${quiz.round1.length} + ${quiz.buzzer.length} questions)`);
    return code;
  }

  listRooms(): OpenRoomSummary[] {
    return [...this.rooms.values()]
      .sort((a, b) => b.openedAt - a.openedAt)
      .map((e) => ({
        roomCode: e.room.code,
        quizTitle: e.room.quizTitle,
        phase: e.room.adminView().phase,
        joined: e.room.adminView().counts.joined,
        openedAt: e.openedAt,
      }));
  }

  // ------------------------------------------------------------------ Host

  /** The projector: the room asked for, else the newest open room. */
  authHost(socket: GameSocket, pin: string, roomCode?: string): HostAuthResult {
    if (!this.checkPin(socket, pin)) return { ok: false, error: "wrong-pin" };
    const asked = roomCode ? this.rooms.get(normaliseCode(roomCode)) : undefined;
    const entry = asked ?? [...this.rooms.values()].sort((a, b) => b.openedAt - a.openedAt)[0];
    if (!entry) return { ok: false, error: "no-room" };
    this.detach(socket);
    socket.data = { roomCode: entry.room.code, role: "host", authed: true };
    entry.hostSockets.add(socket.id);
    entry.emptySince = null;
    entry.lastSent.delete(socket.id);
    entry.screensStep = -1;
    this.queueFlush(entry.room.code);
    return { ok: true, roomCode: entry.room.code };
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
    if ((this.failedPins.get(socket.id) ?? 0) >= PIN_ATTEMPTS) return { ok: false, error: "wrong-pin" };
    const entry = this.rooms.get(normaliseCode(roomCode));
    if (!entry) return { ok: false, error: "room-not-found" };
    if (!this.checkPin(socket, pin)) return { ok: false, error: "wrong-pin" };
    this.attachAdmin(socket, entry);
    return { ok: true, roomCode: entry.room.code };
  }

  private attachAdmin(socket: GameSocket, entry: RoomEntry) {
    this.detach(socket);
    entry.adminSockets.add(socket.id);
    entry.emptySince = null;
    entry.lastSent.delete(socket.id);
    entry.screensStep = -1;
    socket.data = { roomCode: entry.room.code, role: "admin", authed: true };
    this.queueFlush(entry.room.code);
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

  /** Forgets whatever room role this socket had (it's leaving, or taking a new role). Keeps `authed`. */
  private detach(socket: GameSocket) {
    const { roomCode, role, participantId, authed } = socket.data ?? {};
    const entry = roomCode ? this.rooms.get(roomCode) : undefined;
    socket.data = authed ? { authed } : {};
    if (!entry) return;
    entry.lastSent.delete(socket.id);
    if (role === "host") entry.hostSockets.delete(socket.id);
    if (role === "admin") entry.adminSockets.delete(socket.id);
    if (role === "participant" && participantId && entry.participantSockets.get(participantId) === socket.id) {
      entry.participantSockets.delete(participantId);
      entry.room.disconnect(participantId);
    }
    if (entry.hostSockets.size === 0 && entry.adminSockets.size === 0 && entry.emptySince === null) entry.emptySince = Date.now();
  }

  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.rooms) {
      if (entry.emptySince && now - entry.emptySince > ABANDONED_AFTER_MS) {
        this.closeRoom(code, "This quiz was closed because nobody was running it.");
      }
    }
  }

  /** Closes a room for good; false if there's no such room. */
  closeRoom(code: string, reason: string): boolean {
    const entry = this.rooms.get(code);
    if (!entry) return false;
    for (const socketId of [...entry.participantSockets.values(), ...entry.adminSockets, ...entry.hostSockets]) {
      this.io.to(socketId).emit("room:closed", { reason });
    }
    if (entry.screensTimer) clearTimeout(entry.screensTimer);
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.recorder?.save(entry.room.snapshot());
    entry.room.dispose();
    this.rooms.delete(code);
    this.log(`[room ${code}] closed: ${reason}`);
    return true;
  }

  closeAll() {
    clearInterval(this.sweeper);
    for (const code of [...this.rooms.keys()]) this.closeRoom(code, "The quiz server is shutting down.");
  }

  // ------------------------------------------------------------------ Sending views

  private queueFlush(code: string) {
    const entry = this.rooms.get(code);
    if (!entry) return;
    this.queueSave(entry);
    if (entry.flushQueued) return;
    entry.flushQueued = true;
    queueMicrotask(() => {
      entry.flushQueued = false;
      if (this.rooms.get(code) === entry) this.flush(entry);
    });
  }

  /** Saves the room to the database a little later (one write for a burst of changes). */
  private queueSave(entry: RoomEntry) {
    if (!entry.recorder || entry.saveTimer) return;
    entry.saveTimer = setTimeout(() => {
      entry.saveTimer = null;
      if (this.rooms.get(entry.room.code) === entry) entry.recorder?.save(entry.room.snapshot());
    }, SAVE_EVERY_MS);
    entry.saveTimer.unref?.();
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
    if (entry.hostSockets.size) {
      const view = entry.room.hostView();
      for (const socketId of entry.hostSockets) {
        if (this.isNew(entry, socketId, view)) this.io.to(socketId).emit("host:state", view);
      }
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
