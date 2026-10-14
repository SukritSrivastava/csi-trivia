"use client";

/**
 * After the cut: the wild card round (intro, standings, the reveal) and
 * predictions. The wild card questions themselves use QuestionStage; the cast
 * across the top is the wild card players (a wall), and the 9 safe finalists
 * sit as a small SAFE row bottom-right. Every bot's mood comes from the server.
 *
 * The reveal is the orchestrated moment: the alarm speeds up, the whole wall
 * powers down left to right in a fast sweep (everyone but the winner), then the
 * winner's bot zooms to the centre with WILD CARD in terminal digits. Flat:
 * mint outlines and mint text, never a glow.
 */
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { Bot, botDelay } from "@/components/ui/Bot";
import type { Backing, FinalistInfo, HostStage, HostView, ParticipantTag, WildCardState } from "@/shared/protocol";
import { contentTop, Heading, Panel, useMoods } from "../parts";

type Stage<P extends HostStage["phase"]> = Extract<HostStage, { phase: P }>;

/** The safe finalists, small, bottom-right above hermes://quiz: they watch the wild card round. */
export function SafeCorner({ safe }: { safe: ParticipantTag[] }) {
  if (!safe.length) return null;
  return (
    <div className="absolute right-[3%] bottom-[7%] z-10 flex items-center gap-[0.8rem] rounded-[1rem] bg-void/75 px-[1rem] py-[0.6rem]" data-testid="safe-corner">
      <span className="font-term text-[2.2rem] leading-none tracking-[0.1em] text-mint">SAFE</span>
      <ul className="flex gap-[0.5rem]" aria-label={`Safe: ${safe.map((t) => t.name).join(", ")}`}>
        {safe.map((t) => (
          <li key={t.id}>
            <Bot color={t.color} head={t.head} mood="idle" size="2.6rem" delay={botDelay(t.id)} label={t.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WildCardIntroStage({ view, stage }: { view: HostView; stage: Stage<"wcIntro"> }) {
  const w = stage.wildCard;
  return (
    <Panel top={contentTop(view.cast.length)} className="justify-center !gap-[2.4rem]">
      <motion.p
        className="font-term leading-none tracking-[0.1em] text-bright"
        style={{ fontSize: "11rem" }}
        initial={{ opacity: 0, scale: 1.15 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
      >
        WILD CARD
      </motion.p>
      <motion.p className="host-hint max-w-[90rem] !text-[3.2rem] text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
        One of you gets a seat in Blackout. Most correct in <span className="font-term text-[4.2rem] leading-none text-amber">{w.questionCount}</span> questions
        wins.
      </motion.p>
      <motion.p className="host-count" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>
        <b>{w.players}</b> playing for the last seat · a tie goes to the faster
      </motion.p>
    </Panel>
  );
}

/** Top 10 by correct answers (then time): "4 / 5", the leader outlined in mint. */
export function WildCardStandingsStage({ view, stage }: { view: HostView; stage: Stage<"wcStandings" | "wcWinner"> }) {
  const mood = useMoods(view);
  const w = stage.wildCard;
  const sd = w.suddenDeath;
  const asked = w.questionNumber;
  return (
    <Panel top={contentTop(view.cast.length)}>
      <Heading size="5rem">{sd ? "Sudden death" : `Wild card after ${w.questionNumber} of ${w.questionCount}`}</Heading>
      {sd && <p className="host-hint !text-alarm">Exact tie: only {sd.alive.map((t) => t.name).join(" and ")} play on. Wrong answer = out.</p>}
      <ol className="grid w-full grid-flow-col grid-rows-5 gap-x-[4rem] gap-y-[1.2rem]">
        {w.standings.map((s, i) => {
          const lead = i === 0 && s.correct > 0;
          return (
            <motion.li
              key={s.id}
              layout
              className={`flex items-center gap-[1.6rem] rounded-[1rem] px-[1rem] py-[0.4rem] ${lead ? "outline-[0.3rem] outline-mint outline-solid" : ""}`}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <span className="w-[4.4rem] text-right font-term text-[4rem] leading-none text-amber">{s.rank}</span>
              <Bot color={s.color} head={s.head} mood={mood(s.id)} size="4.4rem" delay={botDelay(s.id)} />
              <span className={`host-name min-w-0 flex-1 truncate !text-[2.6rem] ${lead ? "!text-mint" : ""}`}>{s.name}</span>
              <span className="font-term text-[4rem] leading-none text-amber">
                {s.correct}
                <span className="text-[2.6rem] text-fog"> / {asked}</span>
              </span>
            </motion.li>
          );
        })}
      </ol>
    </Panel>
  );
}

/** The sweep: the wall of wild card players. Everyone but the winner powers down, left to right. */
function SweepWall({ cast, w, sweepMs }: { cast: HostView["cast"]; w: WildCardState; sweepMs: number }) {
  const players = cast;
  const n = players.length;
  const rows = n <= 40 ? 2 : 3;
  const perRow = Math.max(1, Math.ceil(n / rows));
  const size = Math.min(4.6, 112.8 / perRow - 1);
  return (
    <ul
      className="absolute top-[2%] right-[3%] left-[3%] z-10 flex flex-wrap justify-center gap-x-[1rem] gap-y-[0.9rem] pt-[0.5rem]"
      aria-label={`${n} wild card players`}
    >
      {players.map((p, i) => {
        const winner = p.id === w.winner?.id;
        return (
          <li
            key={p.id}
            className={winner ? "" : "wc-sweep"}
            style={{ animationDelay: `${300 + (i / Math.max(1, n - 1)) * sweepMs}ms` }}
          >
            <Bot color={p.color} head={p.head} mood={winner ? "right" : "idle"} size={`${size}rem`} delay={botDelay(p.id)} label={p.name} />
          </li>
        );
      })}
    </ul>
  );
}

export function WildCardWinnerStage({ view, stage }: { view: HostView; stage: Stage<"wcStandings" | "wcWinner"> }) {
  const mood = useMoods(view);
  const w = stage.wildCard;
  const winner = w.winner;
  const sweepMs = 1100;
  return (
    <>
      <SweepWall cast={view.cast} w={w} sweepMs={sweepMs} />
      <Panel top="26%">
        {winner ? (
          <motion.div
            className="flex flex-col items-center gap-[1.6rem]"
            initial={{ scale: 0.2, opacity: 0, y: -160 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 18, delay: (300 + sweepMs + 250) / 1000 }}
          >
            <Bot color={winner.color} head={winner.head} mood={mood(winner.id, "right")} size="15rem" delay={0} label={winner.name} />
            <p className="font-term text-[9rem] leading-none tracking-[0.12em] text-mint">WILD CARD</p>
            <p className="host-q host-q-center !text-[5.4rem]">{winner.name}</p>
            {w.fallback && <p className="host-hint">No one scored, so 10th place takes the seat.</p>}
          </motion.div>
        ) : (
          <p className="host-hint">Nobody is left in the wild card round.</p>
        )}
      </Panel>
    </>
  );
}

/** Predictions: the finalists as big bots in two rows of 5, the live split under each. */
export function PredictionsStage({ view, stage }: { view: HostView; stage: Stage<"predictions"> }) {
  return (
    <Panel top="17%" className="!gap-[2rem]">
      <Heading size="5.4rem">Who will escape?</Heading>
      <p className="host-hint text-center">
        Back a finalist on your phone · <span className="font-term text-[4.2rem] leading-none text-amber">{stage.backing.backers}</span> backing
      </p>
      <FinalistGrid view={view} finalists={stage.finalists} backing={stage.backing} />
    </Panel>
  );
}

function FinalistGrid({ view, finalists, backing }: { view: HostView; finalists: FinalistInfo[]; backing: Backing }) {
  const mood = useMoods(view);
  const total = Object.values(backing.counts).reduce((a, b) => a + b, 0);
  return (
    <ul className="grid w-full grid-cols-5 justify-items-center gap-x-[2rem] gap-y-[2.4rem]">
      {finalists.map((f) => {
        const pct = total ? Math.round(((backing.counts[f.id] ?? 0) / total) * 100) : 0;
        return (
          <li key={f.id} className="flex w-[14rem] flex-col items-center gap-[0.6rem]">
            <Bot color={f.color} head={f.head} mood={mood(f.id)} size="7.4rem" delay={botDelay(f.id)} />
            <span className="host-name max-w-full truncate !text-[2.2rem]">{f.name}</span>
            {f.wildCard && <span className="font-term text-[1.8rem] leading-none text-mint-soft">WC</span>}
            <span className="font-term text-[4rem] leading-none text-amber">
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
