"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect } from "react";
import { useHostStore } from "@/stores/hostStore";
import type { HostView } from "@/shared/protocol";
import { AnswerStage } from "./AnswerStage";
import { EndStage } from "./EndStage";
import { HostTopBar } from "./HostTopBar";
import { IntroStage } from "./IntroStage";
import { LobbyStage } from "./LobbyStage";
import { RevealStage } from "./RevealStage";
import { ScoresStage } from "./ScoresStage";
import { VoteStage } from "./VoteStage";

/**
 * The TV. It never decides anything: it draws whatever `HostView` the server
 * sent last. Each phase of the game is its own component below.
 */
export function HostApp() {
  const connect = useHostStore((s) => s.connect);
  const view = useHostStore((s) => s.view);
  const status = useHostStore((s) => s.status);

  useEffect(() => connect(), [connect]);

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
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <Stage view={view} />
                </motion.div>
              </AnimatePresence>
            </main>
            {status === "offline" && <ConnectionLost />}
          </>
        ) : (
          <Connecting status={status} />
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
    case "intro":
      return <IntroStage round={stage.round} />;
    case "answer":
      return <AnswerStage view={view} stage={stage} />;
    case "vote":
      return <VoteStage view={view} stage={stage} />;
    case "reveal":
      return <RevealStage view={view} stage={stage} />;
    case "scores":
      return <ScoresStage view={view} stage={stage} />;
    case "end":
      return <EndStage view={view} stage={stage} />;
  }
}

/** A new key makes AnimatePresence play the exit/enter transition. */
function stageKey(view: HostView) {
  const { stage } = view;
  if (stage.phase === "vote" || stage.phase === "reveal") return `${stage.phase}-${stage.matchupIndex}`;
  if ("round" in stage) return `${stage.phase}-${stage.round.index}`;
  return stage.phase;
}

function Connecting({ status }: { status: string }) {
  return (
    <div className="grid flex-1 place-items-center px-[4rem] text-center">
      {status === "offline" ? (
        <div className="max-w-[60rem]">
          <p className="type-wide text-[4rem] font-black leading-tight">Can&apos;t reach the game server</p>
          <p className="mt-[1.5rem] text-[1.8rem] text-ink-soft">
            Start it with <code className="font-bold">npm run dev</code> in the project folder. This page
            reconnects on its own.
          </p>
        </div>
      ) : (
        <p className="type-wide text-[3rem] font-black">Setting up the room</p>
      )}
    </div>
  );
}

function ConnectionLost() {
  return (
    <div className="absolute inset-x-0 bottom-0 bg-ink px-[3rem] py-[1rem] text-center text-[1.5rem] font-bold text-paper">
      Lost connection to the game server. Reconnecting.
    </div>
  );
}
