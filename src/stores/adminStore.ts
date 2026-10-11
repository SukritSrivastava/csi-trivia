"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { loadAdminSession, saveAdminSession } from "@/lib/session";
import {
  ADMIN_AUTH_ERROR_MESSAGES,
  type AdminAction,
  type AdminActionType,
  type AdminView,
  type CommandResult,
} from "@/shared/protocol";
import type { ConnectionStatus } from "./hostStore";

/** A second tap of the same command within this window is ignored (double taps). */
const DOUBLE_TAP_MS = 600;
const COMMAND_TIMEOUT_MS = 5000;

/** The server's reply, or what happened on this side: ignored double tap, or no reply in time. */
export type SendResult = CommandResult | { ok: false; reason: "double-tap" | "no-reply" };

interface AdminStore {
  status: ConnectionStatus;
  view: AdminView | null;
  /** server clock − this device's clock */
  clockOffset: number;
  /** Sign-in error, shown on the sign-in form. */
  error: string | null;
  signingIn: boolean;
  /** A command waiting for the server's reply (disable buttons meanwhile). */
  pending: AdminActionType | null;
  /** The last command's reply, e.g. to show "That step already moved on". */
  lastResult: { action: AdminActionType; result: SendResult } | null;

  connect: () => () => void;
  signIn: (roomCode: string, pin: string) => void;
  signOut: () => void;
  /** Sends a command from the step currently on screen. */
  send: (action: AdminAction) => Promise<SendResult>;
  downloadResults: () => void;
}

export const useAdminStore = create<AdminStore>()((set, get) => {
  let lastSent: { type: AdminActionType; at: number } | null = null;

  const auth = (roomCode: string, pin: string, quiet = false) => {
    const code = roomCode.trim().toUpperCase();
    set({ signingIn: true, error: quiet ? get().error : null });
    getSocket().emit("admin:auth", { roomCode: code, pin }, (result) => {
      set({ signingIn: false });
      if (result.ok) {
        saveAdminSession({ roomCode: result.roomCode, pin });
        set({ error: null });
      } else {
        saveAdminSession(null);
        set({
          view: null,
          error:
            result.error === "room-not-found" && quiet
              ? "That quiz no longer exists (the quiz server may have restarted). Sign in with the new room code."
              : ADMIN_AUTH_ERROR_MESSAGES[result.error],
        });
      }
    });
  };

  return {
    status: "connecting",
    view: null,
    clockOffset: 0,
    error: null,
    signingIn: false,
    pending: null,
    lastResult: null,

    connect: () => {
      const socket = getSocket();
      const onConnect = () => {
        set({ status: "online" });
        // After a refresh or a dropped connection, sign straight back in.
        const saved = loadAdminSession();
        if (saved) auth(saved.roomCode, saved.pin, true);
      };
      const onDisconnect = () => set({ status: "offline", pending: null });
      const onState = (view: AdminView) => set({ view, clockOffset: view.serverNow - Date.now() });
      const onClosed = ({ reason }: { reason: string }) => {
        saveAdminSession(null);
        set({ view: null, error: reason });
      };
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onDisconnect);
      socket.on("admin:state", onState);
      socket.on("room:closed", onClosed);
      socket.connect();
      return () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onDisconnect);
        socket.off("admin:state", onState);
        socket.off("room:closed", onClosed);
        socket.disconnect();
      };
    },

    signIn: (roomCode, pin) => auth(roomCode, pin),

    signOut: () => {
      saveAdminSession(null);
      set({ view: null, error: null });
      const socket = getSocket();
      socket.disconnect();
      socket.connect();
    },

    send: (action) =>
      new Promise<SendResult>((resolve) => {
        const view = get().view;
        const now = Date.now();
        if (!view) return resolve({ ok: false, reason: "not-signed-in" });
        if (lastSent && lastSent.type === action.type && now - lastSent.at < DOUBLE_TAP_MS) {
          return resolve({ ok: false, reason: "double-tap" }); // ignore quietly
        }
        lastSent = { type: action.type, at: now };
        set({ pending: action.type });
        let done = false;
        const finish = (result: SendResult) => {
          if (done) return;
          done = true;
          set({ pending: null, lastResult: { action: action.type, result } });
          resolve(result);
        };
        getSocket().emit("admin:command", { stepId: view.stepId, action }, finish);
        window.setTimeout(() => finish({ ok: false, reason: "no-reply" }), COMMAND_TIMEOUT_MS);
      }),

    downloadResults: () =>
      getSocket().emit("admin:results", (result) => {
        if (!result) return;
        const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename;
        a.click();
        URL.revokeObjectURL(url);
      }),
  };
});
