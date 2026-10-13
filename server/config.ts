/**
 * Every timing and count of the quiz lives here (docs/SPEC.md v3). Two presets:
 *
 *   event  the real night: 20 Round 1 questions, top 9 safe, a 5-question wild
 *          card round, a 12-question Blackout (plus 3 spares)
 *   demo   the 3 demo questions, top 3 safe (so the wild card round runs with a
 *          few test tabs), 3 wild card questions, a 6-question Blackout;
 *          same timings as the event
 *
 * Pick one with the GAME_PRESET environment variable. `npm run dev` uses demo.
 * Each quiz in the library has its own Settings (QuizRules) that override the
 * counts and timings here; the Blackout tuning (baseGap, darkness, head starts)
 * always comes from the preset.
 */

export interface GameConfig {
  name: "event" | "demo";
  round1: {
    /** Round 1 questions played. */
    questions: number;
    /** Question on the Host before options appear on phones. */
    readMs: number;
    /** Time to answer on phones. */
    answerMs: number;
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
    /** Planned Blackout questions. */
    questions: number;
    /** Extra questions, used only to replace voided ones. */
    spares: number;
    readMs: number;
    answerMs: number;
    /** Every runner starts this many steps ahead of the dark, plus their head start. */
    baseGap: number;
    /** How far the dark moves at question 1, 2, 3, … (the last value repeats). */
    darkness: number[];
    /** Head start by Round 1 rank: ranks 1–3, ranks 4–safe, the wild card. */
    headStart: { top3: number; safe: number; wildCard: number };
  };
  scoring: {
    /** Points for an instant correct answer. */
    maxPoints: number;
    /** Points for a correct answer in the last moment. Speed scales between the two. */
    minCorrectPoints: number;
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
const BLACKOUT_TIMING = { readMs: 5_000, answerMs: 8_000 };
const SCORING = { maxPoints: 1000, minCorrectPoints: 500 };
const HEAD_START = { top3: 2, safe: 1, wildCard: 0 };

export const PRESETS: Record<GameConfig["name"], GameConfig> = {
  event: {
    name: "event",
    round1: { questions: 20, ...QUESTION_TIMING },
    safe: 9,
    wildCard: { questions: 5, suddenDeathMax: 3, ...QUESTION_TIMING },
    blackout: {
      questions: 12,
      spares: 3,
      ...BLACKOUT_TIMING,
      // From `npm run tune-blackout` (20,000 chases of 10 runners per candidate, 14 Oct 2026): first catch at
      // Q3–4 in 74% of chases, 6 still running after Q6, 1–2 left by Q9–11 in 75%, 3+ at the end 10.5%,
      // everyone caught at once 8.9%, the wild card wins 2% (5.5% if it answers like a mid-table finalist).
      baseGap: 4,
      darkness: [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3],
      headStart: HEAD_START,
    },
    scoring: SCORING,
    leaderboardSize: 10,
    standingsSize: 10,
    minParticipants: 2,
    maxParticipants: 200,
  },
  demo: {
    name: "demo",
    round1: { questions: 3, ...QUESTION_TIMING },
    safe: 3,
    wildCard: { questions: 3, suddenDeathMax: 3, ...QUESTION_TIMING },
    blackout: {
      questions: 6,
      spares: 1,
      ...BLACKOUT_TIMING,
      // From `npm run tune-blackout` (5,000 chases of 4 runners, 6 questions): decided by Q6 in 89% of chases,
      // first catch at Q2–3 in 72%, everyone caught at once 7.5%, the wild card wins 7.5%.
      baseGap: 3,
      darkness: [1, 2, 2, 2, 3, 3],
      headStart: HEAD_START,
    },
    scoring: SCORING,
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

/** How far the dark moves after Blackout question `number` (1-based). */
export function darknessStep(config: GameConfig, number: number): number {
  const d = config.blackout.darkness;
  return d[Math.min(number, d.length) - 1] ?? 1;
}

/** A copy of a preset with every timer scaled (tests use this to run fast). */
export function withTimingScale(config: GameConfig, scale: number): GameConfig {
  const s = (ms: number) => Math.max(50, Math.round(ms * scale));
  return {
    ...config,
    round1: { ...config.round1, readMs: s(config.round1.readMs), answerMs: s(config.round1.answerMs) },
    wildCard: { ...config.wildCard, readMs: s(config.wildCard.readMs), answerMs: s(config.wildCard.answerMs) },
    blackout: { ...config.blackout, readMs: s(config.blackout.readMs), answerMs: s(config.blackout.answerMs) },
  };
}
