"use client";

/**
 * Pieces shared by the Host stages. Everything is sized in rem (the Host root
 * has `host-root`, so rem scales with the screen width: at 1920 px, 1rem ≈ 16 px
 * and 1% of the width ≈ 1.2rem), matching public/finaldesign.html.
 */
import { type ReactNode, useMemo } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { TimerRing } from "@/components/ui/TimerRing";
import type { BotMood, CastMember, HostView, ParticipantTag } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";

/** A person's mood as the server says (HostView.cast); screens never work moods out. */
export function useMoods(view: HostView) {
  return useMemo(() => {
    const map = new Map(view.cast.map((c) => [c.id, c.mood]));
    return (id: string, fallback: BotMood = "idle"): BotMood => map.get(id) ?? fallback;
  }, [view.cast]);
}

/** The clock timer, bottom-left (left 13%, bottom 7%, 14.4rem), as in the design. */
export function Clock({ view, size }: { view: HostView; size?: number }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  if (!view.timer) return null;
  return (
    <div className="absolute bottom-[7%] left-[13%] z-10">
      <TimerRing timer={view.timer} clockOffset={clockOffset} size={size} />
    </div>
  );
}

/** A centred block over the "full" scrim, below the cast. */
export function Panel({ children, top = "19%", className = "" }: { children: ReactNode; top?: string; className?: string }) {
  return (
    <div className={`absolute inset-x-[8%] bottom-[9%] z-10 flex flex-col items-center gap-[1.8rem] ${className}`} style={{ top }}>
      {children}
    </div>
  );
}

/** A screen title: the question style, centred and tilted. */
export function Heading({ children, size = "5.4rem" }: { children: ReactNode; size?: string }) {
  return (
    <h2 className="host-q host-q-center" style={{ fontSize: size }}>
      {children}
    </h2>
  );
}

/** A bot with its name under it. */
export function NamedBot({ tag, mood, size = "6rem", nameSize = "1.6rem", highlight = false }: { tag: ParticipantTag; mood: BotMood; size?: string; nameSize?: string; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-[0.6rem]">
      <Bot color={tag.color} head={tag.head} mood={mood} size={size} delay={botDelay(tag.id)} />
      {/* Highlighted: mint name text (flat, no glow). */}
      <span className={`host-name max-w-full truncate ${highlight ? "!text-mint" : ""}`} style={{ fontSize: nameSize }}>
        {tag.name}
      </span>
    </div>
  );
}

/**
 * The bots across the top, each with the mood the server gives it.
 * Up to 12: one row with names, exactly as in finaldesign.html (top 2.5%, 4% sides, 6rem bots).
 * 13+: a dense wall of smaller bots without names, 2 rows (up to 40) or 3, sized so it
 * stays in the top ~16% and never covers the question. CSS animations only.
 */
export function Cast({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;
  if (cast.length <= 12) {
    return (
      <ul className="absolute top-[2.5%] right-[4%] left-[4%] z-10 flex justify-between gap-[1rem]" aria-label="Players">
        {cast.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-col items-center gap-[0.7rem]">
            <Bot color={c.color} head={c.head} mood={c.mood} size="6rem" delay={botDelay(c.id)} />
            <span className="host-name max-w-[10rem] truncate">{c.name}</span>
          </li>
        ))}
      </ul>
    );
  }
  const rows = cast.length <= 40 ? 2 : 3;
  const perRow = Math.ceil(cast.length / rows);
  // The wall spans 94% of the width ≈ 112.8rem at any screen size; leave a gap per bot.
  const size = Math.min(4.6, 112.8 / perRow - 1);
  return (
    <ul
      className="absolute top-[2%] right-[3%] left-[3%] z-10 flex flex-wrap justify-center gap-x-[1rem] gap-y-[0.9rem] pt-[0.5rem]"
      style={{ maxHeight: `${rows * (size + 0.9) + 1}rem` }}
      aria-label={`${cast.length} players`}
    >
      {cast.map((c) => (
        <li key={c.id}>
          <Bot color={c.color} head={c.head} mood={c.mood} size={`${size}rem`} delay={botDelay(c.id)} label={c.name} />
        </li>
      ))}
    </ul>
  );
}

/**
 * How far down panel content should start so it clears the cast:
 * row of ≤12 ends ≈ 15%; 2-row wall (≤40, 4.6rem bots) ≈ 20%; 3-row wall (smaller bots) ≈ 18%.
 */
export function contentTop(castCount: number) {
  if (castCount === 0) return "8%";
  if (castCount <= 12) return "18%";
  return castCount <= 40 ? "22%" : "20%";
}
