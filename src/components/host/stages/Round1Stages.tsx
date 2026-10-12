"use client";

/**
 * Round 1 on the projector. The read and answer steps are the two frames of
 * public/finaldesign.html: the question starts centred (read), then glides to
 * the left with its tilt while the 4 options fly in on the right (answer).
 * Reveal: wrong options dim to 30%, the right number turns mint, the banner
 * types itself out, and the cast hops and shakes (their moods, from the server).
 */
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { assetUrl } from "@/lib/socket";
import type { HostStage, HostView, LeaderRow, OptionResult } from "@/shared/protocol";
import { Clock, contentTop, Heading, Panel, useMoods } from "../parts";

type Stage<P extends HostStage["phase"]> = Extract<HostStage, { phase: P }>;

/** Types `text` out like a terminal, one character every 35 ms. */
export function TypeOut({ text, className = "" }: { text: string; className?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 35);
    return () => window.clearInterval(t);
  }, [text]);
  return (
    <p className={className} aria-label={text}>
      <span aria-hidden>{text.slice(0, n)}</span>
      <span aria-hidden className="opacity-0">
        {text.slice(n)}
      </span>
    </p>
  );
}

export function Round1Intro({ view }: { view: HostView }) {
  const s = view.settings;
  return (
    <Panel top="30%">
      <Heading size="7rem">Round 1</Heading>
      <motion.p className="host-hint !text-[3rem] text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        Everyone plays <span className="font-term text-[4rem] leading-none text-amber">{s.round1Questions}</span> questions. The top{" "}
        <span className="font-term text-[4rem] leading-none text-amber">{s.finalistCount}</span> go to the buzzer round.
      </motion.p>
      <motion.p className="host-count" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
        <b>{s.round1ReadSeconds}</b>s to read · <b>{s.round1AnswerSeconds}</b>s to answer · faster right answers score more
      </motion.p>
    </Panel>
  );
}

/** r1Read → r1Answer → r1TimesUp → r1Reveal, one screen so the question can travel. */
export function QuestionStage({ view, stage }: { view: HostView; stage: Stage<"r1Read" | "r1Answer" | "r1TimesUp" | "r1Reveal"> }) {
  const q = stage.question;
  const reading = stage.phase === "r1Read";
  const correct = stage.phase === "r1Reveal" && !stage.voided ? stage.correctText : null;
  const counting = stage.phase === "r1Answer" || stage.phase === "r1TimesUp";

  return (
    <>
      {/* The question: centred while reading, then left (5% / 34%, 42% wide) as in the design. */}
      <motion.div
        layout
        transition={{ layout: { duration: 0.75, ease: [0.65, 0, 0.35, 1] } }}
        className={
          reading
            ? "absolute top-[18%] bottom-[34%] left-[12%] z-10 flex w-[76%] items-center justify-center gap-[4rem]"
            : "absolute top-[34%] left-[5%] z-10 flex w-[42%] flex-col items-start gap-[2.4rem]"
        }
      >
        <motion.h2 layout="position" className={reading ? "host-q host-q-center" : "host-q"} style={{ rotate: reading ? -2 : -3 }}>
          {q.text}
        </motion.h2>
        {q.image && (
          <motion.img
            layout
            src={assetUrl(q.image)}
            alt=""
            className={`shrink-0 rounded-[1rem] border border-line bg-panel object-contain p-[1rem] ${reading ? "h-[22rem] w-[22rem]" : "h-[13rem] w-[13rem]"}`}
          />
        )}
      </motion.div>

      {reading && (
        <motion.p className="host-hint absolute inset-x-0 bottom-[31%] z-10 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
          Read it. Options appear on your phone in a moment.
        </motion.p>
      )}

      {q.options && (
        <ol className="host-opts absolute top-[30%] right-[5%] z-10 w-[44%]" aria-label="Answers">
          {q.options.map((o, i) => (
            <li key={`${i}-${o}`} className="host-opt" data-correct={correct === o} data-dim={!!correct && correct !== o}>
              <motion.span
                className="flex items-center gap-[1.4rem]"
                initial={{ opacity: 0, x: 80 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.12, type: "spring", stiffness: 260, damping: 24 }}
              >
                <span className="opt-num">{i + 1}</span>
                {o}
              </motion.span>
            </li>
          ))}
        </ol>
      )}

      {(reading || stage.phase === "r1Answer") && <Clock view={view} />}
      {counting && (
        <p className="host-count absolute bottom-[12%] left-[28%] z-10" aria-live="polite">
          <b>{stage.answered}</b>{" "}
          / {stage.expected} answered
        </p>
      )}
      {stage.phase === "r1TimesUp" && (
        <motion.p className="host-banner absolute right-0 bottom-[3%] left-[40%] z-10 text-center" initial={{ opacity: 0, scale: 1.3 }} animate={{ opacity: 1, scale: 1 }}>
          &gt; time&apos;s up
        </motion.p>
      )}
      {stage.phase === "r1Reveal" && (
        <TypeOut
          className="host-banner absolute inset-x-0 bottom-[12%] z-10 text-center"
          text={stage.voided ? "> question cancelled" : `> answer: ${(stage.correctText ?? "").toLowerCase()}`}
        />
      )}
    </>
  );
}

/** How many picked each option: thin mint bars, amber counts, numbers 1–4; the right one lit. */
export function ResultsStage({ view, stage }: { view: HostView; stage: Stage<"r1Results"> }) {
  const max = Math.max(1, ...stage.options.map((o) => o.count));
  return (
    <Panel top={contentTop(view.cast.length)}>
      <p className="host-q host-q-center !text-[3.4rem]">{stage.question.text}</p>
      <ol className="flex w-full flex-col gap-[2rem]">
        {stage.options.map((o: OptionResult, i) => (
          <li key={o.letter} className="flex items-center gap-[1.8rem] font-type text-[2.8rem] text-bright">
            <span className="opt-num !text-[5.4rem]" style={o.correct ? { color: "var(--color-mint)", textShadow: "0 0 1.2rem var(--color-mint)" } : undefined}>
              {i + 1}
            </span>
            <span className={`line-clamp-2 w-[40%] leading-tight ${o.correct ? "" : "opacity-70"}`}>{o.text}</span>
            <span className="relative h-[2.6rem] flex-1">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-[0.4rem] border-2 border-mint"
                style={{ background: o.correct ? "var(--color-mint)" : "rgb(108 240 176 / 0.12)", boxShadow: o.correct ? "0 0 1.2rem var(--color-mint)" : undefined }}
                initial={{ width: "0%" }}
                animate={{ width: `${Math.max(1.5, (o.count / max) * 100)}%` }}
                transition={{ delay: 0.3 + i * 0.15, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <span className="w-[7rem] text-right font-term text-[4.4rem] leading-none text-amber">
              <NumberFlow value={o.count} />
            </span>
          </li>
        ))}
      </ol>
      <p className="host-count">
        <b>{stage.answered}</b> / {stage.expected} answered
      </p>
    </Panel>
  );
}

/** Top 10: rows start in the previous order, then slide to the new one while the scores count up. */
export function LeaderboardStage({ view, stage }: { view: HostView; stage: Stage<"r1Leaderboard"> }) {
  const mood = useMoods(view);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), 900);
    return () => window.clearTimeout(t);
  }, []);
  const before = useMemo(
    () => [...stage.rows].sort((a, b) => (a.previousRank ?? 999) - (b.previousRank ?? 999) || a.rank - b.rank),
    [stage.rows],
  );
  const rows = settled ? stage.rows : before;

  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5rem">Leaderboard</Heading>
      <ol className="grid w-full grid-flow-col grid-rows-5 gap-x-[5rem] gap-y-[1.4rem]">
        {rows.map((r: LeaderRow, i) => (
          <motion.li key={r.id} layout transition={{ type: "spring", stiffness: 140, damping: 20 }} className="flex items-center gap-[1.6rem]">
            <span className="w-[4.4rem] text-right font-term text-[4rem] leading-none text-amber">{settled ? r.rank : i + 1}</span>
            <Bot color={r.color} head={r.head} mood={mood(r.id)} size="4.4rem" delay={botDelay(r.id)} />
            <span className="host-name min-w-0 flex-1 truncate !text-[2.6rem]">{r.name}</span>
            {r.change > 0 && settled && (
              <motion.span className="font-term text-[2.6rem] leading-none text-mint" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                +{r.change}
              </motion.span>
            )}
            <span className="w-[9rem] text-right font-term text-[4rem] leading-none text-bright">
              <NumberFlow value={settled ? r.score : r.score - r.change} />
            </span>
          </motion.li>
        ))}
      </ol>
    </Panel>
  );
}
