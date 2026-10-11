"use client";

import { Avatar } from "@/components/ui/Avatar";
import { textOn } from "@/lib/format";
import { useCountdown } from "@/lib/useCountdown";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerView } from "@/shared/protocol";

/** Your colour band: so you can match yourself to your token on the TV. */
export function PlayHeader({ view }: { view: PlayerView }) {
  const clockOffset = usePlayerStore((s) => s.clockOffset);
  const leave = usePlayerStore((s) => s.leave);
  const countdown = useCountdown(view.timer, clockOffset);
  const { me, role } = view;
  const isAudience = role === "audience";
  const band = isAudience ? "#4a3f7a" : me.color;

  return (
    <header className="sticky top-0 z-10" style={{ background: band, color: textOn(band) }}>
      <div className="flex items-center gap-3 px-5 py-3">
        {!isAudience && <Avatar name={me.name} color={me.color} size={2.6} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-black">{me.name}</p>
          <p className="text-sm font-bold opacity-80">
            {isAudience ? "Audience" : me.isVip ? `VIP, ${me.score} points` : `${me.score} points`}
          </p>
        </div>
        <span className="type-wide rounded-lg bg-ink px-2.5 py-1 text-base font-black tracking-[0.15em] text-paper">
          {view.roomCode}
        </span>
        {view.screen.kind === "lobby" && (
          <button type="button" onClick={leave} className="text-sm font-bold underline underline-offset-2">
            Leave
          </button>
        )}
      </div>
      {countdown && (
        <div className="h-2 bg-ink/30" role="timer" aria-label={`${countdown.seconds} seconds left`}>
          <div
            className="h-full bg-paper transition-[width] duration-200 ease-linear"
            style={{ width: `${countdown.fraction * 100}%` }}
          />
        </div>
      )}
    </header>
  );
}
