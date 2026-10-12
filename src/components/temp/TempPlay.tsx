"use client";

/**
 * TEMPORARY (Phase 1) Participant page, in the approved phone look
 * (public/finaldesign.html): join, build your bot, answer, buzz, back a
 * finalist, plus the raw ParticipantView under "Test tools". The real phone
 * screens, with motion and haptics, replace this in Phase 3.
 */
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { BotBuilder } from "@/components/ui/BotBuilder";
import { loadLastName } from "@/lib/session";
import { useCountdown } from "@/lib/useCountdown";
import { usePageVisibility } from "@/lib/usePageVisibility";
import { useWakeLock } from "@/lib/useWakeLock";
import { type BotMood, type FinalistState, NAME_MAX_LENGTH, type ParticipantScreen, type ParticipantView, type Timer } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { Button, Field, inputClass, RawView, TempShell } from "./TempKit";

export function TempPlay() {
  const connect = useParticipantStore((s) => s.connect);
  const view = useParticipantStore((s) => s.view);
  const status = useParticipantStore((s) => s.status);
  const resuming = useParticipantStore((s) => s.resuming);

  useEffect(() => connect(), [connect]);
  useWakeLock(view !== null);
  usePageVisibility(view !== null);

  return (
    <TempShell title="HERMES QUIZ" status={status} phone>
      {view ? <PlayBody view={view} /> : resuming ? <p className="py-10 text-center">Rejoining your quiz…</p> : <JoinForm />}
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
    <form
      className="flex flex-col gap-4 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        join(code, name);
      }}
    >
      <div className="grid place-items-center py-2">
        <Bot color="#6CF0B0" head="antenna" size="72px" />
      </div>
      <p className="text-center text-xl">Join the quiz</p>
      <Field label="Room code (on the projector)">
        <input
          className={`${inputClass} font-term text-3xl tracking-[0.4em] uppercase`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
          name="code"
        />
      </Field>
      <Field label="Your real name">
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
        <p className="rounded-xl border border-wrong bg-wrong/10 p-3 text-sm text-wrong" role="alert">
          {notice}
        </p>
      )}
      <button type="submit" className="phone-go" disabled={joining || code.length !== 4 || !name.trim()}>
        {joining ? "JOINING…" : "JOIN"}
      </button>
    </form>
  );
}

/** "Q1 of 3 · 5s" header with a thin mint timer bar. */
function PhoneHeader({ view, label }: { view: ParticipantView; label: string }) {
  const clockOffset = useParticipantStore((s) => s.clockOffset);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm opacity-80">
        <Bot color={view.me.color} head={view.me.head} size="22px" />
        <span className="min-w-0 flex-1 truncate">
          {view.me.name} · room {view.roomCode}
        </span>
        <TimeLeft timer={view.timer} clockOffset={clockOffset} />
      </div>
      {label && <p className="text-sm opacity-80">{label}</p>}
      <TimerBar timer={view.timer} clockOffset={clockOffset} />
    </div>
  );
}

function TimeLeft({ timer, clockOffset }: { timer: Timer | null; clockOffset: number }) {
  const c = useCountdown(timer, clockOffset);
  if (!c) return null;
  return (
    <span className="font-term text-2xl leading-none text-amber" data-testid="countdown">
      {c.seconds}s
    </span>
  );
}

function TimerBar({ timer, clockOffset }: { timer: Timer | null; clockOffset: number }) {
  const c = useCountdown(timer, clockOffset);
  return (
    <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
      {c && <div className="h-full bg-mint transition-[width] duration-200 ease-linear" style={{ width: `${c.fraction * 100}%` }} />}
    </div>
  );
}

function PlayBody({ view }: { view: ParticipantView }) {
  const leave = useParticipantStore((s) => s.leave);
  const s = view.screen;

  return (
    <>
      <PhoneHeader view={view} label={headerLabel(s)} />
      {view.paused && <p className="rounded-xl bg-alarm/90 p-2 text-center font-term text-2xl text-ghost">PAUSED BY THE QUIZMASTER</p>}
      <section className="flex min-h-[60dvh] flex-col gap-4" data-testid={`screen-${s.kind}`}>
        <ScreenBody screen={s} view={view} />
      </section>
      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-fog">Test tools (temporary)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-fog">
            status {view.me.status} · screen {s.kind}
          </p>
          <Button onClick={leave}>Leave (forget this seat)</Button>
          <RawView value={view} />
        </div>
      </details>
    </>
  );
}

function headerLabel(s: ParticipantScreen): string {
  switch (s.kind) {
    case "eyesUp":
    case "answer":
      return `Q${s.questionNumber} of ${s.questionCount}`;
    case "buzzer":
    case "buzzerWatch":
      return s.questionNumber ? `${s.suddenDeath ? "Sudden death" : "Buzzer"} Q${s.questionNumber}` : "Buzzer round";
    default:
      return "";
  }
}

/** Big centred moment: the player's bot, a big word, a line under it. */
function Moment({ view, mood, big, bad, children }: { view: ParticipantView; mood: BotMood; big?: string; bad?: boolean; children?: ReactNode }) {
  return (
    <div className="my-auto flex flex-col items-center gap-4 py-6 text-center">
      <Bot color={view.me.color} head={view.me.head} mood={mood} size="96px" label="Your bot" />
      {big && (
        <p className="phone-result" data-bad={bad ? "true" : undefined}>
          {big}
        </p>
      )}
      {children && <div className="text-base opacity-85">{children}</div>}
    </div>
  );
}

function ScreenBody({ screen: s, view }: { screen: ParticipantScreen; view: ParticipantView }) {
  const answer = useParticipantStore((st) => st.answer);
  const buzz = useParticipantStore((st) => st.buzz);
  const back = useParticipantStore((st) => st.back);
  const tapped = useParticipantStore((st) => st.tapped);
  const setBot = useParticipantStore((st) => st.setBot);
  const botPending = useParticipantStore((st) => st.botPending);
  const botNotice = useParticipantStore((st) => st.botNotice);
  const me = view.me;

  switch (s.kind) {
    case "lobby":
      return (
        <div className="flex flex-col gap-2" data-testid="bot-builder">
          <p className="text-xl">Build your bot</p>
          <BotBuilder value={{ color: me.color, head: me.head }} onPick={setBot} busy={botPending} />
          {botNotice && (
            <p className="text-sm text-wrong" role="alert">
              {botNotice}
            </p>
          )}
          <p className="mt-3 text-center text-sm opacity-80">
            <span className="font-term text-xl text-amber">{s.joined}</span> {s.joined === 1 ? "bot" : "bots"} in the room. Your bot locks when the quiz
            starts.
          </p>
        </div>
      );
    case "r1Intro":
      return (
        <Moment view={view} mood="idle" big="ROUND 1">
          {s.settings.round1Questions} questions · {s.settings.round1ReadSeconds}s to read · {s.settings.round1AnswerSeconds}s to answer.
          <br />
          The top {s.settings.finalistCount} go to the buzzer round.
        </Moment>
      );
    case "nextQuestion":
      return (
        <Moment view={view} mood="idle" big="YOU'RE IN">
          You&apos;ll play from the next question.
        </Moment>
      );
    case "eyesUp":
      return (
        <Moment view={view} mood="idle" big="EYES UP">
          Read the question on the projector. Options appear here next.
        </Moment>
      );
    case "answer": {
      const lockedHere = tapped?.questionId === s.questionId ? tapped : null;
      return (
        <>
          <p className="text-xl">{lockedHere ? "Locked in." : "Pick one. First tap locks."}</p>
          <div className="mt-auto flex flex-col gap-3">
            {s.options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className="phone-opt gap-3 text-base"
                onClick={() => answer(s.questionId, o)}
                disabled={!!lockedHere}
                aria-pressed={lockedHere?.optionId === o.id}
                data-testid="option"
              >
                <span className="font-term text-3xl leading-none text-amber">{i + 1}</span>
                {o.text}
              </button>
            ))}
          </div>
        </>
      );
    }
    case "lockedIn":
      return (
        <Moment view={view} mood="locked" big={s.timeUp ? "TIME'S UP" : "LOCKED IN"}>
          {s.choiceText}
        </Moment>
      );
    case "timesUp":
      return (
        <Moment view={view} mood="idle" big="TIME'S UP" bad>
          No answer this time.
        </Moment>
      );
    case "result":
      return s.outcome === "correct" ? (
        <Moment view={view} mood="right" big="CORRECT">
          Your bot survives. For now.
        </Moment>
      ) : (
        <Moment view={view} mood="wrong" big={s.outcome === "missed" ? "MISSED" : "WRONG"} bad>
          It was {s.correctText}.
        </Moment>
      );
    case "voided":
      return (
        <Moment view={view} mood="idle" big="CANCELLED">
          The quizmaster cancelled that question. No points for anyone.
        </Moment>
      );
    case "cut":
      return s.madeIt ? (
        <Moment view={view} mood="right" big={`TOP ${s.finalistCount}`}>
          You finished {s.rank} of {s.of}. You&apos;re in the buzzer round!
        </Moment>
      ) : (
        <Moment view={view} mood="out" big="POWERED DOWN" bad>
          You finished {s.rank} of {s.of}. Stay on to back a finalist.
        </Moment>
      );
    case "audience":
      return (
        <Moment view={view} mood="idle" big="WATCHING">
          You joined as audience. You&apos;ll back a finalist soon.
        </Moment>
      );
    case "backFinalist":
      return (
        <>
          <p className="text-xl">Who will win?</p>
          <p className="text-sm opacity-80">Back a finalist. You can change until the buzzer round starts.</p>
          <div className="grid grid-cols-2 gap-3">
            {s.finalists.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => back(f.id)}
                aria-pressed={s.backedId === f.id}
                className="phone-opt flex-col justify-center gap-2 py-3 text-center"
                data-testid="back"
              >
                <Bot color={f.color} head={f.head} size="44px" delay={botDelay(f.id)} />
                {f.name}
              </button>
            ))}
          </div>
        </>
      );
    case "finalist":
      return (
        <Moment view={view} mood="right" big="FINALIST">
          Seat {s.seat} of {s.finalistCount}. Get ready to buzz.
        </Moment>
      );
    case "buzzer": {
      const mine = s.buzzedBy?.id === me.id;
      const mood: BotMood = s.myResult === "correct" ? "right" : s.lockedOut || s.myResult === "wrong" ? "wrong" : mine ? "locked" : s.canBuzz ? "thinking" : "idle";
      return (
        <>
          <div className="flex items-center justify-between">
            <Bot color={me.color} head={me.head} mood={mood} size="56px" label="Your bot" />
            <p className="text-right text-sm">
              Your points <span className="font-term text-3xl leading-none text-amber">{s.points}</span>
            </p>
          </div>
          <p className="min-h-6 text-center text-lg">
            {mine
              ? "You buzzed! Say your answer out loud."
              : s.buzzedBy
                ? `${s.buzzedBy.name} buzzed`
                : s.lockedOut
                  ? "Locked out this question"
                  : !s.inPlay
                    ? "Sitting this one out"
                    : s.canBuzz
                      ? "Buzzers open!"
                      : "Buzzers locked. Read the question."}
          </p>
          <button
            type="button"
            onClick={() => s.questionId && buzz(s.questionId)}
            disabled={!s.canBuzz}
            data-testid="buzz"
            className="mx-auto grid aspect-square w-[70%] place-items-center rounded-full border-4 border-void bg-mint font-term text-6xl text-void shadow-[6px_6px_0_var(--color-mint-soft),0_0_30px_rgb(108_240_176/0.45)] transition active:scale-95 disabled:bg-line disabled:text-fog disabled:shadow-none"
          >
            BUZZ
          </button>
          <Standings finalists={s.finalists} />
        </>
      );
    }
    case "buzzerWatch":
      return (
        <>
          <p className="text-center text-lg">{s.buzzedBy ? `${s.buzzedBy.name} buzzed` : s.step === "buzzOpen" ? "Buzzers open!" : "The buzzer round"}</p>
          <Standings finalists={s.finalists} backedId={s.backedId} />
        </>
      );
    case "podium": {
      const won = s.place === 1;
      const text = won
        ? "YOU WON!"
        : s.place === 2
          ? "2ND PLACE"
          : s.place === 3
            ? "3RD PLACE"
            : s.place
              ? `${s.place}TH`
              : s.calledIt
                ? "CALLED IT!"
                : "GAME OVER";
      return (
        <Moment view={view} mood={won || s.calledIt ? "right" : s.place ? "idle" : "out"} big={text} bad={s.calledIt === false}>
          {s.place && !won && `You finished ${s.place} of ${s.of}.`}
          {s.calledIt === false && "Your pick didn't win this time."}
          {s.winner && !won && <p className="mt-1">{s.winner.name} won.</p>}
        </Moment>
      );
    }
    case "removed":
      return (
        <Moment view={view} mood="out" big="REMOVED" bad>
          The quizmaster removed you from this quiz.
        </Moment>
      );
  }
}

function Standings({ finalists, backedId }: { finalists: FinalistState[]; backedId?: string | null }) {
  return (
    <ul className="mt-auto grid grid-cols-3 gap-3">
      {finalists.map((f) => (
        <li
          key={f.id}
          className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs ${backedId === f.id ? "border-mint" : "border-line"} ${f.lockedOut || !f.inPlay ? "opacity-45" : ""}`}
        >
          <Bot color={f.color} head={f.head} mood={f.lockedOut ? "wrong" : "idle"} size="36px" delay={botDelay(f.id)} />
          <span className="w-full truncate text-center">{f.name}</span>
          <span className="font-term text-2xl leading-none text-amber">{f.points}</span>
          {backedId === f.id && <span className="text-[10px] text-mint">your pick</span>}
        </li>
      ))}
    </ul>
  );
}
