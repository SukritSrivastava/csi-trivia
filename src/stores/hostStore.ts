"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { loadHostSession, saveHostSession } from "@/lib/session";
import type { HostView } from "@/shared/protocol";

export type ConnectionStatus = "connecting" | "online" | "offline";

/** signedOut: asking for the PIN · waiting: signed in, no room open yet · showing: a room's view is up */
export type HostStage = "signedOut" | "waiting" | "showing";

/** While waiting for Admin to open a room, ask again this often. */
const WAIT_RETRY_MS = 3000;

interface HostStore {
  status: ConnectionStatus;
  stage: HostStage;
  view: HostView | null;
  /** server clock − this device's clock */
  clockOffset: number;
  /** Sign-in error, shown on the PIN screen. */
  error: string | null;
  signingIn: boolean;
  /** Opens the connection; signs back in after a refresh. Returns a cleanup function. */
  connect: () => () => void;
  signIn: (pin: string) => void;
  signOut: () => void;
}

export const useHostStore = create<HostStore>()((set, get) => {
  let retry: number | null = null;
  const clearRetry = () => {
    if (retry !== null) window.clearTimeout(retry);
    retry = null;
  };

  /** Signs in and shows `roomCode` (if still open) or the newest open room. */
  const auth = (pin: string, roomCode?: string) => {
    clearRetry();
    set({ signingIn: true });
    getSocket().emit("host:auth", { pin, roomCode }, (result) => {
      set({ signingIn: false });
      if (result.ok) {
        saveHostSession({ pin, roomCode: result.roomCode });
        set({ stage: "showing", error: null });
      } else if (result.error === "no-room") {
        saveHostSession({ pin });
        set({ stage: "waiting", view: null, error: null });
        retry = window.setTimeout(() => auth(pin), WAIT_RETRY_MS);
      } else {
        saveHostSession(null);
        set({ stage: "signedOut", view: null, error: "Wrong PIN." });
      }
    });
  };

  return {
    status: "connecting",
    stage: "signedOut",
    view: null,
    clockOffset: 0,
    error: null,
    signingIn: false,

    connect: () => {
      const socket = getSocket();
      const onConnect = () => {
        set({ status: "online" });
        // After a refresh or a dropped connection, show the same room again.
        const saved = loadHostSession();
        if (saved) auth(saved.pin, saved.roomCode);
      };
      const onDisconnect = () => {
        clearRetry();
        set({ status: "offline" });
      };
      const onState = (view: HostView) => set({ view, stage: "showing", clockOffset: view.serverNow - Date.now() });
      const onClosed = () => {
        // That room is gone: wait for (or show) the next one.
        const saved = loadHostSession();
        set({ view: null });
        if (saved) auth(saved.pin);
      };

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onDisconnect);
      socket.on("host:state", onState);
      socket.on("room:closed", onClosed);
      socket.connect();

      return () => {
        clearRetry();
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onDisconnect);
        socket.off("host:state", onState);
        socket.off("room:closed", onClosed);
        socket.disconnect();
      };
    },

    signIn: (pin) => {
      if (get().status === "online") auth(pin.trim());
    },

    signOut: () => {
      clearRetry();
      saveHostSession(null);
      set({ stage: "signedOut", view: null, error: null });
      const socket = getSocket();
      socket.disconnect();
      socket.connect();
    },
  };
});
