"use client";

import { useCountdown } from "@/lib/useCountdown";
import type { Timer } from "@/shared/protocol";

interface TimerRingProps {
  timer: Timer | null;
  clockOffset: number;
  /** Diameter in rem. */
  size?: number;
}

/** The TV's countdown: a ring that drains, turning pink in the last ten seconds. */
export function TimerRing({ timer, clockOffset, size = 9 }: TimerRingProps) {
  const countdown = useCountdown(timer, clockOffset);
  if (!countdown) return null;

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const urgent = countdown.seconds <= 10;

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: `${size}rem`, height: `${size}rem` }}
      role="timer"
      aria-label={`${countdown.seconds} seconds left`}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r="47" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="5" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-ink)" strokeOpacity="0.12" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={urgent ? "var(--color-side-a)" : "var(--color-ink)"}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - countdown.fraction)}
          style={{ transition: "stroke-dashoffset 200ms linear" }}
        />
      </svg>
      <span
        className="type-wide relative font-black tabular-nums text-ink"
        style={{ fontSize: `${size * 0.32}rem` }}
      >
        {countdown.seconds}
      </span>
    </div>
  );
}
