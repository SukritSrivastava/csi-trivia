"use client";

/**
 * After the cut: predictions (live backing split), the buzzer round (question
 * with A–D, finalists with live points, buzzers open, the big flash of whoever
 * buzzed, the reveal), the scoreboard between questions, and sudden death.
 * Every bot's mood comes from HostView.cast.
 */
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { assetUrl } from "@/lib/socket";
import type { Backing, FinalistState, HostStage, HostView } from "@/shared/protocol";
import { OPTION_LETTERS } from "@/shared/protocol";
import { Clock, contentTop, Heading, Panel, useMoods } from "../parts";
import { TypeOut } from "./Round1Stages";

type Stage<P extends HostStage["phase"]> = Extract<HostStage, { phase: P }>;

/** The finalists as big bots, with points (or the backing split) under each. */
function FinalistRow({
  view,
  finalists,
  backing,
  size = "8.5rem",
  layout = false,
}: {
  view: HostView;
  finalists: FinalistState[];
  backing?: Backing;
  size?: string;
  layout?: boolean;
}) {
  const mood = useMoods(view);
  const total = backing ? Object.values(backing.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <ul className="flex w-full flex-wrap items-end justify-center gap-x-[3.6rem] gap-y-[2rem]">
      {finalists.map((f) => {
        const pct = backing && total ? Math.round(((backing.counts[f.id] ?? 0) / total) * 100) : 0;
        return (
          <motion.li
            key={f.id}
            layout={layout}
            transition={{ type: "spring", stiffness: 160, damping: 22 }}
            className={`flex w-[13rem] flex-col items-center gap-[0.8rem] ${f.inPlay ? "" : "opacity-40"}`}
          >
            <Bot color={f.color} head={f.head} mood={mood(f.id)} size={size} delay={botDelay(f.id)} />
            <span className="host-name max-w-full truncate !text-[2.4rem]">{f.name}</span>
            {backing ? (
              <>
                <span className="font-term text-[4.6rem] leading-none text-amber">
                  <NumberFlow value={pct} suffix="%" />
                </span>
                <span className="h-[0.6rem] w-full overflow-hidden rounded-full bg-line">
                  <motion.span className="block h-full bg-mint" animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
                </span>
              </>
            ) : (
              <span className="font-term text-[4.6rem] leading-none text-amber">
                <NumberFlow value={f.points} />
              </span>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

export function PredictionsStage({ view, stage }: { view: HostView; stage: Stage<"predictions"> }) {
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5.4rem">Who will win?</Heading>
      <p className="host-hint text-center">
        Back a finalist on your phone.{" "}
        <span className="font-term text-[3.6rem] leading-none text-amber">
          {stage.backing.backers}
        </span>{" "}
        of {stage.backing.audience} have picked.
      </p>
      <FinalistRow view={view} finalists={stage.finalists} backing={stage.backing} size="9rem" />
    </Panel>
  );
}

export function Round2IntroStage({ view, stage }: { view: HostView; stage: Stage<"r2Intro"> }) {
  const s = view.settings;
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="6rem">The buzzer round</Heading>
      <p className="host-hint max-w-[80rem] text-center">
        <span className="font-term text-[3.6rem] leading-none text-amber">{s.round2Questions}</span> questions. First to buzz says the answer out loud. Right is a point;
        wrong locks you out for that question.
      </p>
      <FinalistRow view={view} finalists={stage.finalists} size="9rem" />
    </Panel>
  );
}

/** r2Read → r2BuzzOpen → r2Answering → r2Reveal on one screen. */
export function BuzzerStage({ view, stage }: { view: HostView; stage: Stage<"r2Read" | "r2BuzzOpen" | "r2Answering" | "r2Reveal"> }) {
  const mood = useMoods(view);
  const r = stage.round2;
  const q = r.question;
  const correctText = r.correct?.text ?? null;
  const by = r.buzzedBy;

  let banner: string | null = null;
  if (stage.phase === "r2Read") banner = "> buzzers locked";
  else if (stage.phase === "r2BuzzOpen") banner = r.wrong.length ? "> BUZZERS OPEN AGAIN" : "> BUZZERS OPEN";
  else if (stage.phase === "r2Reveal") {
    banner =
      r.outcome?.kind === "correct"
        ? `> ${r.outcome.by.name} got it: ${(correctText ?? "").toLowerCase()}`
        : r.outcome?.kind === "voided"
          ? "> question cancelled"
          : `> nobody. answer: ${(correctText ?? "").toLowerCase()}`;
  }

  return (
    <>
      <div className="absolute top-[19%] right-[6%] left-[6%] z-10 flex flex-col items-center gap-[2rem]">
        <p className="host-hint">
          {q.suddenDeath ? (
            <>
              Sudden death · question <b className="font-term text-[3.4rem] font-normal text-amber">{q.number}</b>
            </>
          ) : (
            <>
              Buzzer question <b className="font-term text-[3.4rem] font-normal text-amber">{q.number}</b> of {q.count}
            </>
          )}
        </p>
        <div className="flex items-center justify-center gap-[2.4rem]">
          {q.image && <img src={assetUrl(q.image)} alt="" className="h-[10rem] w-[10rem] shrink-0 rounded-[1rem] border border-line bg-panel object-contain p-[0.8rem]" />}
          <h2 className="host-q host-q-center !text-[4.6rem]">{q.text}</h2>
        </div>
        <ol className="grid w-[86%] grid-cols-2 gap-x-[5rem] gap-y-[1.4rem] font-type text-[2.8rem] text-bright">
          {q.options.map((o, i) => (
            <li key={o} className="host-opt" data-correct={correctText === o} data-dim={!!correctText && correctText !== o}>
              <span className="opt-num !text-[4.6rem]">{OPTION_LETTERS[i]}</span>
              {o}
            </li>
          ))}
        </ol>
      </div>

      {banner && stage.phase === "r2BuzzOpen" ? (
        <motion.p
          className="host-banner absolute inset-x-0 top-[59%] z-10 text-center !text-[5rem]"
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        >
          {banner}
        </motion.p>
      ) : banner && stage.phase === "r2Reveal" ? (
        <TypeOut className="host-banner absolute inset-x-0 top-[59%] z-10 text-center" text={banner} />
      ) : banner ? (
        <p className="host-banner absolute inset-x-0 top-[59%] z-10 text-center opacity-70">{banner}</p>
      ) : null}

      <div className="absolute right-[4%] bottom-[5%] left-[29%] z-10">
        <ul className="flex items-end justify-center gap-x-[3rem]">
          {r.finalists.map((f) => (
            <li key={f.id} className={`flex w-[12rem] flex-col items-center gap-[0.6rem] ${f.inPlay ? "" : "opacity-35"}`}>
              <Bot color={f.color} head={f.head} mood={mood(f.id)} size="7rem" delay={botDelay(f.id)} />
              <span className="host-name max-w-full truncate !text-[2.2rem]">{f.name}</span>
              <span className="font-term text-[4.2rem] leading-none text-amber">
                <NumberFlow value={f.points} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      {stage.phase !== "r2Reveal" && <Clock view={view} size={12.5} />}

      {/* The big flash of whoever buzzed. */}
      <AnimatePresence>
        {stage.phase === "r2Answering" && by && (
          <motion.div
            key={by.id}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[2rem] bg-void/95"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.span
              aria-hidden
              className="absolute inset-0"
              style={{ background: "radial-gradient(circle at 50% 45%, rgb(108 240 176 / 0.55), transparent 60%)" }}
              initial={{ opacity: 1 }}
              animate={{ opacity: 0.18 }}
              transition={{ duration: 0.9 }}
            />
            <motion.div initial={{ scale: 0.3, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 320, damping: 16 }}>
              <Bot color={by.color} head={by.head} mood={mood(by.id, "locked")} size="20rem" delay={0} />
            </motion.div>
            <p className="relative font-term text-[10rem] leading-none tracking-[0.06em]" style={{ color: by.color, textShadow: `0 0 2rem ${by.color}` }}>
              {by.name.toUpperCase()}
            </p>
            <p className="host-hint relative">{r.answerTimeUp ? "Time's up. The quizmaster decides." : "Say your answer out loud!"}</p>
            <Clock view={view} size={12.5} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function ScoresStage({ view, stage }: { view: HostView; stage: Stage<"r2Scores"> }) {
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5rem">{stage.suddenDeath ? "Sudden death" : `Scores after ${stage.questionNumber} of ${stage.questionCount}`}</Heading>
      <FinalistRow view={view} finalists={stage.finalists} size="9rem" layout />
    </Panel>
  );
}

export function SuddenDeathStage({ view, stage }: { view: HostView; stage: Stage<"suddenDeath"> }) {
  return (
    <Panel top={contentTop(view.cast.length)}>
      <motion.div initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14 }}>
        <Heading size="8rem">Sudden death</Heading>
      </motion.div>
      <p className="host-hint">Tied for first. Only they can buzz. First right answer wins.</p>
      <FinalistRow view={view} finalists={stage.tied} size="11rem" />
    </Panel>
  );
}
