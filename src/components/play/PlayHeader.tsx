"use client";

import { Avatar } from "@/components/ui/Avatar";
import { textOn } from "@/lib/format";
import { useCountdown } from "@/lib/useCountdown";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerView } from "@/shared/protocol";

const STATUS_LABEL: Record<PlayerView["me"]["status"], string> = {
  active: "Playing",
  out: "Knocked out",
  audience: "Audience",
  removed: "Removed",
};

/** Your colour band, so you can find yourself on the projector, plus the countdown. */
export function PlayHeader({ view }: { view: PlayerView }) {
  const clockOffset = usePlayerStore((s) => s.clockOffset);
  const countdown = useCountdown(view.timer, clockOffset);
  const { me } = view;
  const watching = me.status !== "active";
  const band = watching ? "#4a3f7a" : me.color;
  const urgent = countdown !== null && countdown.seconds <= 5 && view.screen.kind === "answer";

  return (
    <header className="sticky top-0 z-20" style={{ background: band, color: textOn(band) }}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Avatar name={me.name} color={me.color} size={2.4} dimmed={watching} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-black leading-tight">{me.name}</p>
          <p className="text-xs font-bold opacity-80">{STATUS_LABEL[me.status]}</p>
        </div>
        {countdown && (
          <span
            className={`type-wide min-w-[3ch] text-right text-2xl font-black tabular-nums ${urgent ? "animate-pulse" : ""}`}
            aria-hidden
          >
            {countdown.seconds}
          </span>
        )}
        <span className="type-wide rounded-lg bg-ink px-2 py-1 text-sm font-black tracking-[0.15em] text-paper">
          {view.roomCode}
        </span>
      </div>
      <div className="h-1.5 bg-ink/25" role="timer" aria-label={countdown ? `${countdown.seconds} seconds left` : "No timer"}>
        {countdown && (
          <div
            className="h-full transition-[width] duration-100 ease-linear"
            style={{ width: `${countdown.fraction * 100}%`, background: urgent ? "var(--color-side-a)" : "var(--color-paper)" }}
          />
        )}
      </div>
    </header>
  );
}
