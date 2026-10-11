"use client";

/**
 * TEMPORARY (Phase 1) Host page: shows the current step and the raw HostView.
 * The real projector screens replace this in Phase 4. The Host has no game
 * controls; "New room" is only here for testing.
 */
import { useEffect } from "react";
import { useJoinUrl } from "@/components/host/useJoinUrl";
import { displayUrl } from "@/lib/format";
import type { HostStage, HostView } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";
import { Button, Card, Countdown, RawView, TempShell } from "./TempKit";

export function TempHost() {
  const connect = useHostStore((s) => s.connect);
  const view = useHostStore((s) => s.view);
  const status = useHostStore((s) => s.status);
  const error = useHostStore((s) => s.error);

  useEffect(() => connect(), [connect]);

  return (
    <TempShell title="Host (projector)" status={status}>
      {error && <p className="rounded-lg bg-side-a p-3 font-bold">{error}</p>}
      {view ? <HostBody view={view} /> : <p className="font-bold">Creating a quiz room…</p>}
    </TempShell>
  );
}

function HostBody({ view }: { view: HostView }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const newRoom = useHostStore((s) => s.newRoom);
  const joinUrl = useJoinUrl(view);
  const fullJoinLink = `${joinUrl}?code=${view.roomCode}`;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-sm font-bold text-ink-soft">Room code</p>
            <p className="type-wide text-5xl font-black tracking-widest" data-testid="room-code">
              {view.roomCodeVisible ? view.roomCode : "• • • •"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-soft">Join at</p>
            {view.roomCodeVisible ? (
              <a className="break-all font-bold underline" href={fullJoinLink} target="_blank" rel="noreferrer">
                {displayUrl(fullJoinLink)}
              </a>
            ) : (
              <p className="font-bold">Code hidden by Admin</p>
            )}
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm font-bold text-ink-soft">Timer</p>
            <p className="text-3xl">
              <Countdown timer={view.timer} clockOffset={clockOffset} paused={view.paused} />
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm">
          {view.counts.joined} joined · {view.counts.connected} connected · {view.counts.playing} playing · {view.counts.finalists} finalists ·{" "}
          {view.counts.audience} audience · sound {view.soundOn ? "on" : "off"}
        </p>
      </Card>

      <Card title={`Stage: ${view.stage.phase}`}>
        <StageSummary stage={view.stage} view={view} />
      </Card>

      <div>
        <Button onClick={newRoom}>New room (testing only)</Button>
      </div>
      <RawView value={view} />
    </>
  );
}

function StageSummary({ stage, view }: { stage: HostStage; view: HostView }) {
  switch (stage.phase) {
    case "lobby":
      return (
        <ul className="flex flex-wrap gap-2" aria-label="Participants">
          {view.participants.map((p) => (
            <li key={p.id} className="rounded-full border-2 border-ink px-3 py-1 text-sm font-bold" style={{ background: p.color }}>
              {p.name}
            </li>
          ))}
          {view.participants.length === 0 && <li>Nobody yet. Open /play in other tabs.</li>}
        </ul>
      );
    case "r1Intro":
      return (
        <p>
          Round 1: everyone plays {view.settings.round1Questions} questions. {view.settings.round1ReadSeconds}s to read,{" "}
          {view.settings.round1AnswerSeconds}s to answer. Top {view.settings.finalistCount} go to the buzzer round.
        </p>
      );
    case "r1Read":
    case "r1Answer":
    case "r1TimesUp":
    case "r1Reveal":
    case "r1Results":
    case "r1Leaderboard":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-ink-soft">
            Question {stage.question.number} of {stage.question.count}
          </p>
          <p className="text-2xl font-black">{stage.question.text}</p>
          {stage.question.image && <img src={stage.question.image} alt="" className="h-32 w-32 object-contain" />}
          {(stage.phase === "r1Answer" || stage.phase === "r1TimesUp") && (
            <p className="font-bold">
              {stage.answered} / {stage.expected} answered{stage.phase === "r1TimesUp" ? " · Time's up" : ""}
            </p>
          )}
          {stage.phase === "r1Reveal" && <p className="text-xl font-black">{stage.voided ? "Question cancelled" : `Answer: ${stage.correctText}`}</p>}
          {stage.phase === "r1Results" && (
            <ul>
              {stage.options.map((o) => (
                <li key={o.letter} className={o.correct ? "font-black" : ""}>
                  {o.letter}. {o.text}: {o.count} {o.correct ? "✔" : ""}
                </li>
              ))}
            </ul>
          )}
          {stage.phase === "r1Leaderboard" && (
            <ol>
              {stage.rows.map((r) => (
                <li key={r.id}>
                  {r.rank}. {r.name}: {r.score} (+{r.change}){r.previousRank ? ` (was ${r.previousRank})` : ""}
                </li>
              ))}
            </ol>
          )}
        </div>
      );
    case "cut":
      return (
        <ol>
          {stage.standings.map((s) => (
            <li key={s.id} className={s.finalist ? "font-black" : "opacity-60"}>
              {s.rank}. {s.name}: {s.score} {s.finalist ? "→ buzzer round" : ""}
            </li>
          ))}
        </ol>
      );
    case "predictions":
    case "r2Intro":
      return (
        <ul>
          {stage.finalists.map((f) => (
            <li key={f.id}>
              {f.seat}. {f.name}: {f.points} pts · backed by {stage.backing.counts[f.id] ?? 0}
            </li>
          ))}
          <li className="mt-1 text-sm">
            {stage.backing.backers} of {stage.backing.audience} audience have backed someone
          </li>
        </ul>
      );
    case "r2Read":
    case "r2BuzzOpen":
    case "r2Answering":
    case "r2Reveal": {
      const r = stage.round2;
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-ink-soft">
            {r.question.suddenDeath ? `Sudden death question ${r.question.number}` : `Buzzer question ${r.question.number} of ${r.question.count}`}
          </p>
          <p className="text-2xl font-black">{r.question.text}</p>
          <ol className="grid grid-cols-2 gap-1">
            {r.question.options.map((o, i) => (
              <li key={o} className={r.correct?.text === o ? "font-black underline" : ""}>
                {"ABCD"[i]}. {o}
              </li>
            ))}
          </ol>
          <p className="font-bold">
            {stage.phase === "r2Read" && "Buzzers locked (reading)"}
            {stage.phase === "r2BuzzOpen" && "BUZZERS OPEN"}
            {stage.phase === "r2Answering" && `${r.buzzedBy?.name} buzzed! ${r.answerTimeUp ? "(time up, waiting for the mark)" : ""}`}
            {stage.phase === "r2Reveal" &&
              (r.outcome?.kind === "correct"
                ? `${r.outcome.by.name} got it! Answer: ${r.correct?.letter}. ${r.correct?.text}`
                : r.outcome?.kind === "voided"
                  ? "Question cancelled"
                  : `Nobody got it (${r.outcome?.kind === "nobody" ? r.outcome.reason : ""}). Answer: ${r.correct?.letter}. ${r.correct?.text}`)}
          </p>
          <FinalistList finalists={r.finalists} />
          {r.wrong.length > 0 && <p className="text-sm">Wrong: {r.wrong.map((w) => w.name).join(", ")}</p>}
          {r.winner && <p className="font-black">Winner: {r.winner.name}</p>}
        </div>
      );
    }
    case "r2Scores":
      return <FinalistList finalists={stage.finalists} />;
    case "suddenDeath":
      return <p className="font-black">Sudden death: {stage.tied.map((t) => t.name).join(" vs ")}. First correct answer wins.</p>;
    case "podium":
      return (
        <div>
          <ol>
            {stage.entries.slice(0, 10).map((e) => (
              <li key={e.id} className={e.place <= 3 ? "text-xl font-black" : ""}>
                {e.place}. {e.name}: {e.points} {stage.basis === "buzzer" ? "pts" : "(round 1 score)"}
              </li>
            ))}
          </ol>
          {stage.basis === "buzzer" && (
            <p className="mt-2 font-bold">
              {stage.calledIt} of {stage.backing.backers} called it
            </p>
          )}
        </div>
      );
  }
}

function FinalistList({ finalists }: { finalists: { id: string; name: string; points: number; lockedOut: boolean; inPlay: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {finalists.map((f) => (
        <li
          key={f.id}
          className={`rounded-lg border-2 border-ink px-3 py-1 text-sm font-bold ${f.lockedOut || !f.inPlay ? "opacity-40" : ""}`}
        >
          {f.name}: {f.points}
          {f.lockedOut ? " (locked out)" : ""}
        </li>
      ))}
    </ul>
  );
}
