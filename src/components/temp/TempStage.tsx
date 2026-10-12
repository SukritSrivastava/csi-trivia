"use client";

/**
 * TEMPORARY (until Phase 4): the projector picture for the temporary Host page,
 * in the approved "Server Corridor, Lights Low" look (public/finaldesign.html).
 * Phase 4 builds the real Host screens with motion and sound; this is just
 * enough to see every step in the final aesthetic.
 *
 * Everything is sized in rem: the root has `host-root`, so rem scales with the
 * screen width (at 1920 px, 1rem ≈ 16 px and 1% of the width ≈ 1.2rem).
 */
import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import { useJoinUrl } from "@/components/host/useJoinUrl";
import { Bot, botDelay } from "@/components/ui/Bot";
import { Corridor } from "@/components/ui/Corridor";
import { TimerRing } from "@/components/ui/TimerRing";
import { displayUrl } from "@/lib/format";
import { assetUrl } from "@/lib/socket";
import type { CastMember, FinalistState, HostStage, HostView, ParticipantTag } from "@/shared/protocol";
import { OPTION_LETTERS } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";

type Scrim = "split" | "center" | "full" | "none";

export function TempStage({ view, offline }: { view: HostView; offline: boolean }) {
  const stage = view.stage;
  const scrim: Scrim =
    stage.phase === "r1Answer" || stage.phase === "r1TimesUp" || stage.phase === "r1Reveal"
      ? "split"
      : stage.phase === "lobby"
        ? "center"
        : stage.phase === "r1Read" || stage.phase === "r1Intro"
          ? "center"
          : "full";

  return (
    <section className="host-root relative aspect-video w-full overflow-hidden bg-void" aria-label="Projector">
      <Corridor scrim={scrim} />
      {stage.phase !== "lobby" && <CastRow cast={view.cast} />}
      <StageBody view={view} stage={stage} />
      <span className="host-watermark absolute right-[3%] bottom-[3%] z-10">hermes://quiz</span>
      {view.paused && (
        <p className="absolute inset-x-0 top-[44%] z-20 bg-alarm/90 py-[1.2rem] text-center font-term text-[5rem] leading-none text-ghost">
          PAUSED
        </p>
      )}
      {offline && (
        <p className="absolute top-[1.5rem] left-1/2 z-20 -translate-x-1/2 rounded-full border border-wrong px-[1.4rem] py-[0.4rem] font-type text-[1.6rem] text-wrong">
          Reconnecting to the game server…
        </p>
      )}
    </section>
  );
}

/** The bots across the top: names under them for up to 12, a dense wall beyond that. */
function CastRow({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;
  if (cast.length <= 12) {
    return (
      <ul className="absolute top-[2.5%] right-[4%] left-[4%] z-10 flex justify-between gap-[1rem]">
        {cast.map((c) => (
          <li key={c.id} className="flex min-w-0 flex-col items-center gap-[0.6rem]">
            <Bot color={c.color} head={c.head} mood={c.mood} size="6rem" delay={botDelay(c.id)} />
            <span className="host-name max-w-[10rem] truncate">{c.name}</span>
          </li>
        ))}
      </ul>
    );
  }
  const size = cast.length > 60 ? "2.6rem" : "3.4rem";
  return (
    <ul className="absolute top-[2%] right-[3%] left-[3%] z-10 flex max-h-[13rem] flex-wrap justify-center gap-x-[0.9rem] gap-y-[1rem] overflow-hidden pt-[0.6rem]">
      {cast.map((c) => (
        <li key={c.id} title={c.name}>
          <Bot color={c.color} head={c.head} mood={c.mood} size={size} delay={botDelay(c.id)} label={c.name} />
        </li>
      ))}
    </ul>
  );
}

function Clock({ view }: { view: HostView }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  if (!view.timer) return null;
  return (
    <div className="absolute bottom-[7%] left-[13%] z-10">
      <TimerRing timer={view.timer} clockOffset={clockOffset} />
    </div>
  );
}

/** A centred block of content over the "full" scrim. */
function Panel({ children, top = "17%" }: { children: ReactNode; top?: string }) {
  return (
    <div className="absolute inset-x-[10%] bottom-[8%] z-10 flex flex-col items-center gap-[1.6rem] overflow-hidden" style={{ top }}>
      {children}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="host-q host-q-center !text-[5rem]">{children}</h2>;
}

/** The 4 options, numbered 1–4 in amber with the staggered tilt (first frame of finaldesign.html). */
function Options({ options, correct, dimOthers }: { options: string[]; correct?: string | null; dimOthers?: boolean }) {
  return (
    <ol className="host-opts absolute top-[30%] right-[5%] z-10 w-[44%]">
      {options.map((o, i) => (
        <li key={`${i}-${o}`} className="host-opt" data-correct={correct === o} data-dim={dimOthers && correct !== o}>
          <span className="opt-num">{i + 1}</span>
          {o}
        </li>
      ))}
    </ol>
  );
}

function NameLine({ tag, children, mood = "idle" }: { tag: ParticipantTag; children?: ReactNode; mood?: CastMember["mood"] }) {
  return (
    <li className="flex items-center gap-[1.4rem]">
      <Bot color={tag.color} head={tag.head} mood={mood} size="3.6rem" delay={botDelay(tag.id)} />
      <span className="host-name !text-[2.2rem] min-w-0 flex-1 truncate">{tag.name}</span>
      {children}
    </li>
  );
}

function Finalists({ finalists, backing, buzzedId }: { finalists: FinalistState[]; backing?: Record<string, number>; buzzedId?: string | null }) {
  const totalBacked = backing ? Object.values(backing).reduce((a, b) => a + b, 0) : 0;
  return (
    <ul className="flex flex-wrap justify-center gap-[3rem]">
      {finalists.map((f) => {
        const mood = buzzedId === f.id ? "locked" : f.lockedOut ? "wrong" : !f.inPlay ? "out" : "idle";
        return (
          <li key={f.id} className="flex flex-col items-center gap-[0.8rem]">
            <Bot color={f.color} head={f.head} mood={mood} size={buzzedId === f.id ? "11rem" : "8rem"} delay={botDelay(f.id)} />
            <span className="host-name !text-[2.2rem]">{f.name}</span>
            <span className="font-term text-[4rem] leading-none text-amber">
              {backing ? `${totalBacked ? Math.round(((backing[f.id] ?? 0) / totalBacked) * 100) : 0}%` : f.points}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function StageBody({ view, stage }: { view: HostView; stage: HostStage }) {
  const joinUrl = useJoinUrl(view);

  switch (stage.phase) {
    case "lobby":
      return (
        <div className="absolute inset-[5%] z-10 flex flex-col gap-[3rem]">
          <div className="flex items-start justify-between gap-[4rem]">
            <div className="flex flex-col gap-[1.6rem]">
              <p className="host-hint">
                Join on your phone at <span className="text-bright">{view.roomCodeVisible ? displayUrl(joinUrl) : "…"}</span>
              </p>
              <div className="flex gap-[1.4rem]" aria-label="Room code">
                {(view.roomCodeVisible ? view.roomCode.split("") : ["•", "•", "•", "•"]).map((ch, i) => (
                  <span
                    key={i}
                    className="grid h-[12rem] w-[10rem] place-items-center rounded-[1rem] border-[0.3rem] border-mint bg-void/80 font-term text-[10rem] leading-none text-mint [text-shadow:0_0_1.2rem_var(--color-mint)]"
                    style={{ transform: `rotate(${[-3, 2, -1.5, 3][i % 4]}deg)` }}
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-[3rem]">
              <div className="text-center">
                <p className="font-term text-[11rem] leading-none text-amber">{view.counts.joined}</p>
                <p className="host-hint">{view.counts.joined === 1 ? "bot" : "bots"} in the room</p>
              </div>
              {view.roomCodeVisible && (
                <figure className="flex flex-col items-center gap-[0.8rem] rounded-[1rem] border-[0.5rem] border-void bg-clock p-[1.4rem] shadow-[0.72rem_0.72rem_0_var(--color-mint)]">
                  <QRCodeSVG value={`${joinUrl}?code=${view.roomCode}`} size={220} bgColor="#fffbf0" fgColor="#05080a" style={{ width: "14rem", height: "14rem" }} />
                  <figcaption className="font-type text-[1.5rem] text-void">Scan to join</figcaption>
                </figure>
              )}
            </div>
          </div>
          <ul className="flex flex-1 flex-wrap content-start justify-center gap-x-[2rem] gap-y-[1.4rem] overflow-hidden" aria-label="Bots in the room">
            {view.cast.map((c) => (
              <li key={c.id} className="flex w-[8rem] flex-col items-center gap-[0.5rem]">
                <Bot color={c.color} head={c.head} mood={c.mood} size={view.cast.length > 40 ? "3.6rem" : "5rem"} delay={botDelay(c.id)} />
                <span className="host-name w-full truncate text-center">{c.name}</span>
              </li>
            ))}
          </ul>
          <p className="host-hint text-center">
            {view.counts.joined === 0 ? "Waiting for the first bot to join." : "Build your bot on your phone. The quizmaster starts when everyone's in."}
          </p>
        </div>
      );

    case "r1Intro":
      return (
        <Panel top="30%">
          <Heading>Round 1</Heading>
          <p className="host-hint !text-[3rem]">
            Everyone plays {view.settings.round1Questions} questions. The top {view.settings.finalistCount} bots go to the buzzer round.
          </p>
          <p className="host-count">
            <b>{view.settings.round1ReadSeconds}</b>s to read · <b>{view.settings.round1AnswerSeconds}</b>s to answer
          </p>
        </Panel>
      );

    case "r1Read":
      return (
        <>
          <h2 className="host-q host-q-center absolute top-1/2 left-1/2 z-10 w-[70%] !-translate-x-1/2 !-translate-y-1/2">{stage.question.text}</h2>
          {stage.question.image && (
            <img src={assetUrl(stage.question.image)} alt="" className="absolute top-[22%] right-[6%] z-10 h-[20rem] w-[20rem] rounded-[1rem] border border-line bg-panel object-contain p-[1rem]" />
          )}
          <p className="host-hint absolute inset-x-0 bottom-[31%] z-10 text-center">Read it. Options appear on your phone in a moment.</p>
          <Clock view={view} />
        </>
      );

    case "r1Answer":
    case "r1TimesUp":
    case "r1Reveal": {
      const q = stage.question;
      const correct = stage.phase === "r1Reveal" ? stage.correctText : null;
      return (
        <>
          <h2 className="host-q absolute top-[34%] left-[5%] z-10 w-[42%]">{q.text}</h2>
          {q.image && (
            <img src={assetUrl(q.image)} alt="" className="absolute bottom-[6%] left-[30%] z-10 h-[16rem] w-[16rem] rounded-[1rem] border border-line bg-panel object-contain p-[0.8rem]" />
          )}
          {q.options && <Options options={q.options} correct={correct} dimOthers={stage.phase === "r1Reveal" && !stage.voided} />}
          {stage.phase !== "r1Reveal" && (
            <>
              <Clock view={view} />
              <p className="host-count absolute bottom-[12%] left-[28%] z-10">
                <b>{stage.answered}</b> / {stage.expected} answered
              </p>
            </>
          )}
          {stage.phase === "r1TimesUp" && <p className="host-banner absolute inset-x-0 bottom-[3%] z-10 text-center">&gt; time&apos;s up</p>}
          {stage.phase === "r1Reveal" && (
            <p className="host-banner absolute inset-x-0 bottom-[12%] z-10 text-center">
              {stage.voided ? "> question cancelled" : `> answer: ${(stage.correctText ?? "").toLowerCase()}`}
            </p>
          )}
        </>
      );
    }

    case "r1Results": {
      const max = Math.max(1, ...stage.options.map((o) => o.count));
      return (
        <Panel>
          <p className="host-hint">{stage.question.text}</p>
          <ol className="flex w-full flex-col gap-[1.6rem]">
            {stage.options.map((o, i) => (
              <li key={o.letter} className="flex items-center gap-[1.6rem] font-type text-[2.6rem] text-bright">
                <span className="opt-num !text-[5rem]" style={o.correct ? { color: "var(--color-mint)" } : undefined}>
                  {i + 1}
                </span>
                <span className="w-[36%] truncate">{o.text}</span>
                <span className="h-[2.4rem] rounded-[0.4rem] border border-mint" style={{ width: `${(o.count / max) * 40}%`, background: o.correct ? "var(--color-mint)" : "rgb(108 240 176 / 0.12)" }} />
                <span className="font-term text-[3.6rem] leading-none text-amber">{o.count}</span>
              </li>
            ))}
          </ol>
          <p className="host-count">
            <b>{stage.answered}</b> / {stage.expected} answered
          </p>
        </Panel>
      );
    }

    case "r1Leaderboard":
      return (
        <Panel>
          <Heading>Leaderboard</Heading>
          <ol className="grid w-full grid-cols-2 gap-x-[5rem] gap-y-[1.2rem]">
            {stage.rows.map((r) => (
              <NameLine key={r.id} tag={r}>
                <span className="font-term text-[3.4rem] leading-none text-amber">{r.score}</span>
                <span className="w-[5rem] text-right font-term text-[2.4rem] leading-none text-mint-soft">#{r.rank}</span>
              </NameLine>
            ))}
          </ol>
        </Panel>
      );

    case "cut":
      return (
        <Panel top="16%">
          <Heading>The top {view.settings.finalistCount}</Heading>
          <ol className="flex w-[60%] flex-col gap-[0.8rem]">
            {stage.standings.slice(0, view.settings.finalistCount + 4).map((s, i, all) => (
              <div key={s.id} className="contents">
                <NameLine tag={s} mood={s.finalist ? "right" : "out"}>
                  <span className="font-term text-[3rem] leading-none text-amber">{s.score}</span>
                </NameLine>
                {s.finalist && all[i + 1] && !all[i + 1].finalist && (
                  <li aria-hidden className="h-[0.3rem] bg-alarm shadow-[0_0_1.2rem_var(--color-alarm)] [animation:corridor-alarm_3.2s_infinite]" />
                )}
              </div>
            ))}
          </ol>
        </Panel>
      );

    case "predictions":
    case "r2Intro":
      return (
        <Panel top="22%">
          <Heading>{stage.phase === "predictions" ? "Who will win?" : "The buzzer round"}</Heading>
          <p className="host-hint">
            {stage.phase === "predictions"
              ? `Back a finalist on your phone. ${stage.backing.backers} of ${stage.backing.audience} have picked.`
              : "First to buzz answers out loud. Wrong locks you out for that question."}
          </p>
          <Finalists finalists={stage.finalists} backing={stage.phase === "predictions" ? stage.backing.counts : undefined} />
        </Panel>
      );

    case "r2Read":
    case "r2BuzzOpen":
    case "r2Answering":
    case "r2Reveal": {
      const r = stage.round2;
      return (
        <>
          <div className="absolute top-[17%] right-[5%] left-[5%] z-10 flex flex-col items-center gap-[2rem]">
            <p className="host-hint">
              {r.question.suddenDeath ? `Sudden death · question ${r.question.number}` : `Buzzer question ${r.question.number} of ${r.question.count}`}
            </p>
            <h2 className="host-q host-q-center !text-[4.4rem]">{r.question.text}</h2>
            <ol className="grid w-[80%] grid-cols-2 gap-x-[4rem] gap-y-[1.2rem] font-type text-[2.6rem] text-bright">
              {r.question.options.map((o, i) => (
                <li key={o} className="host-opt" data-correct={r.correct?.text === o} data-dim={!!r.correct && r.correct.text !== o}>
                  <span className="opt-num !text-[4.4rem]">{OPTION_LETTERS[i]}</span>
                  {o}
                </li>
              ))}
            </ol>
          </div>
          <div className="absolute inset-x-[5%] bottom-[6%] z-10">
            <Finalists finalists={r.finalists} buzzedId={r.buzzedBy?.id} />
          </div>
          <p className="host-banner absolute inset-x-0 top-[52%] z-10 text-center">
            {stage.phase === "r2Read" && "> buzzers locked"}
            {stage.phase === "r2BuzzOpen" && "> BUZZERS OPEN"}
            {stage.phase === "r2Answering" && `> ${r.buzzedBy?.name ?? ""} buzzed`}
            {stage.phase === "r2Reveal" &&
              (r.outcome?.kind === "correct"
                ? `> ${r.outcome.by.name} got it: ${r.correct?.text ?? ""}`
                : r.outcome?.kind === "voided"
                  ? "> question cancelled"
                  : `> nobody. answer: ${r.correct?.text ?? ""}`)}
          </p>
          {(stage.phase === "r2Read" || stage.phase === "r2BuzzOpen" || stage.phase === "r2Answering") && <Clock view={view} />}
        </>
      );
    }

    case "r2Scores":
      return (
        <Panel top="22%">
          <Heading>{stage.suddenDeath ? "Sudden death scores" : `Scores after ${stage.questionNumber} of ${stage.questionCount}`}</Heading>
          <Finalists finalists={stage.finalists} />
        </Panel>
      );

    case "suddenDeath":
      return (
        <Panel top="26%">
          <Heading>Sudden death</Heading>
          <p className="host-hint">Tied for first. First correct answer wins.</p>
          <Finalists finalists={stage.tied} />
        </Panel>
      );

    case "podium": {
      const [first, second, third] = stage.entries;
      const rest = stage.entries.slice(3, 9);
      const Plinth = ({ e, h }: { e: (typeof stage.entries)[number] | undefined; h: string }) =>
        e ? (
          <div className="flex flex-col items-center gap-[0.8rem]">
            <Bot color={e.color} head={e.head} mood={e.place === 1 ? "right" : "idle"} size={e.place === 1 ? "12rem" : "8rem"} delay={botDelay(e.id)} />
            <span className="host-name !text-[2.4rem]">{e.name}</span>
            <div className="grid w-[16rem] place-items-start justify-center rounded-t-[0.8rem] border border-line bg-rack pt-[1rem] font-term text-[5rem] leading-none text-amber" style={{ height: h }}>
              {e.place}
            </div>
          </div>
        ) : null;
      return (
        <Panel top="16%">
          <div className="flex items-end gap-[3rem]">
            <Plinth e={second} h="10rem" />
            <Plinth e={first} h="15rem" />
            <Plinth e={third} h="7rem" />
          </div>
          {rest.length > 0 && <p className="host-hint">{rest.map((e) => `${e.place}. ${e.name}`).join("   ")}</p>}
          {stage.basis === "buzzer" && (
            <p className="host-count">
              <b>{stage.calledIt}</b> of {stage.backing.backers} called it
            </p>
          )}
        </Panel>
      );
    }
  }
}
