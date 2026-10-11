"use client";

import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ordinal, textOn, vibrate } from "@/lib/format";
import { celebrate } from "@/lib/confetti";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlayerScreen, PlayerView } from "@/shared/protocol";

type Screen<K extends PlayerScreen["kind"]> = Extract<PlayerScreen, { kind: K }>;

/** Each phone sees its own shuffled order; the colour is just the button's position. */
const OPTION_COLORS = ["#FF3D7F", "#00A6A6", "#7B5CFF", "#FF6B1A"];

export function LobbyScreen({ screen, me }: { screen: Screen<"lobby">; me: PlayerView["me"] }) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="type-wide text-4xl font-black leading-tight">You&apos;re in</h1>
      <p className="mt-2 text-lg text-paper/80">Find your name on the projector.</p>
      <div className="grid flex-1 place-items-center py-6">
        <motion.div
          initial={{ scale: 0.5, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 14 }}
        >
          <Avatar name={me.name} color={me.color} size={9} />
        </motion.div>
      </div>
      <p className="text-lg font-semibold">
        {screen.playerCount} {screen.playerCount === 1 ? "player has" : "players have"} joined. The quiz starts soon.
      </p>
    </div>
  );
}

export function RoundIntroScreen({ screen }: { screen: Screen<"roundIntro"> }) {
  const { round } = screen;
  if (!screen.playing) {
    return (
      <Centered>
        <p className="text-lg font-semibold text-paper/75">Round {round.number} is starting</p>
        <p className="type-wide mt-2 text-3xl font-black">You&apos;re watching this one</p>
      </Centered>
    );
  }
  return (
    <Centered>
      <p className="text-lg font-semibold text-paper/75">
        Round {round.number} of {round.totalRounds}
      </p>
      <motion.p
        className="type-wide mt-1 text-6xl font-black leading-none"
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 12 }}
      >
        Top {round.advance}
      </motion.p>
      <p className="mt-2 text-xl font-bold">go through</p>
      <ul className="mt-8 space-y-2 text-lg text-paper/85">
        <li>
          {round.questionCount} questions, {round.secondsPerQuestion} seconds each
        </li>
        <li>Faster correct answers score more</li>
        {round.wrongPenalty > 0 && (
          <li className="font-bold text-marigold">Wrong answers cost {round.wrongPenalty} points</li>
        )}
      </ul>
    </Centered>
  );
}

export function GetReadyScreen({ screen }: { screen: Screen<"getReady"> }) {
  return (
    <Centered>
      <p className="text-lg font-semibold text-paper/75">
        Question {screen.questionNumber} of {screen.questionCount}
      </p>
      <motion.p
        className="type-wide mt-2 text-5xl font-black leading-tight"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      >
        Eyes up
      </motion.p>
      <p className="mt-3 text-lg text-paper/80">Read the question on the projector. Options appear here next.</p>
    </Centered>
  );
}

export function AnswerScreen({ screen, paused }: { screen: Screen<"answer">; paused: boolean }) {
  const answer = usePlayerStore((s) => s.answer);
  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm font-bold text-paper/70">
        Question {screen.questionNumber} of {screen.questionCount}. First tap counts.
      </p>
      <div className="mt-3 grid flex-1 grid-rows-4 gap-3">
        {screen.options.map((option, i) => {
          const bg = OPTION_COLORS[i];
          return (
            <motion.button
              key={option.id}
              type="button"
              disabled={paused}
              onClick={() => {
                vibrate(30);
                answer(screen.questionId, option);
              }}
              className="press flex min-h-[4.5rem] items-center px-4 py-3 text-left text-[1.35rem] font-black leading-snug"
              style={{ background: bg, color: textOn(bg) }}
              initial={{ opacity: 0, x: i % 2 ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.18 }}
            >
              {option.text}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export function LockedInScreen({ choiceText }: { choiceText: string }) {
  return (
    <Centered>
      <motion.div
        className="mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-paper text-5xl"
        initial={{ scale: 0.3 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 15 }}
        aria-hidden
      >
        ✓
      </motion.div>
      <p className="type-wide mt-5 text-4xl font-black">Locked in</p>
      <p className="mt-3 text-lg text-paper/80">
        You picked <span className="font-bold text-paper">{choiceText}</span>
      </p>
      <p className="mt-6 text-base text-paper/60">Waiting for the reveal</p>
    </Centered>
  );
}

export function ResultScreen({ screen }: { screen: Screen<"result"> }) {
  useEffect(() => {
    if (screen.outcome === "correct") vibrate([20, 40, 20]);
    else if (screen.outcome === "wrong") vibrate(120);
  }, [screen.outcome]);

  const look = {
    correct: { bg: "var(--color-side-b)", title: "Correct!", mark: "✓" },
    wrong: { bg: "var(--color-side-a)", title: "Wrong", mark: "✕" },
    missed: { bg: "#4a3f7a", title: "Time's up", mark: "…" },
  }[screen.outcome];

  return (
    <motion.div
      className="-mx-5 -mt-6 -mb-8 flex flex-1 flex-col items-center justify-center px-6 text-center"
      style={{ background: look.bg, color: screen.outcome === "missed" ? "var(--color-paper)" : "var(--color-ink)" }}
      initial={screen.outcome === "wrong" ? { x: 0 } : { scale: 0.95, opacity: 0 }}
      animate={screen.outcome === "wrong" ? { x: [0, -14, 12, -8, 5, 0] } : { scale: 1, opacity: 1 }}
      transition={{ duration: 0.45 }}
    >
      <span className="text-8xl font-black leading-none" aria-hidden>
        {look.mark}
      </span>
      <p className="type-wide mt-4 text-5xl font-black">{look.title}</p>
      {screen.outcome === "missed" && <p className="mt-3 text-lg">No answer this time.</p>}
      {screen.penalty > 0 && <p className="mt-3 text-2xl font-black">−{screen.penalty} points</p>}
      <p className="mt-8 text-base font-semibold opacity-75">Leaderboard on the projector</p>
    </motion.div>
  );
}

export function RoundResultScreen({ screen }: { screen: Screen<"roundResult"> }) {
  useEffect(() => {
    if (screen.advanced) {
      vibrate([30, 60, 30, 60, 60]);
      celebrate(screen.isFinalRound ? "big" : "small");
    }
  }, [screen.advanced, screen.isFinalRound]);

  const title = screen.advanced ? (screen.isFinalRound ? "You're in the final!" : "You made it!") : "You're out";

  return (
    <Centered>
      <motion.p
        className="type-wide text-5xl font-black leading-tight text-balance"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 14 }}
      >
        {title}
      </motion.p>
      <p className="mt-6 text-lg text-paper/75">You finished</p>
      <p className="type-wide text-7xl font-black leading-none tabular-nums">
        <NumberFlow value={screen.rank} />
        <span className="text-4xl">{ordinal(screen.rank).replace(/^\d+/, "")}</span>
      </p>
      <p className="mt-2 text-lg text-paper/75">out of {screen.of} this round</p>
      {!screen.advanced && (
        <p className="mt-8 text-lg">Thanks for playing! Stay for the final duel: you&apos;ll get to back a finalist.</p>
      )}
    </Centered>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center text-center">{children}</div>;
}
