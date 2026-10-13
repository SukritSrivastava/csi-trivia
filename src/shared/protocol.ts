/**
 * THE CONTRACT between the game server and every screen (rules: docs/SPEC.md v3).
 *
 *   Host         /host    the projector everyone sees. No game controls.   receives HostView
 *   Participant  /play    each person's phone. Gets its OWN private view.  receives ParticipantView
 *   Admin        /admin   the quizmaster's control panel (PIN).            receives AdminView
 *
 * The server owns the game: timers, scoring, the cut, shuffling, buzzers,
 * judging. Screens never decide anything. They send an action ("I tapped
 * option x", "Reveal answer") and draw whatever view arrives next.
 *
 * ---------------------------------------------------------------------------
 * For the backend teammate
 * ---------------------------------------------------------------------------
 * Build the real server against this file. server/ implements every
 * line of it and is the working reference (server/quiz.ts holds all the
 * rules with no socket code). If something here has to change, change it in
 * this file first and tell the frontend: TypeScript then flags every screen
 * that needs updating.
 *
 * Rules the server must enforce:
 *   1. A Participant view NEVER contains the correct answer before the reveal.
 *      The Host view doesn't either (the projector laptop may be screen-shared).
 *      Only the Admin view carries it, so the quizmaster can judge.
 *   2. Option ids are opaque random strings, new for every question run.
 *   3. The 4 options are shuffled once per question run. In every round the Host
 *      and every phone show that same order, numbered 1–4 (like Murder Trivia).
 *   4. Answer times are measured on the server, never trusted from a phone.
 *   5. Admin flow commands carry the stepId they were issued from. If the
 *      step has moved on, ignore the command (see AdminCommandPayload).
 *   6. The quizmaster drives the flow. Timers only run where SPEC says so,
 *      and when a timer ends the game holds and waits for the next click.
 *   7. Every answer is marked by the server (no judging): Round 1 points, wild
 *      card tallies, Blackout moves, the dark and every catch.
 *
 * Views are sent whenever they change, and only to the sockets whose view
 * actually changed (100 phones). Every view carries `serverNow` so screens
 * can correct for phones whose clocks are off.
 */

export const APP_NAME = "Hermes Quiz";

export const ROOM_CODE_LENGTH = 4;
/** Consonants only, so a random code can't spell a rude word. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const NAME_MAX_LENGTH = 20;

/** How much "+5 seconds" adds to a running timer. */
export const ADD_TIME_MS = 5_000;

/** Letters for the 4 options, as shown on the Host in the buzzer round and on Admin. */
export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

// ============================================================================
// Bots (every participant's avatar)
// ============================================================================

/**
 * Every participant is a little robot: a colour and a head shape, picked on the
 * phone in the lobby (the server assigns one on join, so nobody has to).
 * Look: docs/SPEC.md "Look" and public/finaldesign.html.
 *
 * Any colour is allowed (the phone has these 12 as quick picks plus a colour
 * wheel), and several people may have the same colour and head: people are told
 * apart by their names, which are unique. The server brightens colours that would
 * vanish on the dark screens (normalizeBotColor).
 */
export const PARTICIPANT_COLORS = [
  "#6CF0B0", // mint
  "#4CC9F0", // sky
  "#9B7BFF", // violet
  "#FF5FA2", // pink
  "#FF4D5E", // red
  "#FF8C42", // orange
  "#FFD23F", // yellow
  "#B6F04C", // lime
  "#E8F0F2", // white
  "#2EC4B6", // teal
  "#C77DFF", // lilac
  "#F72585", // magenta
] as const;

export const BOT_HEADS = ["box", "round", "antenna", "bolts", "horns", "ears", "dome", "visor"] as const;
export type BotHead = (typeof BOT_HEADS)[number];

/**
 * What a bot's eyes are doing. The server decides it (HostView.cast), so every
 * screen shows the same thing.
 * - idle:     blinks and looks around (lobby, read step, between steps)
 * - thinking: eyes dart side to side (a question is open and they haven't answered)
 * - locked:   eyes shut, slow breathing (answered, waiting for the reveal)
 * - right:    happy ^ ^ eyes, smile, hops (got it right)
 * - wrong:    red X eyes, frown, shakes (got it wrong or missed it)
 * - out:      powered down (cut after Round 1, removed)
 * "locked" never says whether the answer was right, so the Host still can't leak it.
 */
export type BotMood = "idle" | "thinking" | "locked" | "right" | "wrong" | "out";

/** A bot choice: any "#rrggbb" colour and one of BOT_HEADS. */
export interface BotLook {
  color: string;
  head: BotHead;
}

/** Bots stay visible on the near-black screens: lightness is kept within this range (HSL, %). */
export const BOT_LIGHTNESS = { min: 45, max: 92 } as const;

/**
 * A bot colour as the server stores it: "#rrggbb" (lowercase), with lightness
 * clamped to BOT_LIGHTNESS so no bot disappears into the dark. Accepts "#rgb"
 * and "#rrggbb". null if it isn't a colour.
 */
export function normalizeBotColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let hex = input.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
  const { h, s, l } = hexToHsl(hex);
  if (l >= BOT_LIGHTNESS.min && l <= BOT_LIGHTNESS.max) return hex;
  // Keep the hue and saturation, move the lightness into range.
  return hslToHex(h, s, Math.min(BOT_LIGHTNESS.max, Math.max(BOT_LIGHTNESS.min, l)));
}

/** "#rrggbb" → h 0–360, s and l 0–100. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

/** h 0–360, s and l 0–100 → "#rrggbb". */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}


// ============================================================================
// The flow (docs/SPEC.md v3.1)
// ============================================================================

/**
 * Every step of the quiz, in order. (click) = the quizmaster's click on Admin,
 * (timer) = runs by itself once started.
 *
 *   lobby
 *   → r1Intro                                    (click: Start quiz)
 *   → for each Round 1 question:
 *       r1Read        8s, question on Host, "Eyes up" on phones       (click: Show question / Next question)
 *       r1Answer      8s, options on phones; ends early when every
 *                     connected player has answered                   (timer)
 *       r1TimesUp     holds                                           (timer)
 *       r1Reveal      the correct answer; phones right / wrong        (click: Reveal answer)
 *       r1Results     how many picked each option (optional)          (click: Show results)
 *       r1Leaderboard top 10 (optional)                               (click: Show leaderboard)
 *   → cut           the ranking, cut line under 9th                    (click: End round 1)
 *   → wcIntro       the wild card players and the 9 safe              (click: Start wild card round)
 *   → for each wild card question (and up to 3 sudden-death ones):
 *       wcRead / wcAnswer / wcTimesUp / wcReveal   as Round 1           (only wildcard players answer)
 *       wcStandings   top 10 by correct answers (optional)            (click: Show standings)
 *   → wcWinner      the 10th finalist                                 (click: Reveal wild card)
 *   → predictions   audience backs a finalist (optional)              (click: Open predictions)
 *   → boIntro       the 10 runners at their start positions, 6s       (click: Start Blackout)
 *   Blackout then runs on AUTOPILOT: every step below starts by itself.
 *   → for each Blackout question, until one runner is left:
 *       boRead        5s, no options                                  (autopilot)
 *       boAnswer      10s, options on the runners' phones; ends early
 *                     when every runner still running has answered     (autopilot)
 *       boTimesUp     1.5s                                             (autopilot)
 *       boReveal      correct answer, runners move +3/+2/+1/0/−1;
 *                     3s + 0.15s per runner                            (autopilot)
 *       boDark        the dark moves; anyone it reaches is caught;
 *                     2.5s + 0.25s per step + 1.5s if anyone caught    (autopilot)
 *   → boWinner      the last runner, 7s                               (autopilot)
 *   → podium                                                          (autopilot, or End quiz now)
 * The quizmaster can still Pause / Resume, Skip, +5s, Void, Restart question,
 * Restart round, End quiz now and Remove participant during Blackout.
 */
export type Phase =
  | "lobby"
  | "r1Intro"
  | "r1Read"
  | "r1Answer"
  | "r1TimesUp"
  | "r1Reveal"
  | "r1Results"
  | "r1Leaderboard"
  | "cut"
  | "wcIntro"
  | "wcRead"
  | "wcAnswer"
  | "wcTimesUp"
  | "wcReveal"
  | "wcStandings"
  | "wcWinner"
  | "predictions"
  | "boIntro"
  | "boRead"
  | "boAnswer"
  | "boTimesUp"
  | "boReveal"
  | "boDark"
  | "boWinner"
  | "podium";

/** 1 = Round 1, 2 = wild card, 3 = Blackout. */
export type RoundNumber = 1 | 2 | 3;

/**
 * A countdown. Phone clocks are often seconds off, so screens compute the time
 * left as `endsAt - (Date.now() + clockOffset)` where
 * `clockOffset = view.serverNow - Date.now()` measured when the view arrived.
 * While paused, `remainingMs` is set and the countdown freezes.
 */
export interface Timer {
  /** Server clock time (ms) when this step ends. */
  endsAt: number;
  /** Full length of the step, including any "+5 seconds". */
  durationMs: number;
  /** Only set while paused: the frozen time left. */
  remainingMs?: number;
}

/**
 * - playing:  in Round 1 (everyone who joins before the cut)
 * - finalist: safe at the cut (top 9) or the wild card winner; runs in Blackout
 * - wildcard: outside the top 9 at the cut; plays the wild card round
 * - audience: lost the wild card, joined after the cut, or no wild card round; backs a finalist
 * - removed:  removed by the quizmaster; can't rejoin
 */
export type ParticipantStatus = "playing" | "finalist" | "wildcard" | "audience" | "removed";

/** How a person appears on every screen: name and bot. */
export interface ParticipantTag {
  id: string;
  name: string;
  /** Bot colour, "#rrggbb" (any colour; see normalizeBotColor). Others may share it. */
  color: string;
  /** Bot head shape. */
  head: BotHead;
}

/** A bot on the Host's cast wall, with what its eyes are doing right now. */
export interface CastMember extends ParticipantTag {
  mood: BotMood;
}

/** Head counts. Removed participants are only counted in `removed`. */
export interface Counts {
  joined: number;
  connected: number;
  playing: number;
  finalists: number;
  wildcard: number;
  audience: number;
  removed: number;
}

/** This room's settings (from the quiz's rules), for intros and labels. */
export interface QuizSettings {
  preset: "event" | "demo";
  round1Questions: number;
  round1ReadSeconds: number;
  round1AnswerSeconds: number;
  /** Points for an instant correct Round 1 answer (200; the last moment scores 100). */
  round1MaxPoints: number;
  /** Safe at the cut (9 at the event). The wild card makes it one more. */
  safeCount: number;
  wildCardQuestions: number;
  wildCardSuddenDeathMax: number;
  blackoutReadSeconds: number;
  blackoutAnswerSeconds: number;
}

// ============================================================================
// Questions (one shape for all three rounds)
// ============================================================================

/** A question as the Host shows it. Never says which option is right. */
export interface McqQuestion {
  /** Opaque id of this question run. New on every run (restart question gives a new one). */
  id: string;
  round: RoundNumber;
  /** 1-based within its round (sudden-death questions count on: 6, 7, 8). */
  number: number;
  /** Planned questions in the round. null in Blackout (it plays until one runner is left). */
  count: number | null;
  /** A wild card sudden-death question. */
  suddenDeath: boolean;
  text: string;
  /** "/questions/x.svg" on this site, or "/images/<id>" on the game server (assetUrl), or null. */
  image: string | null;
  /**
   * The 4 options, numbered 1–4 in this order, from the answer step on. null in
   * the read step. Every phone shows them in this same order with the same numbers.
   */
  options: string[] | null;
}

/** One answer button on a phone. `id` is opaque; it says nothing about which one is right. */
export interface AnswerOption {
  id: string;
  text: string;
}

/** Round 1 results bar chart: how many picked each option (after the reveal only). */
export interface OptionResult {
  /** 1–4, the number shown on screen. */
  number: number;
  text: string;
  count: number;
  correct: boolean;
}

/** After a reveal (Host, every round). */
export interface Reveal {
  /** null when the question was voided. */
  correctText: string | null;
  /** 0–3 into McqQuestion.options; null when voided. */
  correctIndex: number | null;
  voided: boolean;
}

export interface LeaderRow extends ParticipantTag {
  rank: number;
  score: number;
  /** Rank before this question, null if they had none yet (first question, late joiner). */
  previousRank: number | null;
  /** Points won on the question just played. */
  change: number;
}

/** One line of the ranking at the cut. */
export interface Standing extends ParticipantTag {
  rank: number;
  score: number;
  /** Total Round 1 answer time (the tie-break), ms. */
  timeMs: number;
  /** Safe: in the top 9 (or everyone, when the wild card round is skipped). */
  finalist: boolean;
}

// ============================================================================
// Wild card round
// ============================================================================

export interface WildCardStanding extends ParticipantTag {
  rank: number;
  correct: number;
  /** Total answer time over the wild card questions (wrong / miss = the full time), ms. */
  timeMs: number;
}

export interface WildCardState {
  /** Wild card players still in it (not removed). */
  players: number;
  /** The current question's number (0 before the first). */
  questionNumber: number;
  /** Planned questions. */
  questionCount: number;
  /** During the answer steps: answered / expected. Else null. */
  answered: number | null;
  expected: number | null;
  /**
   * Host: the top 10 on wcStandings and wcWinner only (empty otherwise, so the
   * live tally can't be read off the projector mid-question). Admin: everyone, always.
   */
  standings: WildCardStanding[];
  /** The 9 safe finalists (they watch). */
  safe: ParticipantTag[];
  suddenDeath: { active: boolean; number: number; max: number; alive: ParticipantTag[] } | null;
  /** Set on wcWinner (and after). */
  winner: ParticipantTag | null;
  /** Nobody got a wild card question right: the 10th-ranked Round 1 player got the seat. */
  fallback: boolean;
}

// ============================================================================
// Blackout
// ============================================================================

export interface Runner extends ParticipantTag {
  mood: BotMood;
  /** Steps from the start of the track (the dark starts at 0). */
  position: number;
  /** Position before the last reveal (for the move animation). */
  from: number;
  /** The last reveal's move: +3, +2, +1, 0 or −1. null before the first reveal of this question run. */
  delta: number | null;
  /** position − dark: how far ahead of the dark (≤ 0 once caught). */
  gap: number;
  alive: boolean;
  caughtOnQuestion: number | null;
  /** Final place once it's decided (caught, or the end). */
  place: number | null;
  /** 2 (ranks 1–3), 1 (ranks 4–9), 0 (the wild card). */
  headStart: number;
  wildCard: boolean;
  /** Round 1 rank. */
  round1Rank: number | null;
}

export interface BlackoutState {
  /** The current question's number (0 before the first). */
  questionNumber: number;
  /** Blackout questions still available after the current one (it plays until one runner is left). */
  questionsLeft: number | null;
  /** The dark's position. */
  dark: number;
  /** The dark's position before the last advance (for animation). */
  darkFrom: number;
  /** Seat order (Round 1 rank, the wild card last). */
  runners: Runner[];
  /** Ids caught by the last Advance the darkness. */
  caughtThisQuestion: string[];
  /** Runners still running. */
  alive: number;
  /** Decided: the winner moment and the podium come next by themselves. */
  over: boolean;
  /** Set once decided. */
  winner: ParticipantTag | null;
}

// ============================================================================
// Predictions and the podium
// ============================================================================

export interface FinalistInfo extends ParticipantTag {
  /** 1-based seat: Round 1 rank order, the wild card last. */
  seat: number;
  round1Rank: number | null;
  wildCard: boolean;
  connected: boolean;
}

/** Live backing counts (predictions onward). */
export interface Backing {
  /** finalist id → number of audience members backing them */
  counts: Record<string, number>;
  /** Audience members who backed someone. */
  backers: number;
  /** Everyone who can back (audience, connected or not). */
  audience: number;
}

export interface PodiumEntry extends ParticipantTag {
  /** 1-based final place. */
  place: number;
  round1Rank: number | null;
  round1Score: number;
  /** Blackout: final position on the track. null when the quiz ended before Blackout. */
  position: number | null;
  /** Blackout: caught on this question; null for the winner and survivors. */
  caughtOnQuestion: number | null;
  wildCard: boolean;
}

/**
 * - blackout: the normal end, places from the chase
 * - wildcard: ended during the wild card round (the safe finalists by Round 1 rank)
 * - round1:   ended before the cut (the Round 1 ranking)
 */
export type PodiumBasis = "blackout" | "wildcard" | "round1";

/** The result of the quiz: what the Host's podium shows. */
export interface PodiumSummary {
  basis: PodiumBasis;
  /** Final order, winner first. */
  entries: PodiumEntry[];
  /** Audience members who backed the winner. */
  calledIt: number;
}

// ============================================================================
// What the HOST (projector) receives
// ============================================================================

export type HostStage =
  | { phase: "lobby" }
  | { phase: "r1Intro" }
  | { phase: "r1Read"; question: McqQuestion }
  | { phase: "r1Answer" | "r1TimesUp"; question: McqQuestion; answered: number; expected: number }
  | ({ phase: "r1Reveal"; question: McqQuestion } & Reveal)
  | { phase: "r1Results"; question: McqQuestion; options: OptionResult[]; answered: number; expected: number }
  | { phase: "r1Leaderboard"; question: McqQuestion; rows: LeaderRow[] }
  | {
      phase: "cut";
      /** Everyone ranked, best first. */
      standings: Standing[];
      safeCount: number;
      wildCardCount: number;
      /** Fewer than 10 played: everyone is a finalist, no wild card round. */
      wildCardSkipped: boolean;
    }
  | { phase: "wcIntro"; wildCard: WildCardState }
  | { phase: "wcRead" | "wcAnswer" | "wcTimesUp"; question: McqQuestion; wildCard: WildCardState }
  | ({ phase: "wcReveal"; question: McqQuestion; wildCard: WildCardState } & Reveal)
  | { phase: "wcStandings" | "wcWinner"; wildCard: WildCardState }
  | { phase: "predictions"; finalists: FinalistInfo[]; backing: Backing }
  | { phase: "boIntro"; blackout: BlackoutState; backing: Backing }
  | { phase: "boRead" | "boAnswer" | "boTimesUp"; question: McqQuestion; blackout: BlackoutState; answered: number; expected: number; backing: Backing }
  | ({ phase: "boReveal"; question: McqQuestion; blackout: BlackoutState; backing: Backing } & Reveal)
  | { phase: "boDark"; question: McqQuestion; blackout: BlackoutState; backing: Backing }
  /** The winner moment (7 s), then the podium by itself. */
  | { phase: "boWinner"; blackout: BlackoutState; backing: Backing }
  | ({ phase: "podium"; backing: Backing } & PodiumSummary);

export interface HostView {
  roomCode: string;
  /** Address phones open, e.g. http://192.168.1.5:3000/play */
  joinUrl: string;
  /** The quizmaster can hide the code (and QR) once everyone has joined. */
  roomCodeVisible: boolean;
  /** Host sound effects on/off (Admin toggle). */
  soundOn: boolean;
  settings: QuizSettings;
  /** Everyone who joined (not removed), in join order: the lobby wall. */
  participants: ParticipantTag[];
  /**
   * The bots across the top of the projector, each with its mood for the current
   * step (see BotMood). Lobby and Round 1: everyone. The cut: everyone ranked.
   * Wild card round: the wild card players only (the 9 safe are in
   * WildCardState.safe). Blackout and the podium: the 10 finalists. Removed
   * participants are left out.
   */
  cast: CastMember[];
  counts: Counts;
  timer: Timer | null;
  paused: boolean;
  serverNow: number;
  /** Image to preload for whatever question comes next. */
  nextImage: string | null;
  stage: HostStage;
}

// ============================================================================
// What each PARTICIPANT (phone) receives
// ============================================================================

/** A runner as an audience phone sees it (no correctness before the reveal). */
export interface RunnerLite extends ParticipantTag {
  mood: BotMood;
  gap: number;
  alive: boolean;
  place: number | null;
}

export type ParticipantScreen =
  /** Joined, waiting for the quiz to start. Build your bot here (participant:bot). */
  | { kind: "lobby"; joined: number }
  /** Round 1 is about to start. */
  | { kind: "r1Intro"; settings: QuizSettings }
  /** Joined while a question was open: plays from the next question. */
  | { kind: "nextQuestion" }
  /** Read time: the question is on the projector, options come next. */
  | {
      kind: "eyesUp";
      round: RoundNumber;
      questionNumber: number;
      /** null in Blackout (no fixed count). */
      questionCount: number | null;
      suddenDeath: boolean;
      /** Blackout runners: steps ahead of the dark. null in other rounds. */
      gap: number | null;
    }
  /** The 4 options in the Host's order (number = position + 1). Never a correct flag. First tap locks. */
  | {
      kind: "answer";
      round: RoundNumber;
      questionId: string;
      questionNumber: number;
      questionCount: number | null;
      suddenDeath: boolean;
      options: AnswerOption[];
      /** Blackout runners: steps ahead of the dark. null in other rounds. */
      gap: number | null;
    }
  /** Tapped; waiting. `timeUp` once the answer time has ended. */
  | {
      kind: "lockedIn";
      round: RoundNumber;
      /** 1–4: the number of the option they tapped. */
      choiceNumber: number;
      choiceText: string;
      timeUp: boolean;
      /** Blackout runners: steps ahead of the dark. null in other rounds. */
      gap: number | null;
    }
  /** Time ran out without an answer. */
  | { kind: "timesUp"; round: RoundNumber }
  /** After a Round 1 or wild card reveal: right or wrong (no points, no rank). */
  | {
      kind: "result";
      round: 1 | 2;
      outcome: "correct" | "wrong" | "missed";
      /** The right answer, for "It was …" (after the reveal only, so it's safe). */
      correctText: string;
      /** Wild card: "2 of 3 right". null in Round 1. (Not named "correct", so it can't be mistaken for an answer key.) */
      tally: { right: number; asked: number } | null;
    }
  /** The quizmaster cancelled the question. */
  | { kind: "voided"; round: RoundNumber }
  /** End of Round 1: the only time a phone shows its Round 1 rank. */
  | { kind: "cut"; outcome: "safe" | "wildcard"; rank: number; of: number; safeCount: number }
  /** A safe finalist while the wild card round runs. */
  | { kind: "safeWatch"; players: number; questionNumber: number; questionCount: number }
  /** A wild card player between questions (intro, standings). */
  | {
      kind: "wcStatus";
      /** Wild card questions they got right so far. */
      right: number;
      asked: number;
      questionCount: number;
      /** Sudden death: "in" = still in it, "out" = knocked out of it, null = not in sudden death. */
      suddenDeath: "in" | "out" | null;
    }
  /** Reveal wild card. */
  | { kind: "wcWinner"; you: "won" | "lost"; winner: ParticipantTag | null }
  /** Joined after the cut, or lost the wild card, before predictions open. */
  | { kind: "audience" }
  /** Audience: back one finalist (can change until Blackout starts). */
  | { kind: "backFinalist"; finalists: FinalistInfo[]; backedId: string | null }
  /** A runner after a Blackout reveal. */
  | {
      kind: "runnerResult";
      outcome: "correct" | "wrong" | "missed" | "voided";
      /** +3, +2, +1, 0 or −1 (0 when voided). */
      delta: number;
      position: number;
      /** Steps ahead of the dark. */
      gap: number;
      /** For "It was …" when wrong or missed. */
      correctText: string | null;
    }
  /**
   * A runner between questions: ready (before the first question), still running,
   * or caught (with the final place).
   */
  | {
      kind: "runnerStatus";
      alive: boolean;
      /** Steps ahead of the dark (alive), or how far behind it they ended. */
      gap: number;
      position: number;
      headStart: number;
      /** Caught just now (the dark's last move). */
      caughtNow: boolean;
      place: number | null;
      aliveCount: number;
      questionNumber: number;
      /** Blackout questions still available, or null. */
      questionsLeft: number | null;
      /**
       * What the running hold leads to (view.timer counts it down): the next
       * question, the winner moment, or the podium. null when nothing is queued.
       */
      nextUp: "question" | "winner" | "podium" | null;
    }
  /** Audience during Blackout. */
  | {
      kind: "blackoutWatch";
      backed: ParticipantTag | null;
      runners: RunnerLite[];
      alive: number;
      questionNumber: number;
      questionsLeft: number | null;
      /** The winner, once the chase is decided. */
      winner: ParticipantTag | null;
    }
  /** The quiz is over. */
  | {
      kind: "podium";
      basis: PodiumBasis;
      /** Finalists (or everyone, basis "round1"): their final place. Others: null. */
      place: number | null;
      /** How many places there are. */
      of: number;
      winner: ParticipantTag | null;
      /** Audience only: who they backed, and whether that was the winner. */
      backed: ParticipantTag | null;
      calledIt: boolean | null;
      round1Rank: number | null;
    }
  /** Removed by the quizmaster. */
  | { kind: "removed" };

export interface ParticipantView {
  roomCode: string;
  me: ParticipantTag & { status: ParticipantStatus };
  timer: Timer | null;
  paused: boolean;
  serverNow: number;
  screen: ParticipantScreen;
}

// ============================================================================
// What ADMIN (the quizmaster) receives
// ============================================================================

/**
 * Everything the quizmaster can do. Send with "admin:command".
 * "Next step" = whatever `AdminView.primary.action` is right now.
 */
export type AdminAction =
  // ---- the flow (the primary button sends one of these)
  | { type: "startQuiz" }
  | { type: "showQuestion" }
  | { type: "revealAnswer" }
  | { type: "showResults" }
  | { type: "showLeaderboard" }
  | { type: "nextQuestion" }
  | { type: "endRound1" }
  | { type: "startWildCard" }
  | { type: "showStandings" }
  | { type: "revealWildCard" }
  | { type: "openPredictions" }
  | { type: "startBlackout" }
  /** Never accepted since v3.1: the Blackout autopilot moves the dark by itself. Kept so old clients get "not-allowed". */
  | { type: "advanceDarkness" }
  /** Never accepted since v3.1: the autopilot shows the winner and the podium by itself. */
  | { type: "showWinner" }
  // ---- timers
  | { type: "pause" }
  | { type: "resume" }
  /** +ADD_TIME_MS on the running timer. */
  | { type: "addTime" }
  /** End the running timer now, as if it ran out. */
  | { type: "skipTimer" }
  // ---- fixing mistakes
  /** Cancel the current question: it doesn't count (see SPEC "Void question"). */
  | { type: "voidQuestion" }
  /** Undo the current question's effects and play it again from its read step. */
  | { type: "restartQuestion" }
  /** Round 1: back to 0 at the intro. Wild card: tallies to 0. Blackout: positions and the dark to the start. */
  | { type: "restartRound" }
  // ---- room
  | { type: "removeParticipant"; participantId: string }
  | { type: "setRoomCodeVisible"; visible: boolean }
  | { type: "setSound"; on: boolean }
  /** Straight to the podium with the standings as they are. */
  | { type: "endQuiz" };

export type AdminActionType = AdminAction["type"];

export const ADMIN_ACTION_TYPES: readonly AdminActionType[] = [
  "startQuiz",
  "showQuestion",
  "revealAnswer",
  "showResults",
  "showLeaderboard",
  "nextQuestion",
  "endRound1",
  "startWildCard",
  "showStandings",
  "revealWildCard",
  "openPredictions",
  "startBlackout",
  "advanceDarkness",
  "showWinner",
  "pause",
  "resume",
  "addTime",
  "skipTimer",
  "voidQuestion",
  "restartQuestion",
  "restartRound",
  "removeParticipant",
  "setRoomCodeVisible",
  "setSound",
  "endQuiz",
];

/**
 * Commands that apply whatever step the quiz is on, because sending them twice
 * changes nothing (resuming twice is still running). Every OTHER command,
 * Pause and Skip included, is ignored unless its stepId matches the current
 * step, so a double tap or two Admin devices can never skip two steps, and a
 * Pause aimed at a Blackout step that has already passed does nothing.
 */
export const STEP_INDEPENDENT_ACTIONS: readonly AdminActionType[] = [
  "resume",
  "removeParticipant",
  "setRoomCodeVisible",
  "setSound",
  "endQuiz",
];

/** The big button: does exactly what its label says. */
export interface PrimaryAction {
  action: AdminAction;
  label: string;
}

/** The current question, with the answer, for the quizmaster only. */
export interface AdminQuestion {
  id: string;
  round: RoundNumber;
  number: number;
  /** Planned questions in the round (null in Blackout). */
  count: number | null;
  suddenDeath: boolean;
  text: string;
  image: string | null;
  /** In the Host's 1–4 order. `count`: how many picked it, after the reveal (null before). */
  options: { number: number; text: string; correct: boolean; count: number | null }[];
  /** 1–4. */
  correctNumber: number;
  correctText: string;
  /** Cancelled by Void question: it doesn't count. */
  voided: boolean;
}

/** What "Show question" / "Next question" will put up next. */
export interface QuestionPreview {
  round: RoundNumber;
  number: number;
  count: number | null;
  suddenDeath: boolean;
  text: string;
  image: string | null;
  /** Its right answer (Admin only: the "Next up" card). */
  correctText: string;
}

/** Blackout's autopilot as Admin sees it. */
export interface AutopilotState {
  /** From Start Blackout until the podium. */
  running: boolean;
  paused: boolean;
  step: "intro" | "read" | "answer" | "timesUp" | "reveal" | "dark" | "winner";
  /** Time until the next step starts by itself (frozen while paused). */
  nextInMs: number | null;
  /** What starts next, for the autopilot strip: "Answers open", "Runners move", "The dark moves", "Next question", "Winner", "Podium". */
  nextLabel: string;
  questionNumber: number;
  /** Blackout questions still available after the current one. */
  questionsLeft: number;
}

/**
 * Admin only: where the dark goes next and who it would catch. During read /
 * answer / time's up it's "if nobody moves"; after the reveal it's exact.
 */
export interface DarkPreview {
  /** How far the dark moves next. */
  steps: number;
  /** The dark's position after it moves. */
  to: number;
  /** Runners it would catch. */
  catches: ParticipantTag[];
  /** true once the runners have moved (reveal): the preview is final. */
  exact: boolean;
}

export interface AdminParticipant extends ParticipantTag {
  status: ParticipantStatus;
  connected: boolean;
  /** Joined after the cut. */
  joinedLate: boolean;
  /** The quiz page is hidden on their phone right now. */
  pageHidden: boolean;
  /** Times they left the quiz page while a question was open. Admin only, never shown to anyone else. */
  leftPageCount: number;
  /** Round 1 score. */
  score: number;
  /** Round 1 rank (live during Round 1, frozen at the cut). null if they never played Round 1. */
  rank: number | null;
  /** Wild card correct answers (null if they didn't play it). */
  wildCorrect: number | null;
  wildTimeMs: number | null;
  isWildCard: boolean;
  /** Blackout (finalists, from Start Blackout): position, distance from the dark, catch, place. */
  blackout: { position: number; gap: number; caughtOnQuestion: number | null; place: number | null } | null;
  /** Answered the current question. null when no question is open for them. */
  answered: boolean | null;
  /** Audience: the finalist they back. */
  backingId: string | null;
}

export interface AdminView {
  roomCode: string;
  joinUrl: string;
  settings: QuizSettings;
  phase: Phase;
  /** Changes every time the step changes. Send it back with every command. */
  stepId: number;
  /** Where we are, in plain words: "Wild card, question 2 of 5: reveal". */
  stepLabel: string;
  /** The big button: always the main path. null while a Round 1 / wild card timer runs. Pause / Resume during the Blackout autopilot. */
  primary: PrimaryAction | null;
  /**
   * Optional steps, offered as small "or: Show results" chips above the big
   * button: Show results, Show leaderboard, Show standings, Open predictions.
   */
  optional: PrimaryAction[];
  /** One line under the button: what happens next, or why there's no button. */
  hint: string | null;
  /** Every action the server will accept right now. Grey out the rest. */
  allowed: AdminActionType[];
  timer: Timer | null;
  paused: boolean;
  serverNow: number;
  roomCodeVisible: boolean;
  soundOn: boolean;
  /** The current question with its correct answer, or null between questions. */
  question: AdminQuestion | null;
  nextQuestion: QuestionPreview | null;
  counts: Counts & {
    /** Current question: answered / expected. null outside an answer step. */
    answered: number | null;
    expected: number | null;
  };
  /** Everyone who ever joined, removed ones included, in join order. */
  participants: AdminParticipant[];
  /** The finalists (safe + wild card), from the cut onward (empty before). */
  finalists: FinalistInfo[];
  /** From the cut (when it runs) onward, with the full standings. */
  wildCard: WildCardState | null;
  /** From Start Blackout onward. */
  blackout: BlackoutState | null;
  /** The ranking at the cut (from End round 1 on; everyone, best first). null before the cut. */
  cut: { standings: Standing[]; safeCount: number; wildCardCount: number; wildCardSkipped: boolean } | null;
  /** Blackout's autopilot (boIntro to boWinner), else null. */
  autopilot: AutopilotState | null;
  /** During Blackout's read, answer, time's up and reveal steps; else null. */
  darkPreview: DarkPreview | null;
  backing: Backing | null;
  /** The final order, on the podium only (same as the Host's podium stage). */
  podium: PodiumSummary | null;
  /** The quiz this room is playing (a frozen copy, taken when the room was opened). */
  quizTitle: string;
}

// ============================================================================
// The quiz library (Admin creates and edits quizzes; a room plays a frozen copy)
// ============================================================================

/** Everything a quiz can set for itself. Seconds, not ms, so it reads naturally in the editor. */
export interface QuizRules {
  /** Round 1 questions played (the first N of the Round 1 list; the rest are spares). */
  round1Questions: number;
  round1ReadSeconds: number;
  /** Also the wild card round's read and answer times. */
  round1AnswerSeconds: number;
  /** Safe at the cut (9 at the event). */
  safe: number;
  /** Wild card questions (the first N of the Wild card list; the rest are spares for voids and sudden death). */
  wildCardQuestions: number;
  /* Blackout has no count: it plays its whole list, in order, until one runner is left. */
  blackoutReadSeconds: number;
  blackoutAnswerSeconds: number;
}

/** One question in the library. Always 4 options; shuffled once per question when played. */
export interface LibraryQuestion {
  /** Stable id inside the quiz (not shown to players; rooms use fresh opaque ids). */
  id: string;
  text: string;
  options: [string, string, string, string];
  /** Index (0–3) of the right option. */
  correct: number;
  /** "/images/<id>" served by the game server (or a /public path), shown on the Host only. */
  image: string | null;
  /** This question's read time, overriding the quiz's (null = use the quiz's). */
  readSeconds: number | null;
  /** This question's answer time, overriding the quiz's (null = use the quiz's). */
  openSeconds: number | null;
}

export interface Quiz {
  id: string;
  title: string;
  rules: QuizRules;
  /** Played top to bottom; the first rules.round1Questions count. */
  round1: LibraryQuestion[];
  /** Wild card round, top to bottom; the first rules.wildCardQuestions count, the rest are spares. */
  wildcard: LibraryQuestion[];
  /** Blackout, top to bottom, until one runner is left (the event needs at least 12; 15+ is safer). */
  blackout: LibraryQuestion[];
  /** ms since epoch. */
  updatedAt: number;
}

export interface QuizSummary {
  id: string;
  title: string;
  round1: number;
  wildcard: number;
  blackout: number;
  updatedAt: number;
  /** Problems that stop it being played (empty = ready). */
  problems: string[];
  /** The game server's minimum Blackout list (12 at the event, 8 in the demo): the editor checks it too. */
  blackoutMin: number;
}

/** A room that's open now (Admin's home screen, and where the Host attaches). */
export interface OpenRoomSummary {
  roomCode: string;
  quizTitle: string;
  phase: Phase;
  joined: number;
  /** ms since epoch. */
  openedAt: number;
}

export type SaveQuizResult = { ok: true; quiz: Quiz } | { ok: false; error: "not-signed-in" | "not-found" | "invalid"; problems?: string[] };

export type OpenRoomResult =
  | { ok: true; roomCode: string }
  | { ok: false; error: "not-signed-in" | "not-found" | "not-ready"; problems?: string[] };

export type HostAuthResult = { ok: true; roomCode: string } | { ok: false; error: "wrong-pin" | "no-room" };

/**
 * Question images are uploaded over HTTP (not Socket.IO, to keep socket messages small):
 *   POST {game server}{IMAGE_UPLOAD_PATH}, body = the image bytes (image/jpeg, image/png or image/webp),
 *   header IMAGE_PIN_HEADER = the Admin PIN  →  200 { url: "/images/<id>" }
 * The game server then serves GET /images/<id>. Use it as LibraryQuestion.image.
 */
export const IMAGE_UPLOAD_PATH = "/api/images";
export const IMAGE_PIN_HEADER = "x-admin-pin";

/** Limits the server enforces on a quiz (the editor shows them too). */
export const QUIZ_LIMITS = {
  title: 80,
  questionText: 300,
  optionText: 140,
  questionsPerList: 200,
  /** Uploaded image size after the editor shrinks it. */
  imageBytes: 2_500_000,
  safe: { min: 2, max: 20 },
  readSeconds: { min: 1, max: 60 },
  /** Answer time. */
  openSeconds: { min: 3, max: 120 },
} as const;

// ============================================================================
// Socket.IO events
// ============================================================================

export type JoinError = "room-not-found" | "name-taken" | "name-invalid" | "quiz-ended" | "removed" | "room-full";

export type JoinResult =
  | { ok: true; participantId: string; roomCode: string; status: ParticipantStatus }
  | { ok: false; error: JoinError };

/** invalid: not a colour or not a head · too-late: the quiz has started. (Nothing is ever "taken": bots can be shared.) */
export type BotError = "invalid" | "too-late";

export type BotResult = { ok: true } | { ok: false; error: BotError };

export type AdminAuthResult = { ok: true; roomCode: string } | { ok: false; error: "room-not-found" | "wrong-pin" };

export interface AdminCommandPayload {
  /** The AdminView.stepId this command was issued from. */
  stepId: number;
  action: AdminAction;
}

export type CommandResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * stale-step:    the step moved on before this arrived (double tap, second device); nothing happened
       * not-allowed:   that action doesn't apply to this step
       * not-signed-in: this socket hasn't passed admin:auth
       * invalid:       malformed command
       */
      reason: "stale-step" | "not-allowed" | "not-signed-in" | "invalid";
    };

/** Events browsers send to the server. */
export interface ClientToServerEvents {
  // ---- Host
  /**
   * The projector signs in with the Admin PIN and shows a room: `roomCode` if given and open,
   * otherwise the most recently opened room. "no-room": nothing is open yet (ask again shortly).
   * Rooms are opened by Admin (admin:openRoom).
   */
  "host:auth": (payload: { pin: string; roomCode?: string }, ack: (result: HostAuthResult) => void) => void;

  // ---- Participant
  /**
   * Join with a name, or rejoin with the participantId saved from an earlier join.
   * Typing the same name again also rejoins, if that person's phone is disconnected.
   */
  "participant:join": (
    payload: { roomCode: string; name: string; participantId?: string },
    ack: (result: JoinResult) => void,
  ) => void;
  /**
   * Lobby only: change this participant's bot. Any "#rrggbb" colour (the server
   * brightens very dark ones) and any head; others may have the same bot.
   * Rejected only if it isn't a colour/head ("invalid") or the quiz started ("too-late").
   */
  "participant:bot": (payload: BotLook, ack: (result: BotResult) => void) => void;
  /**
   * Every round. First tap wins; later taps are ignored, and so is an answer from
   * anyone who can't answer the current question (finalists in the wild card
   * round, caught runners, the audience).
   */
  "participant:answer": (payload: { questionId: string; optionId: string }) => void;
  /** Audience backs a finalist (can change until Blackout starts). */
  "participant:back": (payload: { finalistId: string }) => void;
  /** The quiz page was hidden/shown (switched app or tab). Flag for Admin only. */
  "participant:visibility": (payload: { hidden: boolean }) => void;

  // ---- Admin
  /** Sign in with the PIN only (quiz library, open rooms). After 5 wrong PINs the socket is refused. */
  "admin:login": (payload: { pin: string }, ack: (result: { ok: true } | { ok: false; error: "wrong-pin" }) => void) => void;
  /** Rooms open right now (needs admin:login). null = not signed in. */
  "admin:rooms": (ack: (rooms: OpenRoomSummary[] | null) => void) => void;
  /** Closes a room for good (phones, Admins and Hosts in it are told). Needs admin:login. */
  "admin:closeRoom": (payload: { roomCode: string }, ack: (result: { ok: boolean }) => void) => void;
  /** Opens a new room playing a frozen copy of this quiz, and signs this socket into it. */
  "admin:openRoom": (payload: { quizId: string }, ack: (result: OpenRoomResult) => void) => void;
  /** Quiz library (needs admin:login). null / not-signed-in when not signed in. */
  "library:list": (ack: (quizzes: QuizSummary[] | null) => void) => void;
  "library:get": (payload: { id: string }, ack: (quiz: Quiz | null) => void) => void;
  /** A new quiz with the server's default rules and no questions, already saved. */
  "library:create": (payload: { title: string }, ack: (result: SaveQuizResult) => void) => void;
  "library:duplicate": (payload: { id: string }, ack: (result: SaveQuizResult) => void) => void;
  /** Saves a quiz (create or replace by id). Drafts may be incomplete; opening a room needs it ready. */
  "library:save": (quiz: Quiz, ack: (result: SaveQuizResult) => void) => void;
  "library:delete": (payload: { id: string }, ack: (result: { ok: boolean }) => void) => void;

  // ---- Admin in a room (everything below needs admin:auth or admin:openRoom on this socket)
  /** Sign into a room (also signs in to the library). */
  "admin:auth": (payload: { roomCode: string; pin: string }, ack: (result: AdminAuthResult) => void) => void;
  "admin:command": (payload: AdminCommandPayload, ack: (result: CommandResult) => void) => void;
  /** Results as CSV text, for prizes. */
  "admin:results": (ack: (result: { csv: string; filename: string } | null) => void) => void;
}

/** Events the server sends to browsers. */
export interface ServerToClientEvents {
  "host:state": (view: HostView) => void;
  "participant:state": (view: ParticipantView) => void;
  "admin:state": (view: AdminView) => void;
  /** The room is gone (Host started a new one, or it was abandoned). */
  "room:closed": (payload: { reason: string }) => void;
  /**
   * Sent to every new connection. `bootId` changes each time the game server
   * starts, so a screen that reconnects to a different bootId knows the server
   * restarted and every room was lost (see SERVER_RESTARTED_MESSAGE).
   */
  "server:hello": (payload: { bootId: string }) => void;
}

// ============================================================================
// Messages
// ============================================================================

/** What every screen says when the game server restarted mid-quiz (rooms live in memory). */
export const SERVER_RESTARTED_MESSAGE = "The quiz server restarted, so the quiz has to start again.";

export const JOIN_ERROR_MESSAGES: Record<JoinError, string> = {
  "room-not-found": "No quiz with that code. Check the code on the projector.",
  "name-taken": 'Someone already joined with that name. Add your surname initial, like "Rahul S".',
  "name-invalid": `Enter your name (up to ${NAME_MAX_LENGTH} characters).`,
  "quiz-ended": "The quiz has ended.",
  removed: "You were removed from the quiz.",
  "room-full": "This quiz is full.",
};

export const BOT_ERROR_MESSAGES: Record<BotError, string> = {
  invalid: "That bot isn't available.",
  "too-late": "The quiz has started, so your bot is locked in.",
};

export const ADMIN_AUTH_ERROR_MESSAGES: Record<"room-not-found" | "wrong-pin", string> = {
  "room-not-found": "No quiz with that room code. Check the code on the Host screen.",
  "wrong-pin": "Wrong PIN.",
};
