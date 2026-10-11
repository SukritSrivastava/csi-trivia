/**
 * The contract between the game server and both screens.
 *
 * Every event name and payload shape lives here, and the server, the TV
 * (/host) and the phones (/play) all import from this one file. If you change
 * something here, TypeScript will point at every place that needs updating.
 *
 * Rule of thumb: the server owns the game. Screens never decide anything;
 * they send an action ("I voted for B") and draw whatever view comes back.
 */

export const APP_NAME = "Roomful"; // working title, rename freely

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const NAME_MAX_LENGTH = 12;
export const ANSWER_MAX_LENGTH = 45;
export const ROOM_CODE_LENGTH = 4;

/** Consonants only, so a random code can never spell a rude word. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** One colour per player slot, in join order. */
export const PLAYER_COLORS = [
  "#FF3D7F", // pink
  "#00A6A6", // teal
  "#7B5CFF", // violet
  "#FF6B1A", // orange
  "#1FA855", // green
  "#2D7FF9", // blue
  "#C2185B", // berry
  "#8D6E63", // cocoa
] as const;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export type Phase = "lobby" | "intro" | "answer" | "vote" | "reveal" | "scores" | "end";

/** "duel": pairs of players answer the same prompt and go head to head.
 *  "final": everyone answers one prompt and everyone votes. */
export type RoundKind = "duel" | "final";

export interface RoomSettings {
  /** Doubles answer and vote timers. Good for new players or laggy video calls. */
  extendedTimers: boolean;
  /** Late joiners (or anyone past 8 players) can vote from the audience. */
  audienceEnabled: boolean;
  /** Hides the room code on the TV once the game starts (for streams). */
  hideRoomCode: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  extendedTimers: false,
  audienceEnabled: true,
  hideRoomCode: false,
};

export interface Timer {
  /** Server clock time (ms) when the phase ends. */
  endsAt: number;
  durationMs: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  isVip: boolean;
  connected: boolean;
  score: number;
}

export interface RoundInfo {
  index: number; // 0-based
  total: number;
  kind: RoundKind;
  multiplier: number;
}

export interface AnswerOption {
  id: string;
  text: string;
}

export interface AnswerResult extends AnswerOption {
  authorId: string;
  /** Player ids who voted for this answer. */
  voterIds: string[];
  audienceVotes: number;
  points: number;
  isWinner: boolean;
  /** Every player vote went to this answer. */
  sweep: boolean;
}

// ---------------------------------------------------------------------------
// What the TV receives
// ---------------------------------------------------------------------------

export type HostStage =
  | { phase: "lobby" }
  | { phase: "intro"; round: RoundInfo }
  | { phase: "answer"; round: RoundInfo; submittedIds: string[] }
  | {
      phase: "vote";
      round: RoundInfo;
      matchupIndex: number;
      matchupCount: number;
      prompt: string;
      options: AnswerOption[];
      votedIds: string[];
    }
  | {
      phase: "reveal";
      round: RoundInfo;
      matchupIndex: number;
      matchupCount: number;
      prompt: string;
      results: AnswerResult[];
    }
  | { phase: "scores"; round: RoundInfo; gains: Record<string, number> }
  | { phase: "end"; winnerIds: string[] };

export interface HostView {
  roomCode: string;
  /** Address phones should open, e.g. http://192.168.1.5:3000/play */
  joinUrl: string;
  players: PublicPlayer[];
  audienceCount: number;
  settings: RoomSettings;
  timer: Timer | null;
  serverNow: number;
  stage: HostStage;
}

// ---------------------------------------------------------------------------
// What each phone receives (every phone gets its own private view)
// ---------------------------------------------------------------------------

export type Role = "player" | "audience";

export type PlayerScreen =
  | {
      kind: "lobby";
      playerCount: number;
      /** Only true for the VIP once enough players are in. */
      canStart: boolean;
    }
  | { kind: "answer"; promptId: string; prompt: string; step: number; steps: number }
  | { kind: "vote"; style: RoundKind; prompt: string; options: AnswerOption[] }
  | { kind: "wait"; title: string; detail?: string }
  | { kind: "end"; rank: number | null; canRestart: boolean };

export interface PlayerView {
  roomCode: string;
  role: Role;
  me: {
    id: string;
    name: string;
    color: string;
    isVip: boolean;
    score: number;
  };
  timer: Timer | null;
  serverNow: number;
  screen: PlayerScreen;
}

// ---------------------------------------------------------------------------
// Socket.IO events
// ---------------------------------------------------------------------------

export type JoinError =
  | "room-not-found"
  | "name-taken"
  | "name-invalid"
  | "game-in-progress"
  | "room-full";

export type JoinResult =
  | { ok: true; playerId: string; role: Role; roomCode: string }
  | { ok: false; error: JoinError };

export interface CreateRoomResult {
  roomCode: string;
  hostToken: string;
}

/** Events the browser sends to the server. */
export interface ClientToServerEvents {
  // TV
  "host:create": (ack: (result: CreateRoomResult) => void) => void;
  "host:resume": (
    payload: { roomCode: string; hostToken: string },
    ack: (result: { ok: boolean }) => void,
  ) => void;
  "host:settings": (settings: Partial<RoomSettings>) => void;
  /** Ends the current timer early. Handy while testing alone. */
  "host:skip": () => void;

  // Phone
  "player:join": (
    payload: { roomCode: string; name: string; playerId?: string },
    ack: (result: JoinResult) => void,
  ) => void;
  "player:start": () => void;
  "player:answer": (payload: { promptId: string; text: string }) => void;
  "player:vote": (payload: { answerId: string }) => void;
  "player:restart": () => void;
}

/** Events the server sends to the browser. */
export interface ServerToClientEvents {
  "host:state": (view: HostView) => void;
  "player:state": (view: PlayerView) => void;
  "room:closed": (payload: { reason: string }) => void;
}

export const JOIN_ERROR_MESSAGES: Record<JoinError, string> = {
  "room-not-found": "No game with that code. Check the code on the TV.",
  "name-taken": "Someone already has that name. Pick another.",
  "name-invalid": "Enter a name (up to 12 characters).",
  "game-in-progress": "This game has already started.",
  "room-full": "This game is full.",
};
