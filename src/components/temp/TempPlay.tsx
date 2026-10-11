"use client";

/**
 * TEMPORARY (Phase 1) Participant page: join, then plain buttons for whatever
 * the current screen allows, and the raw ParticipantView. The real phone
 * screens replace this in Phase 3.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { loadLastName } from "@/lib/session";
import { usePageVisibility } from "@/lib/usePageVisibility";
import { useWakeLock } from "@/lib/useWakeLock";
import { NAME_MAX_LENGTH, type ParticipantScreen, type ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Button, Card, Countdown, Field, inputClass, RawView, TempShell } from "./TempKit";

export function TempPlay() {
  const connect = useParticipantStore((s) => s.connect);
  const view = useParticipantStore((s) => s.view);
  const status = useParticipantStore((s) => s.status);
  const resuming = useParticipantStore((s) => s.resuming);

  useEffect(() => connect(), [connect]);
  useWakeLock(view !== null);
  usePageVisibility(view !== null);

  return (
    <TempShell title="Participant (phone)" status={status}>
      {view ? <PlayBody view={view} /> : resuming ? <p className="font-bold">Rejoining your quiz…</p> : <JoinForm />}
    </TempShell>
  );
}

function JoinForm() {
  const params = useSearchParams();
  const join = useParticipantStore((s) => s.join);
  const joining = useParticipantStore((s) => s.joining);
  const notice = useParticipantStore((s) => s.notice);
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase());
  const [name, setName] = useState("");

  useEffect(() => setName((n) => n || loadLastName()), []);

  return (
    <Card title="Join the quiz">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          join(code, name);
        }}
      >
        <Field label="Room code">
          <input
            className={`${inputClass} uppercase tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            name="code"
          />
        </Field>
        <Field label="Your name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            name="name"
          />
        </Field>
        {notice && (
          <p className="rounded-lg bg-side-a p-2 text-sm font-bold" role="alert">
            {notice}
          </p>
        )}
        <Button onClick={() => join(code, name)} disabled={joining || code.length !== 4 || !name.trim()} tone="primary" big>
          {joining ? "Joining…" : "Join"}
        </Button>
      </form>
    </Card>
  );
}

function PlayBody({ view }: { view: ParticipantView }) {
  const clockOffset = useParticipantStore((s) => s.clockOffset);
  const leave = useParticipantStore((s) => s.leave);
  const s = view.screen;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border-2 border-ink px-3 py-1 font-black" style={{ background: view.me.color }}>
            {view.me.name}
          </span>
          <span className="text-sm font-bold">
            {view.me.status} · room {view.roomCode}
          </span>
          <span className="ml-auto text-2xl">
            <Countdown timer={view.timer} clockOffset={clockOffset} paused={view.paused} />
          </span>
        </div>
        {view.paused && <p className="mt-2 rounded-lg bg-marigold p-2 text-center font-black">Paused by the quizmaster</p>}
      </Card>

      <Card title={`Screen: ${s.kind}`} testId={`screen-${s.kind}`}>
        <ScreenSummary screen={s} meId={view.me.id} />
      </Card>

      <div>
        <Button onClick={leave}>Leave (forget this seat)</Button>
      </div>
      <RawView value={view} />
    </>
  );
}

function ScreenSummary({ screen: s, meId }: { screen: ParticipantScreen; meId: string }) {
  const answer = useParticipantStore((st) => st.answer);
  const buzz = useParticipantStore((st) => st.buzz);
  const back = useParticipantStore((st) => st.back);
  const tapped = useParticipantStore((st) => st.tapped);

  switch (s.kind) {
    case "lobby":
      return <p>You&apos;re in. {s.joined} joined so far. Watch the projector.</p>;
    case "r1Intro":
      return (
        <p>
          Round 1: {s.settings.round1Questions} questions, {s.settings.round1ReadSeconds}s to read and {s.settings.round1AnswerSeconds}s to answer.
        </p>
      );
    case "nextQuestion":
      return <p>You&apos;re in! You&apos;ll play from the next question.</p>;
    case "eyesUp":
      return (
        <p className="text-xl font-black">
          Eyes up! Question {s.questionNumber} of {s.questionCount} is on the projector.
        </p>
      );
    case "answer": {
      const lockedHere = tapped?.questionId === s.questionId ? tapped : null;
      return (
        <div className="grid grid-cols-2 gap-2">
          {s.options.map((o) => (
            <Button key={o.id} onClick={() => answer(s.questionId, o)} disabled={!!lockedHere} big tone={lockedHere?.optionId === o.id ? "primary" : "plain"} testId="option">
              {o.text}
            </Button>
          ))}
        </div>
      );
    }
    case "lockedIn":
      return (
        <p className="text-xl font-black">
          Locked in: {s.choiceText}
          {s.timeUp ? " · Time's up" : ""}
        </p>
      );
    case "timesUp":
      return <p className="text-xl font-black">Time&apos;s up! No answer this time.</p>;
    case "result":
      return <p className="text-3xl font-black">{s.outcome === "correct" ? "Right!" : s.outcome === "wrong" ? "Wrong" : "Missed it"}</p>;
    case "voided":
      return <p className="font-black">Question cancelled. No points for anyone.</p>;
    case "cut":
      return (
        <p className="text-2xl font-black">
          {s.madeIt ? `You're in the top ${s.finalistCount}!` : "You're out"} (you finished {s.rank} of {s.of})
        </p>
      );
    case "audience":
      return <p>You joined as audience. You&apos;ll back a finalist soon.</p>;
    case "backFinalist":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-bold">Who will win? Back a finalist (you can change until the buzzer round starts).</p>
          <div className="flex flex-wrap gap-2">
            {s.finalists.map((f) => (
              <Button key={f.id} onClick={() => back(f.id)} tone={s.backedId === f.id ? "primary" : "plain"} testId="back">
                {f.name}
                {s.backedId === f.id ? " ✔" : ""}
              </Button>
            ))}
          </div>
        </div>
      );
    case "finalist":
      return (
        <p className="text-xl font-black">
          You&apos;re finalist #{s.seat} of {s.finalistCount}! Get ready to buzz.
        </p>
      );
    case "buzzer":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-bold">
            Step: {s.step}
            {s.questionNumber ? ` · question ${s.questionNumber}${s.suddenDeath ? " (sudden death)" : ""}` : ""} · your points {s.points}
            {!s.inPlay ? " · sitting out" : ""}
            {s.lockedOut ? " · locked out this question" : ""}
            {s.myResult ? ` · you were ${s.myResult}` : ""}
          </p>
          {s.buzzedBy && <p className="font-black">{s.buzzedBy.id === meId ? "You buzzed! Say your answer out loud." : `${s.buzzedBy.name} buzzed`}</p>}
          <Button onClick={() => s.questionId && buzz(s.questionId)} disabled={!s.canBuzz} tone="danger" big testId="buzz">
            BUZZ
          </Button>
          <Standings finalists={s.finalists} />
        </div>
      );
    case "buzzerWatch":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-bold">
            Step: {s.step}
            {s.questionNumber ? ` · question ${s.questionNumber}${s.suddenDeath ? " (sudden death)" : ""}` : ""}
            {s.buzzedBy ? ` · ${s.buzzedBy.name} buzzed` : ""}
          </p>
          <Standings finalists={s.finalists} backedId={s.backedId} />
        </div>
      );
    case "podium":
      return (
        <p className="text-2xl font-black">
          {s.place === 1
            ? "You won!"
            : s.place
              ? `You finished ${s.place} of ${s.of}`
              : s.calledIt === true
                ? "You called it!"
                : s.calledIt === false
                  ? "Your pick didn't win this time"
                  : `${s.winner?.name ?? "Nobody"} won`}
        </p>
      );
    case "removed":
      return <p className="font-black">The quizmaster removed you from this quiz.</p>;
  }
}

function Standings({ finalists, backedId }: { finalists: { id: string; name: string; points: number; lockedOut: boolean }[]; backedId?: string | null }) {
  return (
    <ul className="flex flex-wrap gap-2 text-sm">
      {finalists.map((f) => (
        <li key={f.id} className={`rounded-lg border-2 border-ink px-2 py-1 font-bold ${f.lockedOut ? "opacity-40" : ""}`}>
          {f.name}: {f.points}
          {backedId === f.id ? " (your pick)" : ""}
        </li>
      ))}
    </ul>
  );
}
