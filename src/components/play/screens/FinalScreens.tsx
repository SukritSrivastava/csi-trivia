"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { celebrate } from "@/lib/confetti";
import { vibrate } from "@/lib/format";
import { usePlayerStore } from "@/stores/playerStore";
import type { DuelOutcome, Finalist, PlayerScreen } from "@/shared/protocol";
import { Centered } from "./RoundScreens";

type Screen<K extends PlayerScreen["kind"]> = Extract<PlayerScreen, { kind: K }>;

export function WatchScreen({ screen }: { screen: Screen<"watch"> }) {
  return (
    <Centered>
      <p className="type-wide text-4xl font-black leading-tight text-balance">{screen.title}</p>
      {screen.detail && <p className="mt-4 max-w-[22rem] text-lg text-paper/80">{screen.detail}</p>}
    </Centered>
  );
}

export function RemovedScreen() {
  const leave = usePlayerStore((s) => s.leave);
  return (
    <Centered>
      <p className="type-wide text-3xl font-black">You&apos;ve been removed from this quiz</p>
      <p className="mt-4 text-lg text-paper/80">Ask the organiser if this was a mistake.</p>
      <button type="button" onClick={leave} className="mt-8 text-base font-bold underline underline-offset-4">
        Back to the join page
      </button>
    </Centered>
  );
}

export function PredictScreen({ screen }: { screen: Screen<"predict"> }) {
  const predict = usePlayerStore((s) => s.predict);
  // Show the tap straight away; the server's answer follows a moment later.
  const [picked, setPicked] = useState<string | null>(screen.backedId);
  useEffect(() => setPicked(screen.backedId), [screen.backedId]);

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="type-wide text-4xl font-black leading-tight">Who wins the final?</h1>
      <p className="mt-2 text-lg text-paper/80">Back one finalist. You can change your pick until the duel starts.</p>
      <div className="mt-6 grid flex-1 grid-rows-2 gap-4">
        {screen.finalists.map((f) => {
          const chosen = picked === f.id;
          return (
            <motion.button
              key={f.id}
              type="button"
              aria-pressed={chosen}
              onClick={() => {
                vibrate(30);
                setPicked(f.id);
                predict(f.id);
              }}
              className={`press flex items-center gap-4 px-5 text-left ${chosen ? "bg-marigold text-ink" : "bg-paper text-ink"}`}
              animate={{ scale: chosen ? 1.02 : 1 }}
            >
              <Avatar name={f.name} color={f.color} size={4.2} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xl font-black">{f.name}</span>
                <span className="block text-base font-bold opacity-70">{chosen ? "Your pick" : "Tap to back"}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function Score({ me, opponent, pointsToWin }: { me: Finalist; opponent: Finalist; pointsToWin: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-paper/10 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={me.name} color={me.color} size={2.2} />
        <span className="truncate font-black">You</span>
      </span>
      <span className="type-wide text-3xl font-black tabular-nums">
        {me.points} – {opponent.points}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-2">
        <span className="truncate font-black">{opponent.name}</span>
        <Avatar name={opponent.name} color={opponent.color} size={2.2} />
      </span>
      <span className="sr-only">First to {pointsToWin} wins.</span>
    </div>
  );
}

function outcomeText(outcome: DuelOutcome | null, meId: string, opponentName: string) {
  if (!outcome) return "";
  switch (outcome.kind) {
    case "correct":
      return outcome.playerId === meId ? "+1 point!" : `${opponentName} got it`;
    case "steal":
      return outcome.playerId === meId ? "You stole it!" : `${opponentName} stole it`;
    case "bothWrong":
      return "Nobody got it";
    case "noBuzz":
      return "Nobody buzzed";
  }
}

export function BuzzerScreen({ screen }: { screen: Screen<"buzzer"> }) {
  const buzz = usePlayerStore((s) => s.buzz);
  const [pressed, setPressed] = useState(false);
  const { me, opponent, step, buzzedId, deathZoneId } = screen;
  useEffect(() => setPressed(false), [step]);

  let headline = "";
  let detail = "";
  if (step === "read") {
    headline = "Get ready";
    detail = "Read the question on the projector. The buzzer opens in a moment.";
  } else if (step === "buzz") {
    headline = screen.canBuzz ? "Buzz if you know it" : "Buzzing…";
  } else if (step === "answer") {
    headline = buzzedId === me.id ? "Say your answer out loud!" : `${opponent.name} buzzed first`;
    detail = buzzedId === me.id ? "The organiser will mark it." : "If they're wrong, you get a chance to win it.";
  } else if (step === "steal") {
    headline = deathZoneId === me.id ? "You're in the death zone" : "Your chance! Answer out loud";
    detail =
      deathZoneId === me.id
        ? `If ${opponent.name} gets this right, they win the final.`
        : "Get it right and you win the whole final.";
  } else if (step === "result") {
    headline = outcomeText(screen.outcome, me.id, opponent.name);
  }

  const live = step === "buzz" && screen.canBuzz && !pressed;
  const youAnswer = (step === "answer" && buzzedId === me.id) || (step === "steal" && deathZoneId !== me.id);

  return (
    <div className="flex flex-1 flex-col">
      <Score me={me} opponent={opponent} pointsToWin={screen.pointsToWin} />
      <p className="mt-2 text-center text-sm font-semibold text-paper/70">First to {screen.pointsToWin} wins</p>

      <div className="grid flex-1 place-items-center py-6">
        <motion.button
          type="button"
          disabled={!live}
          onClick={() => {
            setPressed(true);
            vibrate([40, 30, 80]);
            buzz();
          }}
          aria-label="Buzz"
          className="grid aspect-square place-items-center rounded-full border-[6px] border-ink text-ink disabled:cursor-default"
          style={{
            width: "min(78vw, 20rem)",
            background: youAnswer ? "var(--color-side-b)" : live ? "var(--color-side-a)" : "#4a3f7a",
            boxShadow: live ? "0 10px 0 var(--color-ink)" : "0 3px 0 var(--color-ink)",
          }}
          animate={live ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={live ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          whileTap={live ? { scale: 0.92, y: 8 } : undefined}
        >
          <span className="type-wide text-5xl font-black">{youAnswer ? "Talk!" : live ? "BUZZ" : step === "result" ? "…" : "Wait"}</span>
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${step}-${buzzedId}-${deathZoneId}`}
          className="text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <p className="type-wide text-3xl font-black leading-tight text-balance">{headline}</p>
          {detail && <p className="mt-2 text-base text-paper/80">{detail}</p>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function DuelWatchScreen({ screen }: { screen: Screen<"duelWatch"> }) {
  const [a, b] = screen.finalists;
  const backed = screen.finalists.find((f) => f.id === screen.backedId);
  return (
    <Centered>
      <p className="text-lg font-semibold text-paper/75">The final. First to {screen.pointsToWin} wins.</p>
      <div className="mt-6 grid w-full grid-cols-2 gap-3">
        {[a, b].map((f) => (
          <div
            key={f.id}
            className={`flex flex-col items-center gap-2 rounded-2xl p-4 ${f.id === screen.backedId ? "bg-marigold text-ink" : "bg-paper/10"}`}
          >
            <Avatar name={f.name} color={f.color} size={4} />
            <span className="w-full truncate text-lg font-black">{f.name}</span>
            <span className="type-wide text-5xl font-black tabular-nums">{f.points}</span>
          </div>
        ))}
      </div>
      <p className="mt-6 text-lg">{backed ? `You backed ${backed.name}` : "You didn't back anyone this time"}</p>
    </Centered>
  );
}

export function EndScreen({ screen }: { screen: Screen<"end"> }) {
  const leave = usePlayerStore((s) => s.leave);
  useEffect(() => {
    if (screen.place === "winner") celebrate("big");
    else if (screen.calledIt) celebrate("small");
  }, [screen.place, screen.calledIt]);

  let title = "";
  let detail = "";
  switch (screen.place) {
    case "winner":
      title = "You won the Hermes Quiz!";
      detail = "Take a bow.";
      break;
    case "runnerUp":
      title = "Runner-up!";
      detail = `What a final. ${screen.winnerName} took it this time.`;
      break;
    case "out":
      title = `${screen.winnerName} wins`;
      detail = screen.outInRound ? `You made it to round ${screen.outInRound}.` : "";
      break;
    case "audience":
      title = `${screen.winnerName} wins`;
      break;
  }
  const called =
    screen.calledIt === true ? "You called it!" : screen.calledIt === false ? "Your pick didn't win this time." : null;

  return (
    <div className="flex flex-1 flex-col">
      <Centered>
        <motion.p
          className="type-wide text-5xl font-black leading-tight text-balance"
          initial={{ scale: 0.5, rotate: -6, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 12 }}
        >
          {title}
        </motion.p>
        {detail && <p className="mt-4 text-lg text-paper/80">{detail}</p>}
        {called && <p className="mt-4 text-xl font-black text-marigold">{called}</p>}
      </Centered>
      <button type="button" onClick={leave} className="py-3 text-base font-bold underline underline-offset-4">
        Leave quiz
      </button>
    </div>
  );
}
