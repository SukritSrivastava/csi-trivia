/**
 * Round settings for the quiz. Two presets:
 *
 *   event  exactly as docs/SPEC.md (everyone → 30 → 15 → 10 → 5 → 2 → duel)
 *   demo   3 short rounds with the 3 demo questions, cuts that work with
 *          4–6 test players, then the duel
 *
 * Pick one with the GAME_PRESET environment variable (npm run dev uses demo).
 */

export interface RoundSettings {
  /** Questions in this round. */
  questions: number;
  /** Seconds to answer each question. */
  seconds: number;
  /** How many players go through to the next stage. */
  advance: number;
  /** Points lost for a wrong answer (0 = no penalty). Missing a question never costs points. */
  wrongPenalty: number;
}

export interface GameConfig {
  name: "event" | "demo";
  rounds: RoundSettings[];
  timings: {
    roundIntroMs: number;
    /** Question on the projector before options appear on phones. */
    readMs: number;
    /** Correct answer on the projector. */
    revealMs: number;
    /** How many picked each option. */
    chartMs: number;
    /** Round top 10. */
    leaderboardMs: number;
    /** The cut-line list at the end of a round. */
    roundEndMs: number;
    /** Audience backs a finalist. */
    predictionMs: number;
  };
  scoring: {
    /** Points for an instant correct answer. */
    maxPoints: number;
    /** Points for a correct answer in the last moment. Speed scales between the two. */
    minCorrectPoints: number;
  };
  duel: {
    pointsToWin: number;
    /** After this many duel questions, the next correct answer wins. */
    plannedQuestions: number;
    readMs: number;
    buzzMs: number;
    answerMs: number;
    stealMs: number;
    resultMs: number;
  };
  /** Lowest player count the organiser can start with. */
  minPlayers: number;
  /** Top N shown on the projector after each question. */
  leaderboardSize: number;
}

const SCORING = { maxPoints: 1000, minCorrectPoints: 500 };

export const PRESETS: Record<GameConfig["name"], GameConfig> = {
  event: {
    name: "event",
    rounds: [
      { questions: 10, seconds: 20, advance: 30, wrongPenalty: 0 },
      { questions: 8, seconds: 20, advance: 15, wrongPenalty: 0 },
      { questions: 6, seconds: 15, advance: 10, wrongPenalty: 0 },
      { questions: 5, seconds: 15, advance: 5, wrongPenalty: 250 },
      { questions: 5, seconds: 12, advance: 2, wrongPenalty: 250 },
    ],
    timings: {
      roundIntroMs: 6_000,
      readMs: 4_000,
      revealMs: 3_000,
      chartMs: 4_000,
      leaderboardMs: 5_000,
      roundEndMs: 12_000,
      predictionMs: 20_000,
    },
    scoring: SCORING,
    duel: {
      pointsToWin: 3,
      plannedQuestions: 9,
      readMs: 4_000,
      buzzMs: 15_000,
      answerMs: 10_000,
      stealMs: 10_000,
      resultMs: 5_000,
    },
    minPlayers: 2,
    leaderboardSize: 10,
  },

  demo: {
    name: "demo",
    rounds: [
      { questions: 3, seconds: 15, advance: 4, wrongPenalty: 0 },
      { questions: 3, seconds: 15, advance: 3, wrongPenalty: 0 },
      { questions: 3, seconds: 12, advance: 2, wrongPenalty: 250 },
    ],
    timings: {
      roundIntroMs: 4_000,
      readMs: 3_000,
      revealMs: 2_500,
      chartMs: 3_000,
      leaderboardMs: 3_500,
      roundEndMs: 8_000,
      predictionMs: 15_000,
    },
    scoring: SCORING,
    duel: {
      pointsToWin: 3,
      plannedQuestions: 5,
      readMs: 3_000,
      buzzMs: 15_000,
      answerMs: 10_000,
      stealMs: 10_000,
      resultMs: 4_000,
    },
    minPlayers: 2,
    leaderboardSize: 10,
  },
};

export function loadConfig(name = process.env.GAME_PRESET ?? "demo"): GameConfig {
  const preset = PRESETS[name as GameConfig["name"]];
  if (!preset) {
    throw new Error(`Unknown GAME_PRESET "${name}". Use "event" or "demo".`);
  }
  return preset;
}
