"use client";

/**
 * BLACKOUT on the projector, on autopilot: the question and its options stay
 * on screen at the top, and below them the chase runs LEFT TO RIGHT. The dark
 * comes in from the left; every finalist has a lane (by seat: Round 1 rank, the
 * wild card last) and runs right toward the EXIT. One step = one column of rack
 * lights along the rails; the dark is a flat black wall with a crisp alarm-red
 * edge that covers the lights as it advances (no glow).
 *
 * Every beat is a CSS animation that starts when its step starts and fits
 * inside the server's hold (aim ≤ 80%):
 *   intro   the dark wipes in from the left; runners run in to their start
 *   reveal  runners move one after another, 150 ms apart (+3 / +2 / +1 / −1 / 0)
 *   dark    the wall advances column by column (~250 ms a step); anyone it
 *           reaches flickers, powers down and fades, with CAUGHT
 *   winner  the dark falls back, the winner runs to the EXIT
 * Pause freezes every animation (animation-play-state); a refreshed Host lands
 * on the current step with the animation already at the right point (negative
 * animation-delay = time already spent in the step, from the server's timer).
 * Skip just starts the next step. Never waits for a click.
 */
import NumberFlow from "@number-flow/react";
import { type CSSProperties, useMemo, useRef, useSyncExternalStore } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { TimerRing } from "@/components/ui/TimerRing";
import { useCountdown } from "@/lib/useCountdown";
import type { HostStage, HostView, McqQuestion, Runner } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";

type BoStage = Extract<HostStage, { phase: "boIntro" | "boRead" | "boAnswer" | "boTimesUp" | "boReveal" | "boDark" | "boWinner" }>;

// ---------------------------------------------------------------------------
// Geometry (in the scene's own 1920×1080 px space). The track fills the lower part.
// ---------------------------------------------------------------------------

const W = 1920;
const H = 1080;
const TRACK_TOP = 482;
const TRACK_BOTTOM = 1040;
const TRACK_LEFT = 60;
/** The exit, at the right end of the track. */
const EXIT_X = 1820;
/** Room to the right of the leader for their name and gap. */
const LABEL_ROOM = 250;
/** Steps behind the dark that stay on screen. */
const BEHIND = 2;
/** Fewest steps the track shows. */
const MIN_SPAN = 16;
/** A runner's bot, px. */
const BOT = 46;

// ---------------------------------------------------------------------------
// Timing (every beat ≤ 80% of its hold in server/config.ts)
// ---------------------------------------------------------------------------

const REVEAL_START = 350;
const REVEAL_GAP = 150;
const REVEAL_MOVE = 650;
const DARK_START = 450;
const DARK_ROW = 250;

/** Counts up each time `key` changes, so a CSS animation can restart without remounting (NumberFlow keeps rolling). */
function useStepSeq(key: string) {
  const ref = useRef({ key, seq: 0 });
  if (ref.current.key !== key) ref.current = { key, seq: ref.current.seq + 1 };
  return ref.current.seq;
}

/** Time already spent in this step (ms), measured once when the step starts on this screen. */
function useElapsed(view: HostView, key: string) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const ref = useRef<{ key: string; ms: number } | null>(null);
  if (!ref.current || ref.current.key !== key) {
    const t = view.timer;
    let ms = 0;
    if (t) ms = t.durationMs - (t.remainingMs ?? t.endsAt - (Date.now() + clockOffset));
    ref.current = { key, ms: Math.max(0, ms) };
  }
  return ref.current.ms;
}

/** The screen's size, for scaling the 1920×1080 stage. */
function useScreenSize() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => `${W}x${H}`,
  );
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function BlackoutScene({ view, stage }: { view: HostView; stage: BoStage }) {
  const bo = stage.blackout;
  const phase = stage.phase;
  const stepKey = `${phase}:${bo.questionNumber}:${"question" in stage ? stage.question.id : ""}`;
  const seq = useStepSeq(stepKey);
  const elapsed = useElapsed(view, stepKey);
  const anim = seq % 2 ? "a" : "b";
  const voided = phase === "boReveal" && stage.voided;

  // The frame: while the dark moves it stays on the old dark line, then the next step catches up.
  const darkNow = phase === "boDark" ? bo.darkFrom : bo.dark;
  const darkSteps = phase === "boDark" ? bo.dark - bo.darkFrom : 0;
  const start = darkNow - BEHIND;
  const furthest = Math.max(darkNow + darkSteps, ...bo.runners.map((r) => Math.max(r.position, r.from)));
  const span = Math.max(MIN_SPAN, furthest - start + 1);
  const stepW = (EXIT_X - LABEL_ROOM - TRACK_LEFT) / span;
  const x = (pos: number) => TRACK_LEFT + (pos - start) * stepW;
  // After the dark moved, the next step re-bases the track: everyone slides back toward the left.
  const lastFrame = useRef({ start, stepW });
  const prev = lastFrame.current;
  lastFrame.current = { start, stepW };
  const reframed = phase === "boRead" && (prev.start !== start || prev.stepW !== stepW);
  const xPrev = (pos: number) => TRACK_LEFT + (pos - prev.start) * prev.stepW;

  const n = bo.runners.length;
  const laneH = (TRACK_BOTTOM - TRACK_TOP) / Math.max(1, n);
  const winnerId = bo.winner?.id ?? null;
  const darkEndMs = DARK_START + darkSteps * DARK_ROW;

  const runners = bo.runners.map((r, i) => {
    let from = x(r.position);
    let to = from;
    let delay = 0;
    let dur = 0;
    if (phase === "boIntro") {
      from = TRACK_LEFT - 80;
      delay = 300 + i * 90;
      dur = 1100;
    } else if (phase === "boReveal" && !voided && r.alive) {
      from = x(r.from);
      delay = REVEAL_START + i * REVEAL_GAP;
      dur = REVEAL_MOVE;
    } else if (phase === "boWinner" && r.id === winnerId) {
      to = EXIT_X - 60;
      delay = 700;
      dur = 1500;
    } else if (reframed) {
      from = xPrev(r.position);
      dur = 700;
    }
    const caughtNow = phase === "boDark" && bo.caughtThisQuestion.includes(r.id);
    // The wall reaches a runner when its edge passes their step.
    const reachAt = DARK_START + Math.max(0, Math.min(darkSteps, r.position - darkNow)) * DARK_ROW;
    return { r, y: TRACK_TOP + laneH * (i + 0.5), from, to, delay, dur, caughtNow, reachAt };
  });

  // The dark wall's right edge, before and after this step's beat.
  let wall0 = x(darkNow);
  let wall1 = x(darkNow + darkSteps);
  let wallDelay = DARK_START;
  let wallDur = Math.max(1, darkSteps) * DARK_ROW;
  if (phase === "boIntro") {
    wall0 = TRACK_LEFT - 30;
    wallDelay = 400;
    wallDur = 1200;
  } else if (phase === "boWinner") {
    wall1 = TRACK_LEFT - 30;
    wallDelay = 600;
    wallDur = 1400;
  } else if (reframed) {
    wall0 = xPrev(darkNow);
    wallDelay = 0;
    wallDur = 700;
  } else if (phase !== "boDark") wall0 = wall1;

  const [sw, sh] = useScreenSize().split("x").map(Number);
  const k = Math.max(sw / W, sh / H);

  return (
    <div className="bo-scene absolute inset-0 overflow-hidden bg-void" data-paused={view.paused || undefined} data-testid="blackout-scene">
      <div className="absolute top-1/2 left-1/2" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${k})` }}>
        <Track start={start} span={span} stepW={stepW} n={n} laneH={laneH} />
        {/* the dark: a flat black wall from the left with a crisp alarm-red edge, advancing step by step */}
        <div
          key={`wall-${seq}`}
          className={`bo-wall ${wall0 !== wall1 ? `bo-wall-${anim}` : ""}`}
          style={
            {
              "--w0": `${Math.max(0, wall0)}px`,
              "--w1": `${Math.max(0, wall1)}px`,
              animationDuration: `${wallDur}ms`,
              animationDelay: `${wallDelay - elapsed}ms`,
              animationTimingFunction: phase === "boDark" ? `steps(${Math.max(1, darkSteps)}, end)` : "cubic-bezier(0.65, 0, 0.35, 1)",
            } as CSSProperties
          }
        />
        {runners.map(({ r, y, from, to, delay, dur, caughtNow, reachAt }, i) => (
          <RunnerSprite
            key={r.id}
            r={r}
            y={y}
            from={from}
            to={to}
            delay={delay - elapsed}
            dur={dur}
            seq={seq}
            caughtNow={caughtNow}
            caughtDelay={reachAt - elapsed}
            showDelta={phase === "boReveal" && !voided && r.alive && r.delta !== null}
            deltaDelay={REVEAL_START + i * REVEAL_GAP + REVEAL_MOVE * 0.4 - elapsed}
            winner={phase === "boWinner" && r.id === winnerId}
          />
        ))}
      </div>
      <i className="corridor-alarm bo-alarm" style={{ animationDuration: phase === "boAnswer" || phase === "boDark" ? "1.1s" : "3.2s" }} aria-hidden />

      <Overlay view={view} stage={stage} elapsed={elapsed} darkEndMs={darkEndMs} anim={anim} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The track: lanes, rails with a column of rack lights per step, the exit
// ---------------------------------------------------------------------------

function Track({ start, span, stepW, n, laneH }: { start: number; span: number; stepW: number; n: number; laneH: number }) {
  const columns = useMemo(() => Array.from({ length: Math.ceil(span) + 4 }, (_, i) => Math.floor(start) - 1 + i), [start, span]);
  const x = (pos: number) => TRACK_LEFT + (pos - start) * stepW;
  return (
    <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {/* the server-room floor: lanes of rack panels */}
      <rect x={0} y={TRACK_TOP - 34} width={W} height={TRACK_BOTTOM - TRACK_TOP + 68} fill="#091013" />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={0} y={TRACK_TOP + i * laneH} width={W} height={laneH} fill={i % 2 ? "#0b1417" : "#0d171b"} />
      ))}
      {/* one column of lights per step, on both rails; the dark wall covers the ones it has reached */}
      {columns.map((c) => {
        const cx = x(c);
        if (cx < -20 || cx > W + 20) return null;
        const red = c % 3 === 0;
        return (
          <g key={c}>
            <line x1={cx} y1={TRACK_TOP} x2={cx} y2={TRACK_BOTTOM} stroke="#13242a" strokeWidth={2} />
            <rect x={cx - 9} y={TRACK_TOP - 26} width={18} height={10} rx={2} fill={red ? "#d6334d" : "#6cf0b0"} opacity={0.8} />
            <rect x={cx - 9} y={TRACK_BOTTOM + 16} width={18} height={10} rx={2} fill={red ? "#d6334d" : "#6cf0b0"} opacity={0.8} />
          </g>
        );
      })}
      {/* the exit: a flat mint frame at the right end */}
      <rect x={EXIT_X} y={TRACK_TOP - 34} width={W - EXIT_X} height={TRACK_BOTTOM - TRACK_TOP + 68} fill="#0f2a22" />
      <line x1={EXIT_X} y1={TRACK_TOP - 34} x2={EXIT_X} y2={TRACK_BOTTOM + 34} stroke="#6cf0b0" strokeWidth={4} />
      <text
        x={EXIT_X + (W - EXIT_X) / 2}
        y={(TRACK_TOP + TRACK_BOTTOM) / 2}
        fill="#6cf0b0"
        fontFamily="var(--font-term)"
        fontSize={44}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(90 ${EXIT_X + (W - EXIT_X) / 2} ${(TRACK_TOP + TRACK_BOTTOM) / 2})`}
        letterSpacing={8}
      >
        EXIT
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// A runner: their bot in their lane, name and gap beside it
// ---------------------------------------------------------------------------

function RunnerSprite({
  r,
  y,
  from,
  to,
  delay,
  dur,
  seq,
  caughtNow,
  caughtDelay,
  showDelta,
  deltaDelay,
  winner,
}: {
  r: Runner;
  y: number;
  from: number;
  to: number;
  delay: number;
  dur: number;
  seq: number;
  caughtNow: boolean;
  caughtDelay: number;
  showDelta: boolean;
  deltaDelay: number;
  winner: boolean;
}) {
  // Caught on an earlier question: a dim bot by the wall, a small "OUT Q2".
  const out = !r.alive && !caughtNow;
  const style = {
    "--x0": `${from}px`,
    "--x1": `${to}px`,
    "--y": `${y}px`,
    zIndex: r.alive ? 20 : 10,
    animationName: dur ? (seq % 2 ? "bo-run-a" : "bo-run-b") : "none",
    animationDuration: `${dur}ms`,
    animationDelay: `${delay}ms`,
  } as CSSProperties;
  const delta = r.delta ?? 0;
  return (
    <div className="bo-runner" style={style} data-testid="bo-runner" data-caught={!r.alive || undefined}>
      <div className={`bo-body ${out ? "opacity-30" : ""} ${caughtNow ? (seq % 2 ? "bo-caught-a" : "bo-caught-b") : ""}`} style={{ animationDelay: `${caughtDelay}ms` }}>
        <span className="bo-bot">
          <Bot color={r.color} head={r.head} mood={r.mood} size={`${BOT}px`} delay={botDelay(r.id)} label={r.name} />
        </span>
        <span className="bo-tag">
          <span className={`bo-name ${winner ? "!text-mint" : ""}`}>{r.name}</span>
          {r.wildCard && <span className="bo-wc">WC</span>}
          {r.alive || caughtNow ? (
            <span className="bo-gap">
              <NumberFlow value={Math.max(0, r.gap)} />
            </span>
          ) : (
            <span className="bo-out">OUT Q{r.caughtOnQuestion ?? ""}</span>
          )}
        </span>
      </div>
      {caughtNow && (
        <span className={`bo-caught-label ${seq % 2 ? "bo-pop-a" : "bo-pop-b"}`} style={{ animationDelay: `${caughtDelay + 250}ms` }}>
          CAUGHT
        </span>
      )}
      {showDelta && (
        <span className={`bo-delta ${seq % 2 ? "bo-float-a" : "bo-float-b"} ${delta > 0 ? "text-mint" : delta < 0 ? "text-wrong" : "text-fog"}`} style={{ animationDelay: `${deltaDelay}ms` }}>
          {delta > 0 ? `+${delta}` : delta < 0 ? "−1" : "0 …"}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The question and options (always on screen), and the words over the track
// ---------------------------------------------------------------------------

function Overlay({ view, stage, elapsed, darkEndMs, anim }: { view: HostView; stage: BoStage; elapsed: number; darkEndMs: number; anim: string }) {
  const bo = stage.blackout;
  const appear = (delayMs: number) => ({ animationDelay: `${delayMs - elapsed}ms` }) as CSSProperties;
  const label = (
    <p className="absolute top-[2.4%] left-[2.5%] z-30 font-term text-[2.4rem] leading-none tracking-[0.08em] text-mint-soft">
      BLACKOUT · Q{bo.questionNumber} <span className="ml-[1rem] rounded-[0.4rem] border-2 border-line px-[0.6rem] text-[1.9rem] text-fog">AUTOPILOT</span>
    </p>
  );

  switch (stage.phase) {
    case "boIntro":
      return (
        <div className="absolute inset-x-0 top-[6%] z-30 flex flex-col items-center gap-[1.4rem]">
          <p className="bo-intro-title font-term leading-none tracking-[0.12em] text-bright" style={{ fontSize: "13rem" }}>
            BLACKOUT
          </p>
          <p className={`host-hint bo-appear-${anim} !text-[3rem]`} style={appear(900)}>
            Answer fast. 10 seconds. The dark is coming. Run for the exit.
          </p>
        </div>
      );
    case "boRead":
      return (
        <>
          {label}
          <QuestionPanel question={stage.question} correctIndex={null} dim={false} withClock />
          <ClockBlock view={view} />
        </>
      );
    case "boAnswer":
    case "boTimesUp":
    case "boReveal":
    case "boDark": {
      const revealed = (stage.phase === "boReveal" || stage.phase === "boDark") && !stage.voided;
      return (
        <>
          {label}
          <QuestionPanel question={stage.question} correctIndex={revealed ? stage.correctIndex : null} dim={revealed} withClock={stage.phase === "boAnswer"} />
          {stage.phase === "boAnswer" && (
            <>
              <ClockBlock view={view} />
              <p className="host-count absolute top-[30%] right-[2.5%] z-30 w-[13rem] text-center !text-[1.9rem]" data-testid="bo-answered">
                <b className="!text-[3.4rem]">{stage.answered}</b> / {stage.expected} answered
              </p>
            </>
          )}
          {stage.phase === "boTimesUp" && <Banner text="TIME'S UP" className={`bo-appear-${anim}`} style={appear(0)} />}
          {stage.phase === "boReveal" && stage.voided && <Banner text="> question cancelled: nobody moves" className={`bo-appear-${anim}`} style={appear(0)} />}
          {stage.phase === "boDark" && (
            <>
              <Banner
                text={bo.alive === 0 ? "THE DARK GOT EVERYONE" : bo.alive === 1 ? "ONE LEFT RUNNING" : `${bo.alive} STILL RUNNING`}
                className={`bo-appear-${anim}`}
                style={appear(darkEndMs + 500)}
                testId="bo-still-running"
                next={<NextIn view={view} over={bo.over} />}
              />
            </>
          )}
        </>
      );
    }
    case "boWinner": {
      const w = bo.runners.find((r) => r.id === bo.winner?.id);
      return (
        <div className="absolute inset-x-0 top-[5%] z-30 flex flex-col items-center gap-[0.8rem]" data-testid="bo-winner">
          {bo.alive >= 2 && (
            <p className={`host-banner bo-appear-${anim} !text-[3.4rem]`} style={appear(0)}>
              OUT OF QUESTIONS: THE FURTHEST AHEAD WINS
            </p>
          )}
          {bo.alive === 0 && (
            <p className={`host-banner bo-appear-${anim} !text-[3.4rem]`} style={appear(0)}>
              CAUGHT TOGETHER: THE FURTHEST AHEAD WINS
            </p>
          )}
          <p className={`font-term leading-none tracking-[0.12em] text-mint bo-appear-${anim}`} style={{ fontSize: "10rem", ...appear(1600) }}>
            ESCAPED
          </p>
          {w && (
            <p className={`host-q host-q-center bo-appear-${anim} !text-[5.4rem]`} style={appear(2000)}>
              {w.name}
            </p>
          )}
        </div>
      );
    }
  }
}

/** The question with its four options, numbered 1–4 like every phone; after the reveal the right one turns mint. */
function QuestionPanel({ question, correctIndex, dim, withClock }: { question: McqQuestion; correctIndex: number | null; dim: boolean; withClock: boolean }) {
  return (
    <div
      className={`absolute top-[7.5%] left-[2.5%] z-30 grid max-h-[31%] grid-cols-[1fr_1.15fr] items-center gap-[3rem] overflow-hidden rounded-[1.4rem] border-2 border-line bg-void/95 px-[2.4rem] py-[1.6rem] ${withClock ? "right-[17%]" : "right-[2.5%]"}`}
      data-testid="bo-question"
    >
      <h2 className="host-q !text-[3.4rem]" style={{ transform: "rotate(-2deg)" }}>
        {question.text}
      </h2>
      {question.options ? (
        <ol className="host-opts !gap-[0.8rem] !text-[2.4rem]">
          {question.options.map((o, i) => (
            <li key={i} className="host-opt" data-dim={dim && i !== correctIndex ? "true" : undefined} data-correct={i === correctIndex ? "true" : undefined}>
              <span className="opt-num !text-[3.8rem]">{i + 1}</span>
              <span>{o}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="host-hint !text-[2.6rem]">Read it. The options come up on your phone in a moment.</p>
      )}
    </div>
  );
}

function ClockBlock({ view }: { view: HostView }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  if (!view.timer) return null;
  return (
    <div className="absolute top-[8%] right-[3.6%] z-30">
      <TimerRing timer={view.timer} clockOffset={clockOffset} size={10} />
    </div>
  );
}

/** A banner top-right, level with the BLACKOUT label (never over the track). */
function Banner({ text, className = "", style, testId, next }: { text: string; className?: string; style?: CSSProperties; testId?: string; next?: React.ReactNode }) {
  return (
    <div className={`absolute top-[1.4%] right-[3%] z-30 flex items-baseline gap-[2rem] whitespace-nowrap ${className}`} style={style} data-testid={testId}>
      <span className="host-banner !text-[3.4rem]">{text}</span>
      {next}
    </div>
  );
}

/** "next question in 3", from the hold's own timer (frozen while paused). */
function NextIn({ view, over }: { view: HostView; over: boolean }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const c = useCountdown(view.timer, clockOffset);
  if (!c) return null;
  return (
    <span className="host-hint !text-[2.2rem]">
      {over ? "the winner in " : "next question in "}
      <span className="font-term text-[3.2rem] leading-none text-amber">{c.seconds}</span>
    </span>
  );
}
