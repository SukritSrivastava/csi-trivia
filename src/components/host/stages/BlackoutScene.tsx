"use client";

/**
 * BLACKOUT on the projector: the centrepiece, on autopilot.
 *
 * One persistent scene for every Blackout step (boIntro → boWinner): the
 * server-room corridor in one-point perspective, drawn as rack rows (one row
 * = one step). The far end (the vanishing point) is where the dark comes from;
 * the camera end is safety. Each runner's gap to the dark is its depth: gap 0
 * stands at the dark line, bigger gaps stand closer to the camera (up to 3×
 * larger). Lights are flat: lit rows have mint / red LED dots and a ceiling
 * strip; dead rows are covered by a flat dark overlay. The dark line is a
 * crisp alarm-red outline (no glow).
 *
 * Every beat is a CSS animation that starts when its step starts and fits
 * inside the server's hold (aim ≤ 80%):
 *   intro   lights behind the start die row by row; runners walk in
 *   reveal  runners move one after another, 150 ms apart (+3 / +2 / +1 / −1 / 0)
 *   dark    rows die one by one (~250 ms each), the front slides forward,
 *           anyone it reaches flickers, powers down and fades to 30%
 *   winner  the lights come back on toward the winner, who reaches the camera end
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
import type { BlackoutState, HostStage, HostView, McqQuestion, Runner } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";

type BoStage = Extract<HostStage, { phase: "boIntro" | "boRead" | "boAnswer" | "boTimesUp" | "boReveal" | "boDark" | "boWinner" }>;

// ---------------------------------------------------------------------------
// Geometry (in the scene's own 1920×1080 px space)
// ---------------------------------------------------------------------------

const W = 1920;
const H = 1080;
const VPX = 960;
const VPY = 430;
/** The corridor's cross-section at scale 1 (the dark line): half-width, up, down. */
const HALF_W = 270;
const UP = 150;
const DOWN = 110;
/** Depth (steps from the dark line) → perspective scale: 1 at the dark line, 3 at 10 steps. */
const scaleAt = (d: number) => 1 + 0.2 * d;
/** Nearest and furthest depths drawn. */
const FAR = -4;
const NEAR = 24;
/** Runners stand between these depths (gap 0–11.5 visible). */
const MIN_RUNNER = -1.5;
const MAX_RUNNER = 11.5;
/** A runner's bot at the dark line, px (≈ 3rem at 1920). */
const BOT_AT_1 = 46;

const plane = (d: number) => {
  const s = scaleAt(d);
  return { l: VPX - HALF_W * s, r: VPX + HALF_W * s, t: VPY - UP * s, b: VPY + DOWN * s, s };
};
const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** Runner lanes across the floor, by seat (Round 1 rank, the wild card last). */
const laneOffset = (i: number, n: number) => (n <= 1 ? 0 : -0.9 + (1.8 * i) / (n - 1));

/** Where a runner stands at depth d in lane offset o: the floor point and the bot size. */
function spot(d: number, o: number) {
  const s = scaleAt(d);
  return { x: VPX + o * HALF_W * s, y: VPY + DOWN * s, f: BOT_AT_1 * s };
}

// ---------------------------------------------------------------------------
// Timing (every beat ≤ 80% of its hold in server/config.ts)
// ---------------------------------------------------------------------------

const REVEAL_START = 350;
const REVEAL_GAP = 150;
const REVEAL_MOVE = 650;
const DARK_START = 450;
const DARK_ROW = 250;
const INTRO_ROW = 260;

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

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function BlackoutScene({ view, stage }: { view: HostView; stage: BoStage }) {
  const bo = stage.blackout;
  const phase = stage.phase;
  const stepKey = `${phase}:${bo.questionNumber}:${"question" in stage ? stage.question.id : ""}`;
  const seq = useStepSeq(stepKey);
  const elapsed = useElapsed(view, stepKey);
  const voided = phase === "boReveal" && stage.voided;

  // The frame: depth = position − base. While the dark moves, the frame stays on the old dark line.
  const base = phase === "boDark" ? bo.darkFrom : bo.dark;
  const darkSteps = phase === "boDark" ? bo.dark - bo.darkFrom : 0;
  // After the dark moved, the next step re-bases the frame: runners slide back toward the dark line.
  const lastBase = useRef(base);
  const rebase = lastBase.current - base;
  lastBase.current = base;

  const n = bo.runners.length;
  const winnerId = bo.winner?.id ?? null;
  const darkEndMs = DARK_START + darkSteps * DARK_ROW;

  const runners = useMemo(
    () =>
      bo.runners.map((r, i) => {
        const o = laneOffset(i, n);
        // Runners on the same step get a small depth offset by lane, so nobody hides behind anyone.
        const nudge = (i % 2) * 0.18;
        const depth = (pos: number) => Math.max(MIN_RUNNER, Math.min(MAX_RUNNER, pos - base + nudge));
        let from = depth(r.position);
        let to = from;
        let oTo = o;
        let delay = 0;
        let dur = 0;
        if (phase === "boIntro") {
          from = MAX_RUNNER + 3;
          delay = 300 + i * 90;
          dur = 1100;
        } else if (phase === "boReveal" && !voided && r.alive) {
          from = depth(r.from);
          delay = REVEAL_START + i * REVEAL_GAP;
          dur = REVEAL_MOVE;
        } else if (phase === "boWinner" && r.id === winnerId) {
          // The winner runs to the camera end, centre stage.
          to = MAX_RUNNER;
          oTo = 0;
          delay = 700;
          dur = 1500;
        } else if (rebase && phase === "boRead") {
          from = depth(r.position + rebase);
          dur = 700;
        }
        const caughtNow = phase === "boDark" && bo.caughtThisQuestion.includes(r.id);
        // The front reaches a runner at their depth: catch them then (they're at or behind the new line).
        const reachAt = DARK_START + Math.max(0, Math.min(darkSteps, to - 0.2)) * DARK_ROW;
        return { r, o, oTo, low: i % 2 === 1, from, to, delay, dur, caughtNow, reachAt };
      }),
    [bo, n, base, phase, voided, winnerId, rebase, darkSteps],
  );

  return (
    <div className="bo-scene absolute inset-0 overflow-hidden" data-paused={view.paused || undefined} data-testid="blackout-scene">
      <Stage1920>
        <CorridorRows phase={phase} darkSteps={darkSteps} seq={seq} elapsed={elapsed} />
        {runners.map(({ r, o, oTo, low, from, to, delay, dur, caughtNow, reachAt }) => (
          <RunnerSprite
            key={r.id}
            r={r}
            o={o}
            oTo={oTo}
            low={low}
            from={from}
            to={to}
            delay={delay - elapsed}
            dur={dur}
            seq={seq}
            caughtNow={caughtNow}
            caughtDelay={reachAt - elapsed}
            showDelta={phase === "boReveal" && !voided && r.alive && r.delta !== null}
            deltaDelay={REVEAL_START + bo.runners.indexOf(r) * REVEAL_GAP + REVEAL_MOVE * 0.4 - elapsed}
            winner={phase === "boWinner" && r.id === winnerId}
          />
        ))}
      </Stage1920>
      <i className="corridor-alarm bo-alarm" style={{ animationDuration: phase === "boAnswer" || phase === "boDark" ? "1.1s" : "3.2s" }} aria-hidden />
      <i className="corridor-vignette" aria-hidden />

      <Overlay view={view} stage={stage} elapsed={elapsed} darkEndMs={darkEndMs} seq={seq} />
      {phase !== "boIntro" && phase !== "boWinner" && <RankStrip bo={bo} />}
    </div>
  );
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

/** A fixed 1920×1080 box, scaled to cover the screen (both projector sizes are 16:9). */
function Stage1920({ children }: { children: React.ReactNode }) {
  const [w, h] = useScreenSize().split("x").map(Number);
  const k = Math.max(w / W, h / H);
  return (
    <div className="bo-stage absolute top-1/2 left-1/2" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${k})` }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The corridor: rack rows, lit or dead, and the dark line
// ---------------------------------------------------------------------------

function CorridorRows({ phase, darkSteps, seq, elapsed }: { phase: BoStage["phase"]; darkSteps: number; seq: number; elapsed: number }) {
  const rows = useMemo(() => {
    const out: { k: number; a: ReturnType<typeof plane>; b: ReturnType<typeof plane> }[] = [];
    for (let k = FAR; k < NEAR; k++) out.push({ k, a: plane(k), b: plane(k + 1) });
    return out;
  }, []);
  const anim = seq % 2 ? "a" : "b";

  /** The dead-row overlay for row k this step: static, dying, or lighting back up. */
  const overlay = (k: number): { cls: string; delay: number } => {
    if (phase === "boIntro") return k < 0 ? { cls: `bo-row-die-${anim}`, delay: 500 + (k - FAR) * INTRO_ROW } : { cls: "", delay: 0 };
    if (phase === "boDark") {
      if (k < 0) return { cls: "bo-row-off", delay: 0 };
      if (k < darkSteps) return { cls: `bo-row-die-${anim}`, delay: DARK_START + k * DARK_ROW };
      return { cls: "", delay: 0 };
    }
    if (phase === "boWinner") return k < 0 ? { cls: `bo-row-light-${anim}`, delay: 900 + (k - FAR) * 140 } : { cls: "", delay: 0 };
    return k < 0 ? { cls: "bo-row-off", delay: 0 } : { cls: "", delay: 0 };
  };

  const front = plane(0);
  const frontTo = scaleAt(darkSteps);
  return (
    <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <rect width={W} height={H} fill="#030506" />
      {rows.map(({ k, a, b }) => {
        const left: [number, number][] = [
          [a.l, a.t],
          [b.l, b.t],
          [b.l, b.b],
          [a.l, a.b],
        ];
        const right: [number, number][] = [
          [a.r, a.t],
          [b.r, b.t],
          [b.r, b.b],
          [a.r, a.b],
        ];
        const ceil: [number, number][] = [
          [a.l, a.t],
          [a.r, a.t],
          [b.r, b.t],
          [b.l, b.t],
        ];
        const floor: [number, number][] = [
          [a.l, a.b],
          [a.r, a.b],
          [b.r, b.b],
          [b.l, b.b],
        ];
        const sm = (a.s + b.s) / 2;
        const xL = (a.l + b.l) / 2;
        const xR = (a.r + b.r) / 2;
        const yAt = (f: number) => VPY - UP * sm + (UP + DOWN) * sm * f;
        const { cls, delay } = overlay(k);
        const red = k % 3 === 1;
        return (
          <g key={k}>
            <polygon points={pts(ceil)} fill="#050a0c" />
            <polygon points={pts(floor)} fill={k % 2 ? "#0b1316" : "#0d171b"} />
            <polygon points={pts(left)} fill={k % 2 ? "#091013" : "#0b1417"} stroke="#030506" strokeWidth={2 * sm} />
            <polygon points={pts(right)} fill={k % 2 ? "#091013" : "#0b1417"} stroke="#030506" strokeWidth={2 * sm} />
            {/* the ceiling light strip */}
            <polygon
              points={pts([
                [VPX - 40 * a.s, a.t + 2],
                [VPX + 40 * a.s, a.t + 2],
                [VPX + 40 * b.s, b.t + 2],
                [VPX - 40 * b.s, b.t + 2],
              ])}
              fill="#bfe9d6"
              opacity={0.28}
            />
            {/* flat LED dots, two columns of three per wall */}
            {[0.3, 0.5, 0.7].map((f) => (
              <g key={f}>
                <circle cx={xL} cy={yAt(f)} r={3.2 * sm} fill={red && f === 0.5 ? "#d6334d" : "#6cf0b0"} opacity={0.75} />
                <circle cx={xR} cy={yAt(f)} r={3.2 * sm} fill={red ? "#d6334d" : "#6cf0b0"} opacity={0.75} />
              </g>
            ))}
            {/* the row's lights out: a flat dark cover */}
            <polygon
              points={pts([
                [a.l, a.t],
                [b.l, b.t],
                [b.r, b.t],
                [a.r, a.t],
                [a.r, a.b],
                [b.r, b.b],
                [b.l, b.b],
                [a.l, a.b],
              ])}
              className={`bo-row ${cls}`}
              style={{ animationDelay: `${delay - elapsed}ms` } as CSSProperties}
              fill="#020304"
            />
          </g>
        );
      })}
      {/* the dark line: a crisp alarm-red frame at the dark's position */}
      <rect
        key={`front-${seq}`}
        className={phase === "boDark" ? `bo-front-${anim}` : phase === "boWinner" ? "bo-front-gone" : ""}
        x={front.l}
        y={front.t}
        width={front.r - front.l}
        height={front.b - front.t}
        fill="none"
        stroke="#d6334d"
        strokeWidth={4}
        vectorEffect="non-scaling-stroke"
        style={
          {
            transformOrigin: `${VPX}px ${VPY}px`,
            transformBox: "view-box",
            transform: `scale(${frontTo})`,
            "--s0": 1,
            "--s1": frontTo,
            animationDuration: `${Math.max(1, darkSteps) * DARK_ROW}ms`,
            animationDelay: `${DARK_START - elapsed}ms`,
          } as CSSProperties
        }
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// A runner
// ---------------------------------------------------------------------------

function RunnerSprite({
  r,
  o,
  oTo,
  low,
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
  o: number;
  /** The lane it ends in (the winner moves to the centre). */
  oTo: number;
  /** Odd lanes print their name one line lower. */
  low: boolean;
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
  const a = spot(from, o);
  const b = spot(to, oTo);
  // Caught on an earlier question: a dim bot by the dark line, no name or plate (the strip lists them).
  const out = !r.alive && !caughtNow;
  const style = {
    "--x0": `${a.x}px`,
    "--y0": `${a.y}px`,
    "--f0": `${a.f}px`,
    "--x1": `${b.x}px`,
    "--y1": `${b.y}px`,
    "--f1": `${b.f}px`,
    zIndex: Math.round(to * 10) + 100,
    animationName: dur ? (seq % 2 ? "bo-move-a" : "bo-move-b") : "none",
    animationDuration: `${dur}ms`,
    animationDelay: `${delay}ms`,
  } as CSSProperties;
  const delta = r.delta ?? 0;
  return (
    <div className="bo-runner" style={style} data-testid="bo-runner" data-caught={!r.alive || undefined}>
      <div
        className={`bo-body ${out ? "opacity-30" : ""} ${caughtNow ? (seq % 2 ? "bo-caught-a" : "bo-caught-b") : ""}`}
        style={{ animationDelay: `${caughtDelay}ms` }}
      >
        {!out && (
          <span className="bo-plate">
            {r.wildCard && <span className="bo-wc">WC</span>}
            <NumberFlow value={Math.max(0, r.gap)} />
          </span>
        )}
        <span className="bo-bot">
          <Bot color={r.color} head={r.head} mood={r.mood} size="1em" delay={botDelay(r.id)} label={r.name} />
        </span>
        {/* Neighbouring lanes stagger their names, so they never print over each other. */}
        {!out && <span className={`bo-name ${low ? "bo-name-low" : ""} ${winner ? "!text-mint" : ""}`}>{r.name}</span>}
      </div>
      {caughtNow && (
        <span className={`bo-caught-label ${caughtNow ? (seq % 2 ? "bo-pop-a" : "bo-pop-b") : ""}`} style={{ animationDelay: `${caughtDelay + 250}ms` }}>
          CAUGHT
        </span>
      )}
      {showDelta && (
        <span
          className={`bo-delta ${seq % 2 ? "bo-float-a" : "bo-float-b"} ${delta > 0 ? "text-mint" : delta < 0 ? "text-wrong" : "text-fog"}`}
          style={{ animationDelay: `${deltaDelay}ms` }}
        >
          {delta > 0 ? `+${delta}` : delta < 0 ? "−1" : "0 …"}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Words over the scene (the Host's rem layer)
// ---------------------------------------------------------------------------

function Overlay({ view, stage, elapsed, darkEndMs, seq }: { view: HostView; stage: BoStage; elapsed: number; darkEndMs: number; seq: number }) {
  const bo = stage.blackout;
  const anim = seq % 2 ? "a" : "b";
  const label = (
    <p className="absolute top-[3%] left-[3%] z-20 font-term text-[2.6rem] leading-none tracking-[0.08em] text-mint-soft">
      BLACKOUT · Q{bo.questionNumber} <span className="ml-[1rem] rounded-[0.4rem] border-2 border-line px-[0.6rem] text-[2rem] text-fog">AUTOPILOT</span>
    </p>
  );
  const appear = (delayMs: number) => ({ animationDelay: `${delayMs - elapsed}ms` }) as CSSProperties;

  switch (stage.phase) {
    case "boIntro":
      return (
        <div className="absolute inset-x-0 top-[9%] z-20 flex flex-col items-center gap-[1.6rem]">
          <p className="bo-intro-title font-term leading-none tracking-[0.12em] text-bright" style={{ fontSize: "16rem" }}>
            BLACKOUT
          </p>
          <p className={`host-hint bo-scrim-text bo-appear-${anim} !text-[3rem]`} style={appear(900)}>
            Answer fast. 10 seconds. The dark is coming.
          </p>
        </div>
      );
    case "boRead":
      return (
        <>
          {label}
          <div className="absolute top-[9%] left-1/2 z-20 w-[72%] -translate-x-1/2 rounded-[1.4rem] border-2 border-line bg-void/85 px-[4rem] py-[3rem]">
            <h2 className="host-q host-q-center !text-[5rem]">{stage.question.text}</h2>
          </div>
          <ClockBlock view={view} />
        </>
      );
    case "boAnswer":
    case "boTimesUp":
    case "boReveal":
      return (
        <>
          {label}
          <QuestionTop question={stage.question} correctIndex={stage.phase === "boReveal" && !stage.voided ? stage.correctIndex : null} dim={stage.phase === "boReveal" && !stage.voided} />
          {stage.phase === "boAnswer" && (
            <>
              <ClockBlock view={view} />
              <p className="host-count absolute bottom-[9%] left-[24%] z-20 rounded-[0.8rem] bg-void/80 px-[1.2rem] py-[0.4rem]" data-testid="bo-answered">
                <b>{stage.answered}</b> / {stage.expected} answered
              </p>
            </>
          )}
          {stage.phase === "boTimesUp" && <Banner text="TIME'S UP" className={`bo-appear-${anim}`} style={appear(0)} />}
          {stage.phase === "boReveal" && stage.voided && <Banner text="> question cancelled: nobody moves" className={`bo-appear-${anim}`} style={appear(0)} />}
        </>
      );
    case "boDark": {
      const alive = bo.alive;
      return (
        <>
          {label}
          <Banner
            text={alive === 0 ? "THE DARK GOT EVERYONE" : alive === 1 ? "ONE LEFT RUNNING" : `${alive} STILL RUNNING`}
            className={`bo-appear-${anim}`}
            style={appear(darkEndMs + 500)}
            testId="bo-still-running"
          />
          <NextIn view={view} className={`bo-appear-${anim}`} style={appear(darkEndMs + 700)} over={bo.over} />
        </>
      );
    }
    case "boWinner": {
      const w = bo.runners.find((r) => r.id === bo.winner?.id);
      const outOfQuestions = bo.alive >= 2;
      return (
        <div className="absolute inset-x-0 top-[7%] z-20 flex flex-col items-center gap-[1rem]" data-testid="bo-winner">
          {outOfQuestions && (
            <p className={`host-banner bo-scrim-text bo-appear-${anim}`} style={appear(0)}>
              OUT OF QUESTIONS
            </p>
          )}
          {bo.alive === 0 && (
            <p className={`host-banner bo-scrim-text bo-appear-${anim}`} style={appear(0)}>
              CAUGHT TOGETHER: THE FURTHEST AHEAD WINS
            </p>
          )}
          <p className={`font-term leading-none tracking-[0.12em] text-mint bo-appear-${anim}`} style={{ fontSize: "12rem", ...appear(1600) }}>
            ESCAPED
          </p>
          {w && (
            <p className={`host-q host-q-center bo-scrim-text bo-appear-${anim} !text-[6rem]`} style={appear(2000)}>
              {w.name}
            </p>
          )}
        </div>
      );
    }
  }
}

/** The answer step's question top-left and options top-right, compact so the corridor stays visible. */
function QuestionTop({ question, correctIndex, dim }: { question: McqQuestion; correctIndex: number | null; dim: boolean }) {
  return (
    <div className="absolute inset-x-[2.5%] top-[8%] z-20 grid grid-cols-[1fr_1.1fr] gap-[3rem] rounded-[1.4rem] border-2 border-line bg-void/95 px-[2.4rem] py-[1.8rem]">
      <h2 className="host-q !text-[3.4rem]" style={{ transform: "rotate(-2deg)" }}>
        {question.text}
      </h2>
      {question.options && (
        <ol className="host-opts !gap-[0.9rem] !text-[2.4rem]">
          {question.options.map((o, i) => (
            <li key={i} className="host-opt" data-dim={dim && i !== correctIndex ? "true" : undefined} data-correct={i === correctIndex ? "true" : undefined}>
              <span className="opt-num !text-[4rem]">{i + 1}</span>
              <span>{o}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ClockBlock({ view }: { view: HostView }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  if (!view.timer) return null;
  return (
    <div className="absolute bottom-[6%] left-[10%] z-20">
      <TimerRing timer={view.timer} clockOffset={clockOffset} size={11} />
    </div>
  );
}

function Banner({ text, className = "", style, testId }: { text: string; className?: string; style?: CSSProperties; testId?: string }) {
  return (
    <p className={`host-banner bo-scrim-text absolute top-[23%] left-1/2 z-20 -translate-x-1/2 text-center whitespace-nowrap ${className}`} style={style} data-testid={testId}>
      {text}
    </p>
  );
}

/** "next question in 3", from the hold's own timer (frozen while paused). */
function NextIn({ view, className, style, over }: { view: HostView; className: string; style: CSSProperties; over: boolean }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const c = useCountdown(view.timer, clockOffset);
  if (!c) return null;
  return (
    <p className={`host-hint bo-scrim-text absolute top-[31%] left-1/2 z-20 -translate-x-1/2 !text-[2.4rem] ${className}`} style={style}>
      {over ? "the winner in " : "next question in "}
      <span className="font-term text-[3.4rem] leading-none text-amber">{c.seconds}</span>
    </p>
  );
}

/** For the back row: runners still running by gap, then the caught ones greyed with their question. */
function RankStrip({ bo }: { bo: BlackoutState }) {
  const alive = bo.runners.filter((r) => r.alive).sort((a, b) => b.gap - a.gap);
  const caught = bo.runners.filter((r) => !r.alive).sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  return (
    <ol className="absolute top-[30%] right-[1.2%] z-20 flex w-[19rem] flex-col gap-[0.4rem] rounded-[1rem] bg-void/80 p-[0.8rem]" aria-label="Runners by distance" data-testid="bo-rank">
      {[...alive, ...caught].map((r) => (
        <li key={r.id} className={`flex items-center gap-[0.8rem] ${r.alive ? "" : "opacity-40"}`}>
          <Bot color={r.color} head={r.head} mood={r.mood} size="2.4rem" delay={botDelay(r.id)} />
          <span className="host-name min-w-0 flex-1 truncate !text-[1.7rem]">{r.name}</span>
          <span className="font-term text-[2.6rem] leading-none text-amber">{r.alive ? r.gap : `Q${r.caughtOnQuestion ?? ""}`}</span>
        </li>
      ))}
    </ol>
  );
}
