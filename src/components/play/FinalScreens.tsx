"use client";

/**
 * After the cut, on the phone: the wild card round (watching when safe, the
 * tally between questions, sudden death, the reveal), backing a finalist, and
 * Blackout on autopilot (the intro with the head start, a runner's move after
 * each reveal, "still running" with "Next question in 3", getting caught, the
 * winner moment, and the audience's view of the chase). Questions use the
 * shared answer screens. Same parts as the four phones in public/finaldesign.html.
 */
import { Bot, botDelay } from "@/components/ui/Bot";
import { ordinal } from "@/lib/format";
import type { ParticipantScreen, ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Gap, Moment, PhoneTitle, useSecondsLeft } from "./parts";

type Screen<K extends ParticipantScreen["kind"]> = Extract<ParticipantScreen, { kind: K }>;

const T = ({ children }: { children: React.ReactNode }) => <b className="font-term text-[1.5em] font-normal text-amber">{children}</b>;

/** "Next question in 3" while an autopilot hold runs (frozen while paused). */
function NextIn({ view, what }: { view: ParticipantView; what: "question" | "winner" | "podium" | null }) {
  const left = useSecondsLeft(view.timer);
  if (!what || left === null) return null;
  const label = what === "question" ? "Next question" : what === "winner" ? "The winner" : "The podium";
  return (
    <span className="mt-2 block opacity-85" data-testid="next-in">
      {label} in <T>{left}</T>
    </span>
  );
}

export function BackFinalistScreen({ screen: s }: { screen: Screen<"backFinalist"> }) {
  const back = useParticipantStore((st) => st.back);
  const backed = s.finalists.find((f) => f.id === s.backedId);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PhoneTitle>Back a finalist</PhoneTitle>
      <p className="text-[1.1rem] leading-snug opacity-85">Who will escape the dark? If they win, you called it. You can change until Blackout starts.</p>
      <div className="mt-auto grid grid-cols-2 gap-3" role="group" aria-label="Finalists">
        {s.finalists.map((f) => {
          const on = s.backedId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => back(f.id)}
              aria-pressed={on}
              className={`flex min-h-[7rem] min-w-0 flex-col items-center justify-center gap-2 rounded-[0.9rem] border-2 px-2 py-3 text-center text-[1.05rem] transition-transform active:scale-[0.98] ${
                on ? "border-mint text-ghost" : "border-line text-ghost/90"
              }`}
              data-testid="back"
            >
              <Bot color={f.color} head={f.head} size="48px" delay={botDelay(f.id)} />
              <span className="w-full truncate">{f.name}</span>
              <span className={`font-term text-[1.3rem] leading-none ${on ? "text-mint" : "text-fog"}`}>{on ? "BACKING" : f.wildCard ? "WILD CARD" : `#${f.round1Rank ?? ""}`}</span>
            </button>
          );
        })}
      </div>
      <p className="min-h-7 text-center text-[1.05rem] text-mint" role="status">
        {backed ? `You're backing ${backed.name}.` : "Tap a bot to back it."}
      </p>
    </div>
  );
}

export function SafeWatchScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"safeWatch"> }) {
  return (
    <Moment me={view.me} mood="idle" big="SAFE" testId="safe-watch">
      You&apos;re safe. Watch the wild card fight.
      {s.questionNumber > 0 && (
        <span className="mt-2 block">
          Question <T>{s.questionNumber}</T> of {s.questionCount}
          {s.players ? (
            <>
              {" · "}
              <T>{s.players}</T> players
            </>
          ) : null}
        </span>
      )}
    </Moment>
  );
}

export function WildCardStatusScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"wcStatus"> }) {
  if (s.suddenDeath === "out") {
    return (
      <Moment me={view.me} mood="wrong" big="OUT" bad testId="wc-out">
        Out of the sudden death. Stay on: you&apos;ll back a finalist next.
      </Moment>
    );
  }
  if (s.suddenDeath === "in") {
    return (
      <Moment me={view.me} mood="idle" big="SUDDEN DEATH" testId="wc-sudden">
        You&apos;re tied for the lead. Wrong answer = out. First one right takes the last seat.
      </Moment>
    );
  }
  return (
    <Moment me={view.me} mood="idle" big="WILD CARD" testId="wc-status">
      One seat left in Blackout. Most right answers wins it.
      {s.asked > 0 && (
        <span className="mt-2 block">
          <T>{s.right}</T> of {s.asked} right so far
        </span>
      )}
    </Moment>
  );
}

export function WildCardWinnerScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"wcWinner"> }) {
  return s.you === "won" ? (
    <Moment me={view.me} mood="right" big="WILD CARD!" testId="wc-won">
      You&apos;re in Blackout!
    </Moment>
  ) : (
    <Moment me={view.me} mood="out" big="NOT THIS TIME" testId="wc-lost">
      {s.winner ? `The wild card went to ${s.winner.name}.` : "The wild card is decided."} You&apos;re in the audience now.
    </Moment>
  );
}

/** A runner after the reveal: their move, and how far ahead of the dark they are now. */
export function RunnerResultScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"runnerResult"> }) {
  const me = view.me;
  if (s.outcome === "voided") {
    return (
      <Moment me={me} mood="idle" big="CANCELLED" testId="runner-voided">
        That question was cancelled: nobody moves.
        <NextIn view={view} what="question" />
      </Moment>
    );
  }
  const big = s.outcome === "correct" ? `CORRECT +${s.delta}` : s.outcome === "wrong" ? (s.delta < 0 ? "WRONG −1" : "WRONG") : "TOO SLOW";
  return (
    <Moment me={me} mood={s.outcome === "correct" ? "right" : s.outcome === "wrong" ? "wrong" : "idle"} big={big} bad={s.outcome !== "correct"} testId={`runner-${s.outcome}`}>
      {s.outcome === "missed" && <span className="block">No move.</span>}
      {s.correctText && <span className="block">It was {s.correctText}.</span>}
      <span className="mt-2 block">
        <Gap n={s.gap} suffix="ahead of the dark" />
      </span>
    </Moment>
  );
}

/** A runner between questions: the intro, still running, caught (with their place), or the winner moment. */
export function RunnerStatusScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"runnerStatus"> }) {
  const me = view.me;
  if (!s.alive) {
    return (
      <Moment me={me} mood="out" big={s.caughtNow ? "CAUGHT" : "POWERED DOWN"} bad testId="runner-caught">
        The darkness got you.
        {s.place && (
          <span className="mt-2 block">
            You finished <T>{ordinal(s.place)}</T>.
          </span>
        )}
      </Moment>
    );
  }
  if (s.nextUp === "podium") {
    // The winner moment: the place is final now.
    return s.place === 1 ? (
      <Moment me={me} mood="right" big="ESCAPED!" testId="runner-escaped">
        Last bot running. The podium is next.
      </Moment>
    ) : (
      <Moment me={me} mood="idle" big="SURVIVED" testId="runner-survived">
        The questions ran out with you still running.
        {s.place && (
          <span className="mt-2 block">
            You finished <T>{ordinal(s.place)}</T>.
          </span>
        )}
      </Moment>
    );
  }
  if (s.questionNumber === 0) {
    return (
      <Moment me={me} mood="idle" big="BLACKOUT" testId="runner-ready">
        The lights are dying behind you. Answer fast to stay ahead of the dark. 10 seconds a question.
        <span className="mt-2 block">
          Head start: <T>+{s.headStart}</T> · <Gap n={s.gap} suffix="ahead" />
        </span>
        <NextIn view={view} what={s.nextUp} />
      </Moment>
    );
  }
  return (
    <Moment me={me} mood="idle" big="STILL RUNNING" hop testId="runner-alive">
      <Gap n={s.gap} suffix="ahead of the dark" />.
      <span className="mt-2 block">
        <T>{s.aliveCount}</T> still running
      </span>
      <NextIn view={view} what={s.nextUp} />
    </Moment>
  );
}

/** The audience during Blackout: their pick big, then the runners still going. */
export function BlackoutWatchScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"blackoutWatch"> }) {
  const alive = s.runners.filter((r) => r.alive).sort((a, b) => b.gap - a.gap);
  const pick = s.backed ? s.runners.find((r) => r.id === s.backed!.id) : undefined;
  const others = alive.filter((r) => r.id !== pick?.id);
  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="blackout-watch">
      <PhoneTitle>{s.winner ? `${s.winner.name} escapes!` : "Blackout"}</PhoneTitle>
      {pick ? (
        <div className={`flex items-center gap-4 rounded-[0.9rem] border-2 px-4 py-3 ${pick.alive ? "border-mint" : "border-line"}`} data-testid="backed-runner">
          <Bot color={pick.color} head={pick.head} mood={pick.mood} size="72px" delay={botDelay(pick.id)} label={pick.name} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.95rem] opacity-70">Your pick</p>
            <p className="truncate text-[1.4rem] leading-tight">{pick.name}</p>
            <p className="text-[1.05rem]">{pick.alive ? <Gap n={pick.gap} suffix="ahead" /> : <span className="text-wrong">{pick.name} got caught</span>}</p>
          </div>
        </div>
      ) : (
        <p className="text-[1.05rem] opacity-85">You didn&apos;t back anyone. Enjoy the chase.</p>
      )}
      <p className="text-[1.1rem] opacity-85">
        <T>{s.alive}</T> still running
      </p>
      <ul className="grid grid-cols-2 gap-2" aria-label="Runners still running">
        {others.map((r) => (
          <li key={r.id} className="flex min-w-0 items-center gap-2 rounded-xl border-2 border-line px-2 py-2">
            <Bot color={r.color} head={r.head} mood={r.mood} size="32px" delay={botDelay(r.id)} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="font-term text-[1.7rem] leading-none text-amber">{r.gap}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
