"use client";

import { useEffect, useState } from "react";
import type { Timer } from "@/shared/protocol";

/**
 * Turns the server's timer into a live countdown.
 *
 * `clockOffset` is (server clock − this device's clock), measured when the
 * last update arrived. Phone clocks are often seconds off, so we never compare
 * against the server's time directly. While paused, the countdown freezes.
 */
export function useCountdown(timer: Timer | null, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now());
  const frozen = timer?.remainingMs !== undefined;

  useEffect(() => {
    if (!timer || frozen) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [timer, frozen]);

  if (!timer) return null;
  const remainingMs = frozen
    ? (timer.remainingMs ?? 0)
    : Math.max(0, timer.endsAt - (now + clockOffset));
  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    /** 1 at the start, 0 when time is up. */
    fraction: timer.durationMs > 0 ? Math.min(1, remainingMs / timer.durationMs) : 0,
  };
}
