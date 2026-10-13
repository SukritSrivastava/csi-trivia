"use client";

/**
 * Bits every phone screen shares, from the four phones in public/finaldesign.html:
 * the small header ("Q1 of 3 · 5s") with the thin mint timer bar, the big
 * centred moment (bot, big terminal word, a line under it), and the alarm-red
 * banners.
 */
import type { ReactNode } from "react";
import { Bot } from "@/components/ui/Bot";
import { useCountdown } from "@/lib/useCountdown";
import type { BotMood, ParticipantTag, Timer } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";

export function PhoneHeader({ label, me, timer, showBot = true }: { label: string; me: ParticipantTag; timer: Timer | null; showBot?: boolean }) {
  const clockOffset = useParticipantStore((s) => s.clockOffset);
  const c = useCountdown(timer, clockOffset);
  return (
    <header className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2 text-[clamp(0.95rem,4.6vw,1.15rem)] opacity-80">
        <span className="min-w-0 flex-1 truncate" data-testid="phone-header">
          {label}
          {c && (
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
  children,
  testId,
}: {
  me: ParticipantTag;
  mood: BotMood;
  big?: string;
  bad?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="my-auto flex flex-col items-center gap-5 py-4 text-center" data-testid={testId}>
      <Bot color={me.color} head={me.head} mood={mood} size="clamp(130px, 46vw, 196px)" label="Your bot" />
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

/** The alarm-red band: reconnecting, paused. */
export function Banner({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="rounded-xl bg-alarm px-3 py-2 text-center font-term text-[1.6rem] leading-none tracking-wide text-ghost" role="status" data-testid={testId}>
      {children}
    </p>
  );
}
