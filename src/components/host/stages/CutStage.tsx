"use client";

/**
 * End of Round 1: the ranked list with each bot; a dramatic alarm-red cut line
 * under the last finalist; the bots below it power down one after another (their
 * "out" mood comes from the server; this only times when each one is shown), and
 * the finalists above it glow. Big rooms: everyone past the shown rows sits in a
 * small powered-down strip.
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
const POWER_DOWN_EVERY_MS = 260;

export function CutStage({ view, stage }: { view: HostView; stage: CutStageData }) {
  const mood = useMoods(view);
  const finalists = stage.standings.filter((s) => s.finalist);
  const below = stage.standings.filter((s) => !s.finalist);
  const shownBelow = below.slice(0, Math.max(2, (ROW_BUDGET - Math.ceil(finalists.length / 2)) * 2));
  const rest = below.slice(shownBelow.length);

  // 0 = rows arriving, 1 = line drawn, then one more bot powers down per tick.
  const [step, setStep] = useState(0);
  useEffect(() => {
    const start = window.setTimeout(() => setStep(1), LINE_AT_MS);
    return () => window.clearTimeout(start);
  }, []);
  useEffect(() => {
    if (step < 1 || step > shownBelow.length + 1) return;
    const t = window.setTimeout(() => setStep((s) => s + 1), POWER_DOWN_EVERY_MS);
    return () => window.clearTimeout(t);
  }, [step, shownBelow.length]);
  const lineDrawn = step >= 1;
  const poweredDown = (i: number) => step >= i + 2;

  const row = (s: Standing, i: number, isBelow: boolean) => (
    <motion.li
      key={s.id}
      className={`flex items-center gap-[1.4rem] transition-opacity duration-500 ${isBelow && poweredDown(i) ? "opacity-45" : ""}`}
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (isBelow ? finalists.length + i : i) * 0.06 }}
    >
      <span className="w-[4.4rem] text-right font-term text-[3.6rem] leading-none text-amber">{s.rank}</span>
      <span className={!isBelow && lineDrawn ? "drop-shadow-[0_0_1rem_var(--color-mint)]" : ""}>
        <Bot color={s.color} head={s.head} mood={isBelow ? (poweredDown(i) ? mood(s.id, "out") : "idle") : mood(s.id)} size="4.2rem" delay={botDelay(s.id)} />
      </span>
      <span className="host-name min-w-0 flex-1 truncate !text-[2.5rem]">{s.name}</span>
      <span className="font-term text-[3.4rem] leading-none text-bright">{s.score}</span>
    </motion.li>
  );

  return (
    <Panel top={contentTop(view.cast.length)} className="!gap-[1.4rem]">
      <Heading size="4.8rem">The top {finalists.length}</Heading>
      <ol className="grid w-[86%] grid-cols-2 gap-x-[5rem] gap-y-[1rem]">{finalists.map((s, i) => row(s, i, false))}</ol>

      {/* The cut line: draws itself left to right, then pulses gently (never below 35%). */}
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

      {shownBelow.length > 0 && <ol className="grid w-[86%] grid-cols-2 gap-x-[5rem] gap-y-[1rem]">{shownBelow.map((s, i) => row(s, i, true))}</ol>}

      {rest.length > 0 && (
        <div className="flex items-center gap-[1.4rem] opacity-50">
          <ul className="flex max-w-[80rem] flex-wrap justify-center gap-[0.5rem]" aria-label={`${rest.length} more`}>
            {rest.slice(0, 60).map((s) => (
              <li key={s.id}>
                <Bot color={s.color} head={s.head} mood={lineDrawn ? mood(s.id, "out") : "idle"} size="1.8rem" delay={botDelay(s.id)} label={`${s.rank}. ${s.name}`} />
              </li>
            ))}
          </ul>
          <span className="host-hint !text-[2rem]">and {rest.length} more</span>
        </div>
      )}
    </Panel>
  );
}
