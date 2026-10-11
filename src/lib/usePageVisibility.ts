"use client";

import { useEffect } from "react";
import { getSocket } from "./socket";

/**
 * Tells the server when this phone leaves the quiz page (switches app or tab)
 * and comes back. The server only counts it while a question is open, and only
 * Admin sees it. Participants are never told.
 */
export function usePageVisibility(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const report = () => getSocket().emit("participant:visibility", { hidden: document.visibilityState === "hidden" });
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [enabled]);
}
