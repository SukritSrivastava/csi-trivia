"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect } from "react";
import { usePageAway } from "@/lib/usePageAway";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerScreen, PlayerView } from "@/shared/protocol";
import { JoinForm } from "./JoinForm";
import { PlayHeader } from "./PlayHeader";
import {
  BuzzerScreen,
  DuelWatchScreen,
  EndScreen,
  PredictScreen,
  RemovedScreen,
  WatchScreen,
} from "./screens/FinalScreens";
import {
  AnswerScreen,
  GetReadyScreen,
  LobbyScreen,
  LockedInScreen,
  ResultScreen,
  RoundIntroScreen,
  RoundResultScreen,
} from "./screens/RoundScreens";

/**
 * The phone controller. Like the projector, it only draws what the server
 * sends: one screen at a time, one job at a time.
 */
export function PlayApp() {
  const connect = usePlayerStore((s) => s.connect);
  const view = usePlayerStore((s) => s.view);
  const status = usePlayerStore((s) => s.status);
  const resuming = usePlayerStore((s) => s.resuming);
  const tapped = usePlayerStore((s) => s.tapped);

  useEffect(() => connect(), [connect]);
  useWakeLock(view !== null);
  usePageAway(view !== null);

  if (!view) {
    if (resuming) {
      return (
        <main className="grid min-h-dvh place-items-center bg-marigold px-6 text-center text-ink">
          <p className="type-wide text-3xl font-black">Rejoining your quiz</p>
        </main>
      );
    }
    return <JoinForm />;
  }

  // Show "Locked in" the instant an option is tapped, before the server confirms.
  const screen = view.screen;
  const optimisticLock =
    screen.kind === "answer" && tapped && screen.options.some((o) => o.id === tapped.optionId) ? tapped.text : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col bg-ink text-paper">
        <PlayHeader view={view} />
        {status === "offline" && (
          <p className="bg-side-a px-4 py-2 text-center text-sm font-bold text-ink" role="status">
            Connection lost. Reconnecting…
          </p>
        )}
        {view.paused && (
          <p className="bg-marigold px-4 py-2 text-center text-sm font-black text-ink" role="status">
            Paused by the organiser
          </p>
        )}
        <main className="relative flex flex-1 flex-col overflow-hidden px-5 pt-6 pb-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={screenKey(screen, optimisticLock)}
              className="flex flex-1 flex-col"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {optimisticLock ? <LockedInScreen choiceText={optimisticLock} /> : <Screen view={view} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </MotionConfig>
  );
}

function Screen({ view }: { view: PlayerView }) {
  const { screen } = view;
  switch (screen.kind) {
    case "lobby":
      return <LobbyScreen screen={screen} me={view.me} />;
    case "roundIntro":
      return <RoundIntroScreen screen={screen} />;
    case "getReady":
      return <GetReadyScreen screen={screen} />;
    case "answer":
      return <AnswerScreen screen={screen} paused={view.paused} />;
    case "lockedIn":
      return <LockedInScreen choiceText={screen.choiceText} />;
    case "result":
      return <ResultScreen screen={screen} />;
    case "roundResult":
      return <RoundResultScreen screen={screen} />;
    case "watch":
      return <WatchScreen screen={screen} />;
    case "predict":
      return <PredictScreen screen={screen} />;
    case "buzzer":
      return <BuzzerScreen screen={screen} />;
    case "duelWatch":
      return <DuelWatchScreen screen={screen} />;
    case "end":
      return <EndScreen screen={screen} />;
    case "removed":
      return <RemovedScreen />;
  }
}

/** A new key plays the screen transition. Same key = update in place (no flicker). */
function screenKey(screen: PlayerScreen, optimisticLock: string | null): string {
  if (optimisticLock || screen.kind === "lockedIn") return "locked";
  switch (screen.kind) {
    case "answer":
      return `answer-${screen.options[0]?.id}`;
    case "getReady":
      return `ready-${screen.questionNumber}`;
    case "result":
      return `result-${screen.outcome}`;
    case "roundIntro":
      return `intro-${screen.round.number}`;
    case "watch":
      return `watch-${screen.title}`;
    case "buzzer":
    case "duelWatch":
      return "duel";
    default:
      return screen.kind;
  }
}
