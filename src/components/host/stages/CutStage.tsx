"use client";

/**
 * End of Round 1: the ranked list with each bot; an alarm-red cut line under
 * the last safe seat. Above it the safe finalists glow (mood right, from the
 * server); below it the wild card players wait (mood idle: nobody is out yet).
 * Big rooms: everyone past the shown rows sits in a small strip. Fewer players
 * than safe seats + 1: everyone is through, no line.
 */
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import type { HostStage, HostView, Standing } from "@/shared/protocol";
import { contentTop, Heading, Panel, useMoods } from "../parts";

type CutStageData = Extract<HostStage, { phase: "cut" }>;

/** Rows of two that fit between the title and the bottom. */
const ROW_BUDGET = 6;
const LINE_AT_MS = 1400;

export function CutStage({ view, stage }: { view: HostView; stage: CutStageData }) {
  const mood = useMoods(view);
  const safe = stage.standings.filter((s) => s.finalist);
  const below = stage.standings.filter((s) => !s.finalist);
  const shownBelow = below.slice(0, Math.max(2, (ROW_BUDGET - Math.ceil(safe.length / 2)) * 2));
  const rest = below.slice(shownBelow.length);

  const [lineDrawn, setLineDrawn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLineDrawn(true), LINE_AT_MS);
    return () => window.clearTimeout(t);
  }, []);

  const row = (s: Standing, i: number, isBelow: boolean) => (
    <motion.li
      key={s.id}
      className="flex items-center gap-[1.4rem]"
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (isBelow ? safe.length + i : i) * 0.05 }}
    >
      <span className="w-[4.4rem] text-right font-term text-[3.4rem] leading-none text-amber">{s.rank}</span>
      <span className={!isBelow && lineDrawn ? "drop-shadow-[0_0_1rem_var(--color-mint)]" : ""}>
        <Bot color={s.color} head={s.head} mood={mood(s.id)} size="3.8rem" delay={botDelay(s.id)} />
      </span>
      <span className="host-name min-w-0 flex-1 truncate !text-[2.3rem]">{s.name}</span>
      <span className="font-term text-[3.2rem] leading-none text-bright">{s.score}</span>
    </motion.li>
  );

  return (
    <Panel top={contentTop(view.cast.length)} className="!gap-[1.2rem]">
      <Heading size="4.6rem">{stage.wildCardSkipped ? "Everyone's through to Blackout" : `Safe: the top ${safe.length}`}</Heading>
      <ol className="grid w-[86%] grid-cols-2 gap-x-[5rem] gap-y-[0.8rem]">{safe.map((s, i) => row(s, i, false))}</ol>

      {!stage.wildCardSkipped && (
        <>
          {/* The cut line: draws itself left to right, then pulses gently. */}
          <div aria-hidden className="flex w-[92%] shrink-0 justify-start">
            <div
              className="h-[0.6rem] rounded-full bg-alarm shadow-[0_0_1.8rem_var(--color-alarm)]"
              style={{
                width: lineDrawn ? "100%" : "0%",
                transition: "width 0.6s cubic-bezier(0.65, 0, 0.35, 1)",
                animation: lineDrawn ? "bot-pulse 1.4s ease-in-out 0.6s infinite" : undefined,
              }}
              data-testid="cut-line"
            />
          </div>
          <p className="host-hint !text-[2.2rem]">
            Below the line: <span className="font-term text-[3rem] leading-none text-amber">{stage.wildCardCount}</span> play the wild card round for the last seat.
          </p>
          {shownBelow.length > 0 && <ol className="grid w-[86%] grid-cols-2 gap-x-[5rem] gap-y-[0.8rem]">{shownBelow.map((s, i) => row(s, i, true))}</ol>}
          {rest.length > 0 && (
            <div className="flex items-center gap-[1.4rem] opacity-70">
              <ul className="flex max-w-[80rem] flex-wrap justify-center gap-[0.5rem]" aria-label={`${rest.length} more`}>
                {rest.slice(0, 60).map((s) => (
                  <li key={s.id}>
                    <Bot color={s.color} head={s.head} mood={mood(s.id)} size="1.8rem" delay={botDelay(s.id)} label={`${s.rank}. ${s.name}`} />
                  </li>
                ))}
              </ul>
              <span className="host-hint !text-[2rem]">and {rest.length} more</span>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
