import type { AdminActionType } from "@/shared/protocol";

/** Button text for every Admin action, in plain words. */
export const ACTION_LABELS: Record<AdminActionType, string> = {
  startQuiz: "Start quiz",
  showQuestion: "Show question",
  revealAnswer: "Reveal answer",
  showResults: "Show results",
  showLeaderboard: "Show leaderboard",
  nextQuestion: "Next question",
  endRound1: "End round 1",
  startWildCard: "Start wild card round",
  showStandings: "Show standings",
  revealWildCard: "Reveal wild card",
  openPredictions: "Open predictions",
  startBlackout: "Start Blackout",
  // Never allowed since v3.1 (the Blackout autopilot does these); kept for the contract.
  advanceDarkness: "Advance the darkness",
  showWinner: "Show winner",
  pause: "Pause",
  resume: "Resume",
  addTime: "+5 seconds",
  skipTimer: "Skip",
  voidQuestion: "Void question",
  restartQuestion: "Restart question",
  restartRound: "Restart round",
  removeParticipant: "Remove",
  setRoomCodeVisible: "Show/hide room code",
  setSound: "Sound on/off",
  endQuiz: "End quiz now",
};

/** Actions that can't be undone easily: Admin asks for a second tap. */
export const DESTRUCTIVE_ACTIONS: readonly AdminActionType[] = [
  "voidQuestion",
  "restartQuestion",
  "restartRound",
  "endQuiz",
  "removeParticipant",
];

/** What a refused command means, in plain words. Empty = say nothing (the screen has already caught up). */
export const COMMAND_ERROR_TEXT: Record<string, string> = {
  "stale-step": "",
  "not-allowed": "That step already happened, or it isn't possible right now.",
  "not-signed-in": "You're signed out. Sign in again.",
  invalid: "The server didn't understand that command.",
  "no-reply": "No reply from the quiz server. Check the connection and try again.",
  "double-tap": "",
};
