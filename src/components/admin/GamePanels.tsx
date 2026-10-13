"use client";

import { Bot, botDelay } from "@/components/ui/Bot";
import type { AdminAction, AdminView } from "@/shared/protocol";
import { Panel } from "./parts";

/** Sends a command from the step these panels were drawn from. */
export type Send = (action: AdminAction) => void;

const ROUND_NAME = { 1: "Round 1", 2: "Wild card", 3: "Blackout" } as const;

// ---------------------------------------------------------------------------
// Current question, with the answer
// ---------------------------------------------------------------------------

/** The question as the room sees it, numbered 1–4 exactly like the Host, the correct one lit. */
export function QuestionCard({ view }: { view: AdminView }) {
  const q = view.question;
  const next = view.nextQuestion;
  if (!q && !next) return null;

  return (
    <Panel testId="question">
      {q ? (
        <>
          <p className="text-[14px] text-mint-soft">
            {q.suddenDeath ? "Wild card sudden death, question " : `${ROUND_NAME[q.round]}, question `}
            <span className="font-term text-xl leading-none text-amber">{q.number}</span>
            {!q.suddenDeath && q.count > 0 && (
              <>
                {" of "}
                <span className="font-term text-xl leading-none text-amber">{q.count}</span>
              </>
            )}
            {q.image && <span className="ml-2 text-fog">(with image)</span>}
          </p>
          <p className="mt-2 text-xl leading-snug text-bright">{q.text}</p>
          <ol className="mt-3 flex flex-col gap-2">
            {q.options.map((o) => (
              <li
                key={o.number}
                className={`flex items-center gap-3 rounded-[0.9rem] border-2 px-3 py-2 ${
                  o.correct ? "border-mint bg-mint/[0.12] text-bright" : "border-line text-mint-soft"
                }`}
                data-correct={o.correct || undefined}
              >
                <span className={`w-6 shrink-0 text-center font-term text-[2rem] leading-none ${o.correct ? "text-mint [text-shadow:0_0_8px_var(--color-mint)]" : "text-amber"}`}>
                  {o.number}
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
          {next.suddenDeath ? "sudden death " : `${ROUND_NAME[next.round].toLowerCase()} `}
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
  return (
    <Panel>
      <div className="grid grid-cols-3 gap-3">
        <Count n={c.joined} label="joined" testId="count-joined" />
        <Count n={c.connected} label="online" />
        {c.expected != null ? (
          <Count n={c.answered ?? 0} of={c.expected} label="answered" testId="count-answered" />
        ) : view.blackout ? (
          <Count n={view.blackout.alive} of={view.blackout.runners.length} label="still running" testId="count-running" />
        ) : view.backing && view.phase === "predictions" ? (
          <Count n={view.backing.backers} of={view.backing.audience} label="backing" />
        ) : view.wildCard && !view.wildCard.winner ? (
          <Count n={view.wildCard.players} label="in the wild card" />
        ) : (
          <Count n={c.playing} label="playing" />
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The wild card round
// ---------------------------------------------------------------------------

/** Live standings (Admin sees them all, always), sudden death, the winner. */
export function WildCardPanel({ view }: { view: AdminView }) {
  const w = view.wildCard;
  const inRound = view.phase.startsWith("wc");
  if (!w || !inRound) return null;
  return (
    <Panel title="Wild card" testId="wild-card">
      {w.suddenDeath && (
        <p className="mb-2 text-[15px] text-amber">
          Sudden death {w.suddenDeath.number} of {w.suddenDeath.max}: {w.suddenDeath.alive.map((t) => t.name).join(", ")}
        </p>
      )}
      {w.winner && (
        <p className="mb-2 text-[15px] text-mint">
          Winner: {w.winner.name}
          {w.fallback ? " (nobody got one right: the next best from Round 1)" : ""}
        </p>
      )}
      <ol className="flex flex-col divide-y divide-line">
        {w.standings.slice(0, 12).map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-1.5">
            <span className="w-7 font-term text-xl leading-none text-amber">{s.rank}</span>
            <Bot color={s.color} head={s.head} size="26px" delay={botDelay(s.id)} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-ghost">{s.name}</span>
            <span className="font-term text-xl leading-none text-ghost">{s.correct} right</span>
            <span className="w-14 text-right font-sans text-[13px] text-fog tabular-nums">{(s.timeMs / 1000).toFixed(1)}s</span>
          </li>
        ))}
      </ol>
      {w.standings.length > 12 && <p className="mt-1 text-[13px] text-fog">and {w.standings.length - 12} more</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Blackout
// ---------------------------------------------------------------------------

/** Every runner: position, distance from the dark, the last move, caught or not. */
export function BlackoutPanel({ view }: { view: AdminView }) {
  const bo = view.blackout;
  if (!bo || view.podium) return null;
  const revealed = view.phase === "boReveal" || view.phase === "boDark";
  return (
    <Panel title={`Blackout · the dark at step ${bo.dark}`} testId="blackout">
      <ol className="flex flex-col divide-y divide-line">
        {[...bo.runners]
          .sort((a, b) => Number(b.alive) - Number(a.alive) || b.position - a.position || (a.place ?? 99) - (b.place ?? 99))
          .map((r) => (
            <li key={r.id} className={`flex items-center gap-3 py-1.5 ${r.alive ? "" : "opacity-50"}`} data-testid="runner-row">
              <Bot color={r.color} head={r.head} mood={r.mood} size="26px" delay={botDelay(r.id)} />
              <span className="min-w-0 flex-1 truncate text-[15px] text-ghost">
                {r.name}
                {r.wildCard && <span className="ml-1 text-[12px] text-fog">wild card</span>}
              </span>
              <span className="font-sans text-[13px] text-fog tabular-nums">step {r.position}</span>
              <span className={`w-10 text-right font-term text-xl leading-none ${r.delta && r.delta > 0 ? "text-mint" : r.delta && r.delta < 0 ? "text-wrong" : "text-fog"}`}>
                {revealed && r.alive && r.delta !== null ? (r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? "−1" : "0") : ""}
              </span>
              <span className="w-16 text-right font-term text-xl leading-none text-amber">{r.alive ? `+${r.gap}` : r.place ? `#${r.place}` : "out"}</span>
            </li>
          ))}
      </ol>
      {bo.over && bo.winner && <p className="mt-2 text-[15px] text-mint">Over: {bo.winner.name} escapes.</p>}
    </Panel>
  );
}

/** The podium as the Host shows it, so the quizmaster can announce it. */
export function Podium({ view }: { view: AdminView }) {
  const podium = view.podium;
  if (!podium) return null;
  const [winner, ...rest] = podium.entries;
  const detail = (e: (typeof podium.entries)[number]) =>
    podium.basis === "blackout" && e.position !== null ? (e.caughtOnQuestion ? `caught Q${e.caughtOnQuestion}` : `step ${e.position}`) : `${e.round1Score} pts`;
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
            <p className="text-[14px] text-fog">{podium.basis === "blackout" ? "escaped the dark" : detail(winner)}</p>
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-fog">Nobody finished the quiz.</p>
      )}
      {rest.length > 0 && (
        <ol className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {rest.slice(0, 11).map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-7 font-term text-2xl leading-none text-amber">{e.place}</span>
              <Bot color={e.color} head={e.head} size="28px" delay={botDelay(e.id)} />
              <span className="min-w-0 flex-1 truncate text-[16px] text-ghost">{e.name}</span>
              <span className="font-sans text-[13px] text-fog">{detail(e)}</span>
            </li>
          ))}
        </ol>
      )}
      {podium.basis === "blackout" && view.backing && (
        <p className="mt-3 text-[15px] text-mint-soft">
          <span className="font-term text-2xl leading-none text-amber">{podium.calledIt}</span> of{" "}
          <span className="font-term text-2xl leading-none text-amber">{view.backing.backers}</span> backers called it.
        </p>
      )}
    </Panel>
  );
}

/** The finalists (after the cut, before Blackout starts): seat, Round 1 rank, backing. */
export function Finalists({ view }: { view: AdminView }) {
  if (!view.finalists.length || view.podium || view.blackout || view.phase.startsWith("wc")) return null;
  const backing = view.backing;
  return (
    <Panel title="Finalists" testId="finalists">
      <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5">
        {view.finalists.map((f) => (
          <li key={f.id} className="flex min-w-0 flex-col items-center gap-1 text-center">
            <Bot color={f.color} head={f.head} size="40px" delay={botDelay(f.id)} />
            <span className="w-full truncate text-[14px] text-ghost">{f.name}</span>
            <span className="text-[13px] leading-none text-fog">
              {!f.connected ? <span className="text-wrong">offline</span> : f.wildCard ? "wild card" : `#${f.round1Rank}`}
              {backing && view.phase === "predictions" ? ` · ${backing.counts[f.id] ?? 0} backing` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
