"use client";

/**
 * After the cut, on the phone: the wild card round (watching when safe, the
 * tally between questions, the reveal), backing a finalist, and Blackout (a
 * runner's move after each reveal, its distance from the dark, getting caught,
 * and the audience's view of the chase). Questions themselves use the shared
 * answer screens. Same parts as the four phones in public/finaldesign.html.
 */
import { Bot, botDelay } from "@/components/ui/Bot";
import { ordinal } from "@/lib/format";
import type { ParticipantScreen, ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Moment, PhoneTitle } from "./parts";

type Screen<K extends ParticipantScreen["kind"]> = Extract<ParticipantScreen, { kind: K }>;

const steps = (n: number) => `${n} ${Math.abs(n) === 1 ? "step" : "steps"}`;

export function BackFinalistScreen({ screen: s }: { screen: Screen<"backFinalist"> }) {
  const back = useParticipantStore((st) => st.back);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PhoneTitle>Who will escape?</PhoneTitle>
      <p className="text-[1.1rem] leading-snug opacity-85">Back a finalist. You can change your pick until Blackout starts.</p>
      <div className="mt-auto grid grid-cols-2 gap-3" role="group" aria-label="Finalists">
        {s.finalists.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => back(f.id)}
            aria-pressed={s.backedId === f.id}
            className="phone-opt min-w-0 flex-col justify-center gap-2 py-3 text-center text-[1.05rem]"
            data-testid="back"
          >
            <Bot color={f.color} head={f.head} size="48px" delay={botDelay(f.id)} />
            <span className="w-full truncate">{f.name}</span>
            {f.wildCard && <span className="text-xs opacity-75">wild card</span>}
          </button>
        ))}
      </div>
      <p className="min-h-7 text-center text-[1.05rem] text-mint" role="status">
        {s.backedId ? `You backed ${s.finalists.find((f) => f.id === s.backedId)?.name ?? "a finalist"}.` : ""}
      </p>
    </div>
  );
}

export function SafeWatchScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"safeWatch"> }) {
  return (
    <Moment me={view.me} mood="idle" big="SAFE" testId="safe-watch">
      You&apos;re through to Blackout. Watch the wild card fight
      {s.players ? (
        <>
          : <b className="font-term text-[1.5em] font-normal text-amber">{s.players}</b> players for the last seat.
        </>
      ) : (
        "."
      )}
    </Moment>
  );
}

export function WildCardStatusScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"wcStatus"> }) {
  if (s.suddenDeath === "out") {
    return (
      <Moment me={view.me} mood="out" big="OUT" bad testId="wc-out">
        Knocked out of the sudden death. Stay on: you&apos;ll back a finalist next.
      </Moment>
    );
  }
  return (
    <Moment me={view.me} mood="idle" big={s.suddenDeath === "in" ? "SUDDEN DEATH" : "WILD CARD"} testId="wc-status">
      {s.suddenDeath === "in" ? (
        "Exact tie! First right answer wins the last seat."
      ) : (
        <>
          One seat left in Blackout. Most right answers wins it.
          {s.asked > 0 && (
            <span className="mt-2 block">
              <b className="font-term text-[1.5em] font-normal text-amber">{s.right}</b> of {s.asked} right so far
            </span>
          )}
        </>
      )}
    </Moment>
  );
}

export function WildCardWinnerScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"wcWinner"> }) {
  return s.you === "won" ? (
    <Moment me={view.me} mood="right" big="WILD CARD!" testId="wc-won">
      You took the last seat. You&apos;re in Blackout!
    </Moment>
  ) : (
    <Moment me={view.me} mood="out" big="NOT THIS TIME" bad testId="wc-lost">
      {s.winner ? `${s.winner.name} took the last seat.` : "The wild card is decided."} Stay on: you&apos;ll back a finalist next.
    </Moment>
  );
}

/** A runner after the reveal: their move, and how far ahead of the dark they are. */
export function RunnerResultScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"runnerResult"> }) {
  const me = view.me;
  if (s.outcome === "voided") {
    return (
      <Moment me={me} mood="idle" big="CANCELLED">
        The quizmaster cancelled that question: nobody moves.
      </Moment>
    );
  }
  const big = s.outcome === "correct" ? `CORRECT +${s.delta}` : s.outcome === "wrong" ? (s.delta < 0 ? "WRONG −1" : "WRONG") : "TOO SLOW";
  return (
    <Moment me={me} mood={s.outcome === "correct" ? "right" : s.outcome === "wrong" ? "wrong" : "idle"} big={big} bad={s.outcome !== "correct"} testId={`runner-${s.outcome}`}>
      {s.outcome === "missed" && "No move this time. "}
      {s.correctText && <span className="block">It was {s.correctText}.</span>}
      <span className="mt-2 block">
        <b className="font-term text-[1.5em] font-normal text-amber">{steps(s.gap)}</b> ahead of the dark
      </span>
    </Moment>
  );
}

/** A runner between questions: ready, still running, or caught (with their place). */
export function RunnerStatusScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"runnerStatus"> }) {
  const me = view.me;
  if (!s.alive) {
    return (
      <Moment me={me} mood="out" big={s.caughtNow ? "CAUGHT" : "POWERED DOWN"} bad testId="runner-caught">
        The darkness got you.{s.place ? ` You finished ${ordinal(s.place)}.` : ""}
      </Moment>
    );
  }
  if (s.questionNumber === 0) {
    return (
      <Moment me={me} mood="idle" big="READY" testId="runner-ready">
        You start <b className="font-term text-[1.5em] font-normal text-amber">{steps(s.gap)}</b> ahead of the dark
        {s.headStart > 0 ? ` (a ${steps(s.headStart)} head start for your Round 1 rank)` : ""}. Right answers move you forward, faster ones further.
      </Moment>
    );
  }
  return (
    <Moment me={me} mood="idle" big="STILL RUNNING" testId="runner-alive">
      <b className="font-term text-[1.5em] font-normal text-amber">{steps(s.gap)}</b> ahead of the dark.
      <span className="mt-2 block">
        {s.aliveCount} still running · question {s.questionNumber} of {s.questionCount}
      </span>
    </Moment>
  );
}

/** The audience during Blackout: who they backed and the runners still going. */
export function BlackoutWatchScreen({ view, screen: s }: { view: ParticipantView; screen: Screen<"blackoutWatch"> }) {
  const alive = [...s.runners].filter((r) => r.alive).sort((a, b) => b.gap - a.gap);
  const out = s.runners.filter((r) => !r.alive).sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="blackout-watch">
      <PhoneTitle>Blackout</PhoneTitle>
      <p className="text-[1.05rem] opacity-85">
        {s.backed ? `You backed ${s.backed.name}. ` : ""}
        <b className="font-term text-[1.5em] font-normal text-amber">{s.alive}</b> still running
      </p>
      <ul className="flex flex-col gap-2" aria-label="Runners">
        {[...alive, ...out].map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2 ${s.backed?.id === r.id ? "border-mint bg-mint/[0.07]" : "border-line"} ${r.alive ? "" : "opacity-45"}`}
          >
            <Bot color={r.color} head={r.head} mood={r.mood} size="32px" delay={botDelay(r.id)} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="font-term text-[1.7rem] leading-none text-amber">{r.alive ? `+${r.gap}` : r.place ? ordinal(r.place) : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
