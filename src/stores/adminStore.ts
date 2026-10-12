"use client";

import { create } from "zustand";
import { gameServerUrl, getSocket } from "@/lib/socket";
import { loadAdminSession, saveAdminSession } from "@/lib/session";
import {
  ADMIN_AUTH_ERROR_MESSAGES,
  type AdminAction,
  type AdminActionType,
  type AdminView,
  type CommandResult,
  IMAGE_PIN_HEADER,
  IMAGE_UPLOAD_PATH,
  type OpenRoomResult,
  type OpenRoomSummary,
  type Quiz,
  type QuizSummary,
  type SaveQuizResult,
} from "@/shared/protocol";
import type { ConnectionStatus } from "./hostStore";

/** A second tap of the same command within this window is ignored (double taps). */
const DOUBLE_TAP_MS = 600;
/**
 * The big button and the judge buttons: a double tap on these is ignored even
 * if the button's command changed between the taps (the next step arrived).
 */
const THUMB_ACTIONS: readonly AdminActionType[] = [
  "startQuiz",
  "showQuestion",
  "revealAnswer",
  "showResults",
  "showLeaderboard",
  "nextQuestion",
  "endRound1",
  "openPredictions",
  "startBuzzerRound",
  "showScores",
  "startSuddenDeath",
  "showWinner",
  "markCorrect",
  "markWrong",
];
const COMMAND_TIMEOUT_MS = 5000;
const LIBRARY_TIMEOUT_MS = 10_000;

/** The server's reply, or what happened on this side: ignored double tap, or no reply in time. */
export type SendResult = CommandResult | { ok: false; reason: "double-tap" | "no-reply" };

interface AdminStore {
  status: ConnectionStatus;
  /** Passed the PIN: the home screen (rooms + quiz library) is available. */
  signedIn: boolean;
  /** The room being run, or null on the home screen. */
  view: AdminView | null;
  /** server clock − this device's clock */
  clockOffset: number;
  /** Sign-in error (PIN screen) or why we're back on the home screen (room closed). */
  error: string | null;
  signingIn: boolean;
  /** A command waiting for the server's reply (disable buttons meanwhile). */
  pending: AdminActionType | null;
  /** The last command's reply, e.g. to show "That step already moved on". */
  lastResult: { action: AdminActionType; result: SendResult } | null;

  connect: () => () => void;
  /** PIN, and optionally a room to go straight into (from /admin?code=ABCD). */
  signIn: (pin: string, roomCode?: string) => void;
  signOut: () => void;
  /** Run an open room (a second Admin device, or after leaving it). */
  joinRoom: (roomCode: string) => Promise<boolean>;
  /** Back to the home screen; the room keeps running. */
  leaveRoom: () => void;
  /** Sends a command (with the stepId of the view the button was drawn from). */
  send: (action: AdminAction, stepId?: number) => Promise<SendResult>;
  downloadResults: () => void;

  // ---- home screen and quiz library (null / failed result when not signed in or no reply)
  listRooms: () => Promise<OpenRoomSummary[] | null>;
  openRoom: (quizId: string) => Promise<OpenRoomResult>;
  /** Closes a room for good (everyone in it is told). */
  closeRoom: (roomCode: string) => Promise<boolean>;
  listQuizzes: () => Promise<QuizSummary[] | null>;
  getQuiz: (id: string) => Promise<Quiz | null>;
  createQuiz: (title: string) => Promise<SaveQuizResult>;
  duplicateQuiz: (id: string) => Promise<SaveQuizResult>;
  saveQuiz: (quiz: Quiz) => Promise<SaveQuizResult>;
  deleteQuiz: (id: string) => Promise<boolean>;
  /** Uploads an (already shrunk) image; resolves to its path ("/images/…") or throws a readable message. */
  uploadImage: (image: Blob) => Promise<string>;
}

/** Emits with an ack, resolving `fallback` if no reply comes in time. */
function ask<T>(fallback: T, emit: (ack: (r: T) => void) => void): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: T) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    emit(finish);
    window.setTimeout(() => finish(fallback), LIBRARY_TIMEOUT_MS);
  });
}

export const useAdminStore = create<AdminStore>()((set, get) => {
  let lastSent: { type: AdminActionType; at: number; thumb: boolean } | null = null;
  const socket = () => getSocket();

  const enterRoom = (pin: string, roomCode: string, quiet: boolean) =>
    new Promise<boolean>((resolve) => {
      socket().emit("admin:auth", { roomCode: roomCode.trim().toUpperCase(), pin }, (result) => {
        if (result.ok) {
          saveAdminSession({ pin, roomCode: result.roomCode });
          set({ error: null });
          resolve(true);
        } else {
          saveAdminSession({ pin });
          set({
            view: null,
            error:
              result.error === "room-not-found"
                ? quiet
                  ? "That room is no longer open (the game server may have restarted). Open it again from a quiz."
                  : ADMIN_AUTH_ERROR_MESSAGES["room-not-found"]
                : ADMIN_AUTH_ERROR_MESSAGES[result.error],
          });
          resolve(false);
        }
      });
    });

  const login = (pin: string, roomCode: string | undefined, quiet: boolean) => {
    set({ signingIn: true, error: quiet ? get().error : null });
    socket().emit("admin:login", { pin }, (result) => {
      if (!result.ok) {
        saveAdminSession(null);
        set({ signingIn: false, signedIn: false, view: null, error: ADMIN_AUTH_ERROR_MESSAGES["wrong-pin"] });
        return;
      }
      saveAdminSession({ pin, roomCode });
      set({ signedIn: true });
      if (roomCode) void enterRoom(pin, roomCode, quiet).then(() => set({ signingIn: false }));
      else set({ signingIn: false });
    });
  };

  return {
    status: "connecting",
    signedIn: false,
    view: null,
    clockOffset: 0,
    error: null,
    signingIn: false,
    pending: null,
    lastResult: null,

    connect: () => {
      const s = socket();
      const onConnect = () => {
        set({ status: "online" });
        // After a refresh or a dropped connection, sign straight back in (and into the room).
        const saved = loadAdminSession();
        if (saved) login(saved.pin, saved.roomCode, true);
      };
      const onDisconnect = () => set({ status: "offline", pending: null });
      const onState = (view: AdminView) => set({ view, clockOffset: view.serverNow - Date.now() });
      const onClosed = ({ reason }: { reason: string }) => {
        const saved = loadAdminSession();
        if (saved) saveAdminSession({ pin: saved.pin });
        set({ view: null, error: reason });
      };
      s.on("connect", onConnect);
      s.on("disconnect", onDisconnect);
      s.on("connect_error", onDisconnect);
      s.on("admin:state", onState);
      s.on("room:closed", onClosed);
      s.connect();
      return () => {
        s.off("connect", onConnect);
        s.off("disconnect", onDisconnect);
        s.off("connect_error", onDisconnect);
        s.off("admin:state", onState);
        s.off("room:closed", onClosed);
        s.disconnect();
      };
    },

    signIn: (pin, roomCode) => login(pin.trim(), roomCode?.trim().toUpperCase() || undefined, false),

    signOut: () => {
      saveAdminSession(null);
      set({ signedIn: false, view: null, error: null });
      const s = socket();
      s.disconnect();
      s.connect();
    },

    joinRoom: async (roomCode) => {
      const saved = loadAdminSession();
      if (!saved) return false;
      return enterRoom(saved.pin, roomCode, false);
    },

    leaveRoom: () => {
      const saved = loadAdminSession();
      if (saved) saveAdminSession({ pin: saved.pin });
      set({ view: null, error: null, lastResult: null });
      // A fresh connection drops the room role; the PIN is re-sent on connect.
      const s = socket();
      s.disconnect();
      s.connect();
    },

    send: (action, stepId) =>
      new Promise<SendResult>((resolve) => {
        const view = get().view;
        const now = Date.now();
        if (!view) return resolve({ ok: false, reason: "not-signed-in" });
        // A second tap within 600 ms is ignored: the same command, or any big/judge
        // button (so "Reveal answer" tapped twice can't turn into "Show results"
        // when the new step arrives between the taps).
        const thumb = THUMB_ACTIONS.includes(action.type);
        if (lastSent && now - lastSent.at < DOUBLE_TAP_MS && (lastSent.type === action.type || (thumb && lastSent.thumb))) {
          return resolve({ ok: false, reason: "double-tap" }); // ignore quietly
        }
        lastSent = { type: action.type, at: now, thumb };
        set({ pending: action.type });
        let done = false;
        const finish = (result: SendResult) => {
          if (done) return;
          done = true;
          set({ pending: null, lastResult: { action: action.type, result } });
          resolve(result);
        };
        socket().emit("admin:command", { stepId: stepId ?? view.stepId, action }, finish);
        window.setTimeout(() => finish({ ok: false, reason: "no-reply" }), COMMAND_TIMEOUT_MS);
      }),

    downloadResults: () =>
      socket().emit("admin:results", (result) => {
        if (!result) return;
        const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename;
        a.click();
        URL.revokeObjectURL(url);
      }),

    listRooms: () => ask<OpenRoomSummary[] | null>(null, (ack) => socket().emit("admin:rooms", ack)),
    openRoom: (quizId) =>
      ask<OpenRoomResult>({ ok: false, error: "not-signed-in" }, (ack) =>
        socket().emit("admin:openRoom", { quizId }, (result) => {
          if (result.ok) {
            const saved = loadAdminSession();
            if (saved) saveAdminSession({ pin: saved.pin, roomCode: result.roomCode });
            set({ error: null });
          }
          ack(result);
        }),
      ),
    closeRoom: async (roomCode) => (await ask<{ ok: boolean }>({ ok: false }, (ack) => socket().emit("admin:closeRoom", { roomCode }, ack))).ok,
    listQuizzes: () => ask<QuizSummary[] | null>(null, (ack) => socket().emit("library:list", ack)),
    getQuiz: (id) => ask<Quiz | null>(null, (ack) => socket().emit("library:get", { id }, ack)),
    createQuiz: (title) => ask<SaveQuizResult>({ ok: false, error: "not-signed-in" }, (ack) => socket().emit("library:create", { title }, ack)),
    duplicateQuiz: (id) => ask<SaveQuizResult>({ ok: false, error: "not-signed-in" }, (ack) => socket().emit("library:duplicate", { id }, ack)),
    saveQuiz: (quiz) => ask<SaveQuizResult>({ ok: false, error: "not-signed-in" }, (ack) => socket().emit("library:save", quiz, ack)),
    deleteQuiz: async (id) => (await ask<{ ok: boolean }>({ ok: false }, (ack) => socket().emit("library:delete", { id }, ack))).ok,

    uploadImage: async (image) => {
      const pin = loadAdminSession()?.pin ?? "";
      let res: Response;
      try {
        res = await fetch(`${gameServerUrl()}${IMAGE_UPLOAD_PATH}`, {
          method: "POST",
          headers: { "content-type": image.type || "application/octet-stream", [IMAGE_PIN_HEADER]: pin },
          body: image,
        });
      } catch {
        throw new Error("Couldn't reach the game server to upload the image.");
      }
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "The image upload failed.");
      return body.url;
    },
  };
});
