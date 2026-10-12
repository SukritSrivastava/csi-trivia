"use client";

import { create } from "zustand";
import { clearServerRestarted, getSocket, serverRestarted } from "@/lib/socket";
import { loadParticipantSession, saveLastName, saveParticipantSession } from "@/lib/session";
import { BOT_ERROR_MESSAGES, type BotLook, JOIN_ERROR_MESSAGES, type ParticipantView, SERVER_RESTARTED_MESSAGE } from "@/shared/protocol";
import type { ConnectionStatus } from "./hostStore";

interface ParticipantStore {
  status: ConnectionStatus;
  view: ParticipantView | null;
  /** server clock − this device's clock */
  clockOffset: number;
  joining: boolean;
  /** Message on the join form (an error, or why you were sent back to it). */
  notice: string | null;
  /** True while rejoining a saved seat after a refresh. */
  resuming: boolean;
  /**
   * The option this phone tapped, shown as locked straight away, before the
   * server confirms. Question ids are new for every question run, so a stale
   * tap never matches the next question.
   */
  tapped: { questionId: string; optionId: string; text: string } | null;
  /** The question this phone buzzed on (shown instantly, before the server confirms). */
  buzzedOn: string | null;
  /** A bot change is on its way to the server. */
  botPending: boolean;
  /** Why the last bot change was refused (someone took it first, quiz started). */
  botNotice: string | null;

  connect: () => () => void;
  join: (roomCode: string, name: string) => void;
  /** Lobby: change this participant's bot. */
  setBot: (look: BotLook) => void;
  answer: (questionId: string, option: { id: string; text: string }) => void;
  buzz: (questionId: string) => void;
  back: (finalistId: string) => void;
  leave: () => void;
}

export const useParticipantStore = create<ParticipantStore>()((set, get) => ({
  status: "connecting",
  view: null,
  clockOffset: 0,
  joining: false,
  notice: null,
  resuming: false,
  tapped: null,
  buzzedOn: null,
  botPending: false,
  botNotice: null,

  connect: () => {
    const socket = getSocket();

    const onConnect = () => {
      set({ status: "online" });
      // Refresh, locked phone or Wi-Fi blip: quietly rejoin the same seat.
      const saved = loadParticipantSession();
      if (!saved) return;
      set({ resuming: true });
      socket.emit("participant:join", { roomCode: saved.roomCode, name: "", participantId: saved.participantId }, (result) => {
        set({ resuming: false });
        if (!result.ok) {
          saveParticipantSession(null);
          set({
            view: null,
            notice:
              result.error === "room-not-found"
                ? serverRestarted()
                  ? `${SERVER_RESTARTED_MESSAGE} Join again with the new code on the projector.`
                  : "That quiz isn't running any more. Join again with the code on the projector."
                : JOIN_ERROR_MESSAGES[result.error],
          });
        }
      });
    };
    const onDisconnect = () => set({ status: "offline" });
    const onConnectError = () => set({ status: "offline", resuming: false });
    const onState = (view: ParticipantView) => set({ view, clockOffset: view.serverNow - Date.now() });
    const onClosed = ({ reason }: { reason: string }) => {
      saveParticipantSession(null);
      set({ view: null, notice: reason });
    };

    // The browser knows about a dropped Wi-Fi long before the socket's ping times out.
    const onOffline = () => set({ status: "offline" });
    window.addEventListener("offline", onOffline);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("participant:state", onState);
    socket.on("room:closed", onClosed);
    if (loadParticipantSession()) set({ resuming: true });
    socket.connect();

    return () => {
      window.removeEventListener("offline", onOffline);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("participant:state", onState);
      socket.off("room:closed", onClosed);
      socket.disconnect();
    };
  },

  join: (roomCode, name) => {
    if (get().joining) return;
    set({ joining: true, notice: null });
    let answered = false;
    getSocket().emit("participant:join", { roomCode: roomCode.trim().toUpperCase(), name }, (result) => {
      answered = true;
      set({ joining: false });
      if (result.ok) {
        clearServerRestarted();
        saveParticipantSession({ roomCode: result.roomCode, participantId: result.participantId });
        saveLastName(name.trim());
      } else {
        set({ notice: JOIN_ERROR_MESSAGES[result.error] });
      }
    });
    // If the game server can't be reached, the reply never comes. Don't leave the button stuck.
    window.setTimeout(() => {
      if (!answered && get().joining) {
        set({ joining: false, notice: "Can't reach the quiz. Check your internet and try again." });
      }
    }, 8000);
  },

  setBot: (look) => {
    if (get().botPending) return;
    set({ botPending: true, botNotice: null });
    getSocket().emit("participant:bot", look, (result) => {
      set({ botPending: false, botNotice: result.ok ? null : BOT_ERROR_MESSAGES[result.error] });
    });
    // No reply (server unreachable): don't leave the builder stuck.
    window.setTimeout(() => {
      if (get().botPending) set({ botPending: false });
    }, 5000);
  },

  answer: (questionId, option) => {
    if (get().tapped?.questionId === questionId) return; // first tap wins
    set({ tapped: { questionId, optionId: option.id, text: option.text } });
    getSocket().emit("participant:answer", { questionId, optionId: option.id });
  },

  buzz: (questionId) => {
    set({ buzzedOn: questionId });
    getSocket().emit("participant:buzz", { questionId });
  },

  back: (finalistId) => getSocket().emit("participant:back", { finalistId }),

  leave: () => {
    saveParticipantSession(null);
    set({ view: null, notice: null, tapped: null, buzzedOn: null });
    // Reconnect fresh so the server forgets this socket's seat.
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  },
}));
