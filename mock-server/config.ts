/**
 * Every timing and count of the quiz lives here. Two presets:
 *
 *   event  the real night (docs/SPEC.md): every Round 1 question, top 6,
 *          10 buzzer questions
 *   demo   the 3 demo questions in Round 1, top 3 (so the cut shows with
 *          4 test tabs), 3 buzzer questions; same timings as the event
 *
 * Pick one with the GAME_PRESET environment variable. `npm run dev` uses demo.
 */

export interface GameConfig {
  name: "event" | "demo";
  round1: {
    /** How many Round 1 questions: a number, or "all" questions tagged round 1 or untagged. */
    questions: number | "all";
    /** Question on the Host before options appear on phones. */
    readMs: number;
    /** Time to answer on phones. */
    answerMs: number;
  };
  /** How many make the cut into the buzzer round. */
  finalists: number;
  round2: {
    /** Planned buzzer questions. Most points after these wins (tie → sudden death). */
    questions: number;
    /** Question + options on the Host, buzzers locked. */
    readMs: number;
    /** Buzzers open. */
    buzzMs: number;
    /** Countdown while the buzzer says the answer out loud. Never marks anything by itself. */
    answerMs: number;
    /** Buzzers reopen for the others after a wrong answer. */
    reopenMs: number;
  };
  scoring: {
    /** Points for an instant correct answer. */
    maxPoints: number;
    /** Points for a correct answer in the last moment. Speed scales between the two. */
    minCorrectPoints: number;
  };
  /** Rows on the Round 1 leaderboard. */
  leaderboardSize: number;
  /** Fewest participants the quiz can start with. */
  minParticipants: number;
  /** Most participants a room accepts. */
  maxParticipants: number;
}

const ROUND1_TIMING = { readMs: 8_000, answerMs: 8_000 };
const ROUND2_TIMING = { readMs: 5_000, buzzMs: 15_000, answerMs: 10_000, reopenMs: 10_000 };
const SCORING = { maxPoints: 1000, minCorrectPoints: 500 };

export const PRESETS: Record<GameConfig["name"], GameConfig> = {
  event: {
    name: "event",
    round1: { questions: "all", ...ROUND1_TIMING },
    finalists: 6,
    round2: { questions: 10, ...ROUND2_TIMING },
    scoring: SCORING,
    leaderboardSize: 10,
    minParticipants: 2,
    maxParticipants: 200,
  },
  demo: {
    name: "demo",
    round1: { questions: 3, ...ROUND1_TIMING },
    finalists: 3,
    round2: { questions: 3, ...ROUND2_TIMING },
    scoring: SCORING,
    leaderboardSize: 10,
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

/** A copy of a preset with every timer scaled (tests use this to run fast). */
export function withTimingScale(config: GameConfig, scale: number): GameConfig {
  const s = (ms: number) => Math.max(50, Math.round(ms * scale));
  return {
    ...config,
    round1: { ...config.round1, readMs: s(config.round1.readMs), answerMs: s(config.round1.answerMs) },
    round2: {
      ...config.round2,
      readMs: s(config.round2.readMs),
      buzzMs: s(config.round2.buzzMs),
      answerMs: s(config.round2.answerMs),
      reopenMs: s(config.round2.reopenMs),
    },
  };
}
