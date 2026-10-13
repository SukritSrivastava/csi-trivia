"use client";

/**
 * Bits every phone screen shares, from the four phones in public/finaldesign.html:
 * the small header ("Q1 of 3 · 5s") with the thin mint timer bar, the big
 * centred moment (bot, big terminal word, a line under it), and the alarm-red
 * banners.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Bot } from "@/components/ui/Bot";
import { useCountdown } from "@/lib/useCountdown";
import type { BotMood, ParticipantTag, Timer } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";

/**
 * The small header: the round name ("ROUND 1" / "WILD CARD" / "BLACKOUT") in
 * terminal caps, "Q3 of 20 · 5s", the player's own bot, and a thin mint bar
 * that drains with the server's timer. `stale` (the socket is down): no
 * countdown at all, the RECONNECTING band says why.
 */
export function PhoneHeader({
  round,
  label,
  me,
  timer,
  seconds = true,
  stale = false,
  showBot = true,
}: {
  round: string | null;
  label: string;
  me: ParticipantTag;
  timer: Timer | null;
  /** Show "· 5s" (question steps); the bar drains either way. */
  seconds?: boolean;
  stale?: boolean;
  showBot?: boolean;
}) {
  const clockOffset = useParticipantStore((s) => s.clockOffset);
  const live = useCountdown(timer, clockOffset);
  const c = stale ? null : live;
  return (
    <header className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2 text-[clamp(0.95rem,4.6vw,1.15rem)]">
        {round && (
          <span className="shrink-0 font-term text-[1.45em] leading-none tracking-[0.08em] text-mint uppercase" data-testid="round-name">
            {round}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate opacity-80" data-testid="phone-header">
          {label}
          {c && seconds && (
            <>
              {" · "}
              <span className="font-term text-[1.5em] leading-none text-amber" data-testid="countdown">
                {c.seconds}s
              </span>
            </>
          )}
        </span>
        {showBot && <Bot color={me.color} head={me.head} size="26px" label={`Your bot, ${me.name}`} />}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
        {c && <div className="h-full bg-mint transition-[width] duration-200 ease-linear" style={{ width: `${c.fraction * 100}%` }} />}
      </div>
    </header>
  );
}

/** Big centred moment: the player's bot, a big word, a line or two under it. */
export function Moment({
  me,
  mood,
  big,
  bad,
  hop = false,
  children,
  testId,
}: {
  me: ParticipantTag;
  mood: BotMood;
  big?: string;
  bad?: boolean;
  /** A short relieved hop (still running in Blackout). */
  hop?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="my-auto flex flex-col items-center gap-5 py-4 text-center" data-testid={testId}>
      <motion.span
        initial={false}
        animate={hop ? { y: [0, -18, 0, -6, 0] } : { y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
      >
        <Bot color={me.color} head={me.head} mood={mood} size="clamp(130px, 46vw, 196px)" label="Your bot" />
      </motion.span>
      {big && (
        <p className="phone-result !text-[clamp(3rem,15vw,4.4rem)]" data-bad={bad ? "true" : undefined}>
          {big}
        </p>
      )}
      {children && <div className="max-w-[22rem] text-[clamp(1.05rem,5vw,1.3rem)] leading-snug opacity-85">{children}</div>}
    </div>
  );
}

/** A screen title in the design's "Pick one. First tap locks." style. */
export function PhoneTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-[clamp(1.6rem,8.4vw,2.2rem)] leading-[1.1] text-balance">{children}</h1>;
}

/** "3 steps ahead" in amber terminal digits. */
export function Gap({ n, suffix = "ahead" }: { n: number; suffix?: string }) {
  return (
    <span data-testid="gap">
      <b className="font-term text-[1.5em] font-normal text-amber">{n}</b> {Math.abs(n) === 1 ? "step" : "steps"} {suffix}
    </span>
  );
}

/** Seconds left on the view's timer (holds included), or null. */
export function useSecondsLeft(timer: Timer | null): number | null {
  const clockOffset = useParticipantStore((s) => s.clockOffset);
  return useCountdown(timer, clockOffset)?.seconds ?? null;
}

/** The alarm-red band: reconnecting, paused. */
export function Banner({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="rounded-xl bg-alarm px-3 py-2 text-center font-term text-[1.6rem] leading-none tracking-wide text-ghost" role="status" data-testid={testId}>
      {children}
    </p>
  );
}
