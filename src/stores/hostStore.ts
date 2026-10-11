"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { loadHostSession, saveHostSession } from "@/lib/session";
import type { HostView } from "@/shared/protocol";

export type ConnectionStatus = "connecting" | "online" | "offline";

interface HostStore {
  status: ConnectionStatus;
  view: HostView | null;
  /** server clock − this device's clock */
  clockOffset: number;
  /** Shown when no room could be created (e.g. the game server isn't running). */
  error: string | null;
  /** Opens the connection and creates (or resumes) a quiz room. Returns a cleanup function. */
  connect: () => () => void;
  /** Throws this room away and starts a fresh one (new code). */
  newRoom: () => void;
}

export const useHostStore = create<HostStore>()((set) => {
  const createRoom = () => {
    let answered = false;
    getSocket().emit("host:create", (result) => {
      answered = true;
      saveHostSession(result);
      set({ error: null });
    });
    window.setTimeout(() => {
      if (!answered) set({ error: "The game server didn't create a room. Check the terminal running npm run dev." });
    }, 6000);
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
        // After a refresh or a dropped connection, pick the same room back up.
        const saved = loadHostSession();
        if (!saved) return createRoom();
        socket.emit("host:resume", saved, ({ ok }) => {
          if (!ok) {
            // The room is gone (most likely the game server restarted): start a new one.
            saveHostSession(null);
            set({ view: null });
            createRoom();
          }
        });
      };
      const onDisconnect = () => set({ status: "offline" });
      const onState = (view: HostView) => set({ view, clockOffset: view.serverNow - Date.now() });

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onDisconnect);
      socket.on("host:state", onState);
      socket.connect();

      return () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onDisconnect);
        socket.off("host:state", onState);
        socket.disconnect();
      };
    },

    newRoom: () => {
      saveHostSession(null);
      set({ view: null });
      createRoom();
    },
  };
});
