/**
 * THE CONTRACT between the game server and every screen (rules: docs/SPEC.md v2).
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
 *   3. The 4 options are shuffled once per question run. In Round 1 the Host and
 *      every phone show that same order, numbered 1–4 (like Murder Trivia).
 *   4. Answer times are measured on the server, never trusted from a phone.
 *   5. Admin flow commands carry the stepId they were issued from. If the
 *      step has moved on, ignore the command (see AdminCommandPayload).
 *   6. The quizmaster drives the flow. Timers only run where SPEC says so,
 *      and when a timer ends the game holds and waits for the next click.
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
// The flow
// ============================================================================

/**
 * Every step of the quiz, in order. (click) = the quizmaster's click on Admin,
 * (timer) = runs by itself once started.
 *
 *   lobby
 *   → r1Intro                                   (click: Start quiz)
 *   → for each Round 1 question:
 *       r1Read        8s, question on Host, "Eyes up" on phones    (click: Show question / Next question)
 *       r1Answer      8s, options on phones; ends early when every
 *                     connected participant has answered           (timer)
 *       r1TimesUp     holds                                        (timer)
 *       r1Reveal      correct answer; phones show right / wrong    (click: Reveal answer)
 *       r1Results     how many picked each option (optional)       (click: Show results)
 *       r1Leaderboard top 10 (optional)                            (click: Show leaderboard)
 *   → cut           full ranking, cut line under 6th               (click: End round 1)
 *   → predictions   audience backs a finalist                      (click: Open predictions)
 *   → r2Intro       the finalists, the buzzer rules                (click: Start buzzer round)
 *   → for each buzzer question:
 *       r2Read        question + A–D on Host, buzzers locked (5s)  (click: Show question / Next question)
 *       r2BuzzOpen    buzzers open (15s; 10s when reopened)        (timer)
 *       r2Answering   first buzz; they say the answer out loud,
 *                     10s countdown that never marks anything      (a buzz)
 *       → Correct → r2Reveal                                       (click: Correct)
 *       → Wrong   → r2BuzzOpen again for the others, or r2Reveal
 *                   if nobody is left                              (click: Wrong)
 *       r2BuzzOpen ends with no buzz → r2Reveal, nobody scores     (timer)
 *       r2Scores      the finalists' points (optional)             (click: Show scores)
 *   → suddenDeath   tie for 1st after the last question; only the
 *                   tied finalists buzz, first correct answer wins (click: Start sudden death)
 *                   (its questions use the r2 steps with suddenDeath: true)
 *   → podium                                                       (click: Show winner, or End quiz now)
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
  | "predictions"
  | "r2Intro"
  | "r2Read"
  | "r2BuzzOpen"
  | "r2Answering"
  | "r2Reveal"
  | "r2Scores"
  | "suddenDeath"
  | "podium";

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
 * - playing:  in Round 1 (everyone who joins before Round 1 ends)
 * - finalist: made the top 6 at the cut; plays the buzzer round
 * - audience: cut after Round 1, or joined after it; backs a finalist
 * - removed:  removed by the quizmaster; can't rejoin
 */
export type ParticipantStatus = "playing" | "finalist" | "audience" | "removed";

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
  audience: number;
  removed: number;
}

/** Fixed settings of this quiz (from the server's preset), for intros and labels. */
export interface QuizSettings {
  preset: "event" | "demo";
  round1Questions: number;
  round1ReadSeconds: number;
  round1AnswerSeconds: number;
  finalistCount: number;
  round2Questions: number;
  round2ReadSeconds: number;
  buzzSeconds: number;
  answerSeconds: number;
  reopenSeconds: number;
}

// ============================================================================
// Round 1 pieces
// ============================================================================

/** A Round 1 question as the Host shows it. */
export interface Round1Question {
  /** Opaque id of this question run. Changes on "restart question". */
  id: string;
  /** 1-based within Round 1. */
  number: number;
  count: number;
  text: string;
  /** Path under /public, e.g. "/questions/hexagon.svg", or null. */
  image: string | null;
  /**
   * The 4 options, numbered 1–4 in this order, from the answer step on. null in
   * the read step. Every phone shows them in this same order with the same numbers.
   * Never says which one is right (that's `correctText` on the reveal).
   */
  options: string[] | null;
}

/** One answer button on a phone. `id` is opaque; it says nothing about which one is right. */
export interface AnswerOption {
  id: string;
  text: string;
}

/** Results bar chart: how many picked each option (after the reveal only). */
export interface OptionResult {
  letter: OptionLetter;
  text: string;
  count: number;
  correct: boolean;
}

export interface LeaderRow extends ParticipantTag {
  rank: number;
  score: number;
  /** Rank before this question, null if they had none yet (first question, late joiner). */
  previousRank: number | null;
  /** Points won on the question just played. */
  change: number;
}

/** One line of the end-of-Round-1 ranking. */
export interface Standing extends ParticipantTag {
  rank: number;
  score: number;
  /** Above the cut line. */
  finalist: boolean;
}

// ============================================================================
// Round 2 (buzzer) pieces
// ============================================================================

/** A buzzer question. The options ARE shown on the Host (A–D) so the room can play along. */
export interface BuzzerQuestion {
  /** Opaque id of this question run. Phones send it with a buzz. */
  id: string;
  /** 1-based. Sudden-death questions count from 1 again. */
  number: number;
  /** Planned questions in the round (sudden death: 0, open-ended). */
  count: number;
  suddenDeath: boolean;
  text: string;
  image: string | null;
  /** In A–D order (shuffled once per question, the same for everyone). */
  options: string[];
}

export interface FinalistState extends ParticipantTag {
  points: number;
  /** Seat order on screen = their Round 1 rank among finalists (1 = top). */
  seat: number;
  connected: boolean;
  /** Buzzed and was marked wrong on this question. */
  lockedOut: boolean;
  /** Takes part in this question (false for non-tied finalists in sudden death). */
  inPlay: boolean;
}

export type BuzzOutcome =
  | { kind: "correct"; by: ParticipantTag }
  /** allWrong: everyone in play was marked wrong. timeUp: buzz window ended with no buzz. */
  | { kind: "nobody"; reason: "allWrong" | "timeUp" }
  /** The quizmaster voided the question: no points either way. */
  | { kind: "voided" };

export interface Round2State {
  question: BuzzerQuestion;
  finalists: FinalistState[];
  /** Who has the turn right now (only during r2Answering). */
  buzzedBy: ParticipantTag | null;
  /** The spoken-answer countdown ran out; waiting for Correct / Wrong. */
  answerTimeUp: boolean;
  /** Marked wrong on this question, in order. */
  wrong: ParticipantTag[];
  /** Set on r2Reveal only. */
  outcome: BuzzOutcome | null;
  /** Set on r2Reveal only. */
  correct: { letter: OptionLetter; text: string } | null;
  /** Sudden death decided. */
  winner: ParticipantTag | null;
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
  /** Buzzer points (basis "buzzer") or Round 1 score (basis "round1"). */
  points: number;
  round1Rank: number | null;
}

// ============================================================================
// What the HOST (projector) receives
// ============================================================================

export type HostStage =
  | { phase: "lobby" }
  | { phase: "r1Intro" }
  | { phase: "r1Read"; question: Round1Question }
  | { phase: "r1Answer"; question: Round1Question; answered: number; expected: number }
  | { phase: "r1TimesUp"; question: Round1Question; answered: number; expected: number }
  | {
      phase: "r1Reveal";
      question: Round1Question;
      /** null when the question was voided */
      correctText: string | null;
      voided: boolean;
    }
  | { phase: "r1Results"; question: Round1Question; options: OptionResult[]; answered: number; expected: number }
  | { phase: "r1Leaderboard"; question: Round1Question; rows: LeaderRow[] }
  | { phase: "cut"; standings: Standing[] }
  | { phase: "predictions"; finalists: FinalistState[]; backing: Backing }
  | { phase: "r2Intro"; finalists: FinalistState[]; backing: Backing }
  | { phase: "r2Read" | "r2BuzzOpen" | "r2Answering" | "r2Reveal"; round2: Round2State; backing: Backing }
  | {
      phase: "r2Scores";
      /** Sorted by points, best first. */
      finalists: FinalistState[];
      questionNumber: number;
      questionCount: number;
      suddenDeath: boolean;
      backing: Backing;
    }
  | { phase: "suddenDeath"; tied: FinalistState[]; backing: Backing }
  | {
      phase: "podium";
      /** "buzzer": finalists by buzzer points. "round1": the quiz was ended before the cut. */
      basis: "buzzer" | "round1";
      /** Final order. The Host puts 1–3 on the podium and the rest below. */
      entries: PodiumEntry[];
      /** Audience members who backed the winner. */
      calledIt: number;
      backing: Backing;
    };

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
   * The bots across the top of the projector, in join order, each with its mood
   * for the current step (see BotMood). Removed participants are left out.
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

/** Buzzer-round sub-step, for phones. */
export type Round2Step = "intro" | "read" | "buzzOpen" | "answering" | "reveal" | "scores" | "suddenDeath";

/** What every phone sees of the buzzer round. */
export interface Round2Phone {
  step: Round2Step;
  /** Send this with a buzz. null outside a question. */
  questionId: string | null;
  questionNumber: number | null;
  questionCount: number;
  suddenDeath: boolean;
  finalists: FinalistState[];
  buzzedBy: ParticipantTag | null;
  wrong: ParticipantTag[];
  outcome: BuzzOutcome | null;
  winner: ParticipantTag | null;
}

export type ParticipantScreen =
  /** Joined, waiting for the quiz to start. Build your bot here (participant:bot): any colour, any head. */
  | { kind: "lobby"; joined: number }
  /** Round 1 is about to start. */
  | { kind: "r1Intro"; settings: QuizSettings }
  /** Joined while a question was open: plays from the next question. */
  | { kind: "nextQuestion" }
  /** Read time: the question is on the projector, options come next. */
  | { kind: "eyesUp"; questionNumber: number; questionCount: number }
  /** The 4 options in the Host's order (number = position + 1). Never a correct flag. First tap locks. */
  | { kind: "answer"; questionId: string; questionNumber: number; questionCount: number; options: AnswerOption[] }
  /** Tapped; waiting. `timeUp` once the answer time has ended. */
  | { kind: "lockedIn"; choiceText: string; timeUp: boolean }
  /** Time ran out without an answer. */
  | { kind: "timesUp" }
  /** After the reveal: right or wrong only (no points, no rank). */
  | {
      kind: "result";
      outcome: "correct" | "wrong" | "missed";
      /** The right answer, for "It was …" (after the reveal only, so it's safe). */
      correctText: string;
    }
  /** The quizmaster cancelled the question. */
  | { kind: "voided" }
  /** End of Round 1: the only time a phone shows its rank. */
  | { kind: "cut"; madeIt: boolean; rank: number; of: number; finalistCount: number }
  /** Joined after Round 1: watching until predictions open. */
  | { kind: "audience" }
  /** Audience: back one finalist (can change until the buzzer round starts). */
  | { kind: "backFinalist"; finalists: FinalistState[]; backedId: string | null }
  /** Finalist, before the buzzer round starts. */
  | { kind: "finalist"; seat: number; finalistCount: number }
  /** Finalist during the buzzer round. */
  | (Round2Phone & {
      kind: "buzzer";
      /** Show the big BUZZ button as live. */
      canBuzz: boolean;
      /** This finalist takes part in this question (sudden death: only the tied ones). */
      inPlay: boolean;
      lockedOut: boolean;
      points: number;
      /** This finalist's own result on the current question. */
      myResult: "correct" | "wrong" | null;
    })
  /** Audience during the buzzer round. */
  | (Round2Phone & { kind: "buzzerWatch"; backedId: string | null })
  /** The quiz is over. */
  | {
      kind: "podium";
      basis: "buzzer" | "round1";
      /** Finalists (or everyone, basis "round1"): their final place. Audience: null. */
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
  | { type: "openPredictions" }
  | { type: "startBuzzerRound" }
  | { type: "showScores" }
  | { type: "startSuddenDeath" }
  | { type: "showWinner" }
  // ---- judging the buzzer round
  | { type: "markCorrect" }
  | { type: "markWrong" }
  /** Reverts the last Correct / Wrong (the point and the lockout) and goes back to judging. */
  | { type: "undoMark" }
  // ---- timers
  | { type: "pause" }
  | { type: "resume" }
  /** +ADD_TIME_MS on the running timer (or a fresh 5s on the spoken-answer countdown). */
  | { type: "addTime" }
  /** End the running timer now, as if it ran out. */
  | { type: "skipTimer" }
  // ---- fixing mistakes
  /** Cancel the current question: nobody gains or loses points. */
  | { type: "voidQuestion" }
  /** Undo the current question's points and play it again from its read step. */
  | { type: "restartQuestion" }
  /** Round 1: everyone back to 0, back to the Round 1 intro. Round 2: points to 0, back to its intro. */
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
  "openPredictions",
  "startBuzzerRound",
  "showScores",
  "startSuddenDeath",
  "showWinner",
  "markCorrect",
  "markWrong",
  "undoMark",
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
 * changes nothing (pausing twice is still paused). Every OTHER command is
 * ignored unless its stepId matches the current step, so a double tap or two
 * Admin devices can never skip two steps or mark one answer twice.
 */
export const STEP_INDEPENDENT_ACTIONS: readonly AdminActionType[] = [
  "pause",
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
  round: 1 | 2;
  number: number;
  /** Planned questions in the round (sudden death: 0). */
  count: number;
  suddenDeath: boolean;
  text: string;
  image: string | null;
  /** In the Host's A–D order. */
  options: { letter: OptionLetter; text: string; correct: boolean }[];
  correctLetter: OptionLetter;
  correctText: string;
}

/** What "Show question" / "Next question" will put up next. */
export interface QuestionPreview {
  round: 1 | 2;
  number: number;
  count: number;
  suddenDeath: boolean;
  text: string;
  image: string | null;
}

export interface AdminParticipant extends ParticipantTag {
  status: ParticipantStatus;
  connected: boolean;
  /** Joined after Round 1 ended. */
  joinedLate: boolean;
  /** The quiz page is hidden on their phone right now. */
  pageHidden: boolean;
  /** Times they left the quiz page while a question was open. Admin only, never shown to anyone else. */
  leftPageCount: number;
  /** Round 1 score. */
  score: number;
  /** Round 1 rank (live during Round 1, final after the cut). null if they never played Round 1. */
  rank: number | null;
  /** Buzzer-round points (finalists). */
  points: number;
  /** Answered the current Round 1 question. null when no Round 1 question is open for them. */
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
  /** Where we are, in plain words: "Round 1, question 3 of 20: answering". */
  stepLabel: string;
  /** The big button. null while a timer runs or a mark is awaited. */
  primary: PrimaryAction | null;
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
    /** Current Round 1 question: answered / expected. null outside answering. */
    answered: number | null;
    expected: number | null;
  };
  /** Everyone who ever joined, removed ones included, in join order. */
  participants: AdminParticipant[];
  /** The current buzzer question, while one is on (r2Read through r2Reveal). */
  round2: Round2State | null;
  /** The finalists with live points, from the cut onward (empty before). */
  finalists: FinalistState[];
  backing: Backing | null;
  /** "Undo last mark" is possible right now. */
  canUndo: boolean;
  /** The last Correct / Wrong on this question (for the undo button label). */
  lastMark: { by: ParticipantTag; correct: boolean } | null;
  /** The final order, on the podium only (same as the Host's podium stage), so the quizmaster can announce it. */
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
  round1AnswerSeconds: number;
  /** How many make the cut into the buzzer round. */
  finalists: number;
  /** Buzzer questions that count (the first N of the buzzer list; the rest are spares for voids and sudden death). */
  buzzerQuestions: number;
  buzzerReadSeconds: number;
  buzzWindowSeconds: number;
  /** The countdown while a finalist says their answer out loud (never marks anything). */
  spokenAnswerSeconds: number;
  /** Buzz window after a wrong answer, for the others. */
  reopenSeconds: number;
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
  /** Round 1: answer time. Buzzer round: buzz window. null = use the quiz's. */
  openSeconds: number | null;
}

export interface Quiz {
  id: string;
  title: string;
  rules: QuizRules;
  /** Played top to bottom; the first rules.round1Questions count. */
  round1: LibraryQuestion[];
  /** Played top to bottom; the first rules.buzzerQuestions count, the rest are spares. */
  buzzer: LibraryQuestion[];
  /** ms since epoch. */
  updatedAt: number;
}

export interface QuizSummary {
  id: string;
  title: string;
  round1: number;
  buzzer: number;
  updatedAt: number;
  /** Problems that stop it being played (empty = ready). */
  problems: string[];
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
  finalists: { min: 2, max: 12 },
  readSeconds: { min: 1, max: 60 },
  /** Answer time, buzz window, spoken answer, reopen. */
  openSeconds: { min: 3, max: 120 },
} as const;

/** The result of the quiz: what the Host's podium shows. */
export interface PodiumSummary {
  basis: "buzzer" | "round1";
  /** Final order, winner first. */
  entries: PodiumEntry[];
  /** Audience members who backed the winner. */
  calledIt: number;
}

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
  /** Round 1. First tap wins; later taps are ignored. */
  "participant:answer": (payload: { questionId: string; optionId: string }) => void;
  /** Buzzer round. First buzz of the window wins the turn. */
  "participant:buzz": (payload: { questionId: string }) => void;
  /** Audience backs a finalist (can change until the buzzer round starts). */
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
  "quiz-ended": "This quiz has already finished.",
  removed: "The quizmaster removed you from this quiz.",
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
