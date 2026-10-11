/**
 * One quiz room: all the rules from docs/SPEC.md, with no socket code, so it
 * can be tested on its own (npm run simulate).
 *
 * lobby → [roundIntro → (read → answer → reveal → chart → leaderboard) × questions → roundEnd] × rounds
 *       → prediction → duel → podium
 */
import { randomUUID } from "node:crypto";
import {
  type AdminView,
  type AnswerOption,
  type DuelOutcome,
  type DuelState,
  type DuelStep,
  type Finalist,
  type HostStage,
  type HostView,
  type JoinResult,
  type LeaderRow,
  NAME_MAX_LENGTH,
  type Phase,
  PLAYER_COLORS,
  type PlayerScreen,
  type PlayerStatus,
  type PlayerTag,
  type PlayerView,
  type ProjectorQuestion,
  type RoundInfo,
  type Standing,
  type Timer,
} from "../src/shared/protocol";
import type { GameConfig } from "./config";
import { pickQuestions, type QuizQuestion } from "./questions";

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
  status: PlayerStatus;
  connected: boolean;
  roundScore: number;
  /** Total answer time this round, for tie-breaks (missed = full time limit). */
  roundTimeMs: number;
  outInRound: number | null;
  rankBefore: number | null;
  lastChange: number;
  away: boolean;
  awayCount: number;
  backing: string | null;
}

interface Answer {
  optionIndex: number;
  elapsedMs: number;
}

/** One question being played. */
interface QuestionRun {
  question: QuizQuestion;
  number: number;
  /** Opaque id for each option (same index as question.options). */
  optionIds: string[];
  /** Per-player shuffled order of option indexes. */
  orders: Map<string, number[]>;
  answers: Map<string, Answer>;
  /** Points actually applied per player, so a void can undo them. */
  applied: Map<string, { points: number; timeMs: number }>;
  scored: boolean;
  voided: boolean;
}

interface DuelRuntime {
  finalistIds: [string, string];
  points: Record<string, number>;
  questions: QuizQuestion[];
  index: number;
  step: DuelStep;
  buzzedId: string | null;
  deathZoneId: string | null;
  outcome: DuelOutcome | null;
  winnerId: string | null;
  awaitingJudge: boolean;
}

const randomId = () => randomUUID().replace(/-/g, "").slice(0, 10);

export class QuizRoom {
  readonly hostToken = randomUUID();

  private players: Player[] = [];
  private phase: Phase = "lobby";
  private roundIndex = 0;
  private roundQuestions: QuizQuestion[] = [];
  private questionIndex = 0;
  private run: QuestionRun | null = null;
  /** Ids active when the current round started (for "restart round"). */
  private roundEntrants: string[] = [];
  private standings: Standing[] = [];
  private duel: DuelRuntime | null = null;

  private timer: Timer | null = null;
  private timeoutHandle: unknown = null;
  private onTimerEnd: (() => void) | null = null;
  private paused = false;

  constructor(
    readonly code: string,
    private readonly joinUrl: string,
    private readonly config: GameConfig,
    private readonly questions: QuizQuestion[],
    private readonly onChange: () => void,
    private readonly clock: Clock = realClock,
    private readonly random: () => number = Math.random,
  ) {}

  // ==========================================================================
  // Joining
  // ==========================================================================

  join(rawName: string, existingId?: string): JoinResult {
    const ok = (p: Player): JoinResult => ({ ok: true, playerId: p.id, roomCode: this.code, status: p.status });

    if (existingId) {
      const known = this.players.find((p) => p.id === existingId);
      if (known) {
        if (known.status === "removed") return { ok: false, error: "removed" };
        known.connected = true;
        this.changed();
        return ok(known);
      }
    }

    const name = rawName.trim().replace(/\s+/g, " ").slice(0, NAME_MAX_LENGTH);
    if (!name) return { ok: false, error: "name-invalid" };

    const same = this.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same) {
      if (same.status === "removed") return { ok: false, error: "removed" };
      if (same.connected) return { ok: false, error: "name-taken" };
      // Same name, phone dropped: take the seat back.
      same.connected = true;
      this.changed();
      return ok(same);
    }

    if (this.phase === "podium") return { ok: false, error: "quiz-ended" };

    // Join as a player in the lobby or during Round 1; after that, the audience.
    const inRoundOne = this.roundIndex === 0 && this.phase !== "roundEnd" && this.phase !== "prediction" && this.phase !== "duel";
    const status: PlayerStatus = this.phase === "lobby" || inRoundOne ? "active" : "audience";
    const player: Player = {
      id: randomId(),
      name,
      color: PLAYER_COLORS[this.players.length % PLAYER_COLORS.length],
      status,
      connected: true,
      roundScore: 0,
      roundTimeMs: 0,
      outInRound: null,
      rankBefore: null,
      lastChange: 0,
      away: false,
      awayCount: 0,
      backing: null,
    };
    this.players.push(player);
    if (status === "active" && this.phase !== "lobby") this.roundEntrants.push(player.id);
    this.changed();
    return ok(player);
  }

  disconnect(id: string) {
    const p = this.find(id);
    if (!p) return;
    p.connected = false;
    this.changed();
    this.checkEveryoneAnswered();
  }

  setAway(id: string, away: boolean) {
    const p = this.find(id);
    if (!p || p.away === away) return;
    p.away = away;
    if (away && this.phase === "answer" && p.status === "active") p.awayCount += 1;
    this.changed();
  }

  // ==========================================================================
  // Player actions
  // ==========================================================================

  answer(playerId: string, questionId: string, optionId: string) {
    const p = this.find(playerId);
    const run = this.run;
    if (!p || !run || this.phase !== "answer" || this.paused || p.status !== "active") return;
    if (run.question.id !== questionId) return;
    if (run.answers.has(playerId)) return; // first tap wins
    const optionIndex = run.optionIds.indexOf(optionId);
    if (optionIndex === -1 || !this.timer) return;
    const elapsedMs = Math.max(0, this.timer.durationMs - (this.timer.endsAt - this.clock.now()));
    run.answers.set(playerId, { optionIndex, elapsedMs });
    this.changed();
    this.checkEveryoneAnswered();
  }

  predict(playerId: string, finalistId: string) {
    const p = this.find(playerId);
    if (!p || this.phase !== "prediction" || p.status === "active" || p.status === "removed") return;
    if (!this.duel?.finalistIds.includes(finalistId)) return;
    p.backing = finalistId;
    this.changed();
  }

  buzz(playerId: string) {
    const d = this.duel;
    if (!d || this.phase !== "duel" || d.step !== "buzz" || this.paused || d.buzzedId) return;
    if (!d.finalistIds.includes(playerId)) return;
    d.buzzedId = playerId;
    this.setDuelStep("answer", this.config.duel.answerMs, () => this.awaitJudge());
  }

  // ==========================================================================
  // Organiser actions
  // ==========================================================================

  get canStart() {
    return this.phase === "lobby" && this.players.filter((p) => p.status === "active").length >= this.config.minPlayers;
  }

  start() {
    if (!this.canStart) return;
    this.roundIndex = 0;
    this.beginRound();
  }

  pause() {
    if (this.paused || !this.timer) return;
    this.paused = true;
    const remainingMs = Math.max(0, this.timer.endsAt - this.clock.now());
    this.timer = { ...this.timer, remainingMs };
    this.clearTimeout();
    this.changed();
  }

  resume() {
    if (!this.paused || !this.timer) return;
    this.paused = false;
    const remaining = this.timer.remainingMs ?? 0;
    this.timer = { endsAt: this.clock.now() + remaining, durationMs: this.timer.durationMs };
    this.timeoutHandle = this.clock.setTimeout(() => this.endTimerNow(), remaining);
    this.changed();
  }

  skip() {
    if (this.paused) this.paused = false;
    if (this.onTimerEnd) this.endTimerNow();
  }

  /** Cancel the current question: undo any points it gave, then move on. */
  voidQuestion() {
    const run = this.run;
    if (!run || run.voided) return;
    if (!["read", "answer", "reveal", "chart", "leaderboard"].includes(this.phase)) return;
    this.paused = false;
    if (run.scored) {
      for (const [id, applied] of run.applied) {
        const p = this.find(id);
        if (!p) continue;
        p.roundScore = Math.max(0, p.roundScore - applied.points);
        p.roundTimeMs -= applied.timeMs;
        p.lastChange = 0;
      }
    }
    run.voided = true;
    this.setStep("reveal", this.config.timings.revealMs, () => this.nextQuestion());
  }

  remove(playerId: string) {
    const p = this.find(playerId);
    if (!p || p.status === "removed") return;
    if (this.duel?.finalistIds.includes(playerId) && (this.phase === "duel" || this.phase === "prediction")) return;
    p.status = "removed";
    this.changed();
    this.checkEveryoneAnswered();
  }

  restartRound() {
    if (!["roundIntro", "read", "answer", "reveal", "chart", "leaderboard", "roundEnd"].includes(this.phase)) return;
    this.paused = false;
    for (const id of this.roundEntrants) {
      const p = this.find(id);
      if (p && p.status !== "removed") {
        p.status = "active";
        p.outInRound = null;
      }
    }
    this.beginRound();
  }

  judge(correct: boolean) {
    const d = this.duel;
    if (!d || this.phase !== "duel" || (d.step !== "answer" && d.step !== "steal")) return;
    this.paused = false;
    const other = (id: string) => (d.finalistIds[0] === id ? d.finalistIds[1] : d.finalistIds[0]);

    if (d.step === "answer" && d.buzzedId) {
      if (correct) {
        d.points[d.buzzedId] += 1;
        d.outcome = { kind: "correct", playerId: d.buzzedId };
        if (d.points[d.buzzedId] >= this.config.duel.pointsToWin || this.suddenDeath) d.winnerId = d.buzzedId;
        this.showDuelResult();
      } else {
        d.deathZoneId = d.buzzedId;
        this.setDuelStep("steal", this.config.duel.stealMs, () => this.awaitJudge());
      }
      return;
    }

    if (d.step === "steal" && d.deathZoneId) {
      const stealer = other(d.deathZoneId);
      if (correct) {
        d.outcome = { kind: "steal", playerId: stealer };
        d.winnerId = stealer;
      } else {
        d.outcome = { kind: "bothWrong" };
      }
      this.showDuelResult();
    }
  }

  /** Results as CSV for prizes. */
  resultsCsv(): string {
    const winnerId = this.duel?.winnerId ?? null;
    const runnerUpId = winnerId && this.duel ? this.duel.finalistIds.find((id) => id !== winnerId) ?? null : null;
    const rows = this.players.map((p) => {
      const result =
        p.id === winnerId
          ? "Winner"
          : p.id === runnerUpId
            ? "Runner-up"
            : p.status === "out"
              ? `Out in round ${p.outInRound}`
              : p.status === "audience"
                ? "Audience"
                : p.status === "removed"
                  ? "Removed"
                  : "In play";
      return [p.name, result, String(p.roundScore), String(p.awayCount)];
    });
    const header = ["Name", "Result", "Last round score", "Left page"];
    return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  }

  dispose() {
    this.clearTimeout();
    this.onTimerEnd = null;
  }

  // ==========================================================================
  // The flow
  // ==========================================================================

  private get roundSettings() {
    return this.config.rounds[this.roundIndex];
  }

  private get isFinalRound() {
    return this.roundIndex === this.config.rounds.length - 1;
  }

  private get suddenDeath() {
    return (this.duel?.index ?? 0) >= this.config.duel.plannedQuestions;
  }

  private activePlayers() {
    return this.players.filter((p) => p.status === "active");
  }

  private beginRound() {
    const settings = this.roundSettings;
    this.roundQuestions = pickQuestions(this.questions, this.roundIndex + 1, settings.questions);
    this.questionIndex = 0;
    this.run = null;
    this.standings = [];
    const entrants = this.activePlayers();
    this.roundEntrants = entrants.map((p) => p.id);
    for (const p of entrants) {
      p.roundScore = 0;
      p.roundTimeMs = 0;
      p.rankBefore = null;
      p.lastChange = 0;
    }
    this.setStep("roundIntro", this.config.timings.roundIntroMs, () => this.beginQuestion());
  }

  private beginQuestion() {
    const question = this.roundQuestions[this.questionIndex];
    this.run = {
      question,
      number: this.questionIndex + 1,
      optionIds: question.options.map(() => randomId()),
      orders: new Map(),
      answers: new Map(),
      applied: new Map(),
      scored: false,
      voided: false,
    };
    this.setStep("read", this.config.timings.readMs, () => this.beginAnswer());
  }

  private beginAnswer() {
    for (const p of this.players) p.away = false;
    this.setStep("answer", this.roundSettings.seconds * 1000, () => this.endAnswer());
  }

  private endAnswer() {
    const run = this.run;
    if (!run) return;
    this.scoreQuestion(run);
    const t = this.config.timings;
    this.setStep("reveal", t.revealMs, () =>
      this.setStep("chart", t.chartMs, () => this.setStep("leaderboard", t.leaderboardMs, () => this.nextQuestion())),
    );
  }

  private nextQuestion() {
    this.questionIndex += 1;
    if (this.questionIndex < this.roundQuestions.length) this.beginQuestion();
    else this.endRound();
  }

  private scoreQuestion(run: QuestionRun) {
    const { maxPoints, minCorrectPoints } = this.config.scoring;
    const limitMs = this.roundSettings.seconds * 1000;
    const penalty = this.roundSettings.wrongPenalty;
    const ranked = this.rankRound();
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));

    for (const p of this.activePlayers()) {
      p.rankBefore = run.number === 1 ? null : rankOf.get(p.id) ?? null;
      const a = run.answers.get(p.id);
      let points = 0;
      let timeMs = limitMs;
      if (a) {
        timeMs = a.elapsedMs;
        if (a.optionIndex === run.question.correct) {
          const speed = 1 - Math.min(1, a.elapsedMs / limitMs);
          points = Math.round(minCorrectPoints + (maxPoints - minCorrectPoints) * speed);
        } else if (penalty > 0) {
          points = -Math.min(penalty, p.roundScore); // never below 0
        }
      }
      p.roundScore += points;
      p.roundTimeMs += timeMs;
      p.lastChange = points;
      run.applied.set(p.id, { points, timeMs });
    }
    run.scored = true;
  }

  /** Active players, best first: round score, then lower total answer time. */
  private rankRound(): Player[] {
    return this.activePlayers().sort((a, b) => b.roundScore - a.roundScore || a.roundTimeMs - b.roundTimeMs);
  }

  private endRound() {
    this.run = null;
    const ranked = this.rankRound();
    const advance = this.roundSettings.advance;
    this.standings = ranked.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      rank: i + 1,
      score: p.roundScore,
      advanced: i < advance,
    }));
    ranked.slice(advance).forEach((p) => {
      p.status = "out";
      p.outInRound = this.roundIndex + 1;
    });
    this.setStep("roundEnd", this.config.timings.roundEndMs, () => {
      if (this.isFinalRound || this.activePlayers().length <= 2) this.beginPrediction();
      else {
        this.roundIndex += 1;
        this.beginRound();
      }
    });
  }

  private beginPrediction() {
    const finalists = this.rankRound().slice(0, 2);
    if (finalists.length < 2) {
      // Not enough players left for a duel: crown whoever is left.
      const winner = finalists[0] ?? this.players[0];
      this.duel = this.newDuel([winner.id, winner.id]);
      this.duel.winnerId = winner.id;
      this.setStep("podium", null);
      return;
    }
    this.duel = this.newDuel([finalists[0].id, finalists[1].id]);
    this.setStep("prediction", this.config.timings.predictionMs, () => this.beginDuelQuestion());
  }

  private newDuel(ids: [string, string]): DuelRuntime {
    return {
      finalistIds: ids,
      points: { [ids[0]]: 0, [ids[1]]: 0 },
      questions: pickQuestions(this.questions, "duel", this.config.duel.plannedQuestions + 20),
      index: -1,
      step: "read",
      buzzedId: null,
      deathZoneId: null,
      outcome: null,
      winnerId: null,
      awaitingJudge: false,
    };
  }

  private beginDuelQuestion() {
    const d = this.duel!;
    d.index += 1;
    d.buzzedId = null;
    d.deathZoneId = null;
    d.outcome = null;
    this.phase = "duel";
    this.setDuelStep("read", this.config.duel.readMs, () =>
      this.setDuelStep("buzz", this.config.duel.buzzMs, () => {
        d.outcome = { kind: "noBuzz" };
        this.showDuelResult();
      }),
    );
  }

  private setDuelStep(step: DuelStep, ms: number | null, onEnd?: () => void) {
    const d = this.duel!;
    d.step = step;
    d.awaitingJudge = false;
    this.setStep("duel", ms, onEnd);
  }

  private awaitJudge() {
    const d = this.duel!;
    d.awaitingJudge = true;
    this.timer = null;
    this.changed();
  }

  private showDuelResult() {
    const d = this.duel!;
    this.setDuelStep("result", this.config.duel.resultMs, () => {
      if (d.winnerId) this.setStep("podium", null);
      else this.beginDuelQuestion();
    });
  }

  // ==========================================================================
  // Timers
  // ==========================================================================

  private setStep(phase: Phase, durationMs: number | null, onEnd?: () => void) {
    this.clearTimeout();
    this.phase = phase;
    this.paused = false;
    if (durationMs !== null && onEnd) {
      this.timer = { endsAt: this.clock.now() + durationMs, durationMs };
      this.onTimerEnd = onEnd;
      this.timeoutHandle = this.clock.setTimeout(() => this.endTimerNow(), durationMs);
    } else {
      this.timer = null;
      this.onTimerEnd = null;
    }
    this.changed();
  }

  private endTimerNow() {
    const next = this.onTimerEnd;
    this.clearTimeout();
    this.onTimerEnd = null;
    this.timer = null;
    next?.();
  }

  private clearTimeout() {
    if (this.timeoutHandle) this.clock.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private checkEveryoneAnswered() {
    if (this.phase !== "answer" || !this.run || this.paused) return;
    const connected = this.activePlayers().filter((p) => p.connected);
    // If every phone dropped at once (Wi-Fi blip), let the timer run instead of racing ahead.
    if (connected.length === 0) return;
    if (connected.every((p) => this.run!.answers.has(p.id))) this.endTimerNow();
  }

  private changed() {
    this.onChange();
  }

  private find(id: string) {
    return this.players.find((p) => p.id === id);
  }

  // ==========================================================================
  // Views
  // ==========================================================================

  private roundInfo(): RoundInfo {
    const s = this.roundSettings;
    return {
      number: this.roundIndex + 1,
      totalRounds: this.config.rounds.length,
      playersIn: this.roundEntrants.filter((id) => this.find(id)?.status !== "removed").length,
      advance: s.advance,
      questionCount: s.questions,
      secondsPerQuestion: s.seconds,
      wrongPenalty: s.wrongPenalty,
    };
  }

  private projectorQuestion(run: QuestionRun): ProjectorQuestion {
    return {
      id: run.question.id,
      number: run.number,
      count: this.roundQuestions.length,
      text: run.question.text,
      image: run.question.image,
    };
  }

  private optionsFor(run: QuestionRun, playerId: string): AnswerOption[] {
    let order = run.orders.get(playerId);
    if (!order) {
      order = shuffle([0, 1, 2, 3], this.random);
      run.orders.set(playerId, order);
    }
    return order.map((i) => ({ id: run.optionIds[i], text: run.question.options[i] }));
  }

  private tag(p: Player): PlayerTag {
    return { id: p.id, name: p.name, color: p.color };
  }

  private finalist(id: string): Finalist {
    const p = this.find(id)!;
    return { ...this.tag(p), points: this.duel?.points[id] ?? 0 };
  }

  private backing(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const id of this.duel?.finalistIds ?? []) counts[id] = 0;
    for (const p of this.players) if (p.backing && p.backing in counts) counts[p.backing] += 1;
    return counts;
  }

  private duelState(): DuelState | null {
    const d = this.duel;
    if (!d || d.index < 0) return null;
    const q = d.questions[d.index];
    return {
      finalists: [this.finalist(d.finalistIds[0]), this.finalist(d.finalistIds[1])],
      pointsToWin: this.config.duel.pointsToWin,
      step: d.step,
      question: { number: d.index + 1, text: q.text, image: q.image, options: [...q.options] },
      buzzedId: d.buzzedId,
      deathZoneId: d.deathZoneId,
      outcome: d.step === "result" ? d.outcome : null,
      correctText: d.step === "result" ? q.options[q.correct] : null,
      suddenDeath: this.suddenDeath,
    };
  }

  private leaderboard(): LeaderRow[] {
    return this.rankRound()
      .slice(0, this.config.leaderboardSize)
      .map((p, i) => ({ ...this.tag(p), rank: i + 1, score: p.roundScore, previousRank: p.rankBefore, lastChange: p.lastChange }));
  }

  private hostStage(): HostStage {
    const run = this.run;
    switch (this.phase) {
      case "lobby":
        return { phase: "lobby" };
      case "roundIntro":
        return { phase: "roundIntro", round: this.roundInfo() };
      case "read":
        return { phase: "read", round: this.roundInfo(), question: this.projectorQuestion(run!) };
      case "answer":
        return {
          phase: "answer",
          round: this.roundInfo(),
          question: this.projectorQuestion(run!),
          answeredCount: run!.answers.size,
          activeCount: this.activePlayers().length,
        };
      case "reveal":
        return {
          phase: "reveal",
          round: this.roundInfo(),
          question: this.projectorQuestion(run!),
          correctText: run!.question.options[run!.question.correct],
          voided: run!.voided,
        };
      case "chart": {
        const counts = [0, 0, 0, 0];
        for (const a of run!.answers.values()) counts[a.optionIndex] += 1;
        return {
          phase: "chart",
          round: this.roundInfo(),
          question: this.projectorQuestion(run!),
          options: run!.question.options.map((text, i) => ({
            id: run!.optionIds[i],
            text,
            count: counts[i],
            correct: i === run!.question.correct,
          })),
          answeredCount: run!.answers.size,
          activeCount: this.activePlayers().length,
        };
      }
      case "leaderboard":
        return { phase: "leaderboard", round: this.roundInfo(), question: this.projectorQuestion(run!), top: this.leaderboard() };
      case "roundEnd":
        return { phase: "roundEnd", round: this.roundInfo(), standings: this.standings };
      case "prediction": {
        const d = this.duel!;
        return {
          phase: "prediction",
          finalists: [this.tag(this.find(d.finalistIds[0])!), this.tag(this.find(d.finalistIds[1])!)],
          backing: this.backing(),
          audienceCount: this.players.filter((p) => p.status === "out" || p.status === "audience").length,
        };
      }
      case "duel":
        return { phase: "duel", duel: this.duelState()!, backing: this.backing() };
      case "podium": {
        const d = this.duel!;
        const winnerId = d.winnerId!;
        const runnerUpId = d.finalistIds.find((id) => id !== winnerId) ?? winnerId;
        const backers = this.players.filter((p) => p.backing).length;
        const calledIt = this.players.filter((p) => p.backing === winnerId).length;
        return { phase: "podium", winner: this.finalist(winnerId), runnerUp: this.finalist(runnerUpId), calledIt, backers };
      }
    }
  }

  hostView(): HostView {
    const visible = this.players.filter((p) => p.status !== "removed");
    let nextImage: string | null = null;
    if (this.phase !== "lobby" && this.roundQuestions.length) {
      const next = this.phase === "roundIntro" ? this.roundQuestions[0] : this.roundQuestions[this.questionIndex + 1];
      nextImage = next?.image ?? null;
    }
    return {
      roomCode: this.code,
      joinUrl: this.joinUrl,
      players: visible.map((p) => ({ ...this.tag(p), status: p.status, connected: p.connected })),
      activeCount: this.activePlayers().length,
      audienceCount: visible.filter((p) => p.status === "out" || p.status === "audience").length,
      timer: this.timer,
      paused: this.paused,
      serverNow: this.clock.now(),
      nextImage,
      stage: this.hostStage(),
    };
  }

  playerView(id: string): PlayerView | null {
    const p = this.find(id);
    if (!p) return null;
    return {
      roomCode: this.code,
      me: { ...this.tag(p), status: p.status },
      timer: this.timer,
      paused: this.paused,
      serverNow: this.clock.now(),
      screen: this.playerScreen(p),
    };
  }

  private playerScreen(p: Player): PlayerScreen {
    if (p.status === "removed") return { kind: "removed" };
    if (this.phase === "podium") return this.endScreen(p);
    if (this.phase === "lobby") return { kind: "lobby", playerCount: this.players.filter((x) => x.status !== "removed").length };

    if (this.phase === "prediction") {
      const d = this.duel!;
      if (p.status === "active") {
        return { kind: "watch", title: "You're in the final!", detail: "Get ready to buzz. First to 3 wins." };
      }
      return {
        kind: "predict",
        finalists: [this.tag(this.find(d.finalistIds[0])!), this.tag(this.find(d.finalistIds[1])!)],
        backedId: p.backing,
      };
    }

    if (this.phase === "duel") {
      const d = this.duel!;
      const state = this.duelState()!;
      if (d.finalistIds.includes(p.id)) {
        const me = this.finalist(p.id);
        const opponent = this.finalist(d.finalistIds.find((x) => x !== p.id)!);
        return {
          kind: "buzzer",
          step: d.step,
          canBuzz: d.step === "buzz" && !d.buzzedId && !this.paused,
          me,
          opponent,
          pointsToWin: this.config.duel.pointsToWin,
          buzzedId: d.buzzedId,
          deathZoneId: d.deathZoneId,
          outcome: state.outcome,
        };
      }
      return {
        kind: "duelWatch",
        step: d.step,
        finalists: state.finalists,
        pointsToWin: this.config.duel.pointsToWin,
        backedId: p.backing,
      };
    }

    // Rounds
    if (p.status === "active") {
      const run = this.run;
      switch (this.phase) {
        case "roundIntro":
          return { kind: "roundIntro", round: this.roundInfo(), playing: true };
        case "read":
          return { kind: "getReady", questionNumber: run!.number, questionCount: this.roundQuestions.length };
        case "answer": {
          const a = run!.answers.get(p.id);
          if (a) return { kind: "lockedIn", choiceText: run!.question.options[a.optionIndex] };
          return {
            kind: "answer",
            questionId: run!.question.id,
            questionNumber: run!.number,
            questionCount: this.roundQuestions.length,
            options: this.optionsFor(run!, p.id),
          };
        }
        case "reveal":
        case "chart":
        case "leaderboard": {
          if (run!.voided) return { kind: "watch", title: "Question cancelled", detail: "No points for anyone. Next one's coming." };
          const a = run!.answers.get(p.id);
          const outcome = !a ? "missed" : a.optionIndex === run!.question.correct ? "correct" : "wrong";
          const change = run!.applied.get(p.id)?.points ?? 0;
          return { kind: "result", outcome, penalty: change < 0 ? -change : 0 };
        }
        case "roundEnd":
          return this.roundResult(p);
      }
    }

    if (this.phase === "roundEnd" && p.status === "out" && p.outInRound === this.roundIndex + 1) {
      return this.roundResult(p);
    }

    if (this.phase === "roundIntro") return { kind: "roundIntro", round: this.roundInfo(), playing: false };

    if (p.status === "out") {
      return {
        kind: "watch",
        title: "You're out",
        detail: `You made it to round ${p.outInRound}. Stay for the final: you'll get to back a finalist.`,
      };
    }
    return { kind: "watch", title: "You're in the audience", detail: "Watch the projector. You'll back a finalist before the final duel." };
  }

  private roundResult(p: Player): PlayerScreen {
    const s = this.standings.find((x) => x.id === p.id);
    return {
      kind: "roundResult",
      rank: s?.rank ?? this.standings.length,
      of: this.standings.length,
      advanced: s?.advanced ?? false,
      isFinalRound: this.isFinalRound,
    };
  }

  private endScreen(p: Player): PlayerScreen {
    const d = this.duel!;
    const winnerId = d.winnerId!;
    const winnerName = this.find(winnerId)?.name ?? "";
    const place = p.id === winnerId ? "winner" : d.finalistIds.includes(p.id) ? "runnerUp" : p.status === "out" ? "out" : "audience";
    return {
      kind: "end",
      place,
      outInRound: p.outInRound,
      calledIt: place === "winner" || place === "runnerUp" ? null : p.backing ? p.backing === winnerId : null,
      winnerName,
    };
  }

  adminView(): AdminView {
    const d = this.duel;
    const duel = this.phase === "duel" ? this.duelState() : null;
    const judging =
      this.phase === "duel" && d
        ? d.step === "answer"
          ? d.buzzedId
          : d.step === "steal" && d.deathZoneId
            ? d.finalistIds.find((id) => id !== d.deathZoneId) ?? null
            : null
        : null;
    let stepLabel = "Waiting in the lobby";
    if (this.run && ["read", "answer", "reveal", "chart", "leaderboard"].includes(this.phase)) {
      stepLabel = `Round ${this.roundIndex + 1}, question ${this.run.number} of ${this.roundQuestions.length} (${this.phase})`;
    } else if (this.phase === "roundIntro") stepLabel = `Round ${this.roundIndex + 1} intro`;
    else if (this.phase === "roundEnd") stepLabel = `End of round ${this.roundIndex + 1}`;
    else if (this.phase === "prediction") stepLabel = "Audience backing a finalist";
    else if (this.phase === "duel" && d) stepLabel = `Duel question ${d.index + 1} (${d.step})`;
    else if (this.phase === "podium") stepLabel = "Finished";

    const q = d && d.index >= 0 ? d.questions[d.index] : null;
    return {
      roomCode: this.code,
      phase: this.phase,
      round: this.phase === "lobby" || this.phase === "prediction" || this.phase === "duel" || this.phase === "podium" ? null : this.roundInfo(),
      stepLabel,
      paused: this.paused,
      timer: this.timer,
      serverNow: this.clock.now(),
      players: this.players.map((p) => ({
        ...this.tag(p),
        status: p.status,
        connected: p.connected,
        roundScore: p.roundScore,
        awayCount: p.awayCount,
      })),
      duel,
      awaitingJudge: this.phase === "duel" && !!d && (d.step === "answer" || d.step === "steal"),
      judgingPlayerId: judging,
      duelAnswer: this.phase === "duel" && q ? q.options[q.correct] : null,
      canStart: this.canStart,
    };
  }

  memberIds(): string[] {
    return this.players.map((p) => p.id);
  }
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
