/**
 * Glue between Socket.IO and the quiz: which socket belongs to which room and
 * player, organiser sign-in, and pushing fresh views after every change.
 */
import type { Server, Socket } from "socket.io";
import {
  type AdminView,
  type ClientToServerEvents,
  type HostView,
  type JoinResult,
  type PlayerView,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerToClientEvents,
} from "../src/shared/protocol";
import type { GameConfig } from "./config";
import { loadQuestions } from "./questions";
import { QuizRoom } from "./quiz";

interface SocketData {
  roomCode?: string;
  role?: "host" | "member" | "admin";
  memberId?: string;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface RoomEntry {
  room: QuizRoom;
  hostSocketId: string | null;
  hostLeftAt: number | null;
  memberSockets: Map<string, string>;
  adminSockets: Set<string>;
  /** Last view sent to each socket, so unchanged views aren't resent to 100 phones. */
  lastSent: Map<string, string>;
  flushQueued: boolean;
}

const ABANDONED_AFTER_MS = 30 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, RoomEntry>();

  constructor(
    private readonly io: GameServer,
    private readonly joinUrl: string,
    private readonly config: GameConfig,
    private readonly adminPin: string,
  ) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  // ------------------------------------------------------------------ Projector

  createRoom(socket: GameSocket) {
    const previous = socket.data?.role === "host" ? socket.data.roomCode : undefined;
    if (previous && this.rooms.get(previous)?.hostSocketId === socket.id) {
      this.closeRoom(previous, "The projector started a new quiz. Join with the new code.");
    }
    const code = this.newCode();
    const questions = loadQuestions(); // re-read each time, so edits apply to the next room
    const entry: RoomEntry = {
      room: new QuizRoom(code, this.joinUrl, this.config, questions, () => this.queueFlush(code)),
      hostSocketId: socket.id,
      hostLeftAt: null,
      memberSockets: new Map(),
      adminSockets: new Set(),
      lastSent: new Map(),
      flushQueued: false,
    };
    this.rooms.set(code, entry);
    socket.data = { roomCode: code, role: "host" };
    this.queueFlush(code);
    console.log(`[room ${code}] created (${this.config.name} preset, ${questions.length} questions)`);
    return { roomCode: code, hostToken: entry.room.hostToken };
  }

  resumeHost(socket: GameSocket, roomCode: string, hostToken: string) {
    const entry = this.rooms.get(roomCode.toUpperCase());
    if (!entry || entry.room.hostToken !== hostToken) return false;
    entry.hostSocketId = socket.id;
    entry.hostLeftAt = null;
    entry.lastSent.delete(socket.id);
    socket.data = { roomCode: entry.room.code, role: "host" };
    this.queueFlush(entry.room.code);
    return true;
  }

  // ------------------------------------------------------------------ Phones

  join(socket: GameSocket, payload: { roomCode: string; name: string; playerId?: string }): JoinResult {
    const code = String(payload?.roomCode ?? "").trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) return { ok: false, error: "room-not-found" };
    const existingId = typeof payload.playerId === "string" ? payload.playerId : undefined;
    const result = entry.room.join(String(payload.name ?? ""), existingId);
    if (result.ok) {
      entry.memberSockets.set(result.playerId, socket.id);
      entry.lastSent.delete(socket.id);
      socket.data = { roomCode: code, role: "member", memberId: result.playerId };
      this.queueFlush(code);
    }
    return result;
  }

  /** Runs `fn` with the room and player this socket speaks for. */
  asMember(socket: GameSocket, fn: (room: QuizRoom, playerId: string) => void) {
    const { roomCode, role, memberId } = socket.data ?? {};
    if (role !== "member" || !roomCode || !memberId) return;
    const entry = this.rooms.get(roomCode);
    if (!entry || entry.memberSockets.get(memberId) !== socket.id) return;
    fn(entry.room, memberId);
  }

  // ------------------------------------------------------------------ Organiser

  authAdmin(socket: GameSocket, roomCode: string, pin: string) {
    const entry = this.rooms.get(roomCode.trim().toUpperCase());
    if (!entry || pin !== this.adminPin) return false;
    entry.adminSockets.add(socket.id);
    entry.lastSent.delete(socket.id);
    socket.data = { roomCode: entry.room.code, role: "admin" };
    this.queueFlush(entry.room.code);
    return true;
  }

  asAdmin(socket: GameSocket, fn: (room: QuizRoom) => void) {
    const { roomCode, role } = socket.data ?? {};
    if (role !== "admin" || !roomCode) return;
    const entry = this.rooms.get(roomCode);
    if (!entry || !entry.adminSockets.has(socket.id)) return;
    fn(entry.room);
  }

  // ------------------------------------------------------------------ Lifecycle

  disconnect(socket: GameSocket) {
    const { roomCode, role, memberId } = socket.data ?? {};
    const entry = roomCode ? this.rooms.get(roomCode) : undefined;
    if (!entry) return;
    entry.lastSent.delete(socket.id);
    if (role === "host" && entry.hostSocketId === socket.id) {
      entry.hostSocketId = null;
      entry.hostLeftAt = Date.now();
    }
    if (role === "admin") entry.adminSockets.delete(socket.id);
    if (role === "member" && memberId && entry.memberSockets.get(memberId) === socket.id) {
      entry.memberSockets.delete(memberId);
      entry.room.disconnect(memberId);
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.rooms) {
      if (entry.hostLeftAt && now - entry.hostLeftAt > ABANDONED_AFTER_MS) {
        this.closeRoom(code, "The projector left the quiz.");
      }
    }
  }

  private closeRoom(code: string, reason: string) {
    const entry = this.rooms.get(code);
    if (!entry) return;
    for (const socketId of entry.memberSockets.values()) this.io.to(socketId).emit("room:closed", { reason });
    entry.room.dispose();
    this.rooms.delete(code);
    console.log(`[room ${code}] closed: ${reason}`);
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

  private flush(entry: RoomEntry) {
    /** True if this view differs from the last one sent to that socket. */
    const isNew = (socketId: string, view: HostView | PlayerView | AdminView) => {
      // serverNow changes on every call, so compare without it.
      const key = JSON.stringify({ ...view, serverNow: 0 });
      if (entry.lastSent.get(socketId) === key) return false;
      entry.lastSent.set(socketId, key);
      return true;
    };
    if (entry.hostSocketId) {
      const view = entry.room.hostView();
      if (isNew(entry.hostSocketId, view)) this.io.to(entry.hostSocketId).emit("host:state", view);
    }
    for (const [memberId, socketId] of entry.memberSockets) {
      const view = entry.room.playerView(memberId);
      if (view && isNew(socketId, view)) this.io.to(socketId).emit("player:state", view);
    }
    if (entry.adminSockets.size) {
      const view = entry.room.adminView();
      for (const socketId of entry.adminSockets) {
        if (isNew(socketId, view)) this.io.to(socketId).emit("admin:state", view);
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
