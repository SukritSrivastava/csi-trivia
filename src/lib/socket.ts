"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/shared/protocol";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

const BOOT_KEY = "hermes:boot";
let restarted = false;

/**
 * True once this tab has seen the game server come back with a different
 * bootId (server:hello), i.e. it restarted and every room was lost. Survives a
 * refresh (sessionStorage remembers the last bootId this tab saw).
 */
export function serverRestarted(): boolean {
  return restarted;
}

/** A new room is up: stop saying the server restarted. */
export function clearServerRestarted() {
  restarted = false;
}

function noteBoot(bootId: string) {
  try {
    const last = sessionStorage.getItem(BOOT_KEY);
    if (last && last !== bootId) restarted = true;
    sessionStorage.setItem(BOOT_KEY, bootId);
  } catch {
    // Storage blocked: restarts are then reported as "room not found".
  }
}

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
    // Registered first, so every store's own listeners see the flag already set.
    socket.on("server:hello", ({ bootId }) => noteBoot(bootId));
    // Back on the network after a Wi-Fi drop: the old connection may look alive but
    // has missed updates. Reconnect now (the stores rejoin and get a fresh view)
    // instead of waiting up to 25 s for the ping to time out.
    window.addEventListener("online", () => {
      if (!socket?.connected) return;
      socket.disconnect();
      socket.connect();
    });
  }
  return socket;
}

/** A question image's address: uploaded ones ("/images/...") live on the game server, the rest on this site. */
export function assetUrl(path: string): string {
  return path.startsWith("/images/") ? `${gameServerUrl()}${path}` : path;
}
