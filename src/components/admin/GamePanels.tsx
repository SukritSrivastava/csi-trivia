"use client";

import { Bot, botDelay } from "@/components/ui/Bot";
import { useCountdown } from "@/lib/useCountdown";
import type { AdminAction, AdminView, BotMood, FinalistState } from "@/shared/protocol";
import { ControlButton, Panel } from "./parts";

/** Sends a command from the step these panels were drawn from. */
export type Send = (action: AdminAction) => void;

// ---------------------------------------------------------------------------
// Current question, with the answer
// ---------------------------------------------------------------------------

/** The question as the room sees it, numbered exactly like the Host (1–4 in Round 1, A–D in the buzzer round), the correct one lit. */
export function QuestionCard({ view }: { view: AdminView }) {
  const q = view.question;
  const next = view.nextQuestion;
  if (!q && !next) return null;

  return (
    <Panel testId="question">
      {q ? (
        <>
          <p className="text-[14px] text-mint-soft">
            {q.suddenDeath ? "Sudden death, question " : q.round === 1 ? "Round 1, question " : "Buzzer round, question "}
            <span className="font-term text-xl leading-none text-amber">{q.number}</span>
            {q.count > 0 && (
              <>
                {" of "}
                <span className="font-term text-xl leading-none text-amber">{q.count}</span>
              </>
            )}
            {q.image && <span className="ml-2 text-fog">(with image)</span>}
          </p>
          <p className="mt-2 text-xl leading-snug text-bright">{q.text}</p>
          <ol className="mt-3 flex flex-col gap-2">
            {q.options.map((o, i) => (
              <li
                key={o.letter}
                className={`flex items-center gap-3 rounded-[0.9rem] border-2 px-3 py-2 ${
                  o.correct ? "border-mint bg-mint/[0.12] text-bright" : "border-line text-mint-soft"
                }`}
                data-correct={o.correct || undefined}
              >
                <span className={`w-6 shrink-0 text-center font-term text-[2rem] leading-none ${o.correct ? "text-mint [text-shadow:0_0_8px_var(--color-mint)]" : "text-amber"}`}>
                  {q.round === 1 ? i + 1 : o.letter}
                </span>
                <span className="min-w-0 flex-1 text-[16px] leading-snug">{o.text}</span>
                {o.correct && <span className="shrink-0 font-term text-xl leading-none text-mint">ANSWER</span>}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-[15px] text-fog">No question on screen right now.</p>
      )}
      {next && (
        <p className="mt-3 border-t border-line pt-3 text-[14px] leading-snug text-fog" data-testid="next-question">
          <span className="text-mint-soft">Next up · </span>
          {next.suddenDeath ? "sudden death " : next.round === 1 ? "round 1 " : "buzzer "}
          <span className="font-term text-lg leading-none text-amber">#{next.number}</span>
          {": "}
          <span className="text-mint-soft">{next.text}</span>
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Live counts
// ---------------------------------------------------------------------------

function Count({ n, of, label, testId }: { n: number; of?: number | null; label: string; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start" data-testid={testId}>
      <span className="font-term text-[2.4rem] leading-none text-amber tabular-nums">
        {n}
        {of != null && <span className="text-[1.6rem] text-fog"> / {of}</span>}
      </span>
      <span className="text-[14px] text-mint-soft">{label}</span>
    </div>
  );
}

export function Counts({ view }: { view: AdminView }) {
  const c = view.counts;
  const r2 = view.round2;
  const buzzed = r2 ? r2.wrong.length + (r2.buzzedBy ? 1 : 0) : null;
  return (
    <Panel>
      <div className="grid grid-cols-3 gap-3">
        <Count n={c.joined} label="joined" testId="count-joined" />
        <Count n={c.connected} label="online" />
        {c.expected != null ? (
          <Count n={c.answered ?? 0} of={c.expected} label="answered" testId="count-answered" />
        ) : buzzed != null ? (
          <Count n={buzzed} label="buzzed" testId="count-buzzed" />
        ) : view.backing ? (
          <Count n={view.backing.backers} of={view.backing.audience} label="backing" />
        ) : (
          <Count n={c.playing} label="playing" />
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Round 2: the finalists, the judge
// ---------------------------------------------------------------------------

function finalistMood(f: FinalistState, view: AdminView): BotMood {
  if (!f.inPlay) return "out";
  if (f.lockedOut) return "wrong";
  if (view.round2?.buzzedBy?.id === f.id) return "locked";
  return "idle";
}

/** The podium as the Host shows it, so the quizmaster can announce it. */
export function Podium({ view }: { view: AdminView }) {
  const podium = view.podium;
  if (!podium) return null;
  const [winner, ...rest] = podium.entries;
  return (
    <Panel title="Final result" testId="podium">
      {winner ? (
        <div className="flex items-center gap-4">
          <Bot color={winner.color} head={winner.head} mood="right" size="72px" delay={botDelay(winner.id)} />
          <div className="min-w-0">
            <p className="text-[14px] text-mint-soft">Winner</p>
            <p className="truncate text-[1.75rem] leading-tight" style={{ color: winner.color }}>
              {winner.name}
            </p>
            <p className="text-[14px] text-fog">
              <span className="font-term text-xl leading-none text-amber">{winner.points}</span> {podium.basis === "buzzer" ? (winner.points === 1 ? "buzzer point" : "buzzer points") : "points in round 1"}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-fog">Nobody finished the quiz.</p>
      )}
      {rest.length > 0 && (
        <ol className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {rest.slice(0, 9).map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-7 font-term text-2xl leading-none text-amber">{e.place}</span>
              <Bot color={e.color} head={e.head} size="28px" delay={botDelay(e.id)} />
              <span className="min-w-0 flex-1 truncate text-[16px] text-ghost">{e.name}</span>
              <span className="font-term text-2xl leading-none text-ghost">{e.points}</span>
            </li>
          ))}
        </ol>
      )}
      {podium.basis === "buzzer" && (
        <p className="mt-3 text-[15px] text-mint-soft">
          <span className="font-term text-2xl leading-none text-amber">{podium.calledIt}</span> of{" "}
          <span className="font-term text-2xl leading-none text-amber">{view.backing?.audience ?? 0}</span> audience called it.
        </p>
      )}
    </Panel>
  );
}

/** The finalists as bots with live points; locked-out ones show "wrong". */
export function Finalists({ view }: { view: AdminView }) {
  if (!view.finalists.length || view.podium) return null;
  const backing = view.backing;
  return (
    <Panel title="Finalists" testId="finalists">
      <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
        {view.finalists.map((f) => (
          <li key={f.id} className={`flex min-w-0 flex-col items-center gap-1 text-center ${f.inPlay ? "" : "opacity-45"}`}>
            <Bot color={f.color} head={f.head} mood={finalistMood(f, view)} size="40px" delay={botDelay(f.id)} />
            <span className="w-full truncate text-[14px] text-ghost">{f.name}</span>
            <span className="font-term text-[1.75rem] leading-none text-amber">{f.points}</span>
            <span className="text-[13px] leading-none text-fog">
              {f.lockedOut ? <span className="text-wrong">locked out</span> : !f.connected ? <span className="text-wrong">offline</span> : backing ? `${backing.counts[f.id] ?? 0} backing` : " "}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Takes over the middle when a finalist buzzes: who, the answer, their countdown, Correct / Wrong. */
export function JudgePanel({ view, clockOffset, send, pending }: { view: AdminView; clockOffset: number; send: Send; pending: boolean }) {
  const r2 = view.round2;
  const by = r2?.buzzedBy;
  const countdown = useCountdown(view.timer, clockOffset);
  if (!r2 || !by || view.phase !== "r2Answering") return null;
  const q = view.question;

  return (
    <section className="rounded-xl border-2 border-mint bg-panel p-4 shadow-[0_0_24px_rgb(108_240_176/0.18)]" data-testid="judge">
      <div className="flex items-center gap-4">
        <Bot color={by.color} head={by.head} mood="locked" size="72px" delay={botDelay(by.id)} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-mint-soft">Answering out loud</p>
          <p className="truncate text-[1.75rem] leading-tight" style={{ color: by.color }}>
            {by.name}
          </p>
        </div>
        <div className="text-right">
          <span className={`font-term text-[3rem] leading-none tabular-nums ${r2.answerTimeUp || (countdown?.seconds ?? 0) <= 3 ? "text-wrong" : "text-ghost"}`}>
            {r2.answerTimeUp ? "0" : (countdown?.seconds ?? "")}
          </span>
          {r2.answerTimeUp && <p className="text-[13px] text-wrong">time&apos;s up</p>}
        </div>
      </div>

      {q && (
        <p className="mt-3 flex items-center gap-3 rounded-[0.9rem] border-2 border-mint bg-mint/[0.12] px-3 py-2 text-bright">
          <span className="font-term text-[2rem] leading-none text-mint">{q.correctLetter}</span>
          <span className="text-[17px] leading-snug">{q.correctText}</span>
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="min-h-20 rounded-[0.9rem] border-2 border-mint bg-mint font-term text-[2.4rem] leading-none text-void transition-transform active:scale-[0.98] disabled:opacity-40"
          onClick={() => send({ type: "markCorrect" })}
          disabled={pending || !view.allowed.includes("markCorrect")}
          data-testid="judge-correct"
        >
          CORRECT
        </button>
        <button
          type="button"
          className="min-h-20 rounded-[0.9rem] border-2 border-wrong bg-wrong/[0.07] font-term text-[2.4rem] leading-none text-wrong transition-[transform,background-color,color] active:scale-[0.98] active:bg-wrong active:text-void disabled:opacity-40"
          onClick={() => send({ type: "markWrong" })}
          disabled={pending || !view.allowed.includes("markWrong")}
          data-testid="judge-wrong"
        >
          WRONG
        </button>
      </div>
    </section>
  );
}

/** "Undo Wrong for Riya": visible until the next step. */
export function UndoMark({ view, send, pending }: { view: AdminView; send: Send; pending: boolean }) {
  if (!view.canUndo || !view.lastMark || !view.allowed.includes("undoMark")) return null;
  return (
    <ControlButton onClick={() => send({ type: "undoMark" })} disabled={pending} testId="undo" className="w-full">
      Undo {view.lastMark.correct ? "Correct" : "Wrong"} for {view.lastMark.by.name}
    </ControlButton>
  );
}

/** Between buzzer steps: who buzzed and how it went, so the quizmaster can narrate. */
export function BuzzSummary({ view }: { view: AdminView }) {
  const r2 = view.round2;
  if (!r2 || view.phase === "r2Answering") return null;
  const o = r2.outcome;
  let line: string | null = null;
  if (view.phase === "r2Reveal" && o) {
    line =
      o.kind === "correct"
        ? `${o.by.name} got it. +1 point.`
        : o.kind === "voided"
          ? "Question cancelled."
          : o.reason === "allWrong"
            ? "Everyone in play was wrong. Nobody scores."
            : "Nobody buzzed in time. Nobody scores.";
  } else if (r2.wrong.length) {
    line = `Wrong so far: ${r2.wrong.map((w) => w.name).join(", ")}.`;
  }
  if (!line) return null;
  return (
    <p className="rounded-[0.9rem] border border-line bg-panel px-4 py-3 text-[15px] text-mint-soft" data-testid="buzz-summary">
      {line}
    </p>
  );
}
