"use client";

import { useCountdown } from "@/lib/useCountdown";
import type { AdminView } from "@/shared/protocol";
import type { ConnectionStatus } from "@/stores/hostStore";
import { Dot } from "./parts";

/**
 * Top of the Admin screen: where we are in plain words, the timer, the
 * connection, and an unmissable PAUSED / reconnecting band.
 */
export function TopBar({ view, clockOffset, status }: { view: AdminView; clockOffset: number; status: ConnectionStatus }) {
  const countdown = useCountdown(view.timer, clockOffset);
  const online = status === "online";
  const low = countdown !== null && countdown.seconds <= 3 && !view.paused;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-void/95 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] text-fog">
            <span className="font-term text-xl leading-none tracking-[0.15em] text-mint">{view.roomCode}</span>
            <Dot on={online} />
            <span className={online ? "" : "text-wrong"} role="status">
              {online ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting…"}
            </span>
          </div>
          <p className="mt-1 text-[17px] leading-snug text-bright" data-testid="step-label">
            {view.stepLabel}
          </p>
        </div>
        {countdown && (
          <div
            className={`font-term text-[3.25rem] leading-none tabular-nums ${view.paused ? "text-wrong" : low ? "text-wrong" : "text-ghost"}`}
            role="timer"
            aria-label={`${countdown.seconds} seconds left${view.paused ? ", paused" : ""}`}
            data-testid="countdown"
          >
            {String(countdown.seconds).padStart(2, "0")}
          </div>
        )}
      </div>

      {/* Thin timer bar, like the phone header. */}
      <div className="h-1 bg-line/60" aria-hidden>
        {countdown && (
          <div
            className={`h-full origin-left transition-transform duration-100 ease-linear ${view.paused ? "bg-wrong" : "bg-mint"}`}
            style={{ transform: `scaleX(${countdown.fraction})` }}
          />
        )}
      </div>

      {view.paused && (
        <div className="relative overflow-hidden bg-alarm py-1.5 text-center" role="status" data-testid="paused">
          <span
            className="absolute inset-0 animate-[corridor-alarm_3.2s_infinite] bg-[radial-gradient(ellipse_at_50%_0%,rgb(255_77_94/0.9),transparent_70%)]"
            aria-hidden
          />
          <span className="relative font-term text-[2rem] leading-none tracking-[0.2em] text-ghost">PAUSED</span>
        </div>
      )}
      {!online && (
        <div className="border-t border-wrong bg-wrong/15 px-4 py-2 text-center text-[15px] text-wrong" role="alert">
          Connection lost. Reconnecting… Don&apos;t refresh, you&apos;ll come straight back.
        </div>
      )}
    </header>
  );
}
