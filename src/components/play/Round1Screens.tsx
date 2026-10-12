"use client";

/**
 * Round 1 on the phone (intro, eyes up, answer, locked in, time's up, result,
 * cancelled), the cut, waiting screens, the podium and removed. The answer
 * buttons come in the Host's order, numbered 1–4 in amber.
 */
import { Bot } from "@/components/ui/Bot";
import { ordinal, vibrate } from "@/lib/format";
import type { ParticipantScreen, ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Moment, PhoneTitle } from "./parts";

type Screen<K extends ParticipantScreen["kind"]> = Extract<ParticipantScreen, { kind: K }>;

export function AnswerScreen({ screen: s }: { screen: Screen<"answer"> }) {
  const answer = useParticipantStore((st) => st.answer);
  const tapped = useParticipantStore((st) => st.tapped);
  const locked = tapped?.questionId === s.questionId ? tapped : null;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PhoneTitle>{locked ? "Locked in." : "Pick one. First tap locks."}</PhoneTitle>
      <div className="mt-auto flex flex-col gap-3" role="group" aria-label="Answers">
        {s.options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            className="phone-opt min-h-[4.25rem] gap-4 text-[clamp(1.1rem,5.4vw,1.4rem)] break-words"
            onClick={() => {
              if (locked) return;
              vibrate(25);
              answer(s.questionId, o);
            }}
            disabled={!!locked}
            aria-pressed={locked?.optionId === o.id}
            data-testid="option"
          >
            <span className={`font-term text-[2.4rem] leading-none ${locked?.optionId === o.id ? "text-void" : "text-amber"}`} aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">{o.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PodiumScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"podium"> }) {
  const me = view.me;
  const winnerLine = s.winner && s.winner.id !== me.id ? <p className="mt-2">{s.winner.name} won the quiz.</p> : null;
  if (s.place === 1)
    return (
      <Moment me={me} mood="right" big="YOU WON!" testId="podium-won">
        {s.basis === "buzzer" ? "Champion of the buzzer round." : "Top of the leaderboard."}
      </Moment>
    );
  if (s.place === 2 || s.place === 3)
    return (
      <Moment me={me} mood="right" big={s.place === 2 ? "2ND PLACE" : "3RD PLACE"}>
        On the podium!
        {winnerLine}
      </Moment>
    );
  if (s.place)
    return (
      <Moment me={me} mood="idle" big={ordinal(s.place).toUpperCase()}>
        You finished {ordinal(s.place)} {s.basis === "buzzer" ? "in the final" : `of ${s.of}`}.{winnerLine}
      </Moment>
    );
  if (s.calledIt)
    return (
      <Moment me={me} mood="right" big="CALLED IT!" testId="podium-called">
        You backed {s.backed?.name}, and they won.
      </Moment>
    );
  return (
    <Moment me={me} mood="out" big="GAME OVER" bad={s.calledIt === false}>
      {s.calledIt === false ? `Your pick, ${s.backed?.name}, didn't win this time.` : "Thanks for playing!"}
      {winnerLine}
    </Moment>
  );
}

/** Every screen without its own component. */
export function SimpleScreen({ view, screen: s }: { view: ParticipantView; screen: ParticipantScreen }) {
  const me = view.me;
  switch (s.kind) {
    case "r1Intro":
      return (
        <Moment me={me} mood="idle" big="ROUND 1">
          {s.settings.round1Questions} questions. Read each one on the projector, then answer here.
          <br />
          The top {s.settings.finalistCount} go to the buzzer round.
        </Moment>
      );
    case "nextQuestion":
      return (
        <Moment me={me} mood="idle" big="YOU'RE IN">
          You&apos;ll play from the next question.
        </Moment>
      );
    case "eyesUp":
      return (
        <div className="my-auto flex flex-col items-center gap-5 text-center" data-testid="eyes-up">
          <span className="animate-[eyes-up_1.6s_ease-in-out_infinite]">
            <Bot color={me.color} head={me.head} mood="idle" size="clamp(130px, 46vw, 196px)" label="Your bot" />
          </span>
          <p className="phone-result !text-[clamp(3rem,15vw,4.4rem)]">EYES UP</p>
          <p className="max-w-[20rem] text-[clamp(1.05rem,5vw,1.3rem)] leading-snug opacity-85">Read the question on the projector. Your options appear here next.</p>
        </div>
      );
    case "lockedIn":
      return (
        <Moment me={me} mood="locked" big={s.timeUp ? "TIME'S UP" : "LOCKED IN"} testId="locked-in">
          Locked in: {s.choiceText}
        </Moment>
      );
    case "timesUp":
      return (
        <Moment me={me} mood="idle" big="TIME'S UP" bad>
          No answer this time.
        </Moment>
      );
    case "result":
      return s.outcome === "correct" ? (
        <Moment me={me} mood="right" big="CORRECT" testId="result-correct">
          Your bot survives. For now.
        </Moment>
      ) : (
        <Moment me={me} mood="wrong" big={s.outcome === "missed" ? "MISSED" : "WRONG"} bad testId="result-wrong">
          It was {s.correctText}.
        </Moment>
      );
    case "voided":
      return (
        <Moment me={me} mood="idle" big="CANCELLED">
          The quizmaster cancelled that question. No points for anyone.
        </Moment>
      );
    case "cut":
      return s.madeIt ? (
        <Moment me={me} mood="right" big={`TOP ${s.finalistCount}`} testId="cut-in">
          You finished <b className="font-term text-[1.6em] font-normal text-amber">{ordinal(s.rank)}</b> of {s.of}. You&apos;re in the buzzer round!
        </Moment>
      ) : (
        <Moment me={me} mood="out" big="POWERED DOWN" bad testId="cut-out">
          You finished <b className="font-term text-[1.6em] font-normal text-amber">{ordinal(s.rank)}</b> of {s.of}. Stay on: you&apos;ll back a finalist next.
        </Moment>
      );
    case "audience":
      return (
        <Moment me={me} mood="idle" big="WATCHING">
          You&apos;re in the audience. You&apos;ll back a finalist soon.
        </Moment>
      );
    case "finalist":
      return (
        <Moment me={me} mood="right" big="FINALIST">
          Seat {s.seat} of {s.finalistCount}. Get ready to buzz.
        </Moment>
      );
    case "removed":
      return (
        <Moment me={me} mood="out" big="REMOVED" bad testId="removed">
          The quizmaster removed you from this quiz.
        </Moment>
      );
    default:
      return null;
  }
}
