"use client";

/**
 * Blackout on the projector (Phase 1: a plain but complete track; the bots
 * running toward the camera come in Phase 2). One lane per runner: the dark is
 * an alarm-red band growing from the left, each bot stands at its step, the
 * distance ahead of the dark in amber. On the reveal each move (+3 … −1) shows
 * beside the bot; when the dark moves, the ones it reaches power down (their
 * mood comes from the server) and get their place. Questions use QuestionStage.
 */
import { motion } from "motion/react";
import { Bot, botDelay } from "@/components/ui/Bot";
import type { BlackoutState, HostStage, HostView, Runner } from "@/shared/protocol";
import { contentTop, Heading, Panel } from "../parts";
import { TypeOut } from "./Round1Stages";

type Stage<P extends HostStage["phase"]> = Extract<HostStage, { phase: P }>;

const moveLabel = (d: number | null) => (d === null ? "" : d > 0 ? `+${d}` : d < 0 ? "−1" : "0");

function Track({ bo, showMoves }: { bo: BlackoutState; showMoves: boolean }) {
  // Steps on screen: from 0 to a little past the leader.
  const span = Math.max(12, ...bo.runners.map((r) => r.position + 3), bo.dark + 6);
  const pct = (step: number) => `${Math.min(100, (step / span) * 100)}%`;
  const lane = bo.runners.length > 8 ? "4.2rem" : "5.2rem";
  return (
    <ol className="flex w-full flex-col gap-[0.8rem]" aria-label="The chase">
      {bo.runners.map((r: Runner) => (
        <li key={r.id} className={`flex items-center gap-[1.4rem] ${r.alive ? "" : "opacity-45"}`} style={{ height: lane }}>
          <span className="host-name w-[14rem] shrink-0 truncate text-right !text-[2rem]">{r.name}</span>
          <div className="relative h-full flex-1 overflow-visible rounded-[0.6rem] border border-line bg-rack/70">
            {/* the dark */}
            <motion.div
              className="absolute inset-y-0 left-0 rounded-l-[0.6rem] bg-alarm/45 shadow-[0_0_1.6rem_var(--color-alarm)]"
              initial={{ width: pct(bo.darkFrom) }}
              animate={{ width: pct(bo.dark) }}
              transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1], delay: 0.2 }}
            />
            {/* the runner */}
            <motion.div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              initial={{ left: pct(showMoves ? r.from : r.position) }}
              animate={{ left: pct(r.position) }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
            >
              <Bot color={r.color} head={r.head} mood={r.mood} size={lane} delay={botDelay(r.id)} label={r.name} />
            </motion.div>
          </div>
          <span className="w-[6rem] shrink-0 text-right font-term text-[3.4rem] leading-none text-amber" aria-label={`${r.gap} steps ahead of the dark`}>
            {r.alive ? r.gap : r.place ? `#${r.place}` : ""}
          </span>
          <span className={`w-[4.6rem] shrink-0 font-term text-[3rem] leading-none ${r.delta && r.delta > 0 ? "text-mint" : r.delta && r.delta < 0 ? "text-wrong" : "text-fog"}`}>
            {showMoves && r.alive ? moveLabel(r.delta) : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function BlackoutIntroStage({ view, stage }: { view: HostView; stage: Stage<"boIntro"> }) {
  return (
    <Panel top={contentTop(view.cast.length)} className="!gap-[1.4rem]">
      <Heading size="6rem">Blackout</Heading>
      <p className="host-hint max-w-[96rem] text-center">
        The lights are dying behind you. Right answers move you forward (faster = further), wrong ones back. Each question the dark moves on; if it
        reaches you, you power down. Last bot running escapes.
      </p>
      <Track bo={stage.blackout} showMoves={false} />
    </Panel>
  );
}

/** After the reveal: the right answer, and every runner's move. */
export function BlackoutRevealStage({ view, stage }: { view: HostView; stage: Stage<"boReveal"> }) {
  return (
    <Panel top={contentTop(view.cast.length)} className="!gap-[1.2rem]">
      <TypeOut
        className="host-banner text-center"
        text={stage.voided ? "> question cancelled: nobody moves" : `> answer: ${(stage.correctText ?? "").toLowerCase()}`}
      />
      <Track bo={stage.blackout} showMoves={!stage.voided} />
      <p className="host-hint !text-[2.2rem]">The dark moves {stage.voided ? "not at all" : "next"}.</p>
    </Panel>
  );
}

/** The dark moves: whoever it reaches powers down. */
export function BlackoutDarkStage({ view, stage }: { view: HostView; stage: Stage<"boDark"> }) {
  const bo = stage.blackout;
  const caught = bo.runners.filter((r) => bo.caughtThisQuestion.includes(r.id));
  return (
    <Panel top={contentTop(view.cast.length)} className="!gap-[1.2rem]">
      <TypeOut
        className="host-banner text-center"
        text={caught.length ? `> the dark got ${caught.map((r) => r.name.toLowerCase()).join(", ")}` : "> nobody caught. keep running."}
      />
      <Track bo={bo} showMoves={false} />
      <p className="host-count">
        <b>{bo.alive}</b> still running{bo.over && bo.winner ? ` · ${bo.winner.name} escapes` : ""}
      </p>
    </Panel>
  );
}
