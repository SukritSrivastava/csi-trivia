/**
 * THE CONTRACT between the game server and every screen.
 *
 *   Projector  (/host)   receives HostView
 *   Phones     (/play)   each receive their OWN PlayerView
 *   Organiser  (/admin)  receives AdminView
 *
 * The server owns the game: timers, scoring, cuts, shuffling, the duel.
 * Screens never decide anything. They send an action ("I picked option x")
 * and draw whatever view arrives next.
 *
 * Backend: build the real server against this file. The mock server in
 * mock-server/ implements all of it, so use that as a working reference.
 * If something here has to change, change it in this file first and tell
 * the frontend; TypeScript will flag every screen that needs updating.
 *
 * Security rules the server must keep:
 *   1. A phone's view NEVER contains the correct answer before the reveal.
 *   2. Option ids are opaque (random per question), so they give nothing away.
 *   3. Each phone gets the 4 options in its own shuffled order.
 *   4. Answer times are measured on the server, never trusted from a phone.
 */

export const APP_NAME = "Hermes Quiz";

export const ROOM_CODE_LENGTH = 4;
/** Consonants only, so a random code can't spell a rude word. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const NAME_MAX_LENGTH = 20;

/** Name-tag colours, assigned in join order and repeated after 12. */
export const PLAYER_COLORS = [
  "#FF3D7F", // pink
  "#00A6A6", // teal
  "#7B5CFF", // violet
  "#FF6B1A", // orange
  "#1FA855", // green
  "#2D7FF9", // blue
  "#C2185B", // berry
  "#8D6E63", // cocoa
  "#E0457B", // rose
  "#0F8B8D", // deep teal
  "#5B3FD9", // indigo
  "#D9480F", // rust
] as const;

// ============================================================================
// Building blocks
// ============================================================================

/**
 * Every step of the night, in order:
 *
 *   lobby
 *   → for each round:
 *       roundIntro
 *       → for each question: read → answer → reveal → chart → leaderboard
 *       → roundEnd (the cut)
 *   → prediction (knocked-out players back a finalist)
 *   → duel (buzzer final, first to N points)
 *   → podium
 */
export type Phase =
  | "lobby"
  | "roundIntro"
  | "read"
  | "answer"
  | "reveal"
  | "chart"
  | "leaderboard"
  | "roundEnd"
  | "prediction"
  | "duel"
  | "podium";

/**
 * A countdown. Phones' clocks are often seconds off, so screens compute the
 * time left as `endsAt - (Date.now() + (serverNow - Date.now() at receipt))`.
 * While the game is paused, `remainingMs` is set and the countdown freezes.
 */
export interface Timer {
  /** Server clock time (ms) when this step ends. */
  endsAt: number;
  durationMs: number;
  /** Only set while paused: the frozen time left. */
  remainingMs?: number;
}

/**
 * - active:   still in the quiz
 * - out:      knocked out at a cut; now part of the audience
 * - audience: joined after Round 1 ended; watches and backs a finalist
 * - removed:  removed by the organiser
 */
export type PlayerStatus = "active" | "out" | "audience" | "removed";

export interface PlayerTag {
  id: string;
  name: string;
  color: string;
}

export interface LobbyPlayer extends PlayerTag {
  status: PlayerStatus;
  connected: boolean;
}

export interface RoundInfo {
  /** 1-based */
  number: number;
  totalRounds: number;
  /** Players starting this round. */
  playersIn: number;
  /** How many go through to the next stage. */
  advance: number;
  questionCount: number;
  secondsPerQuestion: number;
  /** Points lost for a wrong answer this round (0 = no penalty). */
  wrongPenalty: number;
}

/** What the projector shows of a question. Options are NOT shown while answering. */
export interface ProjectorQuestion {
  id: string;
  /** 1-based, within the round */
  number: number;
  count: number;
  text: string;
  /** Path under /public, e.g. "/questions/hexagon.svg", or null. */
  image: string | null;
}

/** One answer button. `id` is opaque; it says nothing about which one is right. */
export interface AnswerOption {
  id: string;
  text: string;
}

/** After the answer is revealed: how the room voted. */
export interface OptionResult {
  id: string;
  text: string;
  count: number;
  correct: boolean;
}

export interface LeaderRow extends PlayerTag {
  rank: number;
  /** Round score (every round starts at 0). */
  score: number;
  /** Rank before this question, null if they had no rank yet. */
  previousRank: number | null;
  /** Points won (or lost) on the question just played. */
  lastChange: number;
}

export interface Standing extends PlayerTag {
  rank: number;
  score: number;
  advanced: boolean;
}

export interface Finalist extends PlayerTag {
  points: number;
}

// ============================================================================
// The final duel
// ============================================================================

/**
 * One duel question goes through these steps:
 *
 *   read    question + 4 options on the projector (crowd plays along)
 *   buzz    both finalists can buzz (15s)
 *   answer  the buzzer says the answer out loud (10s); the organiser marks it
 *   steal   the buzzer was wrong, so they're in the DEATH ZONE: the other
 *           finalist gets one try (10s). Right = they win the whole duel.
 *   result  what happened, then the next question (or the podium)
 *
 * If the answer/steal timer runs out, the step waits for the organiser's mark.
 */
export type DuelStep = "read" | "buzz" | "answer" | "steal" | "result";

export type DuelOutcome =
  | { kind: "correct"; playerId: string } // +1 point
  | { kind: "steal"; playerId: string } // won the duel from the death zone
  | { kind: "bothWrong" }
  | { kind: "noBuzz" };

export interface DuelQuestion {
  /** 1-based */
  number: number;
  text: string;
  image: string | null;
  /** Shown on the projector in the duel, in A–D order. */
  options: string[];
}

export interface DuelState {
  finalists: [Finalist, Finalist];
  pointsToWin: number;
  step: DuelStep;
  question: DuelQuestion;
  /** Who buzzed first this question. */
  buzzedId: string | null;
  /** Who is in the death zone (buzzed and got it wrong). */
  deathZoneId: string | null;
  /** Set on the result step. */
  outcome: DuelOutcome | null;
  /** Set on the result step. */
  correctText: string | null;
  /** After the planned duel questions run out, the next correct answer wins. */
  suddenDeath: boolean;
}

// ============================================================================
// What the PROJECTOR receives
// ============================================================================

export type HostStage =
  | { phase: "lobby" }
  | { phase: "roundIntro"; round: RoundInfo }
  | { phase: "read"; round: RoundInfo; question: ProjectorQuestion }
  | {
      phase: "answer";
      round: RoundInfo;
      question: ProjectorQuestion;
      answeredCount: number;
      activeCount: number;
    }
  | { phase: "reveal"; round: RoundInfo; question: ProjectorQuestion; correctText: string; voided: boolean }
  | {
      phase: "chart";
      round: RoundInfo;
      question: ProjectorQuestion;
      options: OptionResult[];
      answeredCount: number;
      activeCount: number;
    }
  | { phase: "leaderboard"; round: RoundInfo; question: ProjectorQuestion; top: LeaderRow[] }
  | { phase: "roundEnd"; round: RoundInfo; standings: Standing[] }
  | {
      phase: "prediction";
      finalists: [PlayerTag, PlayerTag];
      /** finalist id → number of backers */
      backing: Record<string, number>;
      audienceCount: number;
    }
  | { phase: "duel"; duel: DuelState; backing: Record<string, number> }
  | {
      phase: "podium";
      winner: Finalist;
      runnerUp: Finalist;
      /** Audience members who backed the winner. */
      calledIt: number;
      backers: number;
    };

export interface HostView {
  roomCode: string;
  /** Address phones open, e.g. http://192.168.1.5:3000/play */
  joinUrl: string;
  /** Everyone who joined, for the lobby wall. */
  players: LobbyPlayer[];
  activeCount: number;
  audienceCount: number;
  timer: Timer | null;
  paused: boolean;
  serverNow: number;
  /** Image the projector should preload for the next question. */
  nextImage: string | null;
  stage: HostStage;
}

// ============================================================================
// What each PHONE receives
// ============================================================================

export type PlayerScreen =
  /** Joined, waiting for the quiz to start. */
  | { kind: "lobby"; playerCount: number }
  /** A round is about to start. `playing` is false for audience members. */
  | { kind: "roundIntro"; round: RoundInfo; playing: boolean }
  /** Read time: the question is on the projector, options appear next. */
  | { kind: "getReady"; questionNumber: number; questionCount: number }
  /** The 4 options in THIS phone's order. No correct flag, ever. */
  | {
      kind: "answer";
      questionId: string;
      questionNumber: number;
      questionCount: number;
      options: AnswerOption[];
    }
  /** Tapped. Waiting for the reveal. */
  | { kind: "lockedIn"; choiceText: string }
  /** After the reveal: right or wrong only (no points or rank here). */
  | { kind: "result"; outcome: "correct" | "wrong" | "missed"; penalty: number }
  /** End of a round: the only time a phone shows its rank. */
  | { kind: "roundResult"; rank: number; of: number; advanced: boolean; isFinalRound: boolean }
  /** Nothing to do right now (audience, knocked out, between steps). */
  | { kind: "watch"; title: string; detail?: string }
  /** Audience: back one finalist before the duel. */
  | { kind: "predict"; finalists: [PlayerTag, PlayerTag]; backedId: string | null }
  /** Finalist in the duel. */
  | {
      kind: "buzzer";
      step: DuelStep;
      canBuzz: boolean;
      me: Finalist;
      opponent: Finalist;
      pointsToWin: number;
      /** Who buzzed this question (may be me). */
      buzzedId: string | null;
      deathZoneId: string | null;
      outcome: DuelOutcome | null;
    }
  /** Everyone else during the duel. */
  | {
      kind: "duelWatch";
      step: DuelStep;
      finalists: [Finalist, Finalist];
      pointsToWin: number;
      backedId: string | null;
    }
  /** The quiz is over. */
  | {
      kind: "end";
      place: "winner" | "runnerUp" | "out" | "audience";
      /** The round they were knocked out in, if any. */
      outInRound: number | null;
      /** Audience: did their finalist win? null if they didn't back anyone. */
      calledIt: boolean | null;
      winnerName: string;
    }
  /** Removed by the organiser. */
  | { kind: "removed" };

export interface PlayerView {
  roomCode: string;
  me: PlayerTag & { status: PlayerStatus };
  timer: Timer | null;
  paused: boolean;
  serverNow: number;
  screen: PlayerScreen;
}

// ============================================================================
// What the ORGANISER page receives
// ============================================================================

export interface AdminPlayer extends LobbyPlayer {
  roundScore: number;
  /** How many times they left the quiz page while a question was open. */
  awayCount: number;
}

export interface AdminView {
  roomCode: string;
  phase: Phase;
  round: RoundInfo | null;
  /** e.g. "Question 3 of 10" or "Duel question 2" */
  stepLabel: string;
  paused: boolean;
  timer: Timer | null;
  serverNow: number;
  players: AdminPlayer[];
  /** The duel, so the judge sees who to mark. Null outside the duel. */
  duel: DuelState | null;
  /** True when a Correct / Wrong mark is expected. */
  awaitingJudge: boolean;
  /** Who the judge is marking right now. */
  judgingPlayerId: string | null;
  /** The correct answer, so the judge can mark spoken answers. Duel only. */
  duelAnswer: string | null;
  canStart: boolean;
}

// ============================================================================
// Socket.IO events
// ============================================================================

export type JoinError =
  | "room-not-found"
  | "name-taken"
  | "name-invalid"
  | "quiz-ended"
  | "removed";

export type JoinResult =
  | { ok: true; playerId: string; roomCode: string; status: PlayerStatus }
  | { ok: false; error: JoinError };

/** Events browsers send to the server. */
export interface ClientToServerEvents {
  // ---- Projector
  "host:create": (ack: (result: { roomCode: string; hostToken: string }) => void) => void;
  "host:resume": (
    payload: { roomCode: string; hostToken: string },
    ack: (result: { ok: boolean }) => void,
  ) => void;

  // ---- Phones
  /** Join, or rejoin with the playerId saved from an earlier join. */
  "player:join": (
    payload: { roomCode: string; name: string; playerId?: string },
    ack: (result: JoinResult) => void,
  ) => void;
  /** First tap wins; later taps are ignored. */
  "player:answer": (payload: { questionId: string; optionId: string }) => void;
  /** Audience backs a finalist (can change their mind until the duel starts). */
  "player:predict": (payload: { finalistId: string }) => void;
  /** Finalist presses the buzzer. */
  "player:buzz": () => void;
  /** Sent when the quiz page is hidden/shown. Flag for the organiser only. */
  "player:away": (payload: { away: boolean }) => void;

  // ---- Organiser (all need a successful admin:auth on this socket)
  "admin:auth": (
    payload: { roomCode: string; pin: string },
    ack: (result: { ok: boolean }) => void,
  ) => void;
  "admin:start": () => void;
  "admin:pause": () => void;
  "admin:resume": () => void;
  /** End the current step's timer now. */
  "admin:skip": () => void;
  /** Cancel the current question: nobody gains or loses points for it. */
  "admin:void": () => void;
  "admin:remove": (payload: { playerId: string }) => void;
  /** Scores back to 0 and replay the current round from its first question. */
  "admin:restartRound": () => void;
  /** Duel judge: mark the spoken answer. */
  "admin:judge": (payload: { correct: boolean }) => void;
  /** Results as CSV text (name, status, round reached, round scores). */
  "admin:results": (ack: (csv: string) => void) => void;
}

/** Events the server sends to browsers. */
export interface ServerToClientEvents {
  "host:state": (view: HostView) => void;
  "player:state": (view: PlayerView) => void;
  "admin:state": (view: AdminView) => void;
  "room:closed": (payload: { reason: string }) => void;
}

export const JOIN_ERROR_MESSAGES: Record<JoinError, string> = {
  "room-not-found": "No quiz with that code. Check the code on the projector.",
  "name-taken": "Someone already joined with that name. Add your surname initial, like \"Rahul S\".",
  "name-invalid": "Enter your name (up to 20 characters).",
  "quiz-ended": "This quiz has already finished.",
  removed: "The organiser removed you from this quiz.",
};
