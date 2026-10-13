"use client";

/**
 * After the cut: the wild card round (intro, standings, the winner) and
 * predictions. The wild card questions themselves use QuestionStage. Every
 * bot's mood comes from the server (HostView.cast). Design extension in the
 * same language: headings in the question style, amber counts, mint glow for
 * the winner.
 */
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { Bot, botDelay } from "@/components/ui/Bot";
import type { Backing, FinalistInfo, HostStage, HostView, ParticipantTag } from "@/shared/protocol";
import { contentTop, Heading, Panel, useMoods } from "../parts";

type Stage<P extends HostStage["phase"]> = Extract<HostStage, { phase: P }>;

/** The safe finalists as a quiet row of small bots: they watch. */
function SafeRow({ safe }: { safe: ParticipantTag[] }) {
  if (!safe.length) return null;
  return (
    <div className="flex flex-col items-center gap-[0.8rem]">
      <p className="host-hint !text-[2rem]">Safe, watching:</p>
      <ul className="flex flex-wrap justify-center gap-x-[2rem] gap-y-[1rem]" aria-label="Safe finalists">
        {safe.map((t) => (
          <li key={t.id} className="flex flex-col items-center gap-[0.4rem]">
            <Bot color={t.color} head={t.head} mood="idle" size="3.6rem" delay={botDelay(t.id)} />
            <span className="host-name max-w-[10rem] truncate !text-[1.6rem]">{t.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WildCardIntroStage({ view, stage }: { view: HostView; stage: Stage<"wcIntro"> }) {
  const w = stage.wildCard;
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="6.4rem">The wild card</Heading>
      <p className="host-hint max-w-[86rem] text-center">
        <span className="font-term text-[3.6rem] leading-none text-amber">{w.players}</span> players,{" "}
        <span className="font-term text-[3.6rem] leading-none text-amber">{w.questionCount}</span> questions, one last seat in Blackout. Most right
        answers wins; a tie goes to the faster.
      </p>
      <SafeRow safe={w.safe} />
    </Panel>
  );
}

/** Top 10 by correct answers (then time). */
export function WildCardStandingsStage({ view, stage }: { view: HostView; stage: Stage<"wcStandings" | "wcWinner"> }) {
  const mood = useMoods(view);
  const w = stage.wildCard;
  const sd = w.suddenDeath;
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5rem">{sd ? "Sudden death" : `Wild card after ${w.questionNumber} of ${w.questionCount}`}</Heading>
      {sd && <p className="host-hint">Exact tie: only {sd.alive.map((t) => t.name).join(" and ")} play on.</p>}
      <ol className="grid w-full grid-flow-col grid-rows-5 gap-x-[5rem] gap-y-[1.4rem]">
        {w.standings.map((s, i) => (
          <motion.li key={s.id} className="flex items-center gap-[1.6rem]" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
            <span className="w-[4.4rem] text-right font-term text-[4rem] leading-none text-amber">{s.rank}</span>
            <Bot color={s.color} head={s.head} mood={mood(s.id)} size="4.4rem" delay={botDelay(s.id)} />
            <span className="host-name min-w-0 flex-1 truncate !text-[2.6rem]">{s.name}</span>
            <span className="font-term text-[4rem] leading-none text-bright">
              {s.correct}
              <span className="text-[2.4rem] text-fog"> right</span>
            </span>
          </motion.li>
        ))}
      </ol>
    </Panel>
  );
}

export function WildCardWinnerStage({ view, stage }: { view: HostView; stage: Stage<"wcStandings" | "wcWinner"> }) {
  const mood = useMoods(view);
  const w = stage.wildCard;
  const winner = w.winner;
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5rem">The wild card</Heading>
      {winner ? (
        <motion.div className="flex flex-col items-center gap-[1.6rem]" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 16, delay: 0.4 }}>
          <span className="drop-shadow-[0_0_2rem_var(--color-mint)]">
            <Bot color={winner.color} head={winner.head} mood={mood(winner.id, "right")} size="16rem" delay={0} label={winner.name} />
          </span>
          <p className="font-term text-[8rem] leading-none tracking-[0.06em]" style={{ color: winner.color, textShadow: `0 0 2rem ${winner.color}` }}>
            {winner.name.toUpperCase()}
          </p>
          <p className="host-hint">{w.fallback ? "Nobody got one right, so the next best from Round 1 takes the last seat." : "takes the last seat in Blackout."}</p>
        </motion.div>
      ) : (
        <p className="host-hint">Nobody is left in the wild card round.</p>
      )}
    </Panel>
  );
}

/** Predictions: the finalists as bots, the live split under each. */
export function PredictionsStage({ view, stage }: { view: HostView; stage: Stage<"predictions"> }) {
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5.4rem">Who will escape?</Heading>
      <p className="host-hint text-center">
        Back a finalist on your phone. <span className="font-term text-[3.6rem] leading-none text-amber">{stage.backing.backers}</span> of {stage.backing.audience} have
        picked.
      </p>
      <FinalistRow view={view} finalists={stage.finalists} backing={stage.backing} />
    </Panel>
  );
}

function FinalistRow({ view, finalists, backing }: { view: HostView; finalists: FinalistInfo[]; backing: Backing }) {
  const mood = useMoods(view);
  const total = Object.values(backing.counts).reduce((a, b) => a + b, 0);
  const size = finalists.length > 6 ? "6.4rem" : "8.5rem";
  return (
    <ul className="flex w-full flex-wrap items-end justify-center gap-x-[2.6rem] gap-y-[2rem]">
      {finalists.map((f) => {
        const pct = total ? Math.round(((backing.counts[f.id] ?? 0) / total) * 100) : 0;
        return (
          <li key={f.id} className="flex w-[11rem] flex-col items-center gap-[0.7rem]">
            <Bot color={f.color} head={f.head} mood={mood(f.id)} size={size} delay={botDelay(f.id)} />
            <span className="host-name max-w-full truncate !text-[2rem]">{f.name}</span>
            <span className="font-term text-[3.8rem] leading-none text-amber">
              <NumberFlow value={pct} suffix="%" />
            </span>
            <span className="h-[0.6rem] w-full overflow-hidden rounded-full bg-line">
              <motion.span className="block h-full bg-mint" animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
