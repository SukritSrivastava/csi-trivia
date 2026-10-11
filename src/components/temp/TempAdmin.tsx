"use client";

/**
 * TEMPORARY (Phase 1) Admin page: sign in, the big primary button, a plain
 * button for every Admin action (greyed out when not allowed), the
 * participants, and the raw AdminView. The real control panel replaces this
 * in Phase 2.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ACTION_LABELS, COMMAND_ERROR_TEXT, DESTRUCTIVE_ACTIONS } from "@/lib/adminLabels";
import { ADMIN_ACTION_TYPES, type AdminAction, type AdminActionType, type AdminView } from "@/shared/protocol";
import { useAdminStore } from "@/stores/adminStore";
import { Button, Card, Countdown, Field, inputClass, RawView, TempShell } from "./TempKit";

/** Actions with parameters get their own controls below; these take none. */
type SimpleType = Exclude<AdminActionType, "removeParticipant" | "setRoomCodeVisible" | "setSound">;
const SIMPLE_ACTIONS = ADMIN_ACTION_TYPES.filter(
  (t): t is SimpleType => t !== "removeParticipant" && t !== "setRoomCodeVisible" && t !== "setSound",
);
const simple = (type: SimpleType) => ({ type }) as AdminAction;

export function TempAdmin() {
  const connect = useAdminStore((s) => s.connect);
  const view = useAdminStore((s) => s.view);
  const status = useAdminStore((s) => s.status);

  useEffect(() => connect(), [connect]);

  return (
    <TempShell title="Admin (quizmaster)" status={status}>
      {view ? <AdminBody view={view} /> : <SignIn />}
    </TempShell>
  );
}

function SignIn() {
  const params = useSearchParams();
  const signIn = useAdminStore((s) => s.signIn);
  const signingIn = useAdminStore((s) => s.signingIn);
  const error = useAdminStore((s) => s.error);
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase());
  const [pin, setPin] = useState("");

  return (
    <Card title="Sign in">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          signIn(code, pin);
        }}
      >
        <Field label="Room code (on the Host screen)">
          <input className={`${inputClass} uppercase tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} name="code" />
        </Field>
        <Field label="PIN">
          <input className={inputClass} value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" name="pin" />
        </Field>
        {error && (
          <p className="rounded-lg bg-side-a p-2 text-sm font-bold" role="alert">
            {error}
          </p>
        )}
        <Button onClick={() => signIn(code, pin)} disabled={signingIn || code.length !== 4 || !pin} tone="primary" big>
          {signingIn ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}

function AdminBody({ view }: { view: AdminView }) {
  const send = useAdminStore((s) => s.send);
  const pending = useAdminStore((s) => s.pending);
  const lastResult = useAdminStore((s) => s.lastResult);
  const clockOffset = useAdminStore((s) => s.clockOffset);
  const signOut = useAdminStore((s) => s.signOut);
  const downloadResults = useAdminStore((s) => s.downloadResults);
  const [confirm, setConfirm] = useState<string | null>(null);

  // A destructive button needs a second tap within 3 seconds.
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirm]);

  const guarded = (key: string, run: () => void) => {
    if (confirm === key) {
      setConfirm(null);
      run();
    } else setConfirm(key);
  };
  const allowed = (t: AdminActionType) => view.allowed.includes(t);
  const error = lastResult && !lastResult.result.ok ? COMMAND_ERROR_TEXT[lastResult.result.reason] : "";

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <p className="type-wide text-3xl font-black tracking-widest">{view.roomCode}</p>
          <p className="text-lg font-black" data-testid="step-label">
            {view.stepLabel}
          </p>
          <span className="ml-auto text-3xl">
            <Countdown timer={view.timer} clockOffset={clockOffset} paused={view.paused} />
          </span>
        </div>
        {view.paused && <p className="mt-2 rounded-lg bg-marigold p-2 text-center text-xl font-black">PAUSED</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {view.primary ? (
            <Button onClick={() => void send(view.primary!.action)} disabled={pending !== null} tone="primary" big testId="primary">
              {view.primary.label}
            </Button>
          ) : (
            <span className="rounded-lg border-2 border-dashed border-ink px-6 py-4 text-lg font-bold text-ink-soft">
              {view.phase === "podium" ? "Finished" : "Waiting…"}
            </span>
          )}
          {view.hint && <p className="max-w-xl text-sm font-semibold">{view.hint}</p>}
        </div>
        {error && (
          <p className="mt-2 text-sm font-bold text-side-a" role="alert">
            {ACTION_LABELS[lastResult!.action]}: {error}
          </p>
        )}
      </Card>

      {view.round2?.buzzedBy && (
        <Card title="Judge">
          <p className="mb-2 text-xl font-black">
            {view.round2.buzzedBy.name} is answering{view.round2.answerTimeUp ? " (time's up)" : ""}. Answer: {view.question?.correctLetter}.{" "}
            {view.question?.correctText}
          </p>
          <div className="flex gap-3">
            <Button onClick={() => void send({ type: "markCorrect" })} disabled={!allowed("markCorrect")} tone="good" big testId="judge-correct">
              Correct
            </Button>
            <Button onClick={() => void send({ type: "markWrong" })} disabled={!allowed("markWrong")} tone="danger" big testId="judge-wrong">
              Wrong
            </Button>
          </div>
        </Card>
      )}

      <Card title="All actions (greyed out = not possible right now)">
        <div className="flex flex-wrap gap-2">
          {SIMPLE_ACTIONS.map((type) => {
            const destructive = DESTRUCTIVE_ACTIONS.includes(type);
            const label = type === "undoMark" && view.lastMark ? `Undo ${view.lastMark.correct ? "Correct" : "Wrong"} for ${view.lastMark.by.name}` : ACTION_LABELS[type];
            return (
              <Button
                key={type}
                disabled={!allowed(type) || pending !== null}
                tone={destructive ? "danger" : "plain"}
                onClick={() => (destructive ? guarded(type, () => void send(simple(type))) : void send(simple(type)))}
              >
                {confirm === type ? `Tap again: ${label}` : label}
              </Button>
            );
          })}
          <Button onClick={() => void send({ type: "setRoomCodeVisible", visible: !view.roomCodeVisible })}>
            {view.roomCodeVisible ? "Hide room code on Host" : "Show room code on Host"}
          </Button>
          <Button onClick={() => void send({ type: "setSound", on: !view.soundOn })}>{view.soundOn ? "Sound off" : "Sound on"}</Button>
          <Button onClick={downloadResults}>Results CSV</Button>
          <Button onClick={signOut}>Sign out</Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Current question (with the answer)">
          {view.question ? (
            <div>
              <p className="font-bold">
                Round {view.question.round}, question {view.question.number}
                {view.question.count ? ` of ${view.question.count}` : ""}
                {view.question.suddenDeath ? " (sudden death)" : ""}
              </p>
              <p className="text-lg font-black">{view.question.text}</p>
              <ul>
                {view.question.options.map((o) => (
                  <li key={o.letter} className={o.correct ? "font-black text-side-b" : ""}>
                    {o.letter}. {o.text} {o.correct ? "✔" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-ink-soft">No question on right now.</p>
          )}
          {view.nextQuestion && (
            <p className="mt-3 text-sm">
              <span className="font-bold">Next up:</span> round {view.nextQuestion.round}
              {view.nextQuestion.suddenDeath ? " sudden death" : ""} #{view.nextQuestion.number}: {view.nextQuestion.text}
            </p>
          )}
        </Card>
        <Card title="Counts">
          <p className="text-sm">
            {view.counts.joined} joined · {view.counts.connected} connected · {view.counts.playing} playing · {view.counts.finalists} finalists ·{" "}
            {view.counts.audience} audience · {view.counts.removed} removed
          </p>
          {view.counts.expected !== null && (
            <p className="mt-1 text-xl font-black">
              {view.counts.answered} / {view.counts.expected} answered
            </p>
          )}
          {view.finalists.length > 0 && (
            <ul className="mt-2 text-sm">
              {view.finalists.map((f) => (
                <li key={f.id} className={f.lockedOut || !f.inPlay ? "opacity-50" : ""}>
                  {f.seat}. {f.name}: {f.points} pts{f.lockedOut ? " (locked out)" : ""}
                  {view.backing ? ` · backed by ${view.backing.counts[f.id] ?? 0}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Participants (${view.participants.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-ink">
                <th className="py-1 pr-2">Name</th>
                <th className="pr-2">Status</th>
                <th className="pr-2">Online</th>
                <th className="pr-2">Rank</th>
                <th className="pr-2">Score</th>
                <th className="pr-2">Buzzer pts</th>
                <th className="pr-2">Answered</th>
                <th className="pr-2">Left page</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.participants.map((p) => (
                <tr key={p.id} className={`border-b border-ink/20 ${p.status === "removed" ? "opacity-40" : ""}`}>
                  <td className="py-1 pr-2 font-bold">
                    <span className="mr-1 inline-block h-3 w-3 rounded-full border border-ink" style={{ background: p.color }} />
                    {p.name}
                  </td>
                  <td className="pr-2">{p.status}{p.joinedLate ? " (late)" : ""}</td>
                  <td className="pr-2">{p.connected ? "●" : "○"}{p.pageHidden ? " away" : ""}</td>
                  <td className="pr-2">{p.rank ?? "–"}</td>
                  <td className="pr-2">{p.score}</td>
                  <td className="pr-2">{p.status === "finalist" ? p.points : "–"}</td>
                  <td className="pr-2">{p.answered === null ? "–" : p.answered ? "yes" : "no"}</td>
                  <td className="pr-2">{p.leftPageCount || ""}</td>
                  <td>
                    {p.status !== "removed" && allowed("removeParticipant") && (
                      <Button tone="danger" onClick={() => guarded(`remove:${p.id}`, () => void send({ type: "removeParticipant", participantId: p.id }))}>
                        {confirm === `remove:${p.id}` ? "Tap again" : "Remove"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RawView value={view} />
    </>
  );
}
