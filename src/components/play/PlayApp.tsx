"use client";

/**
 * The Participant (phone) screen. Renders ParticipantView from the server:
 * join → build your bot → every Round 1 state → cut → backing / buzzer → podium.
 * Look: the four phones in public/finaldesign.html (phone-bg, typewriter words,
 * terminal digits, no corridor). Keeps the screen awake, rejoins after a
 * refresh or a locked phone, and shows "Reconnecting…" / "Paused" bands.
 */
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Bot } from "@/components/ui/Bot";
import { celebrate } from "@/lib/confetti";
import { usePageVisibility } from "@/lib/usePageVisibility";
import { useWakeLock } from "@/lib/useWakeLock";
import type { ParticipantScreen, ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { BackFinalistScreen, BuzzerScreen, BuzzerWatchScreen } from "./BuzzerScreens";
import { JoinScreen } from "./JoinScreen";
import { LobbyScreen } from "./LobbyScreen";
import { Banner, PhoneHeader } from "./parts";
import { AnswerScreen, PodiumScreen, SimpleScreen } from "./Round1Screens";

export function PlayApp() {
  const connect = useParticipantStore((s) => s.connect);
  const view = useParticipantStore((s) => s.view);
  const status = useParticipantStore((s) => s.status);
  const resuming = useParticipantStore((s) => s.resuming);

  useEffect(() => connect(), [connect]);
  useWakeLock(view !== null && view.screen.kind !== "removed");
  usePageVisibility(view !== null);

  return (
    <MotionConfig reducedMotion="user">
      <div className="phone-bg min-h-dvh">
        <main
          className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-[max(1.25rem,env(safe-area-inset-left))] pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          data-testid="play"
        >
          {view ? (
            <Playing view={view} offline={status !== "online"} />
          ) : resuming ? (
            <div className="my-auto flex flex-col items-center gap-4 text-center" data-testid="rejoining">
              <Bot color="#6cf0b0" head="antenna" mood="thinking" size="96px" />
              <p className="text-[1.3rem]">Rejoining your quiz…</p>
            </div>
          ) : (
            <>
              {status === "offline" && <Banner testId="offline">CAN&apos;T REACH THE QUIZ. RETRYING…</Banner>}
              <JoinScreen />
            </>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}

function questionLabel(s: ParticipantScreen): string | null {
  switch (s.kind) {
    case "eyesUp":
    case "answer":
      return `Q${s.questionNumber} of ${s.questionCount}`;
    case "buzzer":
    case "buzzerWatch":
      if (!s.questionNumber) return "The buzzer round";
      return s.suddenDeath ? `Sudden death · Q${s.questionNumber}` : `Buzzer Q${s.questionNumber} of ${s.questionCount}`;
    default:
      return null;
  }
}

/** Screens that follow a question keep its "Q2 of 3" in the header. */
const AFTER_QUESTION = new Set<ParticipantScreen["kind"]>(["lockedIn", "timesUp", "result", "voided"]);

/** Changing this key plays the screen transition. */
function screenKey(s: ParticipantScreen): string {
  if (s.kind === "answer") return `answer:${s.questionId}`;
  if (s.kind === "eyesUp") return `eyes:${s.questionNumber}`;
  return s.kind;
}

function Playing({ view, offline }: { view: ParticipantView; offline: boolean }) {
  const s = view.screen;
  const lastQuestion = useRef<string | null>(null);
  const label = questionLabel(s);
  if (label && s.kind !== "buzzer" && s.kind !== "buzzerWatch") lastQuestion.current = label;
  const header =
    label ??
    (AFTER_QUESTION.has(s.kind) ? lastQuestion.current : null) ??
    (s.kind === "lobby" ? `Room ${view.roomCode} · ${view.me.name}` : `${view.me.name} · room ${view.roomCode}`);
  const key = screenKey(s);

  // Confetti for making the top 6, winning, and calling the winner.
  const celebration = s.kind === "cut" && s.madeIt ? "small" : s.kind === "podium" && s.place === 1 ? "big" : s.kind === "podium" && s.calledIt ? "small" : null;
  useEffect(() => {
    if (!celebration) return;
    const t = window.setTimeout(() => void celebrate(celebration, [view.me.color, "#6cf0b0", "#ffb627", "#e7fff4"]), 350);
    return () => window.clearTimeout(t);
    // Once per screen, not on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, celebration]);

  return (
    <>
      <PhoneHeader label={header} me={view.me} timer={view.timer} showBot={s.kind !== "buzzer"} />
      {offline && <Banner testId="reconnecting">RECONNECTING…</Banner>}
      {view.paused && !offline && <Banner testId="paused">PAUSED BY THE QUIZMASTER</Banner>}
      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={key}
          className="flex flex-1 flex-col"
          data-testid={`screen-${s.kind}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <Screen view={view} />
        </motion.section>
      </AnimatePresence>
    </>
  );
}

function Screen({ view }: { view: ParticipantView }) {
  const s = view.screen;
  switch (s.kind) {
    case "lobby":
      return <LobbyScreen view={view} joined={s.joined} />;
    case "answer":
      return <AnswerScreen screen={s} />;
    case "backFinalist":
      return <BackFinalistScreen screen={s} />;
    case "buzzer":
      return <BuzzerScreen view={view} screen={s} />;
    case "buzzerWatch":
      return <BuzzerWatchScreen view={view} screen={s} />;
    case "podium":
      return <PodiumScreen view={view} screen={s} />;
    default:
      return <SimpleScreen view={view} screen={s} />;
  }
}
