"use client";

/**
 * Question screens for every round (eyes up, answer, locked in, time's up,
 * result, cancelled), Round 1's intro, the cut, waiting screens, the podium
 * and removed. The answer buttons come in the Host's order, numbered 1–4 in
 * amber. Blackout runners see the question text above the options. A
 * multi-correct Round 1 question ticks options (a mint square on the right) and
 * locks in with LOCK IN; its result can be PARTLY RIGHT.
 */
import { useState } from "react";
import { Bot } from "@/components/ui/Bot";
import { ordinal, vibrate } from "@/lib/format";
import type { ParticipantScreen, ParticipantTag, ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Gap, Moment, PhoneTitle, useSecondsLeft } from "./parts";

type Screen<K extends ParticipantScreen["kind"]> = Extract<ParticipantScreen, { kind: K }>;

/** "1, 3" / "1 and 3" / "1, 2 and 4". */
export function numberList(numbers: number[], and = false): string {
  if (!and || numbers.length < 2) return numbers.join(", ");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * Multi-correct (Round 1): taps tick and untick (each tick is sent as a draft, so a
 * refresh brings them back and time's up sends them); LOCK IN, pinned in thumb
 * reach, sends them. After the lock: ticks freeze, the rest dim to 40%, eyes shut.
 */
function MultiAnswerScreen({ screen: s, me, paused }: { screen: Screen<"answer">; me: ParticipantTag; paused: boolean }) {
  const select = useParticipantStore((st) => st.select);
  const lockIn = useParticipantStore((st) => st.lockIn);
  const server = s.multi!;
  // The phone's own ticks, starting from what the server kept (a refresh restores them).
  const [ticks, setTicks] = useState<string[]>(server.selectedIds);
  const [sent, setSent] = useState(false);
  const locked = server.locked || sent;
  const shown = server.locked ? server.selectedIds : ticks;
  const numbers = s.options.flatMap((o, i) => (shown.includes(o.id) ? [i + 1] : []));

  const toggle = (id: string) => {
    if (locked) return;
    const next = ticks.includes(id) ? ticks.filter((x) => x !== id) : [...ticks, id];
    setTicks(next);
    select(s.questionId, next);
    vibrate(30);
  };
  const lock = () => {
    if (locked || ticks.length === 0 || paused) return;
    setSent(true);
    lockIn(s.questionId, ticks);
    vibrate(30);
  };

  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="multi-answer">
      {locked ? (
        <div className="flex items-center gap-3" data-testid="multi-locked">
          <Bot color={me.color} head={me.head} mood="locked" size="56px" label="Your bot" />
          <PhoneTitle>
            Locked in: <span className="font-term text-[1.3em] leading-none text-amber">{numberList(numbers)}</span>
          </PhoneTitle>
        </div>
      ) : (
        <PhoneTitle>Select ALL that apply.</PhoneTitle>
      )}
      <div className="flex flex-col gap-3" role="group" aria-label="Answers: select all that apply">
        {s.options.map((o, i) => {
          const on = shown.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className="phone-opt min-h-[4.25rem] gap-4 text-[clamp(1.1rem,5.4vw,1.4rem)] break-words"
              onClick={() => toggle(o.id)}
              disabled={locked}
              aria-pressed={on}
              data-tick
              data-testid="option"
            >
              <span className="font-term text-[2.4rem] leading-none text-amber" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">{o.text}</span>
              <span className="tick-box" aria-hidden>
                {on && (
                  <svg viewBox="0 0 20 20" className="size-[1.35rem]">
                    <path d="M4 10.5 8.2 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {locked && <p className="text-center text-[1.05rem] opacity-70">Eyes on the screen for the answers.</p>}
      {!locked && (
        <div className="phone-lock-bar mt-auto">
          <button type="button" className="phone-go min-h-14 w-full !text-[2.2rem]" onClick={lock} disabled={ticks.length === 0 || paused} data-testid="multi-lock-in">
            LOCK IN
          </button>
        </div>
      )}
    </div>
  );
}

export function AnswerScreen({ screen: s, me, paused = false }: { screen: Screen<"answer">; me: ParticipantTag; paused?: boolean }) {
  if (s.multi) return <MultiAnswerScreen screen={s} me={me} paused={paused} />;
  return <SingleAnswerScreen screen={s} />;
}

function SingleAnswerScreen({ screen: s }: { screen: Screen<"answer"> }) {
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

/**
 * After a multi-correct reveal: CORRECT, PARTLY RIGHT ("You got 2 of 3 right",
 * "1 wrong pick"), WRONG or TOO SLOW, always with every right answer. No points,
 * no rank (Round 1 rule). The bot's mood comes from the server.
 */
function MultiResult({ view, screen: s }: { view: ParticipantView; screen: Screen<"result"> }) {
  const m = s.multi!;
  const me = view.me;
  const amber = (n: number | string) => <b className="font-term text-[1.5em] font-normal text-amber">{n}</b>;
  // "The right answers: 1 and 3. Claude; GPT-4": amber digits only; each answer kept whole where it fits.
  const last = m.rightNumbers.length - 1;
  const answers = (
    <span className="mt-2 block" data-testid="right-answers">
      The right answers:{" "}
      {m.rightNumbers.map((n, i) => (
        <span key={n}>
          {amber(n)}
          {i < last - 1 ? ", " : i === last - 1 ? " and " : ". "}
        </span>
      ))}
      {m.rightTexts.map((t, i) => (
        <span key={t}>
          <span className="inline-block max-w-full">
            {t}
            {i < m.rightTexts.length - 1 ? ";" : ""}
          </span>{" "}
        </span>
      ))}
    </span>
  );
  if (s.outcome === "correct")
    return (
      <Moment me={me} mood={m.mood} big="CORRECT" testId="result-correct">
        You got all {amber(m.total)}.{answers}
      </Moment>
    );
  if (s.outcome === "partial")
    return (
      <Moment me={me} mood={m.mood} big="PARTLY RIGHT" partial testId="result-partial">
        You got {amber(m.found)} of {amber(m.total)} right.
        {m.wrongPicks > 0 && (
          <span className="mt-1 block">
            {amber(m.wrongPicks)} wrong {m.wrongPicks === 1 ? "pick" : "picks"}.
          </span>
        )}
        {answers}
      </Moment>
    );
  if (s.outcome === "missed")
    return (
      <Moment me={me} mood="wrong" big="TOO SLOW" bad testId="result-missed">
        No picks this time.{answers}
      </Moment>
    );
  return (
    <Moment me={me} mood={m.mood} big="WRONG" bad testId="result-wrong">
      {m.found > 0 ? (
        <>
          You got {amber(m.found)} of {amber(m.total)} right, but {amber(m.wrongPicks)} wrong {m.wrongPicks === 1 ? "pick" : "picks"} cancelled it out.
        </>
      ) : (
        "None of your picks were right."
      )}
      {answers}
    </Moment>
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
      if (s.choiceNumbers) {
        // Multi-correct: every pick by number; "we sent your picks" when time ran out before LOCK IN.
        const picks = <b className="font-term text-[1.5em] font-normal text-amber">{numberList(s.choiceNumbers)}</b>;
        return (
          <Moment me={me} mood="locked" big={s.timeUp ? "TIME'S UP" : "LOCKED IN"} testId={s.sentAtTimeUp ? "picks-sent" : "locked-in"}>
            {s.sentAtTimeUp ? <>We sent your picks: {picks}</> : <>Locked in: {picks}</>}
          </Moment>
        );
      }
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
      if (s.multi) return <MultiResult view={view} screen={s} />;
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
