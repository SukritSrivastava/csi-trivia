/**
 * Every timing and count of the quiz lives here (docs/SPEC.md v3.1). Two presets:
 *
 *   event  the real night: 20 Round 1 questions, top 9 safe, a 5-question wild
 *          card round, then Blackout on autopilot until one runner is left
 *   demo   the 3 demo questions, top 3 safe (so the wild card round runs with a
 *          few test tabs), 3 wild card questions, a short Blackout;
 *          same timings as the event
 *
 * Pick one with the GAME_PRESET environment variable. `npm run dev` uses demo.
 * Each quiz in the library has its own Settings (QuizRules) that override the
 * counts and timings here; the Blackout tuning (baseGap, darkness, head starts)
 * and the autopilot holds always come from the preset.
 */

import { MULTI_ANSWER_SECONDS } from "../src/shared/protocol";

/** Round 1: an instant correct answer scores this… */
export const R1_MAX_POINTS = 200;
/** …and a correct answer at the last moment this. Speed slides linearly between them. */
export const R1_MIN_POINTS = 100;

/** Round 1 points for a correct answer after `elapsedMs` of a `limitMs` answer window. */
export function round1Points(elapsedMs: number, limitMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / Math.max(1, limitMs)));
  return Math.round(R1_MAX_POINTS - (R1_MAX_POINTS - R1_MIN_POINTS) * t);
}

/** Multi-correct (Round 1): each wrong option ticked takes this share of the speed score off. */
export const MULTI_WRONG_PENALTY = 0.25;
/** Multi-correct: the answer time when the question has no time of its own (the read time is unchanged). */
export const MULTI_ANSWER_MS = MULTI_ANSWER_SECONDS * 1000;

/**
 * Round 1 points for a multi-correct question (docs/SPEC.md "Multi-correct questions"):
 *   S = round1Points(elapsed, limit), the speed score of the lock-in (200 → 100)
 *   points = max(0, round(S × (found / total − MULTI_WRONG_PENALTY × wrong)))
 * found = right options ticked, total = right options, wrong = wrong options ticked.
 */
export function multiPoints(elapsedMs: number, limitMs: number, found: number, total: number, wrong: number): number {
  const s = round1Points(elapsedMs, limitMs);
  return Math.max(0, Math.round(s * (found / Math.max(1, total) - MULTI_WRONG_PENALTY * wrong)));
}

export interface GameConfig {
  name: "event" | "demo";
  round1: {
    /** Round 1 questions played. */
    questions: number;
    /** Question on the Host before options appear on phones. */
    readMs: number;
    /** Time to answer on phones. */
    answerMs: number;
    /** Time to answer a multi-correct question that has no time of its own (MULTI_ANSWER_MS). */
    multiAnswerMs: number;
  };
  /** Safe at the cut (ranks 1–N become finalists). The wild card winner makes it N + 1. */
  safe: number;
  wildCard: {
    /** Planned wild card questions. */
    questions: number;
    /** Most sudden-death questions after them. */
    suddenDeathMax: number;
    readMs: number;
    answerMs: number;
  };
  blackout: {
    /**
     * Blackout plays every question in its list (tagged round 3, then untagged
     * unused ones) until one runner is left. Opening a room needs at least this many.
     */
    minQuestions: number;
    /** Below this many, the server logs a warning (voids eat questions). */
    warnBelow: number;
    readMs: number;
    answerMs: number;
    /** The autopilot's holds after each step, long enough for the Host animation. */
    holds: {
      /** After Start Blackout: the intro. */
      introMs: number;
      /** Time's up on screen. */
      timesUpMs: number;
      /** Runners move: base + per runner still running. */
      revealMs: number;
      revealPerRunnerMs: number;
      /** The dark moves: base + per step it moves + extra if anyone was caught. */
      darkMs: number;
      darkPerStepMs: number;
      darkCaughtMs: number;
      /** A voided question's "cancelled" before the next one. */
      voidMs: number;
      /** The winner moment, then the podium. */
      winnerMs: number;
    };
    /** Every runner starts this many steps ahead of the dark, plus their head start. */
    baseGap: number;
    /** How far the dark moves at question 1, 2, 3, … (past the end, the last value repeats). */
    darkness: number[];
    /** Head start by Round 1 rank: ranks 1–3, ranks 4–safe, the wild card. */
    headStart: { top3: number; safe: number; wildCard: number };
  };
  /** Rows on the Round 1 leaderboard. */
  leaderboardSize: number;
  /** Rows on the wild card standings. */
  standingsSize: number;
  /** Fewest participants the quiz can start with. */
  minParticipants: number;
  /** Most participants a room accepts. */
  maxParticipants: number;
}

const QUESTION_TIMING = { readMs: 8_000, answerMs: 8_000 };
const BLACKOUT_TIMING = { readMs: 5_000, answerMs: 10_000 };
const HOLDS: GameConfig["blackout"]["holds"] = {
  introMs: 6_000,
  timesUpMs: 1_500,
  revealMs: 3_000,
  revealPerRunnerMs: 150,
  darkMs: 2_500,
  darkPerStepMs: 250,
  darkCaughtMs: 1_500,
  voidMs: 3_000,
  winnerMs: 7_000,
};
const HEAD_START = { top3: 2, safe: 1, wildCard: 0 };

export const PRESETS: Record<GameConfig["name"], GameConfig> = {
  event: {
    name: "event",
    round1: { questions: 20, ...QUESTION_TIMING, multiAnswerMs: MULTI_ANSWER_MS },
    safe: 9,
    wildCard: { questions: 5, suddenDeathMax: 3, ...QUESTION_TIMING },
    blackout: {
      minQuestions: 12,
      warnBelow: 15,
      ...BLACKOUT_TIMING,
      holds: HOLDS,
      // From `npm run tune-blackout` (20,000 chases of 10 runners, 10 s answers, 15 questions available,
      // 14 Oct 2026): first catch at Q3–4 in 86% of chases, 5 still running after Q6, decided around Q10,
      // 1–2 left by Q9–11 in 74%, 3+ still running after Q12 2.7%, everyone caught at once 13.5%, the wild
      // card wins 2.5% (5.8% if it answers like a mid-table finalist).
      baseGap: 6,
      darkness: [1, 2, 2, 3],
      headStart: HEAD_START,
    },
    leaderboardSize: 10,
    standingsSize: 10,
    minParticipants: 2,
    maxParticipants: 200,
  },
  demo: {
    name: "demo",
    round1: { questions: 3, ...QUESTION_TIMING, multiAnswerMs: MULTI_ANSWER_MS },
    safe: 3,
    wildCard: { questions: 3, suddenDeathMax: 3, ...QUESTION_TIMING },
    blackout: {
      minQuestions: 8,
      warnBelow: 8,
      ...BLACKOUT_TIMING,
      holds: HOLDS,
      // From `npm run tune-blackout` (5,000 chases of 4 runners, 8 questions available): decided by Q6 in
      // most chases (median Q6), 1–2 left by Q4–6 in 76%, everyone caught at once 5.4%, the wild card wins 7.1%.
      baseGap: 2,
      darkness: [1, 2],
      headStart: HEAD_START,
    },
    leaderboardSize: 10,
    standingsSize: 10,
    minParticipants: 2,
    maxParticipants: 200,
  },
};

export function loadConfig(name = process.env.GAME_PRESET ?? "demo"): GameConfig {
  const preset = PRESETS[name.trim().toLowerCase() as GameConfig["name"]];
  if (!preset) {
    throw new Error(`Unknown GAME_PRESET "${name}". Use "event" or "demo".`);
  }
  return preset;
}

/** How far the dark moves after Blackout question `number` (1-based). Past the end of the list, its last value. */
export function darknessStep(config: GameConfig, number: number): number {
  const d = config.blackout.darkness;
  return d[Math.min(Math.max(1, number), d.length) - 1] ?? 1;
}

/** A copy of a preset with every timer and hold scaled (tests use this to run fast). */
export function withTimingScale(config: GameConfig, scale: number): GameConfig {
  const s = (ms: number) => Math.max(50, Math.round(ms * scale));
  const h = config.blackout.holds;
  return {
    ...config,
    round1: { ...config.round1, readMs: s(config.round1.readMs), answerMs: s(config.round1.answerMs), multiAnswerMs: s(config.round1.multiAnswerMs) },
    wildCard: { ...config.wildCard, readMs: s(config.wildCard.readMs), answerMs: s(config.wildCard.answerMs) },
    blackout: {
      ...config.blackout,
      readMs: s(config.blackout.readMs),
      answerMs: s(config.blackout.answerMs),
      holds: {
        introMs: s(h.introMs),
        timesUpMs: s(h.timesUpMs),
        revealMs: s(h.revealMs),
        revealPerRunnerMs: Math.round(h.revealPerRunnerMs * scale),
        darkMs: s(h.darkMs),
        darkPerStepMs: Math.round(h.darkPerStepMs * scale),
        darkCaughtMs: Math.round(h.darkCaughtMs * scale),
        voidMs: s(h.voidMs),
        winnerMs: s(h.winnerMs),
      },
    },
  };
}
