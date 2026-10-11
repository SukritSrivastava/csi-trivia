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
  /** Opens the connection and creates (or resumes) a quiz room. Returns a cleanup function. */
  connect: () => () => void;
  newRoom: () => void;
}

export const useHostStore = create<HostStore>()((set) => {
  const createRoom = () => {
    getSocket().emit("host:create", (result) => saveHostSession(result));
  };

  return {
    status: "connecting",
    view: null,
    clockOffset: 0,

    connect: () => {
      const socket = getSocket();

      const onConnect = () => {
        set({ status: "online" });
        // After a refresh or a dropped connection, pick the same room back up.
        const saved = loadHostSession();
        if (!saved) return createRoom();
        socket.emit("host:resume", saved, ({ ok }) => {
          if (!ok) {
            saveHostSession(null);
            createRoom();
          }
        });
      };
      const onDisconnect = () => set({ status: "offline" });
      const onConnectError = () => set({ status: "offline" });
      const onState = (view: HostView) => set({ view, clockOffset: view.serverNow - Date.now() });

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      socket.on("host:state", onState);
      socket.connect();

      return () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onConnectError);
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
