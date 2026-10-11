"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { loadPlayerSession, saveLastName, savePlayerSession } from "@/lib/session";
import { JOIN_ERROR_MESSAGES, type PlayerView } from "@/shared/protocol";
import type { ConnectionStatus } from "./hostStore";

interface PlayerStore {
  status: ConnectionStatus;
  view: PlayerView | null;
  clockOffset: number;
  joining: boolean;
  /** Shown on the join form. */
  notice: string | null;

  /** Optimistic UI: what this phone already sent, so it can move on before the server replies. */
  sentPromptId: string | null;
  votedFor: string | null;

  connect: () => () => void;
  join: (roomCode: string, name: string) => void;
  answer: (promptId: string, text: string) => void;
  vote: (answerId: string) => void;
  start: () => void;
  restart: () => void;
  leave: () => void;
}

export const usePlayerStore = create<PlayerStore>()((set, get) => ({
  status: "connecting",
  view: null,
  clockOffset: 0,
  joining: false,
  notice: null,
  sentPromptId: null,
  votedFor: null,

  connect: () => {
    const socket = getSocket();

    const onConnect = () => {
      set({ status: "online" });
      // Phone locked, Wi-Fi blipped or page refreshed: quietly rejoin as the same player.
      const saved = loadPlayerSession();
      if (!saved) return;
      socket.emit("player:join", { roomCode: saved.roomCode, name: "", playerId: saved.playerId }, (result) => {
        if (!result.ok) {
          savePlayerSession(null);
          set({ view: null, notice: "That game has ended. Join a new one." });
        }
      });
    };
    const onDisconnect = () => set({ status: "offline" });
    const onConnectError = () => set({ status: "offline" });
    const onState = (view: PlayerView) =>
      set({ view, clockOffset: view.serverNow - Date.now() });
    const onClosed = ({ reason }: { reason: string }) => {
      savePlayerSession(null);
      set({ view: null, notice: reason });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("player:state", onState);
    socket.on("room:closed", onClosed);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("player:state", onState);
      socket.off("room:closed", onClosed);
      socket.disconnect();
    };
  },

  join: (roomCode, name) => {
    if (get().joining) return;
    set({ joining: true, notice: null });
    getSocket().emit("player:join", { roomCode, name }, (result) => {
      set({ joining: false });
      if (result.ok) {
        savePlayerSession({ roomCode: result.roomCode, playerId: result.playerId });
        saveLastName(name.trim());
      } else {
        set({ notice: JOIN_ERROR_MESSAGES[result.error] });
      }
    });
    // If the game server isn't reachable, the ack never comes. Don't leave the button stuck.
    window.setTimeout(() => {
      if (get().joining) {
        set({ joining: false, notice: "Can't reach the game. Check you're on the same Wi-Fi as the TV." });
      }
    }, 8000);
  },

  answer: (promptId, text) => {
    set({ sentPromptId: promptId });
    getSocket().emit("player:answer", { promptId, text });
  },

  vote: (answerId) => {
    set({ votedFor: answerId });
    getSocket().emit("player:vote", { answerId });
  },

  start: () => getSocket().emit("player:start"),
  restart: () => getSocket().emit("player:restart"),

  leave: () => {
    savePlayerSession(null);
    set({ view: null, notice: null });
    // Reconnect fresh so the server forgets this socket's old seat.
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  },
}));
