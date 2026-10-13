"use client";

import { useEffect, useState } from "react";
import { ACTION_LABELS, COMMAND_ERROR_TEXT } from "@/lib/adminLabels";
import { useCountdown } from "@/lib/useCountdown";
import type { AdminView, AutopilotState, PrimaryAction } from "@/shared/protocol";
import { useAdminStore } from "@/stores/adminStore";

/**
 * The bottom of the Admin screen, always in the same place and in thumb reach:
 * the hint, the optional steps as small "or: …" chips, and the big primary
 * button labelled with exactly what it does. While a Round 1 / wild card timer
 * runs the button is a disabled countdown ("ANSWERING… 5"). During the
 * Blackout autopilot an AUTOPILOT strip shows the step and what comes next,
 * and the big button is PAUSE (mint) / RESUME (alarm red).
 */
export function Dock({
  view,
  pending,
  onPrimary,
  onOptional,
  onDownload,
}: {
  view: AdminView;
  pending: boolean;
  onPrimary: () => void;
  onOptional: (o: PrimaryAction) => void;
  onDownload: () => void;
}) {
  const clockOffset = useAdminStore((s) => s.clockOffset);
  const countdown = useCountdown(view.timer, clockOffset);
  const finished = view.phase === "podium";
  const auto = view.autopilot;
  const resume = view.primary?.action.type === "resume";

  return (
    <div className="relative border-t border-line bg-void px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="dock">
      <Toast />
      {view.hint && (
        <p className="mb-2.5 text-[15px] leading-snug text-mint-soft" data-testid="hint">
          {view.hint}
        </p>
      )}
      {auto && <AutopilotStrip auto={auto} seconds={countdown?.seconds ?? null} />}
      {view.optional.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="optional">
          {view.optional.map((o) => (
            <button
              key={o.action.type}
              type="button"
              onClick={() => onOptional(o)}
              disabled={pending}
              className="phone-opt min-h-12 !rounded-full !px-4 text-[15px] disabled:opacity-40"
              data-testid={`optional-${o.action.type}`}
            >
              <span className="mr-1.5 text-fog">or:</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {view.primary ? (
        <button
          type="button"
          className={`phone-go min-h-16 w-full text-[2.25rem] uppercase transition-transform active:scale-[0.99] disabled:opacity-40 ${
            resume ? "!border-alarm !bg-alarm !text-ghost" : ""
          }`}
          onClick={onPrimary}
          disabled={pending}
          aria-keyshortcuts="Space"
          data-testid="primary"
        >
          {pending ? "…" : view.primary.label}
        </button>
      ) : finished ? (
        <button type="button" className="phone-go min-h-16 w-full text-[2.25rem] uppercase" onClick={onDownload} data-testid="primary-csv">
          Download results
        </button>
      ) : countdown ? (
        // A timer runs and nothing needs a click: the button counts down, disabled.
        <button type="button" className="phone-go min-h-16 w-full text-[2.25rem] uppercase disabled:!opacity-60" disabled aria-live="off" data-testid="primary-wait">
          {view.phase.endsWith("Read") ? "Reading…" : "Answering…"} {countdown.seconds}
        </button>
      ) : (
        <div
          className="flex min-h-16 w-full items-center justify-center rounded-[0.9rem] border-2 border-dashed border-line px-4 py-2 text-center text-[15px] leading-snug text-mint-soft"
          role="status"
          data-testid="primary-wait"
        >
          {view.hint ?? "Waiting"}
        </div>
      )}
      <p className="mt-2 hidden text-center text-[14px] text-fog lg:block">
        <Key>Space</Key> {auto ? "pause / resume" : "next step"} · <Key>P</Key> pause / resume
        {auto && (
          <>
            {" "}
            · <Key>S</Key> skip
          </>
        )}
      </p>
    </div>
  );
}

const STEP_WORD: Record<AutopilotState["step"], string> = {
  intro: "Intro",
  read: "Reading",
  answer: "Answering",
  timesUp: "Time's up",
  reveal: "Runners move",
  dark: "The dark moves",
  winner: "The winner",
};

/** "AUTOPILOT · ANSWERING · 6 → time's up": the step now, its countdown, and what starts next. */
function AutopilotStrip({ auto, seconds }: { auto: AutopilotState; seconds: number | null }) {
  return (
    <div
      className={`mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden rounded-[0.9rem] border-2 px-3 py-1.5 font-term text-[1.5rem] leading-none tracking-[0.06em] whitespace-nowrap uppercase ${
        auto.paused ? "border-alarm text-wrong" : "border-line text-mint-soft"
      }`}
      role="status"
      data-testid="autopilot"
    >
      <span className={`shrink-0 ${auto.paused ? "text-wrong" : "text-mint"}`}>{auto.paused ? "Paused" : "Autopilot"}</span>
      <span className="text-fog">·</span>
      <span className="min-w-0 truncate text-ghost">{STEP_WORD[auto.step]}</span>
      {seconds !== null && (
        <>
          <span className="text-fog">·</span>
          <span className="shrink-0 text-amber tabular-nums">{seconds}</span>
        </>
      )}
      <span className="ml-auto min-w-0 truncate text-fog">next: {auto.nextLabel}</span>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-line px-1.5 py-0.5 font-term text-lg leading-none text-mint-soft">{children}</kbd>;
}

/**
 * A refused command, in plain words, for 4 seconds: a small panel over the
 * dock. A stale-step reply is silent (the screen has already re-drawn from the
 * newer view), and so is an ignored double tap.
 */
function Toast() {
  const lastResult = useAdminStore((s) => s.lastResult);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!lastResult || lastResult.result.ok) return setText(null);
    const msg = COMMAND_ERROR_TEXT[lastResult.result.reason];
    if (!msg) return;
    setText(`${ACTION_LABELS[lastResult.action]}: ${msg}`);
    const t = window.setTimeout(() => setText(null), 4000);
    return () => window.clearTimeout(t);
  }, [lastResult]);

  if (!text) return null;
  return (
    <p
      className="absolute inset-x-4 bottom-full mb-2 rounded-[0.9rem] border-2 border-wrong bg-panel px-4 py-2.5 text-[15px] leading-snug text-wrong"
      role="alert"
      data-testid="command-error"
    >
      {text}
    </p>
  );
}
