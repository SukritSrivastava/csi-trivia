"use client";

/**
 * The middle of the Admin screen: what's on the projector right now, with the
 * answer, and the round's own panel (the cut, the wild card, predictions, the
 * Blackout ladder, the podium). Everything comes from AdminView; nothing here
 * works game state out. Numbers are terminal digits; counts and gaps amber.
 * Flat, no glow: mint fills and outlines mark what matters.
 */
import { Bot, botDelay } from "@/components/ui/Bot";
import type { AdminAction, AdminActionType, AdminView, Runner } from "@/shared/protocol";
import { ControlButton, Panel, useConfirm } from "./parts";

/** Sends a command from the step these panels were drawn from. */
export type Send = (action: AdminAction) => void;

const ROUND_NAME = { 1: "Round 1", 2: "Wild card", 3: "Blackout" } as const;

/** A number in terminal digits: amber unless `className` gives another colour. */
function N({ children, className = "", ...rest }: { children: React.ReactNode; className?: string; "aria-label"?: string }) {
  const coloured = /text-(amber|ghost|fog|wrong|void|mint|bright|mint-soft)/.test(className);
  return (
    <span className={`font-term leading-none tabular-nums ${coloured ? "" : "text-amber"} ${className}`} {...rest}>
      {children}
    </span>
  );
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** Dense table rows (the cut, the wild card): rank · bot · name · number · time. */
const GRID = "grid grid-cols-[2.25rem_2rem_minmax(0,1fr)_3.5rem_3.75rem] items-center gap-x-2";

// ---------------------------------------------------------------------------
// Current question, with the answer
// ---------------------------------------------------------------------------

/** The question as the room sees it, numbered 1–4 exactly like the Host, the correct one filled mint. */
export function QuestionCard({ view }: { view: AdminView }) {
  const q = view.question;
  if (!q || view.podium) return null;
  const counted = q.options.some((o) => o.count !== null);
  return (
    <Panel testId="question">
      <p className="text-[15px] text-mint-soft">
        {q.suddenDeath ? "Wild card · sudden death · question " : `${ROUND_NAME[q.round]} · question `}
        <N className="text-[1.5rem] text-amber">{q.number}</N>
        {!q.suddenDeath && !!q.count && (
          <>
            {" of "}
            <N className="text-[1.5rem] text-amber">{q.count}</N>
          </>
        )}
        {q.image && <span className="ml-2 text-fog">(with image)</span>}
      </p>
      <p className="mt-2 text-[1.3rem] leading-snug text-bright">{q.text}</p>
      <ol className="mt-3 flex flex-col gap-2">
        {q.options.map((o) => (
          <li
            key={o.number}
            className={`flex min-h-12 items-center gap-3 rounded-[0.9rem] border-2 px-3 py-2 ${o.correct ? "border-mint bg-mint text-void" : "border-line text-mint-soft"}`}
            data-correct={o.correct || undefined}
          >
            <N className={`w-6 shrink-0 text-center text-[2rem] ${o.correct ? "text-void" : "text-amber"}`}>{o.number}</N>
            <span className="min-w-0 flex-1 text-[16px] leading-snug">{o.text}</span>
            {o.correct && <span className="shrink-0 text-[14px]">✓ correct</span>}
            {counted && (
              <N className={`w-10 shrink-0 text-right text-[1.6rem] ${o.correct ? "text-void" : "text-amber"}`} aria-label={`${o.count} picked it`}>
                {o.count}
              </N>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** The next question and its answer, one muted line each. */
export function NextUp({ view }: { view: AdminView }) {
  const next = view.nextQuestion;
  if (!next || view.podium) return null;
  return (
    <section className="rounded-xl border border-dashed border-line px-4 py-3 text-[14px] leading-snug text-fog" data-testid="next-question">
      <p className="truncate">
        <span className="text-mint-soft">Next up · </span>
        {next.suddenDeath ? "sudden death " : `${ROUND_NAME[next.round].toLowerCase()} `}
        <N className="text-[1.25rem]">#{next.number}</N>: <span className="text-mint-soft">{next.text}</span>
      </p>
      <p className="mt-1 truncate">
        Answer: <span className="text-mint-soft">{next.correctText}</span>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live counts
// ---------------------------------------------------------------------------

function Count({ n, of, label, testId }: { n: number; of?: number | null; label: string; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start" data-testid={testId}>
      <N className="text-[2.4rem] text-amber">
        {n}
        {of != null && <span className="text-[1.6rem] text-fog"> / {of}</span>}
      </N>
      <span className="text-[14px] text-mint-soft">{label}</span>
    </div>
  );
}

export function Counts({ view }: { view: AdminView }) {
  const c = view.counts;
  const sd = view.wildCard?.suddenDeath;
  const inWild = view.phase.startsWith("wc") && view.phase !== "wcWinner";
  return (
    <Panel>
      <div className="grid grid-cols-3 gap-3">
        <Count n={c.joined} label="joined" testId="count-joined" />
        {c.expected != null ? (
          <Count n={c.answered ?? 0} of={c.expected} label="answered" testId="count-answered" />
        ) : (
          <Count n={c.connected} label="online" />
        )}
        {view.blackout && !view.podium ? (
          <Count n={view.blackout.alive} of={view.blackout.runners.length} label="alive" testId="count-running" />
        ) : sd && inWild ? (
          <Count n={sd.alive.length} label="still in sudden death" testId="count-sudden" />
        ) : view.backing && view.phase === "predictions" ? (
          <Count n={view.backing.backers} of={view.backing.audience} label="backing" />
        ) : view.wildCard && inWild ? (
          <Count n={view.wildCard.players} label="in the wild card" />
        ) : (
          <Count n={c.playing || c.finalists} label={c.playing ? "playing" : "finalists"} />
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

/** The top 20 at the cut, a mint line under the last safe seat. */
export function CutPanel({ view }: { view: AdminView }) {
  const cut = view.cut;
  if (!cut || view.phase !== "cut") return null;
  const rows = cut.standings.slice(0, 20);
  const safe = cut.safeCount;
  return (
    <Panel title="The cut" testId="cut">
      {cut.wildCardSkipped && (
        <p className="mb-3 rounded-[0.9rem] border-2 border-amber px-3 py-2 text-[15px] text-amber" role="status">
          Not enough players for a wild card round: everyone&apos;s a finalist.
        </p>
      )}
      <div role="table" aria-label="The cut, top 20">
        <div role="row" className={`${GRID} pb-1 text-[14px] text-fog`}>
          <span role="columnheader">#</span>
          <span role="columnheader" className="col-span-2">
            Name
          </span>
          <span role="columnheader" className="text-right">
            Score
          </span>
          <span role="columnheader" className="text-right">
            Time
          </span>
        </div>
        {rows.map((s, i) => (
          <div
            key={s.id}
            role="row"
            className={`${GRID} min-h-11 py-1 ${i === safe - 1 && !cut.wildCardSkipped ? "border-b-2 border-mint" : "border-b border-line"}`}
            data-testid="cut-row"
          >
            <N className="text-[1.5rem]">{s.rank}</N>
            <Bot color={s.color} head={s.head} size="24px" delay={botDelay(s.id)} still />
            <span className={`truncate font-sans text-[15px] ${s.finalist ? "text-mint" : "text-ghost"}`}>{s.name}</span>
            <N className="text-right text-[1.5rem] text-ghost">{s.score}</N>
            <N className="text-right text-[1.25rem] text-fog">{seconds(s.timeMs)}s</N>
          </div>
        ))}
      </div>
      {cut.standings.length > rows.length && <p className="mt-1 text-[14px] text-fog">and {cut.standings.length - rows.length} more</p>}
      <p className="mt-3 text-[15px] text-mint-soft">
        <N className="text-[1.75rem]">{safe}</N> safe ·{" "}
        {cut.wildCardSkipped ? (
          "no wild card round"
        ) : (
          <>
            <N className="text-[1.75rem]">{cut.wildCardCount}</N> go to the wild card round
          </>
        )}
      </p>
      <p className="mt-1 text-[14px] text-fog">Round 1 scores 100–200 a correct answer; ties go to the faster total time.</p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The wild card round
// ---------------------------------------------------------------------------

/** The safe finalists watching, the live standings (Admin sees them all), sudden death, the winner. */
export function WildCardPanel({ view }: { view: AdminView }) {
  const w = view.wildCard;
  if (!w || !view.phase.startsWith("wc")) return null;
  const leader = w.standings[0];
  return (
    <>
      {w.winner && view.phase === "wcWinner" && (
        <Panel testId="wild-card-winner">
          <div className="flex items-center gap-4">
            <Bot color={w.winner.color} head={w.winner.head} mood="right" size="88px" delay={botDelay(w.winner.id)} label={w.winner.name} />
            <div className="min-w-0">
              <p className="font-term text-[2rem] leading-none tracking-[0.12em] text-mint">WILD CARD</p>
              <p className="mt-1 truncate text-[1.75rem] leading-tight text-bright">{w.winner.name}</p>
              {w.fallback && <p className="mt-1 text-[14px] text-amber">Fallback: nobody got one right, so the 10th in Round 1 takes the seat.</p>}
            </div>
          </div>
        </Panel>
      )}
      <Panel title="Wild card" aside={<N className="text-[1.6rem]">{w.players}</N>} testId="wild-card">
        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Safe finalists">
          <span className="shrink-0 font-term text-[1.4rem] leading-none tracking-[0.12em] text-mint">SAFE</span>
          {w.safe.map((t) => (
            <Bot key={t.id} color={t.color} head={t.head} size="26px" delay={botDelay(t.id)} label={t.name} still />
          ))}
        </div>
        {w.suddenDeath && (
          <div className="mb-3 rounded-[0.9rem] border-2 border-amber px-3 py-2" data-testid="sudden-death">
            <p className="text-[15px] text-amber">
              Sudden death <N>{w.suddenDeath.number}</N> of <N>{w.suddenDeath.max}</N> · still in: <N>{w.suddenDeath.alive.length}</N>
            </p>
            <ul className="mt-2 flex flex-wrap gap-3">
              {w.suddenDeath.alive.map((t) => (
                <li key={t.id} className="flex items-center gap-1.5 text-[15px] text-ghost">
                  <Bot color={t.color} head={t.head} size="26px" delay={botDelay(t.id)} />
                  {t.name}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div role="table" aria-label="Wild card standings, top 10">
          <div role="row" className={`${GRID} pb-1 text-[14px] text-fog`}>
            <span role="columnheader">#</span>
            <span role="columnheader" className="col-span-2">
              Name
            </span>
            <span role="columnheader" className="text-right">
              Right
            </span>
            <span role="columnheader" className="text-right">
              Time
            </span>
          </div>
          {w.standings.slice(0, 10).map((s) => {
            const lead = s.id === leader?.id && s.correct > 0;
            return (
              <div
                key={s.id}
                role="row"
                className={`${GRID} min-h-11 rounded-[0.6rem] py-1 ${lead ? "border-2 border-mint px-1" : "border-b border-line"}`}
                data-testid={lead ? "wild-leader" : undefined}
              >
                <N className="text-[1.5rem]">{s.rank}</N>
                <Bot color={s.color} head={s.head} size="24px" delay={botDelay(s.id)} still />
                <span className={`truncate font-sans text-[15px] ${lead ? "text-mint" : "text-ghost"}`}>{s.name}</span>
                <N className="text-right text-[1.5rem] text-ghost">{s.correct}</N>
                <N className="text-right text-[1.25rem] text-fog">{seconds(s.timeMs)}s</N>
              </div>
            );
          })}
        </div>
        {w.standings.length > 10 && <p className="mt-1 text-[14px] text-fog">and {w.standings.length - 10} more (People tab)</p>}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/** The finalists with the live backing (count and share), and when it locks. */
export function PredictionsPanel({ view }: { view: AdminView }) {
  const b = view.backing;
  if (view.phase !== "predictions" || !b) return null;
  return (
    <Panel title="Predictions" aside={<N className="text-[1.6rem]">{b.backers}</N>} testId="predictions">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        {view.finalists.map((f) => {
          const n = b.counts[f.id] ?? 0;
          const pct = b.backers ? Math.round((n / b.backers) * 100) : 0;
          return (
            <li key={f.id} className="flex min-w-0 items-center gap-2 rounded-[0.9rem] border border-line px-2 py-1.5">
              <Bot color={f.color} head={f.head} size="32px" delay={botDelay(f.id)} still />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-ghost">{f.name}</p>
                <p className="text-[14px] leading-none text-fog">
                  <N className="text-[1.5rem] text-amber">{n}</N> · <N className="text-[1.5rem] text-amber">{pct}%</N>
                  {!f.connected && <span className="ml-1 text-wrong">offline</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[15px] text-mint-soft">Predictions lock when you start Blackout.</p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Blackout: the distance ladder
// ---------------------------------------------------------------------------

const headStartTag = (r: Runner) => (r.wildCard ? "WC" : `+${r.headStart}`);
const moveText = (d: number) => (d > 0 ? `+${d}` : d < 0 ? "−1" : "0");

/**
 * Every runner, furthest ahead first, caught ones greyed at the bottom: the
 * gap to the dark big in amber, the last move after each reveal, and (Admin
 * only) who the dark will catch next. The fast Blackout controls sit right
 * under it.
 */
export function BlackoutPanel({ view, send, pending }: { view: AdminView; send: Send; pending: boolean }) {
  const bo = view.blackout;
  if (!bo || view.podium) return null;
  const revealed = view.phase === "boReveal" || view.phase === "boDark";
  const voided = !!view.question?.voided;
  const rows = [...bo.runners].sort(
    (a, b) => Number(b.alive) - Number(a.alive) || (a.alive ? b.position - a.position : (a.place ?? 99) - (b.place ?? 99)),
  );
  const preview = view.darkPreview;
  const left = view.autopilot?.questionsLeft ?? bo.questionsLeft;
  return (
    <Panel testId="blackout">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[15px] text-mint-soft">
        <span>
          the dark at <N className="text-[1.75rem] text-wrong">{bo.dark}</N>
        </span>
        <span>
          alive: <N className="text-[1.75rem]">{bo.alive}</N>
        </span>
        <span>
          question <N className="text-[1.75rem]">{bo.questionNumber}</N>
          {left != null && (
            <>
              {" · "}
              <N className="text-[1.75rem]">{left}</N> left in the file
            </>
          )}
        </span>
      </div>

      {preview && (
        <p className="mb-3 rounded-[0.9rem] border-2 border-alarm px-3 py-2 text-[15px] leading-snug text-wrong" data-testid="dark-preview">
          {preview.exact ? "The dark will move " : "If nobody moves, the dark moves "}
          <N className="text-[1.6rem] text-wrong">{preview.steps}</N> →{" "}
          {preview.catches.length ? `catches: ${preview.catches.map((c) => c.name).join(", ")}` : "catches nobody"}
        </p>
      )}

      <ol className="flex flex-col gap-1.5" aria-label="Runners, furthest ahead first">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`flex min-h-14 items-center gap-3 rounded-[0.9rem] border px-2 py-1.5 ${r.alive ? "border-line" : "border-transparent opacity-45"}`}
            data-testid="runner-row"
          >
            <Bot color={r.color} head={r.head} mood={r.mood} size="36px" delay={botDelay(r.id)} label={r.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] leading-tight text-ghost">{r.name}</p>
              <p className="text-[14px] leading-tight text-fog">
                <span className="rounded border border-line px-1 font-term text-[1.1rem] leading-none text-mint-soft">{headStartTag(r)}</span>{" "}
                step <N className="text-[1.1rem] text-fog">{r.position}</N>
                {!r.alive && r.caughtOnQuestion != null && <span className="text-wrong"> · caught Q{r.caughtOnQuestion}</span>}
              </p>
            </div>
            <N
              className={`w-10 shrink-0 text-right text-[1.75rem] ${r.delta && r.delta > 0 ? "text-mint" : r.delta && r.delta < 0 ? "text-wrong" : "text-fog"}`}
              aria-label={r.delta === null ? undefined : `moved ${moveText(r.delta)}`}
            >
              {revealed && !voided && r.alive && r.delta !== null ? moveText(r.delta) : ""}
            </N>
            <N className="w-14 shrink-0 text-right text-[2.6rem] text-amber" aria-label={r.alive ? `${r.gap} steps ahead of the dark` : `place ${r.place}`}>
              {r.alive ? r.gap : r.place ? `#${r.place}` : ""}
            </N>
          </li>
        ))}
      </ol>
      {bo.over && bo.winner && <p className="mt-2 text-[15px] text-mint">Over: {bo.winner.name} escapes the dark.</p>}

      <BlackoutControls view={view} send={send} pending={pending} />
    </Panel>
  );
}

type Fast = "voidQuestion" | "restartQuestion";
const FAST_CONFIRM: Record<Fast, string> = { voidQuestion: "Tap again to void", restartQuestion: "Tap again to restart" };
const FAST_LABEL: Record<Fast, string> = { voidQuestion: "Void question", restartQuestion: "Restart question" };

/** Needed fast in Blackout, so right under the ladder: +5 s, Skip, Void, Restart question (two taps). */
function BlackoutControls({ view, send, pending }: { view: AdminView; send: Send; pending: boolean }) {
  const { armed, guard } = useConfirm();
  if (!view.autopilot) return null;
  const can = (t: AdminActionType) => view.allowed.includes(t) && !pending;
  const why = (t: AdminActionType) => (can(t) ? undefined : notNowReason(t, view));
  const fast = (type: Fast) => (
    <ControlButton tone="danger" armed={armed === type} disabled={!can(type)} title={why(type)} onClick={() => guard(type, () => send({ type }))} testId={`bo-${type}`}>
      {armed === type ? FAST_CONFIRM[type] : FAST_LABEL[type]}
    </ControlButton>
  );
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="blackout-controls">
      <ControlButton onClick={() => send({ type: "addTime" })} disabled={!can("addTime")} title={why("addTime")} testId="bo-addTime">
        <span className="font-term text-2xl leading-none">+5s</span>
      </ControlButton>
      <ControlButton onClick={() => send({ type: "skipTimer" })} disabled={!can("skipTimer")} title={why("skipTimer")} testId="bo-skipTimer">
        Skip
      </ControlButton>
      {fast("voidQuestion")}
      {fast("restartQuestion")}
    </div>
  );
}

/** Why a control is greyed out right now (shown on hover / long press). */
export function notNowReason(type: AdminActionType, view: AdminView): string {
  if (view.phase === "podium") return "The quiz is over.";
  const bo = !!view.autopilot;
  switch (type) {
    case "addTime":
      return bo ? "+5 s works while the runners are answering." : "+5 s works while a timer runs.";
    case "skipTimer":
      return "Nothing is counting down right now.";
    case "pause":
    case "resume":
      return "Pause works while a timer or an autopilot step is running.";
    case "voidQuestion":
      return bo ? "Void works while a question is being read or answered." : "No question to void at this step.";
    case "restartQuestion":
      return bo ? "Restart works until the dark has moved." : "No question to restart at this step.";
    case "restartRound":
      return bo ? "Not during the winner moment." : "Nothing to restart at this step.";
    case "endQuiz":
      return "Start the quiz first.";
    default:
      return "Not possible at this step.";
  }
}

// ---------------------------------------------------------------------------
// The podium
// ---------------------------------------------------------------------------

/** The final order as the Host shows it, so the quizmaster can announce it. */
export function Podium({ view }: { view: AdminView }) {
  const podium = view.podium;
  if (!podium) return null;
  const [first, second, third, ...rest] = podium.entries;
  const detail = (e: (typeof podium.entries)[number]) =>
    podium.basis === "blackout" && e.position !== null ? (e.caughtOnQuestion ? `caught Q${e.caughtOnQuestion}` : "escaped") : `${e.round1Score} pts`;
  return (
    <Panel title="Final result" testId="podium">
      {first ? (
        <div className="flex items-center gap-4">
          <Bot color={first.color} head={first.head} mood="right" size="80px" delay={botDelay(first.id)} label={first.name} />
          <div className="min-w-0">
            <p className="font-term text-[1.6rem] leading-none text-amber">1st</p>
            <p className="truncate text-[1.75rem] leading-tight text-mint">{first.name}</p>
            <p className="text-[14px] text-fog">{podium.basis === "blackout" ? "escaped the dark" : detail(first)}</p>
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-fog">Nobody finished the quiz.</p>
      )}
      {(second || third) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[second, third].filter(Boolean).map((e, i) => (
            <div key={e!.id} className="flex min-w-0 items-center gap-2 rounded-[0.9rem] border border-line px-2 py-2">
              <Bot color={e!.color} head={e!.head} size="40px" delay={botDelay(e!.id)} still />
              <div className="min-w-0">
                <p className="font-term text-[1.4rem] leading-none text-amber">{i === 0 ? "2nd" : "3rd"}</p>
                <p className="truncate text-[15px] text-ghost">{e!.name}</p>
                <p className="text-[14px] text-fog">{detail(e!)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <ol className="mt-3 flex flex-col divide-y divide-line border-t border-line">
          {rest.slice(0, 9).map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <N className="w-7 text-[1.6rem]">{e.place}</N>
              <Bot color={e.color} head={e.head} size="28px" delay={botDelay(e.id)} still />
              <span className="min-w-0 flex-1 truncate text-[16px] text-ghost">{e.name}</span>
              <span className="text-[14px] text-fog">{detail(e)}</span>
            </li>
          ))}
        </ol>
      )}
      {podium.basis === "blackout" && view.backing && (
        <p className="mt-3 text-[15px] text-mint-soft" data-testid="called-it">
          <N className="text-[1.75rem]">{podium.calledIt}</N> of <N className="text-[1.75rem]">{view.backing.backers}</N> called it.
        </p>
      )}
      <p className="mt-2 text-[14px] text-fog">The results (CSV) download is the big button below.</p>
    </Panel>
  );
}

/** The finalists right after the wild card (before predictions or Blackout): seat and Round 1 rank. */
export function Finalists({ view }: { view: AdminView }) {
  const inWildRound = view.phase.startsWith("wc") && view.phase !== "wcWinner";
  if (!view.finalists.length || view.podium || view.blackout || view.phase === "predictions" || view.phase === "cut" || inWildRound) return null;
  return (
    <Panel title="Finalists" aside={<N className="text-[1.6rem]">{view.finalists.length}</N>} testId="finalists">
      <ul className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5">
        {view.finalists.map((f) => (
          <li key={f.id} className="flex min-w-0 flex-col items-center gap-1 text-center">
            <Bot color={f.color} head={f.head} size="40px" delay={botDelay(f.id)} still />
            <span className="w-full truncate text-[14px] text-ghost">{f.name}</span>
            <span className="text-[14px] leading-none text-fog">
              {!f.connected ? <span className="text-wrong">offline</span> : f.wildCard ? "wild card" : `#${f.round1Rank}`}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
