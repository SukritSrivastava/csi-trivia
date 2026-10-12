"use client";

/**
 * After the cut: backing a finalist (audience), the finalist's BUZZ screen,
 * and the audience's view of the buzzer round.
 */
import { AnimatePresence, motion } from "motion/react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { vibrate } from "@/lib/format";
import type { BotMood, ParticipantScreen, ParticipantTag, ParticipantView, Round2Phone } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { FinalistGrid, PhoneTitle } from "./parts";

type Screen<K extends ParticipantScreen["kind"]> = Extract<ParticipantScreen, { kind: K }>;

export function BackFinalistScreen({ screen: s }: { screen: Screen<"backFinalist"> }) {
  const back = useParticipantStore((st) => st.back);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PhoneTitle>Who will win?</PhoneTitle>
      <p className="text-[1.1rem] leading-snug opacity-85">Back a finalist. You can change your pick until the buzzer round starts.</p>
      <div className="mt-auto grid grid-cols-2 gap-3" role="group" aria-label="Finalists">
        {s.finalists.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => back(f.id)}
            aria-pressed={s.backedId === f.id}
            className="phone-opt min-w-0 flex-col justify-center gap-2 py-4 text-center text-[1.1rem]"
            data-testid="back"
          >
            <Bot color={f.color} head={f.head} size="56px" delay={botDelay(f.id)} />
            <span className="w-full truncate">{f.name}</span>
          </button>
        ))}
      </div>
      <p className="min-h-7 text-center text-[1.05rem] text-mint" role="status">
        {s.backedId ? `You backed ${s.finalists.find((f) => f.id === s.backedId)?.name ?? "a finalist"}.` : ""}
      </p>
    </div>
  );
}

/** "Riya got it", "Nobody got it", for both finalists and the audience. */
function outcomeLine(r: Round2Phone, meId: string): string {
  if (!r.outcome) return "";
  if (r.outcome.kind === "correct") return r.outcome.by.id === meId ? "You got it!" : `${r.outcome.by.name} got it.`;
  if (r.outcome.kind === "voided") return "The quizmaster cancelled that question.";
  return r.outcome.reason === "timeUp" ? "Nobody buzzed in time." : "Nobody got it.";
}

function stepLine(r: Round2Phone): string {
  switch (r.step) {
    case "intro":
      return "The buzzer round is about to start.";
    case "scores":
      return "Scores. Next question coming up.";
    case "suddenDeath":
      return "Sudden death! Tied for first.";
    case "read":
      return "Buzzers locked. Read the question.";
    case "buzzOpen":
      return r.wrong.length ? "Buzzers open again!" : "Buzzers open!";
    default:
      return "";
  }
}

/** Whoever buzzed, big: their bot and name. */
function Buzzed({ who }: { who: ParticipantTag }) {
  return (
    <motion.div className="flex flex-col items-center gap-2" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 18 }}>
      <Bot color={who.color} head={who.head} mood="locked" size="clamp(96px, 30vw, 130px)" delay={0} />
      <p className="font-term text-[clamp(2.6rem,13vw,3.6rem)] leading-none" style={{ color: who.color, textShadow: `0 0 8px ${who.color}` }}>
        {who.name.toUpperCase()}
      </p>
    </motion.div>
  );
}

export function BuzzerScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"buzzer"> }) {
  const buzz = useParticipantStore((st) => st.buzz);
  const buzzedOn = useParticipantStore((st) => st.buzzedOn);
  const me = view.me;
  const mine = s.buzzedBy?.id === me.id;
  // Tapped BUZZ, server hasn't answered yet: show it as taken straight away.
  const pending = !s.buzzedBy && !s.lockedOut && !s.myResult && !!s.questionId && buzzedOn === s.questionId && s.step === "buzzOpen";
  const live = s.canBuzz && !pending && !view.paused;

  let mood: BotMood = "idle";
  let line = stepLine(s);
  let big: string | null = null;
  let bad = false;
  if (s.step === "reveal") {
    if (s.myResult === "correct") [mood, big] = ["right", "CORRECT"];
    else if (s.myResult === "wrong") [mood, big, bad] = ["wrong", "WRONG", true];
    line = outcomeLine(s, me.id);
  } else if (mine || pending) {
    mood = "locked";
    line = mine ? "You buzzed! Say your answer out loud." : "Buzzed…";
  } else if (s.lockedOut) {
    mood = "wrong";
    line = "Locked out this question.";
  } else if (s.buzzedBy) {
    line = `${s.buzzedBy.name} buzzed`;
  } else if (!s.inPlay) {
    mood = "out";
    line = "Sitting this one out: only the tied finalists play.";
  } else if (live) {
    mood = "thinking";
  }

  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="buzzer-screen" data-step={s.step}>
      <div className="flex items-center gap-3">
        <Bot color={me.color} head={me.head} mood={mood} size="58px" label="Your bot" />
        <p className="min-w-0 flex-1 text-[1.05rem] leading-tight opacity-85">{me.name}</p>
        <p className="text-right text-sm leading-tight">
          Your points
          <br />
          <span className="font-term text-[2.4rem] leading-none text-amber" data-testid="my-points">
            {s.points}
          </span>
        </p>
      </div>

      <p className="min-h-[3.2rem] text-center text-[clamp(1.2rem,6vw,1.5rem)] leading-tight text-balance" role="status" data-testid="buzzer-line">
        {line}
      </p>

      <div className="grid min-h-[min(68vw,18rem)] flex-1 place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {big ? (
            <motion.p key="big" className="phone-result !text-[clamp(3rem,16vw,4.4rem)]" data-bad={bad ? "true" : undefined} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              {big}
            </motion.p>
          ) : s.buzzedBy && !mine ? (
            <Buzzed key={`b-${s.buzzedBy.id}`} who={s.buzzedBy} />
          ) : (
            <motion.button
              key="buzz"
              type="button"
              onClick={() => {
                if (!live || !s.questionId) return;
                vibrate([30, 40, 30]);
                buzz(s.questionId);
              }}
              disabled={!live}
              aria-label={live ? "Buzz" : "Buzz (not open)"}
              data-testid="buzz"
              data-live={live}
              className="phone-buzz"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {mine || pending ? "BUZZED" : "BUZZ"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <FinalistGrid finalists={s.finalists} buzzedId={s.buzzedBy?.id} meId={me.id} />
    </div>
  );
}

export function BuzzerWatchScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"buzzerWatch"> }) {
  const backed = s.finalists.find((f) => f.id === s.backedId);
  const line = s.step === "reveal" ? outcomeLine(s, view.me.id) : s.buzzedBy ? `${s.buzzedBy.name} buzzed` : stepLine(s) || "Watch the projector.";
  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="buzzer-watch" data-step={s.step}>
      <p className="min-h-[3.2rem] text-center text-[clamp(1.2rem,6vw,1.5rem)] leading-tight text-balance" role="status">
        {line}
      </p>
      <div className="grid min-h-[9rem] flex-1 place-items-center">
        {s.buzzedBy && s.step === "answering" ? (
          <Buzzed key={s.buzzedBy.id} who={s.buzzedBy} />
        ) : (
          <Bot color={view.me.color} head={view.me.head} mood={s.step === "buzzOpen" ? "thinking" : "idle"} size="clamp(96px, 30vw, 130px)" label="Your bot" />
        )}
      </div>
      <p className="text-center text-base opacity-80">{backed ? `You backed ${backed.name}.` : "You didn't back anyone."}</p>
      <FinalistGrid finalists={s.finalists} backedId={s.backedId} buzzedId={s.step === "answering" ? s.buzzedBy?.id : null} />
    </div>
  );
}
