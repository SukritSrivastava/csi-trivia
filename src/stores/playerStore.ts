"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { loadPlayerSession, saveLastName, savePlayerSession } from "@/lib/session";
import { JOIN_ERROR_MESSAGES, type PlayerView } from "@/shared/protocol";
import type { ConnectionStatus } from "./hostStore";

interface PlayerStore {
  status: ConnectionStatus;
  view: PlayerView | null;
  /** server clock − this device's clock */
  clockOffset: number;
  joining: boolean;
  /** Message on the join form (an error, or why you were sent back to it). */
  notice: string | null;
  /** True while trying to rejoin a saved session after a refresh. */
  resuming: boolean;
  /**
   * The option this phone tapped, shown as "Locked in" straight away, before
   * the server confirms. Option ids are new for every question, so a stale
   * one never matches the next question.
   */
  tapped: { optionId: string; text: string } | null;

  connect: () => () => void;
  join: (roomCode: string, name: string) => void;
  answer: (questionId: string, option: { id: string; text: string }) => void;
  predict: (finalistId: string) => void;
  buzz: () => void;
  leave: () => void;
}

export const usePlayerStore = create<PlayerStore>()((set, get) => ({
  status: "connecting",
  view: null,
  clockOffset: 0,
  joining: false,
  notice: null,
  resuming: false,
  tapped: null,

  connect: () => {
    const socket = getSocket();

    const onConnect = () => {
      set({ status: "online" });
      // Refresh, locked phone or Wi-Fi blip: quietly rejoin as the same player.
      const saved = loadPlayerSession();
      if (!saved) return;
      set({ resuming: true });
      socket.emit("player:join", { roomCode: saved.roomCode, name: "", playerId: saved.playerId }, (result) => {
        set({ resuming: false });
        if (!result.ok) {
          savePlayerSession(null);
          set({ view: null, notice: JOIN_ERROR_MESSAGES[result.error] ?? "That quiz has ended." });
        }
      });
    };
    const onDisconnect = () => set({ status: "offline" });
    const onConnectError = () => set({ status: "offline", resuming: false });
    const onState = (view: PlayerView) => set({ view, clockOffset: view.serverNow - Date.now() });
    const onClosed = ({ reason }: { reason: string }) => {
      savePlayerSession(null);
      set({ view: null, notice: reason });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("player:state", onState);
    socket.on("room:closed", onClosed);
    if (loadPlayerSession()) set({ resuming: true });
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
    const attempt = Date.now();
    getSocket().emit("player:join", { roomCode, name }, (result) => {
      set({ joining: false });
      if (result.ok) {
        savePlayerSession({ roomCode: result.roomCode, playerId: result.playerId });
        saveLastName(name.trim());
      } else {
        set({ notice: JOIN_ERROR_MESSAGES[result.error] });
      }
    });
    // If the game server can't be reached, the reply never comes. Don't leave the button stuck.
    window.setTimeout(() => {
      if (get().joining && Date.now() - attempt >= 8000) {
        set({ joining: false, notice: "Can't reach the quiz. Check your internet and try again." });
      }
    }, 8000);
  },

  answer: (questionId, option) => {
    if (get().tapped?.optionId === option.id) return;
    set({ tapped: { optionId: option.id, text: option.text } });
    getSocket().emit("player:answer", { questionId, optionId: option.id });
  },

  predict: (finalistId) => getSocket().emit("player:predict", { finalistId }),

  buzz: () => getSocket().emit("player:buzz"),

  leave: () => {
    savePlayerSession(null);
    set({ view: null, notice: null, tapped: null });
    // Reconnect fresh so the server forgets this socket's old seat.
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  },
}));
