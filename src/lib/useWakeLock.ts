"use client";

import { useEffect } from "react";

/**
 * Keeps the phone screen on while you're in a game. A sleeping phone drops
 * its connection, which is the most common way players fall out.
 *
 * Browsers release the lock whenever the tab is hidden, so we ask again each
 * time it becomes visible. Unsupported browsers just skip this.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) await lock.release();
      } catch {
        // Denied (low battery, unsupported context). Nothing to do.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
}
