"use client";

/**
 * PHASE 1 PLACEHOLDERS: just enough projector to run a full game.
 * Phase 2 replaces each of these with the real, animated projector screen.
 */
import { Avatar } from "@/components/ui/Avatar";
import { TimerRing } from "@/components/ui/TimerRing";
import { useHostStore } from "@/stores/hostStore";
import type { HostStage, HostView } from "@/shared/protocol";

type Stage<P extends HostStage["phase"]> = Extract<HostStage, { phase: P }>;

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="type-wide text-[6rem] font-black leading-none tracking-tight text-balance">{children}</h1>;
}

function QuestionCard({ text, image, label }: { text: string; image: string | null; label: string }) {
  return (
    <div className="plate flex w-full items-center gap-[3rem] px-[3rem] py-[2.5rem]">
      <div className="flex-1">
        <p className="text-[1.6rem] font-bold text-ink-soft">{label}</p>
        <p className="mt-[0.4rem] text-[4.4rem] font-black leading-[1.1] text-balance">{text}</p>
      </div>
      {image && (
        <img src={image} alt="" className="h-[22rem] w-[22rem] rounded-[1rem] border-[0.25rem] border-ink object-contain" />
      )}
    </div>
  );
}

export function RoundIntroStage({ stage }: { stage: Stage<"roundIntro"> }) {
  const r = stage.round;
  return (
    <div className="flex flex-col items-center text-center">
      <Title>Round {r.number}</Title>
      <p className="mt-[2rem] text-[3rem] font-black">
        {r.playersIn} players. Top {r.advance} go through.
      </p>
      <p className="mt-[1rem] text-[2rem] font-semibold text-ink-soft">
        {r.questionCount} questions, {r.secondsPerQuestion} seconds each
        {r.wrongPenalty > 0 && `. Wrong answers cost ${r.wrongPenalty} points.`}
      </p>
    </div>
  );
}

export function ReadStage({ stage }: { view: HostView; stage: Stage<"read"> }) {
  const q = stage.question;
  return (
    <div className="flex w-full max-w-[120rem] flex-col gap-[2rem]">
      <QuestionCard text={q.text} image={q.image} label={`Question ${q.number} of ${q.count}`} />
      <p className="text-center text-[2.4rem] font-black">Read it. Options appear on your phone in a moment.</p>
    </div>
  );
}

export function AnswerStage({ view, stage }: { view: HostView; stage: Stage<"answer"> }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const q = stage.question;
  return (
    <div className="flex w-full max-w-[120rem] flex-col gap-[2.5rem]">
      <QuestionCard text={q.text} image={q.image} label={`Question ${q.number} of ${q.count}`} />
      <div className="flex items-center justify-center gap-[3rem]">
        <TimerRing timer={view.timer} clockOffset={clockOffset} size={11} />
        <p className="type-wide text-[4rem] font-black tabular-nums">
          {stage.answeredCount} / {stage.activeCount} answered
        </p>
      </div>
    </div>
  );
}

export function RevealStage({ stage }: { stage: Stage<"reveal"> }) {
  return (
    <div className="flex w-full max-w-[110rem] flex-col items-center gap-[2rem] text-center">
      <p className="text-[2.4rem] font-bold">{stage.question.text}</p>
      {stage.voided ? (
        <Title>Question cancelled</Title>
      ) : (
        <div className="plate bg-side-b px-[4rem] py-[2.5rem]">
          <p className="text-[1.8rem] font-bold">Correct answer</p>
          <p className="type-wide text-[5rem] font-black leading-tight">{stage.correctText}</p>
        </div>
      )}
    </div>
  );
}

export function ChartStage({ stage }: { stage: Stage<"chart"> }) {
  const max = Math.max(1, ...stage.options.map((o) => o.count));
  return (
    <div className="flex w-full max-w-[110rem] flex-col gap-[1.4rem]">
      <p className="text-[2.4rem] font-bold">{stage.question.text}</p>
      {stage.options.map((o) => (
        <div key={o.id} className={`plate flex items-center gap-[2rem] px-[2rem] py-[1.2rem] ${o.correct ? "bg-side-b" : ""}`}>
          <span className="w-[38rem] text-[2.4rem] font-black">{o.text}</span>
          <div className="h-[2.4rem] flex-1 rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-ink" style={{ width: `${(o.count / max) * 100}%` }} />
          </div>
          <span className="type-wide w-[6rem] text-right text-[2.6rem] font-black tabular-nums">{o.count}</span>
        </div>
      ))}
    </div>
  );
}

export function LeaderboardStage({ stage }: { stage: Stage<"leaderboard"> }) {
  return (
    <div className="flex w-full max-w-[90rem] flex-col gap-[0.8rem]">
      <p className="type-wide mb-[1rem] text-[3.6rem] font-black">Round {stage.round.number} top {stage.top.length}</p>
      {stage.top.map((r) => (
        <div key={r.id} className="plate flex items-center gap-[1.5rem] px-[1.5rem] py-[0.6rem]">
          <span className="w-[4rem] text-[2rem] font-black">{r.rank}</span>
          <Avatar name={r.name} color={r.color} size={3} />
          <span className="flex-1 truncate text-[2rem] font-black">{r.name}</span>
          <span className="w-[8rem] text-right text-[1.6rem] font-bold text-ink-soft">
            {r.lastChange > 0 ? `+${r.lastChange}` : r.lastChange < 0 ? r.lastChange : ""}
          </span>
          <span className="type-wide w-[9rem] text-right text-[2.2rem] font-black tabular-nums">{r.score}</span>
        </div>
      ))}
    </div>
  );
}

export function RoundEndStage({ stage }: { stage: Stage<"roundEnd"> }) {
  return (
    <div className="flex w-full max-w-[110rem] flex-col gap-[1.5rem]">
      <p className="type-wide text-[4rem] font-black">
        End of round {stage.round.number}: top {stage.round.advance} go through
      </p>
      <ol className="columns-3 gap-[1.5rem]">
        {stage.standings.map((s) => (
          <li
            key={s.id}
            className={`mb-[0.5rem] flex break-inside-avoid items-center gap-[0.8rem] text-[1.6rem] font-bold ${s.advanced ? "" : "opacity-40"}`}
          >
            <span className="w-[3rem]">{s.rank}</span>
            <span className="flex-1 truncate">{s.name}</span>
            <span className="tabular-nums">{s.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PredictionStage({ stage }: { view: HostView; stage: Stage<"prediction"> }) {
  const total = Object.values(stage.backing).reduce((a, b) => a + b, 0);
  return (
    <div className="flex w-full max-w-[100rem] flex-col items-center gap-[3rem] text-center">
      <Title>The final</Title>
      <p className="text-[2.4rem] font-bold">Everyone who&apos;s out: back a finalist on your phone</p>
      <div className="grid w-full grid-cols-2 gap-[3rem]">
        {stage.finalists.map((f) => {
          const n = stage.backing[f.id] ?? 0;
          return (
            <div key={f.id} className="plate flex flex-col items-center gap-[1rem] py-[2.5rem]">
              <Avatar name={f.name} color={f.color} size={8} />
              <p className="text-[3rem] font-black">{f.name}</p>
              <p className="type-wide text-[4rem] font-black">{total ? Math.round((n / total) * 100) : 0}%</p>
              <p className="text-[1.6rem] font-semibold text-ink-soft">{n} backing</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DuelStage({ view, stage }: { view: HostView; stage: Stage<"duel"> }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const d = stage.duel;
  const name = (id: string | null) => d.finalists.find((f) => f.id === id)?.name ?? "";
  const status =
    d.step === "read"
      ? "Read the question"
      : d.step === "buzz"
        ? "Buzzers open!"
        : d.step === "answer"
          ? `${name(d.buzzedId)} buzzed. Answer out loud!`
          : d.step === "steal"
            ? `${name(d.deathZoneId)} is in the death zone. ${name(d.finalists.find((f) => f.id !== d.deathZoneId)?.id ?? null)}: answer to win!`
            : d.outcome?.kind === "correct"
              ? `+1 to ${name(d.outcome.playerId)}. Answer: ${d.correctText}`
              : d.outcome?.kind === "steal"
                ? `${name(d.outcome.playerId)} wins it! Answer: ${d.correctText}`
                : `No point. Answer: ${d.correctText}`;
  return (
    <div className="flex w-full max-w-[120rem] flex-col gap-[2rem]">
      <div className="flex items-center justify-between">
        {d.finalists.map((f) => (
          <div key={f.id} className="flex items-center gap-[1rem]">
            <Avatar name={f.name} color={f.color} size={5} />
            <span className="text-[2.6rem] font-black">{f.name}</span>
            <span className="type-wide text-[4rem] font-black">{f.points}</span>
          </div>
        ))}
      </div>
      <QuestionCard
        text={d.question.text}
        image={d.question.image}
        label={`Duel question ${d.question.number}${d.suddenDeath ? " (sudden death)" : ""}. First to ${d.pointsToWin}.`}
      />
      <div className="grid grid-cols-2 gap-[1rem]">
        {d.question.options.map((o, i) => (
          <p key={o} className="plate px-[1.5rem] py-[0.8rem] text-[2.2rem] font-black">
            {"ABCD"[i]}. {o}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-center gap-[2rem]">
        <TimerRing timer={view.timer} clockOffset={clockOffset} size={8} />
        <p className="type-wide text-[3rem] font-black text-balance">{status}</p>
      </div>
    </div>
  );
}

export function PodiumStage({ stage }: { stage: Stage<"podium"> }) {
  return (
    <div className="flex flex-col items-center gap-[2rem] text-center">
      <Avatar name={stage.winner.name} color={stage.winner.color} size={12} />
      <Title>{stage.winner.name} wins!</Title>
      <p className="text-[2.4rem] font-bold">Runner-up: {stage.runnerUp.name}</p>
      {stage.backers > 0 && (
        <p className="text-[2rem] font-semibold text-ink-soft">
          {stage.calledIt} of {stage.backers} audience members called it
        </p>
      )}
    </div>
  );
}
