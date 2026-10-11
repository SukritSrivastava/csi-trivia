"use client";

import { useCountdown } from "@/lib/useCountdown";
import type { Timer } from "@/shared/protocol";

interface TimerRingProps {
  timer: Timer | null;
  clockOffset: number;
  /** Diameter in rem (the Host scales rem with screen width). 14.4rem matches the approved design at 1080p. */
  size?: number;
}

/**
 * The Host's countdown, styled like Murder Trivia's pocket watch: a clock face
 * where a red wedge grows as time is used up, terminal digits, a hard mint
 * offset shadow. Sits bottom-left on question screens (public/finaldesign.html).
 */
export function TimerRing({ timer, clockOffset, size = 14.4 }: TimerRingProps) {
  const countdown = useCountdown(timer, clockOffset);
  if (!countdown) return null;

  const used = Math.round((1 - countdown.fraction) * 1000) / 10; // % of the face in red

  return (
    <div
      className="clock shrink-0"
      style={{
        width: `${size}rem`,
        height: `${size}rem`,
        fontSize: `${size * 0.53}rem`,
        background: `conic-gradient(var(--color-alarm) 0 ${used}%, var(--color-clock) ${used}%)`,
        transition: "background 200ms linear",
      }}
      role="timer"
      aria-label={`${countdown.seconds} seconds left`}
    >
      {countdown.seconds}
    </div>
  );
}
