/**
 * One room = one running game. This file is pure game logic: it knows nothing
 * about sockets, so it can be tested on its own (see server/simulate.ts).
 *
 * Flow:  lobby → [intro → answer → (vote → reveal) × matchups → scores] × rounds → end
 */
import { randomUUID } from "node:crypto";
import {
  ANSWER_MAX_LENGTH,
  type AnswerOption,
  type AnswerResult,
  DEFAULT_SETTINGS,
  type HostStage,
  type HostView,
  type JoinResult,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX_LENGTH,
  type Phase,
  PLAYER_COLORS,
  type PlayerScreen,
  type PlayerView,
  type RoomSettings,
  type RoundInfo,
  type RoundKind,
  type Timer,
} from "../src/shared/protocol";
import { DUEL_PROMPTS, FINAL_PROMPTS, PromptBag, shuffle } from "./prompts";

/** The three rounds of a game. Points per vote = 100 × multiplier. */
export const ROUNDS: { kind: RoundKind; multiplier: number }[] = [
  { kind: "duel", multiplier: 1 },
  { kind: "duel", multiplier: 2 },
  { kind: "final", multiplier: 3 },
];

/** Phase lengths in milliseconds. Answer and vote double with extended timers. */
export const TIMES = {
  intro: 4_000,
  answerDuel: 75_000,
  answerFinal: 60_000,
  voteDuel: 20_000,
  voteFinal: 30_000,
  revealDuel: 7_000,
  revealFinal: 10_000,
  scores: 8_000,
};

const POINTS_PER_VOTE = 100;
const SWEEP_BONUS = 250;
export const MISSING_ANSWER_TEXT = "Ran out of time";

/** Lets tests swap in a fake clock. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

interface Player {
  id: string;
  name: string;
  color: string;
  isVip: boolean;
  connected: boolean;
  score: number;
}

interface AudienceMember {
  id: string;
  name: string;
  connected: boolean;
}

interface Answer {
  id: string;
  authorId: string;
  text: string | null; // null until submitted
}

interface Prompt {
  id: string;
  text: string;
  authorIds: string[];
  answers: Answer[];
}

interface Matchup {
  prompt: Prompt;
  /** Answers in the order they're shown (shuffled so position doesn't give away the author). */
  answers: Answer[];
  /** voterId → answerId */
  playerVotes: Map<string, string>;
  audienceVotes: Map<string, string>;
  results: AnswerResult[] | null;
}

export class Room {
  readonly code: string;
  readonly hostToken = randomUUID();
  settings: RoomSettings = { ...DEFAULT_SETTINGS };

  private players: Player[] = [];
  private audience = new Map<string, AudienceMember>();
  private phase: Phase = "lobby";
  private roundIndex = 0;
  private prompts: Prompt[] = [];
  private matchups: Matchup[] = [];
  private matchupIndex = 0;
  private gains: Record<string, number> = {};

  private timer: Timer | null = null;
  private timeoutHandle: unknown = null;
  private onTimerEnd: (() => void) | null = null;

  private readonly duelPrompts: PromptBag;
  private readonly finalPrompts: PromptBag;

  constructor(
    code: string,
    private readonly joinUrl: string,
    /** Called after every state change so the server can push new views. */
    private readonly onChange: () => void,
    private readonly clock: Clock = realClock,
    private readonly random: () => number = Math.random,
  ) {
    this.code = code;
    this.duelPrompts = new PromptBag(DUEL_PROMPTS, random);
    this.finalPrompts = new PromptBag(FINAL_PROMPTS, random);
  }

  // -------------------------------------------------------------------------
  // Joining and leaving
  // -------------------------------------------------------------------------

  join(rawName: string, existingId?: string): JoinResult {
    const ok = (playerId: string, role: "player" | "audience"): JoinResult => ({
      ok: true,
      playerId,
      role,
      roomCode: this.code,
    });

    // 1. Same phone coming back (refresh, phone slept): reattach by id.
    if (existingId) {
      const player = this.players.find((p) => p.id === existingId);
      if (player) {
        player.connected = true;
        this.ensureVip();
        this.onChange();
        return ok(player.id, "player");
      }
      const member = this.audience.get(existingId);
      if (member) {
        member.connected = true;
        this.onChange();
        return ok(member.id, "audience");
      }
    }

    const name = cleanName(rawName);
    if (!name) return { ok: false, error: "name-invalid" };

    // 2. Same name as a player whose phone dropped: let them take it back.
    const sameName = this.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (sameName) {
      if (sameName.connected) return { ok: false, error: "name-taken" };
      sameName.connected = true;
      this.ensureVip();
      this.onChange();
      return ok(sameName.id, "player");
    }

    // 3. New player, while there's room in the lobby.
    if (this.phase === "lobby" && this.players.length < MAX_PLAYERS) {
      const player: Player = {
        id: randomUUID(),
        name,
        color: PLAYER_COLORS[this.players.length % PLAYER_COLORS.length],
        isVip: false,
        connected: true,
        score: 0,
      };
      this.players.push(player);
      this.ensureVip();
      this.onChange();
      return ok(player.id, "player");
    }

    // 4. Otherwise, the audience.
    if (this.settings.audienceEnabled) {
      const member: AudienceMember = { id: randomUUID(), name, connected: true };
      this.audience.set(member.id, member);
      this.onChange();
      return ok(member.id, "audience");
    }

    return { ok: false, error: this.phase === "lobby" ? "room-full" : "game-in-progress" };
  }

  disconnect(id: string) {
    const player = this.players.find((p) => p.id === id);
    if (player) {
      player.connected = false;
      if (this.phase === "lobby" && player.isVip) {
        player.isVip = false;
        this.ensureVip();
      }
      this.onChange();
      this.checkEarlyEnd();
      return;
    }
    const member = this.audience.get(id);
    if (member) {
      member.connected = false;
      this.onChange();
    }
  }

  get connectedCount() {
    return (
      this.players.filter((p) => p.connected).length +
      [...this.audience.values()].filter((a) => a.connected).length
    );
  }

  isPlayer(id: string) {
    return this.players.some((p) => p.id === id);
  }

  /** Exactly one VIP: the earliest-joined connected player (or the earliest player). */
  private ensureVip() {
    if (this.players.some((p) => p.isVip && p.connected)) return;
    const next = this.players.find((p) => p.connected) ?? this.players[0];
    for (const p of this.players) p.isVip = p === next;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  updateSettings(partial: Partial<RoomSettings>) {
    const next = { ...this.settings };
    if (typeof partial.extendedTimers === "boolean") next.extendedTimers = partial.extendedTimers;
    if (typeof partial.audienceEnabled === "boolean") next.audienceEnabled = partial.audienceEnabled;
    if (typeof partial.hideRoomCode === "boolean") next.hideRoomCode = partial.hideRoomCode;
    this.settings = next;
    this.onChange();
  }

  start(playerId: string) {
    const player = this.players.find((p) => p.id === playerId);
    if (this.phase !== "lobby" || !player?.isVip || this.players.length < MIN_PLAYERS) return;
    for (const p of this.players) p.score = 0;
    this.roundIndex = 0;
    this.startRound();
  }

  restart(playerId: string) {
    const player = this.players.find((p) => p.id === playerId);
    if (this.phase !== "end" || !player?.isVip) return;
    for (const p of this.players) p.score = 0;
    this.setPhase("lobby", null);
  }

  submitAnswer(playerId: string, promptId: string, rawText: string) {
    if (this.phase !== "answer") return;
    const text = rawText.trim().replace(/\s+/g, " ").slice(0, ANSWER_MAX_LENGTH);
    if (!text) return;
    const answer = this.prompts
      .find((p) => p.id === promptId)
      ?.answers.find((a) => a.authorId === playerId);
    if (!answer || answer.text !== null) return;
    answer.text = text;
    this.onChange();
    this.checkEarlyEnd();
  }

  vote(voterId: string, answerId: string) {
    if (this.phase !== "vote") return;
    const matchup = this.matchups[this.matchupIndex];
    const answer = matchup.answers.find((a) => a.id === answerId && a.text !== null);
    if (!answer) return;

    if (this.isPlayer(voterId)) {
      if (!this.canPlayerVote(voterId, matchup) || answer.authorId === voterId) return;
      if (matchup.playerVotes.has(voterId)) return;
      matchup.playerVotes.set(voterId, answerId);
    } else if (this.audience.has(voterId)) {
      if (matchup.audienceVotes.has(voterId)) return;
      matchup.audienceVotes.set(voterId, answerId);
    } else {
      return;
    }
    this.onChange();
    this.checkEarlyEnd();
  }

  /** Host's "skip" button: end the current timer now. */
  skip() {
    if (this.onTimerEnd) this.endTimerNow();
  }

  /** Stops timers when the room is deleted. */
  dispose() {
    if (this.timeoutHandle) this.clock.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
    this.onTimerEnd = null;
  }

  // -------------------------------------------------------------------------
  // Phase machine
  // -------------------------------------------------------------------------

  private get round(): RoundInfo {
    const r = ROUNDS[this.roundIndex];
    return { index: this.roundIndex, total: ROUNDS.length, kind: r.kind, multiplier: r.multiplier };
  }

  private scaled(ms: number) {
    return this.settings.extendedTimers ? ms * 2 : ms;
  }

  private setPhase(phase: Phase, durationMs: number | null, onEnd?: () => void) {
    if (this.timeoutHandle) this.clock.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
    this.phase = phase;
    if (durationMs !== null && onEnd) {
      this.timer = { endsAt: this.clock.now() + durationMs, durationMs };
      this.onTimerEnd = onEnd;
      this.timeoutHandle = this.clock.setTimeout(() => this.endTimerNow(), durationMs);
    } else {
      this.timer = null;
      this.onTimerEnd = null;
    }
    this.onChange();
  }

  private endTimerNow() {
    const next = this.onTimerEnd;
    if (this.timeoutHandle) this.clock.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
    this.onTimerEnd = null;
    this.timer = null;
    next?.();
  }

  private startRound() {
    this.gains = {};
    this.setPhase("intro", TIMES.intro, () => this.beginAnswering());
  }

  private beginAnswering() {
    const ids = shuffle(this.players.map((p) => p.id), this.random);
    const makePrompt = (text: string, authorIds: string[]): Prompt => ({
      id: randomUUID(),
      text,
      authorIds,
      answers: authorIds.map((authorId) => ({ id: randomUUID(), authorId, text: null })),
    });

    if (this.round.kind === "duel") {
      // Prompt i goes to player i and player i+1, so everyone answers exactly two.
      this.prompts = ids.map((id, i) =>
        makePrompt(this.duelPrompts.draw(), [id, ids[(i + 1) % ids.length]]),
      );
      this.setPhase("answer", this.scaled(TIMES.answerDuel), () => this.endAnswering());
    } else {
      this.prompts = [makePrompt(this.finalPrompts.draw(), ids)];
      this.setPhase("answer", this.scaled(TIMES.answerFinal), () => this.endAnswering());
    }
  }

  private endAnswering() {
    const matchups: Matchup[] = [];
    for (const prompt of this.prompts) {
      const written = prompt.answers.filter((a) => a.text !== null);
      if (written.length === 0) continue;
      const shown =
        this.round.kind === "duel"
          ? shuffle([...prompt.answers], this.random) // keep the blank one so it shows as a forfeit
          : shuffle(written, this.random);
      matchups.push({
        prompt,
        answers: shown,
        playerVotes: new Map(),
        audienceVotes: new Map(),
        results: null,
      });
    }
    this.matchups = shuffle(matchups, this.random);
    this.matchupIndex = 0;
    if (this.matchups.length === 0) this.showScores();
    else this.beginVote();
  }

  private beginVote() {
    const matchup = this.matchups[this.matchupIndex];
    const written = matchup.answers.filter((a) => a.text !== null);
    // A duel where one side never answered skips straight to the result.
    if (this.round.kind === "duel" && written.length < 2) {
      this.finishMatchup();
      return;
    }
    const ms = this.round.kind === "duel" ? TIMES.voteDuel : TIMES.voteFinal;
    this.setPhase("vote", this.scaled(ms), () => this.finishMatchup());
  }

  private finishMatchup() {
    const matchup = this.matchups[this.matchupIndex];
    matchup.results = this.score(matchup);
    for (const r of matchup.results) {
      const author = this.players.find((p) => p.id === r.authorId);
      if (!author) continue;
      author.score += r.points;
      this.gains[author.id] = (this.gains[author.id] ?? 0) + r.points;
    }
    const ms = this.round.kind === "duel" ? TIMES.revealDuel : TIMES.revealFinal;
    this.setPhase("reveal", ms, () => {
      this.matchupIndex += 1;
      if (this.matchupIndex < this.matchups.length) this.beginVote();
      else this.showScores();
    });
  }

  private showScores() {
    this.setPhase("scores", TIMES.scores, () => {
      this.roundIndex += 1;
      if (this.roundIndex < ROUNDS.length) this.startRound();
      else this.setPhase("end", null);
    });
  }

  private score(matchup: Matchup): AnswerResult[] {
    const mult = this.round.multiplier;
    const written = matchup.answers.filter((a) => a.text !== null);
    const forfeit = this.round.kind === "duel" && written.length < 2;
    const totalPlayerVotes = matchup.playerVotes.size;
    const totalAudienceVotes = matchup.audienceVotes.size;

    const results: AnswerResult[] = matchup.answers.map((a) => {
      const voterIds = [...matchup.playerVotes].filter(([, id]) => id === a.id).map(([v]) => v);
      const audienceVotes = [...matchup.audienceVotes.values()].filter((id) => id === a.id).length;
      let points = 0;
      let sweep = false;
      if (a.text !== null) {
        if (forfeit) {
          // Opponent didn't answer: win as if every eligible voter picked you.
          points = this.eligibleVoterIds(matchup).length * POINTS_PER_VOTE * mult;
        } else {
          points = voterIds.length * POINTS_PER_VOTE * mult;
          if (totalAudienceVotes > 0) {
            points += Math.round((audienceVotes / totalAudienceVotes) * POINTS_PER_VOTE * mult);
          }
          sweep =
            this.round.kind === "duel" &&
            totalPlayerVotes > 0 &&
            voterIds.length === totalPlayerVotes;
          if (sweep) points += SWEEP_BONUS * mult;
        }
      }
      return {
        id: a.id,
        text: a.text ?? MISSING_ANSWER_TEXT,
        authorId: a.authorId,
        voterIds,
        audienceVotes,
        points,
        isWinner: false,
        sweep,
      };
    });

    const best = Math.max(...results.map((r) => r.points));
    if (best > 0) for (const r of results) r.isWinner = r.points === best;
    return results;
  }

  // -------------------------------------------------------------------------
  // Who still needs to act (for ending phases early)
  // -------------------------------------------------------------------------

  private pendingPrompts(playerId: string) {
    return this.prompts.filter((p) =>
      p.answers.some((a) => a.authorId === playerId && a.text === null),
    );
  }

  private eligibleVoterIds(matchup: Matchup) {
    return this.players.filter((p) => this.canPlayerVote(p.id, matchup)).map((p) => p.id);
  }

  private canPlayerVote(playerId: string, matchup: Matchup) {
    // In a duel the two authors sit out. In the final everyone votes, just not for themselves.
    if (this.round.kind === "duel") return !matchup.prompt.authorIds.includes(playerId);
    return matchup.answers.some((a) => a.text !== null && a.authorId !== playerId);
  }

  /** Move on as soon as every connected player has done their part. */
  private checkEarlyEnd() {
    const connected = this.players.filter((p) => p.connected);
    if (this.phase === "answer") {
      if (connected.every((p) => this.pendingPrompts(p.id).length === 0)) this.endTimerNow();
    } else if (this.phase === "vote") {
      const matchup = this.matchups[this.matchupIndex];
      const waiting = connected.filter(
        (p) => this.canPlayerVote(p.id, matchup) && !matchup.playerVotes.has(p.id),
      );
      if (waiting.length === 0) this.endTimerNow();
    }
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  hostView(): HostView {
    return {
      roomCode: this.code,
      joinUrl: this.joinUrl,
      players: this.players.map((p) => ({ ...p })),
      audienceCount: [...this.audience.values()].filter((a) => a.connected).length,
      settings: { ...this.settings },
      timer: this.timer,
      serverNow: this.clock.now(),
      stage: this.hostStage(),
    };
  }

  private hostStage(): HostStage {
    switch (this.phase) {
      case "lobby":
        return { phase: "lobby" };
      case "intro":
        return { phase: "intro", round: this.round };
      case "answer":
        return {
          phase: "answer",
          round: this.round,
          submittedIds: this.players
            .filter((p) => this.pendingPrompts(p.id).length === 0)
            .map((p) => p.id),
        };
      case "vote": {
        const m = this.matchups[this.matchupIndex];
        return {
          phase: "vote",
          round: this.round,
          matchupIndex: this.matchupIndex,
          matchupCount: this.matchups.length,
          prompt: m.prompt.text,
          options: toOptions(m.answers),
          votedIds: [...m.playerVotes.keys()],
        };
      }
      case "reveal": {
        const m = this.matchups[this.matchupIndex];
        return {
          phase: "reveal",
          round: this.round,
          matchupIndex: this.matchupIndex,
          matchupCount: this.matchups.length,
          prompt: m.prompt.text,
          results: m.results ?? [],
        };
      }
      case "scores":
        return { phase: "scores", round: this.round, gains: { ...this.gains } };
      case "end": {
        const best = Math.max(...this.players.map((p) => p.score));
        return {
          phase: "end",
          winnerIds: this.players.filter((p) => p.score === best).map((p) => p.id),
        };
      }
    }
  }

  playerView(id: string): PlayerView | null {
    const player = this.players.find((p) => p.id === id);
    if (player) {
      return {
        roomCode: this.code,
        role: "player",
        me: {
          id: player.id,
          name: player.name,
          color: player.color,
          isVip: player.isVip,
          score: player.score,
        },
        timer: this.timer,
        serverNow: this.clock.now(),
        screen: this.playerScreen(player),
      };
    }
    const member = this.audience.get(id);
    if (member) {
      return {
        roomCode: this.code,
        role: "audience",
        me: { id: member.id, name: member.name, color: "#1B1340", isVip: false, score: 0 },
        timer: this.timer,
        serverNow: this.clock.now(),
        screen: this.audienceScreen(member),
      };
    }
    return null;
  }

  private playerScreen(player: Player): PlayerScreen {
    const lookUp: PlayerScreen = { kind: "wait", title: "Eyes on the TV" };
    switch (this.phase) {
      case "lobby":
        return {
          kind: "lobby",
          playerCount: this.players.length,
          canStart: player.isVip && this.players.length >= MIN_PLAYERS,
        };
      case "intro":
        return {
          kind: "wait",
          title: this.round.kind === "final" ? "Final round" : `Round ${this.round.index + 1}`,
          detail: "Get ready to type",
        };
      case "answer": {
        const assigned = this.prompts.filter((p) => p.authorIds.includes(player.id));
        const pending = this.pendingPrompts(player.id);
        if (pending.length === 0) {
          return { kind: "wait", title: "Answers sent", detail: "Waiting for everyone else" };
        }
        return {
          kind: "answer",
          promptId: pending[0].id,
          prompt: pending[0].text,
          step: assigned.length - pending.length + 1,
          steps: assigned.length,
        };
      }
      case "vote": {
        const m = this.matchups[this.matchupIndex];
        if (!this.canPlayerVote(player.id, m)) {
          return this.round.kind === "duel"
            ? { kind: "wait", title: "That's your answer up there", detail: "Everyone else is voting" }
            : { kind: "wait", title: "Nothing to vote on", detail: "Yours is the only answer" };
        }
        if (m.playerVotes.has(player.id)) {
          return { kind: "wait", title: "Vote locked in" };
        }
        const options = toOptions(m.answers).filter(
          (o) => m.answers.find((a) => a.id === o.id)?.authorId !== player.id,
        );
        return { kind: "vote", style: this.round.kind, prompt: m.prompt.text, options };
      }
      case "reveal":
      case "scores":
        return lookUp;
      case "end":
        return { kind: "end", rank: this.rankOf(player), canRestart: player.isVip };
    }
  }

  private audienceScreen(member: AudienceMember): PlayerScreen {
    if (this.phase === "lobby") {
      return { kind: "wait", title: "You're in the audience", detail: "You'll vote once the game starts" };
    }
    if (this.phase === "vote") {
      const m = this.matchups[this.matchupIndex];
      if (m.audienceVotes.has(member.id)) return { kind: "wait", title: "Vote locked in" };
      return { kind: "vote", style: this.round.kind, prompt: m.prompt.text, options: toOptions(m.answers) };
    }
    if (this.phase === "end") return { kind: "end", rank: null, canRestart: false };
    return { kind: "wait", title: "Eyes on the TV", detail: "Audience votes count too" };
  }

  private rankOf(player: Player) {
    return 1 + this.players.filter((p) => p.score > player.score).length;
  }

  /** Ids of everyone who should receive a player view. */
  memberIds(): string[] {
    return [...this.players.map((p) => p.id), ...this.audience.keys()];
  }
}

function toOptions(answers: Answer[]): AnswerOption[] {
  return answers.filter((a) => a.text !== null).map((a) => ({ id: a.id, text: a.text! }));
}

function cleanName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").slice(0, NAME_MAX_LENGTH);
}
