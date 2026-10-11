/**
 * Glue between Socket.IO and the game: keeps track of which socket belongs to
 * which room and player, and pushes fresh views after every change.
 */
import type { Server, Socket } from "socket.io";
import {
  type ClientToServerEvents,
  type CreateRoomResult,
  type JoinResult,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomSettings,
  type ServerToClientEvents,
} from "../src/shared/protocol";
import { Room } from "./game";

interface SocketData {
  roomCode?: string;
  role?: "host" | "member";
  memberId?: string;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface RoomEntry {
  room: Room;
  hostSocketId: string | null;
  hostLeftAt: number | null;
  /** memberId → the socket currently speaking for that player/audience member */
  memberSockets: Map<string, string>;
  flushQueued: boolean;
}

/** Rooms with no TV connected for this long are deleted. */
const ABANDONED_AFTER_MS = 15 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, RoomEntry>();

  constructor(
    private readonly io: GameServer,
    private readonly joinUrl: string,
  ) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  // ---------------------------------------------------------------- TV

  createRoom(socket: GameSocket): CreateRoomResult {
    // "New room code" on a TV that already had a room: close the old one.
    const previous = socket.data?.role === "host" ? socket.data.roomCode : undefined;
    if (previous && this.rooms.get(previous)?.hostSocketId === socket.id) {
      this.closeRoom(previous, "The TV started a new room. Join with the new code.");
    }

    const code = this.newCode();
    const entry: RoomEntry = {
      room: new Room(code, this.joinUrl, () => this.queueFlush(code)),
      hostSocketId: socket.id,
      hostLeftAt: null,
      memberSockets: new Map(),
      flushQueued: false,
    };
    this.rooms.set(code, entry);
    socket.data = { roomCode: code, role: "host" };
    this.queueFlush(code);
    console.log(`[room ${code}] created`);
    return { roomCode: code, hostToken: entry.room.hostToken };
  }

  resumeHost(socket: GameSocket, roomCode: string, hostToken: string): boolean {
    const entry = this.rooms.get(roomCode?.toUpperCase());
    if (!entry || entry.room.hostToken !== hostToken) return false;
    entry.hostSocketId = socket.id;
    entry.hostLeftAt = null;
    socket.data = { roomCode: entry.room.code, role: "host" };
    this.queueFlush(entry.room.code);
    return true;
  }

  updateSettings(socket: GameSocket, settings: Partial<RoomSettings>) {
    this.hostRoom(socket)?.updateSettings(settings ?? {});
  }

  skip(socket: GameSocket) {
    this.hostRoom(socket)?.skip();
  }

  // ---------------------------------------------------------------- Phones

  join(
    socket: GameSocket,
    payload: { roomCode: string; name: string; playerId?: string },
  ): JoinResult {
    const code = String(payload?.roomCode ?? "").trim().toUpperCase();
    const entry = this.rooms.get(code);
    if (!entry) return { ok: false, error: "room-not-found" };

    const existingId = typeof payload.playerId === "string" ? payload.playerId : undefined;
    const result = entry.room.join(String(payload.name ?? ""), existingId);
    if (result.ok) {
      entry.memberSockets.set(result.playerId, socket.id);
      socket.data = { roomCode: code, role: "member", memberId: result.playerId };
      this.queueFlush(code);
    }
    return result;
  }

  start(socket: GameSocket) {
    const m = this.member(socket);
    m?.room.start(m.id);
  }

  restart(socket: GameSocket) {
    const m = this.member(socket);
    m?.room.restart(m.id);
  }

  answer(socket: GameSocket, payload: { promptId: string; text: string }) {
    const m = this.member(socket);
    if (!m || typeof payload?.promptId !== "string" || typeof payload?.text !== "string") return;
    m.room.submitAnswer(m.id, payload.promptId, payload.text);
  }

  vote(socket: GameSocket, payload: { answerId: string }) {
    const m = this.member(socket);
    if (!m || typeof payload?.answerId !== "string") return;
    m.room.vote(m.id, payload.answerId);
  }

  // ---------------------------------------------------------------- Lifecycle

  disconnect(socket: GameSocket) {
    const { roomCode, role, memberId } = socket.data ?? {};
    const entry = roomCode ? this.rooms.get(roomCode) : undefined;
    if (!entry) return;

    if (role === "host" && entry.hostSocketId === socket.id) {
      entry.hostSocketId = null;
      entry.hostLeftAt = Date.now();
      console.log(`[room ${roomCode}] TV disconnected`);
    }
    // Only mark a player offline if this socket is still the one speaking for them
    // (after a refresh, the new socket may already have taken over).
    if (role === "member" && memberId && entry.memberSockets.get(memberId) === socket.id) {
      entry.memberSockets.delete(memberId);
      entry.room.disconnect(memberId);
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [code, entry] of this.rooms) {
      if (entry.hostLeftAt && now - entry.hostLeftAt > ABANDONED_AFTER_MS) {
        this.closeRoom(code, "The TV left the game.");
      }
    }
  }

  private closeRoom(code: string, reason: string) {
    const entry = this.rooms.get(code);
    if (!entry) return;
    for (const socketId of entry.memberSockets.values()) {
      this.io.to(socketId).emit("room:closed", { reason });
    }
    entry.room.dispose();
    this.rooms.delete(code);
    console.log(`[room ${code}] closed: ${reason}`);
  }

  // ---------------------------------------------------------------- Helpers

  private hostRoom(socket: GameSocket): Room | undefined {
    const entry = socket.data?.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    if (!entry || entry.hostSocketId !== socket.id) return undefined;
    return entry.room;
  }

  private member(socket: GameSocket): { room: Room; id: string } | undefined {
    const { roomCode, role, memberId } = socket.data ?? {};
    if (role !== "member" || !roomCode || !memberId) return undefined;
    const entry = this.rooms.get(roomCode);
    if (!entry || entry.memberSockets.get(memberId) !== socket.id) return undefined;
    return { room: entry.room, id: memberId };
  }

  /** Several changes can happen in one tick; send views once at the end. */
  private queueFlush(code: string) {
    const entry = this.rooms.get(code);
    if (!entry || entry.flushQueued) return;
    entry.flushQueued = true;
    queueMicrotask(() => {
      entry.flushQueued = false;
      this.flush(entry);
    });
  }

  private flush(entry: RoomEntry) {
    if (entry.hostSocketId) {
      this.io.to(entry.hostSocketId).emit("host:state", entry.room.hostView());
    }
    for (const [memberId, socketId] of entry.memberSockets) {
      const view = entry.room.playerView(memberId);
      if (view) this.io.to(socketId).emit("player:state", view);
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
