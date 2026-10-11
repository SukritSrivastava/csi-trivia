"use client";

import { useEffect } from "react";
import { getSocket } from "./socket";

/**
 * Tells the server when this phone leaves the quiz page (switches app or tab).
 * The server only counts it while a question is open, and only the organiser
 * sees it. Players are never told.
 */
export function usePageAway(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const report = () => getSocket().emit("player:away", { away: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [enabled]);
}
