"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { loadAdminSession, saveAdminSession } from "@/lib/session";
import type { AdminView } from "@/shared/protocol";
import type { ConnectionStatus } from "./hostStore";

interface AdminStore {
  status: ConnectionStatus;
  view: AdminView | null;
  clockOffset: number;
  error: string | null;
  connect: () => () => void;
  signIn: (roomCode: string, pin: string) => void;
  signOut: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  voidQuestion: () => void;
  restartRound: () => void;
  remove: (playerId: string) => void;
  judge: (correct: boolean) => void;
  downloadResults: () => void;
}

export const useAdminStore = create<AdminStore>()((set) => {
  const auth = (roomCode: string, pin: string) => {
    getSocket().emit("admin:auth", { roomCode: roomCode.trim().toUpperCase(), pin }, ({ ok }) => {
      if (ok) {
        saveAdminSession({ roomCode: roomCode.trim().toUpperCase(), pin });
        set({ error: null });
      } else {
        saveAdminSession(null);
        set({ view: null, error: "Wrong room code or PIN." });
      }
    });
  };

  return {
    status: "connecting",
    view: null,
    clockOffset: 0,
    error: null,

    connect: () => {
      const socket = getSocket();
      const onConnect = () => {
        set({ status: "online" });
        const saved = loadAdminSession();
        if (saved) auth(saved.roomCode, saved.pin);
      };
      const onDisconnect = () => set({ status: "offline" });
      const onState = (view: AdminView) => set({ view, clockOffset: view.serverNow - Date.now() });
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onDisconnect);
      socket.on("admin:state", onState);
      socket.connect();
      return () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onDisconnect);
        socket.off("admin:state", onState);
        socket.disconnect();
      };
    },

    signIn: (roomCode, pin) => auth(roomCode, pin),
    signOut: () => {
      saveAdminSession(null);
      set({ view: null });
      const socket = getSocket();
      socket.disconnect();
      socket.connect();
    },
    start: () => getSocket().emit("admin:start"),
    pause: () => getSocket().emit("admin:pause"),
    resume: () => getSocket().emit("admin:resume"),
    skip: () => getSocket().emit("admin:skip"),
    voidQuestion: () => getSocket().emit("admin:void"),
    restartRound: () => getSocket().emit("admin:restartRound"),
    remove: (playerId) => getSocket().emit("admin:remove", { playerId }),
    judge: (correct) => getSocket().emit("admin:judge", { correct }),
    downloadResults: () =>
      getSocket().emit("admin:results", (csv) => {
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "hermes-quiz-results.csv";
        a.click();
        URL.revokeObjectURL(url);
      }),
  };
});
