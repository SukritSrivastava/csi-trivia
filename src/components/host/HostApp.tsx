"use client";

/**
 * The projector (/host, Phase 4). After the PIN (HostGate) it shows HostView:
 * the corridor behind everything, the cast across the top, one stage at a time
 * with a short transition, hermes://quiz bottom-right. Plus: sound (Web Audio,
 * unlocked by a click; Admin's toggle and the Host's own mute both apply), a
 * mute and a full-screen button that show while the mouse moves, the cursor
 * hidden after 3 s, the next question's image preloaded, PAUSED / reconnecting bands.
 */
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Corridor } from "@/components/ui/Corridor";
import { useCountdown } from "@/lib/useCountdown";
import { assetUrl } from "@/lib/socket";
import type { HostStage, HostView } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";
import { HostGate } from "./HostGate";
import { Cast } from "./parts";
import { SOUNDS, type SoundName, soundUnlocked, unlockSound } from "./sound";
import { CutStage } from "./stages/CutStage";
import { BlackoutDarkStage, BlackoutIntroStage, BlackoutRevealStage, BlackoutWinnerStage } from "./stages/BlackoutStages";
import { LobbyStage } from "./stages/LobbyStage";
import { PodiumStage } from "./stages/PodiumStage";
import { LeaderboardStage, QuestionStage, ResultsStage, Round1Intro } from "./stages/Round1Stages";
import { PredictionsStage, WildCardIntroStage, WildCardStandingsStage, WildCardWinnerStage } from "./stages/WildCardStages";

const MUTE_KEY = "hermes:host-muted";

export function HostApp() {
  const connect = useHostStore((s) => s.connect);
  const view = useHostStore((s) => s.view);
  const fontsReady = useFontsReady();
  useEffect(() => connect(), [connect]);
  // Nothing on the projector until Special Elite and VT323 are in: no flash of a fallback font.
  return (
    <MotionConfig reducedMotion="user">
      <div className="contents" style={fontsReady ? undefined : { visibility: "hidden" }} data-fonts-ready={fontsReady}>
        {view ? <HostScreen view={view} /> : <HostGate />}
      </div>
    </MotionConfig>
  );
}

/** True once the page's fonts have loaded (or after 3 s, so a font problem never blanks the projector). */
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) setReady((done = true));
    };
    const t = window.setTimeout(finish, 3000);
    void Promise.all([document.fonts.load('1rem "Special Elite"'), document.fonts.load("1rem VT323")])
      .then(() => document.fonts.ready)
      .then(finish, finish);
    return () => window.clearTimeout(t);
  }, []);
  return ready;
}

/** Which dark pool goes behind the text (design: split for the answer step, center for single blocks, full for lists). */
function scrimFor(stage: HostStage): "split" | "center" | "full" {
  switch (stage.phase) {
    case "r1Answer":
    case "r1TimesUp":
    case "r1Reveal":
    case "wcAnswer":
    case "wcTimesUp":
    case "wcReveal":
    case "boAnswer":
    case "boTimesUp":
      return "split";
    case "lobby":
    case "r1Intro":
    case "r1Read":
    case "wcRead":
    case "boRead":
    case "wcWinner":
      return "center";
    default:
      return "full";
  }
}

/** Screens that should transition as one (so the question can travel from read to answer). */
function stageKey(stage: HostStage): string {
  switch (stage.phase) {
    case "r1Read":
    case "r1Answer":
    case "r1TimesUp":
    case "r1Reveal":
    case "wcRead":
    case "wcAnswer":
    case "wcTimesUp":
    case "wcReveal":
    case "boRead":
    case "boAnswer":
    case "boTimesUp":
      return `q-${stage.question.id}`;
    case "r1Results":
      return `res-${stage.question.id}`;
    case "r1Leaderboard":
      return `lb-${stage.question.id}`;
    case "wcStandings":
      return `st-${stage.wildCard.questionNumber}`;
    case "boReveal":
    case "boDark":
      // One screen per question: the moves, then the dark on the same track.
      return `track-${stage.question.id}`;
    default:
      return stage.phase;
  }
}

function StageView({ view }: { view: HostView }) {
  const s = view.stage;
  switch (s.phase) {
    case "lobby":
      return <LobbyStage view={view} />;
    case "r1Intro":
      return <Round1Intro view={view} />;
    case "r1Read":
    case "r1Answer":
    case "r1TimesUp":
    case "r1Reveal":
    case "wcRead":
    case "wcAnswer":
    case "wcTimesUp":
    case "wcReveal":
    case "boRead":
    case "boAnswer":
    case "boTimesUp":
      return <QuestionStage view={view} stage={s} />;
    case "r1Results":
      return <ResultsStage view={view} stage={s} />;
    case "r1Leaderboard":
      return <LeaderboardStage view={view} stage={s} />;
    case "cut":
      return <CutStage view={view} stage={s} />;
    case "wcIntro":
      return <WildCardIntroStage view={view} stage={s} />;
    case "wcStandings":
      return <WildCardStandingsStage view={view} stage={s} />;
    case "wcWinner":
      return <WildCardWinnerStage view={view} stage={s} />;
    case "predictions":
      return <PredictionsStage view={view} stage={s} />;
    case "boIntro":
      return <BlackoutIntroStage view={view} stage={s} />;
    case "boReveal":
      return <BlackoutRevealStage view={view} stage={s} />;
    case "boDark":
      return <BlackoutDarkStage view={view} stage={s} />;
    case "boWinner":
      return <BlackoutWinnerStage view={view} stage={s} />;
    case "podium":
      return <PodiumStage view={view} stage={s} />;
  }
}

function HostScreen({ view }: { view: HostView }) {
  const status = useHostStore((s) => s.status);
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [mouseActive, setMouseActive] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const stage = view.stage;
  const soundOn = view.soundOn && !muted && unlocked;

  // Host mute is remembered on this laptop.
  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      // storage blocked: not muted
    }
  }, []);
  const toggleMute = () => {
    setMuted((m) => {
      try {
        window.localStorage.setItem(MUTE_KEY, m ? "0" : "1");
      } catch {
        // fine
      }
      return !m;
    });
  };

  // Browsers block audio until a click or key: any one unlocks it.
  useEffect(() => {
    const unlock = () => void unlockSound().then((ok) => ok && setUnlocked(true));
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    if (soundUnlocked()) setUnlocked(true);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Hide the cursor (and the small buttons) after 3 s without movement.
  useEffect(() => {
    let t = window.setTimeout(() => setMouseActive(false), 3000);
    const move = () => {
      setMouseActive(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setMouseActive(false), 3000);
    };
    window.addEventListener("pointermove", move);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Preload whatever image comes next.
  useEffect(() => {
    if (!view.nextImage) return;
    const img = new Image();
    img.src = assetUrl(view.nextImage);
  }, [view.nextImage]);

  useGameSounds(view, soundOn);

  return (
    <main
      className={`host-root relative h-dvh w-full overflow-hidden bg-void font-type text-ghost ${mouseActive ? "" : "cursor-none"}`}
      aria-label="Projector"
      data-phase={stage.phase}
    >
      <Corridor scrim={scrimFor(stage)} alarmSeconds={stage.phase === "boAnswer" || stage.phase === "boDark" ? 1.1 : undefined} />
      {stage.phase !== "lobby" && <Cast cast={view.cast} />}

      <AnimatePresence mode="wait">
        <motion.div
          key={stageKey(stage)}
          className="absolute inset-0"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <StageView view={view} />
        </motion.div>
      </AnimatePresence>

      <span className="host-watermark absolute right-[3%] bottom-[3%] z-10">hermes://quiz</span>
      {soundOn && <TickSound view={view} />}

      {view.paused && (
        <div className="absolute inset-x-0 top-[44%] z-40 overflow-hidden bg-alarm/90 py-[1.4rem] text-center" role="status">
          <span className="absolute inset-0 animate-[corridor-alarm_3.2s_infinite] bg-wrong/70" aria-hidden />
          <span className="relative font-term text-[6rem] leading-none tracking-[0.2em] text-ghost">PAUSED</span>
        </div>
      )}
      {status !== "online" && (
        <p className="absolute top-[1.5rem] left-1/2 z-40 -translate-x-1/2 rounded-full border-2 border-wrong bg-void/90 px-[1.6rem] py-[0.5rem] font-type text-[1.8rem] text-wrong" role="alert">
          Reconnecting to the game server…
        </p>
      )}

      {view.soundOn && !muted && !unlocked && (
        <button
          type="button"
          onClick={() => void unlockSound().then((ok) => ok && setUnlocked(true))}
          className={`absolute z-40 rounded-full ${stage.phase === "lobby" ? "top-[1.5%] left-1/2 -translate-x-1/2" : "right-[12%] bottom-[2.2%]"} border-2 border-mint bg-void/90 px-[1.6rem] py-[0.6rem] font-type text-[1.7rem] text-mint`}
          data-testid="enable-sound"
        >
          Click to enable sound
        </button>
      )}

      <div className={`absolute right-[3%] bottom-[7%] z-40 flex gap-[1rem] transition-opacity duration-300 ${mouseActive ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <HostButton onClick={toggleMute} label={muted ? "Sound is off on this screen" : "Mute this screen"}>
          {muted ? "SOUND OFF" : "SOUND ON"}
        </HostButton>
        <HostButton onClick={toggleFullscreen} label={fullscreen ? "Exit full screen" : "Full screen"}>
          {fullscreen ? "EXIT FULL" : "FULL SCREEN"}
        </HostButton>
      </div>
    </main>
  );
}

function HostButton({ onClick, label, children }: { onClick: () => void; label: string; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-[0.8rem] border-2 border-mint bg-void/85 px-[1.2rem] py-[0.5rem] font-term text-[2rem] leading-none text-mint hover:bg-mint/15"
    >
      {children}
    </button>
  );
}

/** A tick in each of the last 3 seconds of any countdown (not while paused). */
function TickSound({ view }: { view: HostView }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const countdown = useCountdown(view.timer, clockOffset);
  const seconds = countdown?.seconds ?? null;
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (seconds === null || view.paused) return;
    if (seconds !== last.current && seconds >= 1 && seconds <= 3) SOUNDS.tick();
    last.current = seconds;
  }, [seconds, view.paused]);
  return null;
}

/** Plays a sound on the moments that matter, by comparing each new view with the one before. */
function useGameSounds(view: HostView, on: boolean) {
  const prev = useRef<HostView | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!on || !before) return;
    const was = before.stage;
    const now = view.stage;
    const play = (name: SoundName) => SOUNDS[name]();
    const entered = now.phase !== was.phase;

    if (now.phase === "lobby" && was.phase === "lobby" && view.cast.length > before.cast.length) play("join");
    if (entered && (now.phase === "r1Reveal" || now.phase === "wcReveal" || now.phase === "boReveal") && !now.voided) play("reveal");
    if (entered && now.phase === "wcWinner") play("correct");
    if (entered && now.phase === "boDark") window.setTimeout(() => (now.blackout.caughtThisQuestion.length ? SOUNDS.powerDown() : SOUNDS.correct()), 900);
    if (entered && now.phase === "podium") window.setTimeout(() => SOUNDS.win(), 1400);
  }, [view, on]);
}
