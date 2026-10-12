"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/shared/protocol";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/**
 * Where the game server lives. By default it's the same computer that served
 * this page, on port 3001, so a phone that opened http://192.168.1.5:3000
 * talks to http://192.168.1.5:3001 without any setup.
 */
export function gameServerUrl(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:3001`;
}

/** One shared connection per browser tab. */
export function getSocket(): GameSocket {
  if (!socket) {
    socket = io(gameServerUrl(), {
      autoConnect: false,
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 3000,
    });
  }
  return socket;
}

/** A question image's address: uploaded ones ("/images/...") live on the game server, the rest on this site. */
export function assetUrl(path: string): string {
  return path.startsWith("/images/") ? `${gameServerUrl()}${path}` : path;
}
