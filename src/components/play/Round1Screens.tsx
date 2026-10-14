"use client";

/**
 * Question screens for every round (eyes up, answer, locked in, time's up,
 * result, cancelled), Round 1's intro, the cut, waiting screens, the podium
 * and removed. The answer buttons come in the Host's order, numbered 1–4 in
 * amber. Blackout runners also see how far ahead of the dark they are.
 */
import { Bot } from "@/components/ui/Bot";
import { ordinal, vibrate } from "@/lib/format";
import type { ParticipantScreen, ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Gap, Moment, PhoneTitle, useSecondsLeft } from "./parts";

type Screen<K extends ParticipantScreen["kind"]> = Extract<ParticipantScreen, { kind: K }>;

export function AnswerScreen({ screen: s }: { screen: Screen<"answer"> }) {
  const answer = useParticipantStore((st) => st.answer);
  const tapped = useParticipantStore((st) => st.tapped);
  // Blackout: the server says which option this runner already tapped (survives a refresh).
  const chosen = s.chosenId ? s.options.find((o) => o.id === s.chosenId) : undefined;
  const locked = tapped?.questionId === s.questionId ? tapped : chosen ? { questionId: s.questionId, optionId: chosen.id, text: chosen.text } : null;
  return (
    <div className="flex flex-1 flex-col gap-4">
      {s.text ? (
        // Blackout: only the question and its options on the phone.
        <PhoneTitle>{s.text}</PhoneTitle>
      ) : (
        <PhoneTitle>{locked ? "Locked in." : s.suddenDeath ? "Sudden death. Wrong answer = out." : "Pick one. First tap locks."}</PhoneTitle>
      )}
      <div className="mt-auto flex flex-col gap-3" role="group" aria-label="Answers">
        {s.options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            className="phone-opt min-h-[4.25rem] gap-4 text-[clamp(1.1rem,5.4vw,1.4rem)] break-words"
            onClick={() => {
              if (locked) return;
              answer(s.questionId, o);
              vibrate(30); // only after the tap, on phones that can
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

function EyesUp({ view, screen: s }: { view: ParticipantView; screen: Screen<"eyesUp"> }) {
  const left = useSecondsLeft(view.timer);
  const me = view.me;
  return (
    <div className="my-auto flex flex-col items-center gap-5 text-center" data-testid="eyes-up">
      <span className="animate-[eyes-up_1.6s_ease-in-out_infinite]">
        <Bot color={me.color} head={me.head} mood="idle" size="clamp(130px, 46vw, 196px)" label="Your bot" />
      </span>
      <p className="phone-result !text-[clamp(3rem,15vw,4.4rem)]">EYES UP</p>
      <p className="max-w-[20rem] text-[clamp(1.05rem,5vw,1.3rem)] leading-snug opacity-85">
        Eyes on the screen. Your options appear here
        {left !== null && !view.paused ? (
          <>
            {" in "}
            <b className="font-term text-[1.5em] font-normal text-amber">{left}</b>
          </>
        ) : (
          " next"
        )}
        .
      </p>
      {s.gap !== null && (
        <p className="text-[1.1rem] opacity-85">
          <Gap n={s.gap} suffix="ahead of the dark" />
        </p>
      )}
      {s.suddenDeath && <p className="text-[1.1rem] text-amber">Sudden death: you&apos;re tied for the lead. Wrong answer = out.</p>}
    </div>
  );
}

export function PodiumScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"podium"> }) {
  const me = view.me;
  const winnerLine = s.winner && s.winner.id !== me.id ? <span className="mt-2 block">{s.winner.name} won the quiz.</span> : null;
  if (s.place === 1)
    return (
      <Moment me={me} mood="right" big="YOU WON!" testId="podium-won">
        {s.basis === "blackout" ? "Last bot running: you escaped the dark." : "Top of the leaderboard."}
      </Moment>
    );
  if (s.place === 2 || s.place === 3)
    return (
      <Moment me={me} mood="right" big={s.place === 2 ? "2ND PLACE" : "3RD PLACE"} testId="podium-place">
        On the podium!
        {winnerLine}
      </Moment>
    );
  if (s.place)
    return (
      <Moment me={me} mood="idle" big={ordinal(s.place).toUpperCase()} testId="podium-place">
        You finished {ordinal(s.place)} {s.basis === "blackout" ? "in Blackout" : `of ${s.of}`}.{winnerLine}
      </Moment>
    );
  if (s.calledIt)
    return (
      <Moment me={me} mood="right" big="CALLED IT!" testId="podium-called">
        You called it! You backed {s.backed?.name}, and they won.
      </Moment>
    );
  if (s.calledIt === false)
    return (
      <Moment me={me} mood="idle" big="GAME OVER" testId="podium-missed">
        Your pick, {s.backed?.name}, didn&apos;t win this time.
        {winnerLine}
      </Moment>
    );
  return (
    <Moment me={me} mood="idle" big="GAME OVER" testId="podium-thanks">
      Thanks for playing!
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
        <Moment me={me} mood="idle" big="ROUND 1" testId="r1-intro">
          Everyone plays. Answer fast: up to <b className="font-term text-[1.5em] font-normal text-amber">{s.settings.round1MaxPoints}</b> points a question.
          <span className="mt-2 block">
            Top <b className="font-term text-[1.5em] font-normal text-amber">{s.settings.safeCount}</b> go to Blackout; the rest get a wild card shot.
          </span>
        </Moment>
      );
    case "nextQuestion":
      return (
        <Moment me={me} mood="idle" big="YOU'RE IN">
          You&apos;ll play from the next question.
        </Moment>
      );
    case "eyesUp":
      return <EyesUp view={view} screen={s} />;
    case "lockedIn":
      return (
        <Moment me={me} mood="locked" big={s.timeUp ? "TIME'S UP" : "LOCKED IN"} testId="locked-in">
          Locked in: <b className="font-term text-[1.5em] font-normal text-amber">{s.choiceNumber}</b>. {s.choiceText}
          {s.gap !== null && (
            <span className="mt-2 block">
              <Gap n={s.gap} suffix="ahead of the dark" />
            </span>
          )}
        </Moment>
      );
    case "timesUp":
      return (
        <Moment me={me} mood="idle" big="TIME'S UP" testId="times-up">
          No answer this time.
        </Moment>
      );
    case "result":
      return s.outcome === "correct" ? (
        <Moment me={me} mood="right" big="CORRECT" testId="result-correct">
          {s.tally ? (
            <>
              <b className="font-term text-[1.5em] font-normal text-amber">{s.tally.right}</b> of {s.tally.asked} right.
            </>
          ) : (
            "Nice. Keep it up."
          )}
        </Moment>
      ) : (
        <Moment me={me} mood="wrong" big={s.outcome === "missed" ? "TOO SLOW" : "WRONG"} bad testId={s.outcome === "missed" ? "result-missed" : "result-wrong"}>
          It was {s.correctText}.
          {s.tally && (
            <span className="mt-2 block">
              <b className="font-term text-[1.5em] font-normal text-amber">{s.tally.right}</b> of {s.tally.asked} right.
            </span>
          )}
        </Moment>
      );
    case "voided":
      return (
        <Moment me={me} mood="idle" big="CANCELLED" testId="voided">
          That question was cancelled. No points either way.
        </Moment>
      );
    case "cut":
      return s.outcome === "safe" ? (
        <Moment me={me} mood="right" big="SAFE" testId="cut-in">
          You&apos;re through to Blackout.
          <span className="mt-2 block">
            Rank <b className="font-term text-[1.5em] font-normal text-amber">{s.rank}</b>
          </span>
        </Moment>
      ) : (
        <Moment me={me} mood="idle" big="NOT OUT YET" testId="cut-out">
          You&apos;re in the wild card round: one seat left.
          <span className="mt-2 block">
            Rank <b className="font-term text-[1.5em] font-normal text-amber">{s.rank}</b>
          </span>
        </Moment>
      );
    case "audience":
      return (
        <Moment me={me} mood="idle" big="AUDIENCE" testId="audience">
          You&apos;re in the audience. Watch the projector: you&apos;ll back a finalist soon.
        </Moment>
      );
    case "removed":
      return (
        <Moment me={me} mood="out" big="REMOVED" bad testId="removed">
          You were removed from the quiz.
        </Moment>
      );
    default:
      return null;
  }
}
