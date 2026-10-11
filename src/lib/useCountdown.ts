"use client";

import { useEffect, useState } from "react";
import type { Timer } from "@/shared/protocol";

/**
 * Turns the server's timer into a live countdown.
 *
 * `clockOffset` is (server clock − this device's clock), measured when the
 * last update arrived. Phones' clocks are often off by seconds, so we never
 * compare against the server's time directly.
 */
export function useCountdown(timer: Timer | null, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [timer]);

  if (!timer) return null;
  const remainingMs = Math.max(0, timer.endsAt - (now + clockOffset));
  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    /** 1 at the start, 0 when time is up. */
    fraction: timer.durationMs > 0 ? remainingMs / timer.durationMs : 0,
  };
}
