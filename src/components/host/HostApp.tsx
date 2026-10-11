"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect } from "react";
import { useHostStore } from "@/stores/hostStore";
import type { HostView } from "@/shared/protocol";
import { HostTopBar } from "./HostTopBar";
import { LobbyStage } from "./LobbyStage";
import {
  AnswerStage,
  ChartStage,
  DuelStage,
  LeaderboardStage,
  PodiumStage,
  PredictionStage,
  ReadStage,
  RevealStage,
  RoundEndStage,
  RoundIntroStage,
} from "./PlaceholderStages";

/**
 * The projector. It never decides anything: it draws whatever HostView the
 * server sent last. PHASE 1: simple placeholder stages. Phase 2 builds the
 * real projector screens.
 */
export function HostApp() {
  const connect = useHostStore((s) => s.connect);
  const view = useHostStore((s) => s.view);
  const status = useHostStore((s) => s.status);

  useEffect(() => connect(), [connect]);

  // Preload the next question's image so it appears instantly.
  useEffect(() => {
    if (view?.nextImage) new Image().src = view.nextImage;
  }, [view?.nextImage]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="host-root relative flex min-h-dvh flex-col overflow-hidden bg-marigold text-ink">
        {view ? (
          <>
            <HostTopBar view={view} />
            <main className="relative flex flex-1 items-center justify-center px-[4rem] pb-[3rem]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={stageKey(view)}
                  className="flex w-full justify-center"
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -24 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <Stage view={view} />
                </motion.div>
              </AnimatePresence>
            </main>
            {view.paused && (
              <div className="absolute inset-x-0 top-[7rem] mx-auto w-fit rounded-full bg-ink px-[2rem] py-[0.6rem] text-[2rem] font-black text-marigold">
                Paused
              </div>
            )}
            {status === "offline" && (
              <div className="absolute inset-x-0 bottom-0 bg-ink px-[3rem] py-[1rem] text-center text-[1.5rem] font-bold text-paper">
                Lost connection to the quiz server. Reconnecting.
              </div>
            )}
          </>
        ) : (
          <div className="grid flex-1 place-items-center px-[4rem] text-center">
            {status === "offline" ? (
              <div className="max-w-[60rem]">
                <p className="type-wide text-[4rem] font-black leading-tight">Can&apos;t reach the quiz server</p>
                <p className="mt-[1.5rem] text-[1.8rem] text-ink-soft">
                  Start it with <code className="font-bold">npm run dev</code> in the project folder. This page reconnects on
                  its own.
                </p>
              </div>
            ) : (
              <p className="type-wide text-[3rem] font-black">Setting up the quiz</p>
            )}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

function Stage({ view }: { view: HostView }) {
  const { stage } = view;
  switch (stage.phase) {
    case "lobby":
      return <LobbyStage view={view} />;
    case "roundIntro":
      return <RoundIntroStage stage={stage} />;
    case "read":
      return <ReadStage view={view} stage={stage} />;
    case "answer":
      return <AnswerStage view={view} stage={stage} />;
    case "reveal":
      return <RevealStage stage={stage} />;
    case "chart":
      return <ChartStage stage={stage} />;
    case "leaderboard":
      return <LeaderboardStage stage={stage} />;
    case "roundEnd":
      return <RoundEndStage stage={stage} />;
    case "prediction":
      return <PredictionStage view={view} stage={stage} />;
    case "duel":
      return <DuelStage view={view} stage={stage} />;
    case "podium":
      return <PodiumStage stage={stage} />;
  }
}

/** A new key makes AnimatePresence play the exit/enter transition. */
function stageKey(view: HostView) {
  const { stage } = view;
  if ("question" in stage && stage.phase !== "read" && stage.phase !== "answer") return `${stage.phase}-${stage.question.id}`;
  if (stage.phase === "read" || stage.phase === "answer") return `q-${stage.question.id}-${stage.question.number}`;
  if (stage.phase === "duel") return `duel-${stage.duel.question.number}`;
  return stage.phase;
}
