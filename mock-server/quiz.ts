/**
 * One quiz room: every rule from docs/SPEC.md (v2), with no socket code, so it
 * can be tested on its own (npm run simulate).
 *
 * The quizmaster drives the flow through `command()`. Timers only run where
 * SPEC says so (Round 1 read → answer; Round 2 read → buzz window → spoken
 * answer countdown), and when one ends the room holds for the next click.
 *
 * Views are built on demand (hostView, participantView, adminView). Derived
 * data (rankings, finalist lists) is cached until the next change, so building
 * 100 phone views after an update stays cheap.
 */
import { randomUUID } from "node:crypto";
import {
  ADD_TIME_MS,
  type AdminAction,
  type AdminActionType,
  type AdminParticipant,
  type AdminQuestion,
  type AdminView,
  type Backing,
  type BuzzerQuestion,
  type BuzzOutcome,
  type CommandResult,
  type Counts,
  type FinalistState,
  type HostStage,
  type HostView,
  type JoinResult,
  type LeaderRow,
  NAME_MAX_LENGTH,
  OPTION_LETTERS,
  type OptionResult,
  PARTICIPANT_COLORS,
  type ParticipantScreen,
  type ParticipantStatus,
  type ParticipantTag,
  type ParticipantView,
  type Phase,
  type PodiumEntry,
  type PrimaryAction,
  type QuestionPreview,
  type QuizSettings,
  type Round1Question,
  type Round2Phone,
  type Round2State,
  type Round2Step,
  type Standing,
  STEP_INDEPENDENT_ACTIONS,
  type Timer,
} from "../src/shared/protocol";
import type { GameConfig } from "./config";
import { pickRound1, pickRound2, type QuizQuestion } from "./questions";

// ============================================================================
// Clock (injectable, so tests can fast-forward time)
// ============================================================================

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

// ============================================================================
// Internal state
// ============================================================================

interface Participant {
  id: string;
  name: string;
  color: string;
  joinIndex: number;
  status: ParticipantStatus;
  connected: boolean;
  /** Joined after Round 1 ended. */
  joinedLate: boolean;
  /** Index of the first Round 1 question this person plays (late joiners start later). */
  firstQuestion: number;
  /** Round 1 score. */
  score: number;
  /** Answer time summed over the Round 1 questions they played (a miss = the full time). */
  playedTimeMs: number;
  /** Has been ranked after at least one scored question (for "previous rank"). */
  hasRank: boolean;
  prevRank: number | null;
  change: number;
  /** Round 1 rank, frozen at the cut. */
  cutRank: number | null;
  /** Buzzer-round points. */
  points: number;
  backingId: string | null;
  pageHidden: boolean;
  leftPageCount: number;
}

interface Round1Run {
  id: string;
  index: number;
  question: QuizQuestion;
  /** Opaque id per option, same index as question.options. */
  optionIds: string[];
  /** Option indexes in A–D order (Admin letters, results chart). */
  hostOrder: number[];
  /** Each phone's own shuffled order of option indexes. */
  orders: Map<string, number[]>;
  answers: Map<string, { optionIndex: number; elapsedMs: number }>;
  /** Points and time actually applied per participant, so a void can undo them. */
  applied: Map<string, { points: number; timeMs: number }>;
  /** Answer time for this question, including any "+5 seconds". */
  limitMs: number;
  scored: boolean;
  voided: boolean;
}

type Outcome = { kind: "correct"; by: string } | { kind: "nobody"; reason: "allWrong" | "timeUp" } | { kind: "voided" };

interface Round2Run {
  id: string;
  /** Index into round2Questions. */
  index: number;
  /** 1-based number shown on screen. */
  number: number;
  suddenDeath: boolean;
  question: QuizQuestion;
  /** Option indexes in A–D order. */
  hostOrder: number[];
  /** Finalist ids who can buzz on this question. */
  inPlay: string[];
  /** Marked wrong on this question, in order. */
  lockedOut: string[];
  buzzedBy: string | null;
  answerTimeUp: boolean;
  outcome: Outcome | null;
  /** Who got the point on this question. */
  awardedTo: string | null;
}

interface LastMark {
  runId: string;
  by: string;
  correct: boolean;
  /** State just before the mark, restored by undo. */
  before: { run: Round2Run; points: number; winnerId: string | null };
}

const randomId = () => randomUUID().replace(/-/g, "").slice(0, 12);

const ROUND1_QUESTION_PHASES: Phase[] = ["r1Read", "r1Answer", "r1TimesUp", "r1Reveal", "r1Results", "r1Leaderboard"];
const ROUND1_PHASES: Phase[] = ["r1Intro", ...ROUND1_QUESTION_PHASES];
const ROUND2_QUESTION_PHASES: Phase[] = ["r2Read", "r2BuzzOpen", "r2Answering", "r2Reveal"];
const ROUND2_PHASES: Phase[] = ["r2Intro", ...ROUND2_QUESTION_PHASES, "r2Scores", "suddenDeath"];

// ============================================================================
// The room
// ============================================================================

export class QuizRoom {
  readonly hostToken = randomUUID();

  private participants: Participant[] = [];
  private phase: Phase = "lobby";
  private step = 1;

  // Round 1
  private readonly round1Questions: QuizQuestion[];
  private r1: Round1Run | null = null;
  /** Round 1 question index → scored and not voided. */
  private r1Scored = new Map<number, boolean>();

  // The cut
  /** Round 1 participants in rank order, frozen at "End round 1". */
  private cutOrder: string[] | null = null;
  /** Finalists, frozen when the first buzzer question is shown. Before that they're derived from cutOrder. */
  private frozenFinalists: string[] | null = null;

  // Round 2
  private readonly round2Questions: QuizQuestion[];
  private r2Next = 0;
  /** Planned questions started so far (sudden death not included). */
  private r2Number = 0;
  private r2: Round2Run | null = null;
  private sudden: { tiedIds: string[]; number: number } | null = null;
  private winnerId: string | null = null;
  private lastMark: LastMark | null = null;

  // Podium (frozen when shown)
  private podium: { basis: "buzzer" | "round1"; order: string[] } | null = null;

  // Timer
  private timer: Timer | null = null;
  private timeoutHandle: unknown = null;
  private onTimerEnd: (() => void) | null = null;
  private paused = false;

  private roomCodeVisible = true;
  private soundOn = true;

  private cache = new Map<string, unknown>();

  constructor(
    readonly code: string,
    private readonly joinUrl: string,
    private readonly config: GameConfig,
    questions: QuizQuestion[],
    private readonly onChange: () => void,
    private readonly clock: Clock = realClock,
    private readonly random: () => number = Math.random,
  ) {
    this.round1Questions = pickRound1(questions, config.round1.questions);
    // Planned questions plus plenty of spares for voids and sudden death.
    this.round2Questions = pickRound2(questions, config.round2.questions + 60, this.round1Questions);
  }

  get stepId() {
    return this.step;
  }

  get currentPhase() {
    return this.phase;
  }

  // ==========================================================================
  // Participants
  // ==========================================================================

  join(rawName: string, existingId?: string): JoinResult {
    const ok = (p: Participant): JoinResult => ({ ok: true, participantId: p.id, roomCode: this.code, status: p.status });

    if (existingId) {
      const known = this.find(existingId);
      if (known) {
        if (known.status === "removed") return { ok: false, error: "removed" };
        known.connected = true;
        this.changed();
        return ok(known);
      }
    }

    const name = String(rawName ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, NAME_MAX_LENGTH)
      .trim();
    if (!name) return { ok: false, error: "name-invalid" };

    const same = this.participants.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same) {
      if (same.status === "removed") return { ok: false, error: "removed" };
      if (same.connected) return { ok: false, error: "name-taken" };
      // Same name and that phone dropped: take the seat back.
      same.connected = true;
      this.changed();
      return ok(same);
    }

    if (this.phase === "podium") return { ok: false, error: "quiz-ended" };
    if (this.active().length >= this.config.maxParticipants) return { ok: false, error: "room-full" };

    const inRound1 = this.phase === "lobby" || ROUND1_PHASES.includes(this.phase);
    let firstQuestion = 0;
    if (this.r1 && ROUND1_QUESTION_PHASES.includes(this.phase)) {
      // Joined during the read step: plays this question. Later: from the next one.
      firstQuestion = this.phase === "r1Read" ? this.r1.index : this.r1.index + 1;
    }
    const participant: Participant = {
      id: randomId(),
      name,
      color: PARTICIPANT_COLORS[this.participants.length % PARTICIPANT_COLORS.length],
      joinIndex: this.participants.length,
      status: inRound1 ? "playing" : "audience",
      connected: true,
      joinedLate: !inRound1,
      firstQuestion,
      score: 0,
      playedTimeMs: 0,
      hasRank: false,
      prevRank: null,
      change: 0,
      cutRank: null,
      points: 0,
      backingId: null,
      pageHidden: false,
      leftPageCount: 0,
    };
    this.participants.push(participant);
    this.changed();
    return ok(participant);
  }

  disconnect(id: string) {
    const p = this.find(id);
    if (!p || !p.connected) return;
    p.connected = false;
    p.pageHidden = false;
    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  /** The quiz page was hidden or shown on this phone. Counted only while a question is open. */
  setPageHidden(id: string, hidden: boolean) {
    const p = this.find(id);
    if (!p || p.status === "removed" || p.pageHidden === hidden) return;
    p.pageHidden = hidden;
    if (hidden && this.questionOpenFor(p)) p.leftPageCount += 1;
    this.changed();
  }

  answer(id: string, questionId: string, optionId: string) {
    const p = this.find(id);
    const run = this.r1;
    if (!p || !run || this.phase !== "r1Answer" || this.paused || !this.timer) return;
    if (run.id !== questionId || !this.playsQuestion(p, run) || run.answers.has(id)) return;
    const optionIndex = run.optionIds.indexOf(optionId);
    if (optionIndex === -1) return;
    const elapsedMs = Math.min(run.limitMs, Math.max(0, this.timer.durationMs - (this.timer.endsAt - this.clock.now())));
    run.answers.set(id, { optionIndex, elapsedMs });
    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  buzz(id: string, questionId: string) {
    const run = this.r2;
    if (!run || this.phase !== "r2BuzzOpen" || this.paused || run.id !== questionId || run.buzzedBy) return;
    if (!this.canBuzz(id, run)) return;
    run.buzzedBy = id;
    run.answerTimeUp = false;
    this.lastMark = null; // a new buzz ends the chance to undo the previous mark
    this.go("r2Answering", this.config.round2.answerMs, () => {
      run.answerTimeUp = true;
      this.changed();
    });
  }

  back(id: string, finalistId: string) {
    const p = this.find(id);
    if (!p || this.phase !== "predictions" || p.status !== "audience") return;
    if (!this.finalistIds().includes(finalistId) || p.backingId === finalistId) return;
    p.backingId = finalistId;
    this.changed();
  }

  // ==========================================================================
  // Admin commands
  // ==========================================================================

  /** Runs one quizmaster command. Ignored if issued from a step that has since moved on. */
  command(stepId: number, action: AdminAction): CommandResult {
    if (!STEP_INDEPENDENT_ACTIONS.includes(action.type) && stepId !== this.step) {
      return { ok: false, reason: "stale-step" };
    }
    if (!this.allowedActions().has(action.type)) return { ok: false, reason: "not-allowed" };

    switch (action.type) {
      case "startQuiz":
        this.go("r1Intro");
        break;
      case "showQuestion":
        if (this.phase === "r1Intro") this.beginRound1Question(0);
        else this.beginRound2Question();
        break;
      case "revealAnswer":
        this.go("r1Reveal");
        break;
      case "showResults":
        this.go("r1Results");
        break;
      case "showLeaderboard":
        this.go("r1Leaderboard");
        break;
      case "nextQuestion":
        if (this.isRound1Phase()) this.beginRound1Question(this.r1!.index + 1);
        else this.beginRound2Question();
        break;
      case "endRound1":
        this.cut();
        break;
      case "openPredictions":
        this.go("predictions");
        break;
      case "startBuzzerRound":
        this.go("r2Intro");
        break;
      case "showScores":
        this.lastMark = null;
        this.go("r2Scores");
        break;
      case "startSuddenDeath":
        this.sudden = { tiedIds: this.tiedLeaders().map((p) => p.id), number: 0 };
        this.lastMark = null;
        this.go("suddenDeath");
        break;
      case "showWinner":
        this.finish("buzzer");
        break;
      case "markCorrect":
        this.mark(true);
        break;
      case "markWrong":
        this.mark(false);
        break;
      case "undoMark":
        this.undoMark();
        break;
      case "pause":
        this.pause();
        break;
      case "resume":
        this.resume();
        break;
      case "addTime":
        this.addTime();
        break;
      case "skipTimer":
        this.paused = false;
        this.endTimerNow();
        break;
      case "voidQuestion":
        this.voidQuestion();
        break;
      case "restartQuestion":
        this.restartQuestion();
        break;
      case "restartRound":
        this.restartRound();
        break;
      case "removeParticipant":
        this.remove(action.participantId);
        break;
      case "setRoomCodeVisible":
        this.roomCodeVisible = action.visible;
        this.changed();
        break;
      case "setSound":
        this.soundOn = action.on;
        this.changed();
        break;
      case "endQuiz":
        this.finish(this.cutOrder ? "buzzer" : "round1");
        break;
    }
    return { ok: true };
  }

  /** Results for prizes: one row per participant, best first. */
  resultsCsv(): { csv: string; filename: string } {
    const header = ["Place", "Name", "Result", "Round 1 rank", "Round 1 score", "Buzzer points", "Backed", "Called it", "Left page", "Status"];
    const podiumIds = this.podium?.basis === "buzzer" ? this.podium.order : [];
    const winnerId = this.podium ? this.podium.order[0] ?? null : null;
    const r1Rank = this.round1RankMap();
    const sorted = [...this.participants].sort((a, b) => {
      const pa = podiumIds.indexOf(a.id);
      const pb = podiumIds.indexOf(b.id);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 1e6 : pa) - (pb === -1 ? 1e6 : pb);
      if ((a.status === "removed") !== (b.status === "removed")) return a.status === "removed" ? 1 : -1;
      const ra = r1Rank.get(a.id) ?? 1e6;
      const rb = r1Rank.get(b.id) ?? 1e6;
      return ra - rb || a.joinIndex - b.joinIndex;
    });
    const rows = sorted.map((p, i) => {
      const place = podiumIds.indexOf(p.id);
      let result: string;
      if (p.status === "removed") result = "Removed";
      else if (place === 0) result = "Winner";
      else if (place > 0) result = place < 3 ? `${ordinal(place + 1)} place` : `Finalist (${ordinal(place + 1)})`;
      else if (p.joinedLate) result = "Audience (joined after round 1)";
      else if (p.cutRank !== null) result = p.status === "finalist" ? "Finalist" : `Round 1: ${ordinal(p.cutRank)}`;
      else result = this.podium?.basis === "round1" && r1Rank.has(p.id) ? `${ordinal(r1Rank.get(p.id)!)} (quiz ended in round 1)` : "Playing";
      const backed = p.backingId ? this.find(p.backingId)?.name ?? "" : "";
      const calledIt = p.backingId && winnerId && this.podium?.basis === "buzzer" ? (p.backingId === winnerId ? "Yes" : "No") : "";
      return [
        String(i + 1),
        p.name,
        result,
        r1Rank.has(p.id) ? String(r1Rank.get(p.id)) : "",
        String(p.score),
        p.cutRank !== null && (p.status === "finalist" || podiumIds.includes(p.id)) ? String(p.points) : "",
        backed,
        calledIt,
        String(p.leftPageCount),
        p.status,
      ];
    });
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    return { csv, filename: `hermes-quiz-${this.code}-results.csv` };
  }

  dispose() {
    this.clearTimer();
    this.onTimerEnd = null;
  }

  // ==========================================================================
  // Round 1
  // ==========================================================================

  private beginRound1Question(index: number) {
    const question = this.round1Questions[index];
    this.r1 = {
      id: randomId(),
      index,
      question,
      optionIds: question.options.map(() => randomId()),
      hostOrder: shuffle([0, 1, 2, 3], this.random),
      orders: new Map(),
      answers: new Map(),
      applied: new Map(),
      limitMs: this.config.round1.answerMs,
      scored: false,
      voided: false,
    };
    this.go("r1Read", this.config.round1.readMs, () => this.openAnswers());
  }

  private openAnswers() {
    const run = this.r1!;
    run.limitMs = this.config.round1.answerMs;
    this.go("r1Answer", this.config.round1.answerMs, () => this.timesUp());
    this.endAnswerIfEveryoneAnswered();
  }

  private timesUp() {
    const run = this.r1!;
    this.scoreRound1(run);
    this.go("r1TimesUp");
  }

  private scoreRound1(run: Round1Run) {
    const { maxPoints, minCorrectPoints } = this.config.scoring;
    const rankBefore = new Map(this.round1Ranking().map((p, i) => [p.id, i + 1]));
    for (const p of this.participants) {
      if (!this.playsQuestion(p, run)) continue;
      const a = run.answers.get(p.id);
      let points = 0;
      let timeMs = run.limitMs;
      if (a) {
        timeMs = a.elapsedMs;
        if (a.optionIndex === run.question.correct) {
          const speed = 1 - Math.min(1, a.elapsedMs / run.limitMs);
          points = Math.round(minCorrectPoints + (maxPoints - minCorrectPoints) * speed);
        }
      }
      p.prevRank = p.hasRank ? rankBefore.get(p.id) ?? null : null;
      p.hasRank = true;
      p.score += points;
      p.playedTimeMs += timeMs;
      p.change = points;
      run.applied.set(p.id, { points, timeMs });
    }
    run.scored = true;
    this.r1Scored.set(run.index, true);
    this.changed();
  }

  /** Takes back the points (and time) a question gave. */
  private unscoreRound1(run: Round1Run) {
    if (!run.scored) return;
    for (const [id, applied] of run.applied) {
      const p = this.find(id);
      if (!p) continue;
      p.score -= applied.points;
      p.playedTimeMs -= applied.timeMs;
      p.change = 0;
    }
    run.applied.clear();
    run.scored = false;
    this.r1Scored.delete(run.index);
  }

  /** "End round 1": freeze the ranking, top N become finalists, the rest the audience. */
  private cut() {
    const ranking = this.round1Ranking();
    this.cutOrder = ranking.map((p) => p.id);
    ranking.forEach((p, i) => {
      p.cutRank = i + 1;
    });
    this.syncFinalistStatuses();
    this.go("cut");
  }

  // ==========================================================================
  // Round 2 (buzzer)
  // ==========================================================================

  private beginRound2Question() {
    if (!this.frozenFinalists) this.frozenFinalists = this.finalistIds();
    const index = this.r2Next++ % this.round2Questions.length;
    const question = this.round2Questions[index];
    const sudden = this.sudden;
    const number = sudden ? ++sudden.number : ++this.r2Number;
    const inPlay = (sudden ? sudden.tiedIds : this.finalistIds()).filter((id) => this.find(id)?.status === "finalist");
    this.r2 = {
      id: randomId(),
      index,
      number,
      suddenDeath: !!sudden,
      question,
      hostOrder: shuffle([0, 1, 2, 3], this.random),
      inPlay,
      lockedOut: [],
      buzzedBy: null,
      answerTimeUp: false,
      outcome: null,
      awardedTo: null,
    };
    this.lastMark = null;
    this.startRound2Read();
  }

  private startRound2Read() {
    this.go("r2Read", this.config.round2.readMs, () => this.openBuzzers(this.config.round2.buzzMs));
  }

  private openBuzzers(ms: number) {
    this.go("r2BuzzOpen", ms, () => this.nobodyScores("timeUp"));
  }

  private nobodyScores(reason: "allWrong" | "timeUp") {
    const run = this.r2!;
    run.buzzedBy = null;
    run.outcome = { kind: "nobody", reason };
    this.go("r2Reveal");
  }

  private mark(correct: boolean) {
    const run = this.r2!;
    const by = run.buzzedBy!;
    const p = this.find(by)!;
    const before = { run: cloneRun(run), points: p.points, winnerId: this.winnerId };

    if (correct) {
      p.points += 1;
      run.awardedTo = by;
      run.buzzedBy = null;
      run.outcome = { kind: "correct", by };
      if (run.suddenDeath) this.winnerId = by;
      this.go("r2Reveal");
    } else {
      run.lockedOut.push(by);
      run.buzzedBy = null;
      if (this.buzzersLeft(run).length > 0) {
        this.openBuzzers(this.config.round2.reopenMs);
      } else {
        run.outcome = { kind: "nobody", reason: "allWrong" };
        this.go("r2Reveal");
      }
    }
    this.lastMark = { runId: run.id, by, correct, before };
    this.changed();
  }

  private undoMark() {
    const mark = this.lastMark!;
    const p = this.find(mark.by);
    if (p) p.points = mark.before.points;
    this.winnerId = mark.before.winnerId;
    this.r2 = cloneRun(mark.before.run);
    this.r2.buzzedBy = mark.by;
    this.r2.answerTimeUp = true;
    this.lastMark = null;
    // Back to judging, with no countdown: the quizmaster marks it again.
    this.go("r2Answering");
  }

  private get canUndo(): boolean {
    const mark = this.lastMark;
    return (
      !!mark &&
      !!this.r2 &&
      mark.runId === this.r2.id &&
      (this.phase === "r2BuzzOpen" || this.phase === "r2Reveal") &&
      this.r2.outcome?.kind !== "voided"
    );
  }

  /** Finalists who can still buzz on this question. */
  private buzzersLeft(run: Round2Run): string[] {
    return run.inPlay.filter((id) => !run.lockedOut.includes(id) && this.find(id)?.status === "finalist");
  }

  private canBuzz(id: string, run: Round2Run) {
    return this.buzzersLeft(run).includes(id);
  }

  /** Finalists sharing the most points, when more than one (and no sudden-death winner yet). */
  private tiedLeaders(): Participant[] {
    if (this.winnerId) return [];
    const finalists = this.finalists();
    if (finalists.length < 2) return [];
    const top = Math.max(...finalists.map((p) => p.points));
    const leaders = finalists.filter((p) => p.points === top);
    return leaders.length > 1 ? leaders : [];
  }

  /** Has the buzzer round played its planned questions? */
  private get plannedDone() {
    return this.r2Number >= this.config.round2.questions;
  }

  // ==========================================================================
  // Fixing mistakes
  // ==========================================================================

  private voidQuestion() {
    if (this.isRound1Phase()) {
      const run = this.r1!;
      this.unscoreRound1(run);
      run.voided = true;
      this.go("r1Reveal");
      return;
    }
    const run = this.r2!;
    this.takeBackRound2Point(run);
    run.buzzedBy = null;
    run.outcome = { kind: "voided" };
    this.lastMark = null;
    // A voided buzzer question is replaced by the next one, so the round still
    // has its full number of real questions.
    if (run.suddenDeath) this.sudden!.number -= 1;
    else this.r2Number -= 1;
    this.go("r2Reveal");
  }

  private restartQuestion() {
    if (this.isRound1Phase()) {
      const run = this.r1!;
      this.unscoreRound1(run);
      this.beginRound1Question(run.index);
      return;
    }
    const run = this.r2!;
    this.takeBackRound2Point(run);
    this.r2 = {
      ...run,
      id: randomId(),
      inPlay: (run.suddenDeath ? this.sudden!.tiedIds : this.finalistIds()).filter(
        (id) => this.find(id)?.status === "finalist",
      ),
      lockedOut: [],
      buzzedBy: null,
      answerTimeUp: false,
      outcome: null,
      awardedTo: null,
    };
    this.lastMark = null;
    this.startRound2Read();
  }

  private takeBackRound2Point(run: Round2Run) {
    if (!run.awardedTo) return;
    const p = this.find(run.awardedTo);
    if (p) p.points = Math.max(0, p.points - 1);
    if (this.winnerId === run.awardedTo) this.winnerId = null;
    run.awardedTo = null;
  }

  private restartRound() {
    if (this.isRound1Phase() || this.phase === "r1Intro" || this.phase === "cut") {
      for (const p of this.participants) {
        if (p.status === "removed") continue;
        Object.assign(p, {
          status: "playing",
          joinedLate: false,
          firstQuestion: 0,
          score: 0,
          playedTimeMs: 0,
          hasRank: false,
          prevRank: null,
          change: 0,
          cutRank: null,
          backingId: null,
        } satisfies Partial<Participant>);
      }
      this.r1 = null;
      this.r1Scored.clear();
      this.cutOrder = null;
      this.go("r1Intro");
      return;
    }
    for (const p of this.participants) p.points = 0;
    this.r2 = null;
    this.r2Next = 0;
    this.r2Number = 0;
    this.sudden = null;
    this.winnerId = null;
    this.lastMark = null;
    this.go("r2Intro");
  }

  private remove(id: string) {
    const p = this.find(id);
    if (!p || p.status === "removed") return;
    const wasFinalist = p.status === "finalist";
    p.status = "removed";
    p.connected = false;
    p.backingId = null;

    if (wasFinalist && !this.frozenFinalists) {
      // Before the buzzer round starts, the next-best participant takes the seat.
      for (const other of this.participants) if (other.backingId === id) other.backingId = null;
      this.syncFinalistStatuses();
    }

    const run = this.r2;
    if (wasFinalist && run && ROUND2_QUESTION_PHASES.includes(this.phase)) {
      run.inPlay = run.inPlay.filter((x) => x !== id);
      if (this.sudden) this.sudden.tiedIds = this.sudden.tiedIds.filter((x) => x !== id);
      if (this.phase === "r2Answering" && run.buzzedBy === id) {
        // They had the turn: give the others the buzzers back.
        run.buzzedBy = null;
        this.lastMark = null;
        if (this.buzzersLeft(run).length > 0) this.openBuzzers(this.config.round2.reopenMs);
        else this.nobodyScores("allWrong");
        return;
      }
      if (this.phase === "r2BuzzOpen" && this.buzzersLeft(run).length === 0) {
        this.nobodyScores(run.lockedOut.length ? "allWrong" : "timeUp");
        return;
      }
    } else if (wasFinalist && this.sudden) {
      this.sudden.tiedIds = this.sudden.tiedIds.filter((x) => x !== id);
    }

    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  private finish(basis: "buzzer" | "round1") {
    let order: string[];
    if (basis === "buzzer") {
      order = [...this.finalists()]
        .sort(
          (a, b) =>
            Number(b.id === this.winnerId) - Number(a.id === this.winnerId) ||
            b.points - a.points ||
            (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6),
        )
        .map((p) => p.id);
    } else {
      order = this.round1Ranking().map((p) => p.id);
    }
    this.podium = { basis, order };
    this.lastMark = null;
    this.go("podium");
  }

  // ==========================================================================
  // Timers
  // ==========================================================================

  /** Moves to a new step. Every step change gets a new stepId and clears any pause. */
  private go(phase: Phase, durationMs?: number, onEnd?: () => void) {
    this.clearTimer();
    this.phase = phase;
    this.step += 1;
    this.paused = false;
    if (durationMs !== undefined && onEnd) this.startTimer(durationMs, onEnd);
    else {
      this.timer = null;
      this.onTimerEnd = null;
    }
    this.changed();
  }

  private startTimer(ms: number, onEnd: () => void) {
    this.clearTimer();
    this.timer = { endsAt: this.clock.now() + ms, durationMs: ms };
    this.onTimerEnd = onEnd;
    this.timeoutHandle = this.clock.setTimeout(() => this.endTimerNow(), ms);
  }

  private endTimerNow() {
    const next = this.onTimerEnd;
    this.clearTimer();
    this.onTimerEnd = null;
    this.timer = null;
    this.paused = false;
    if (next) next();
    else this.changed();
  }

  private clearTimer() {
    if (this.timeoutHandle !== null) this.clock.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }

  private pause() {
    if (this.paused || !this.timer) return;
    this.paused = true;
    this.timer = { ...this.timer, remainingMs: Math.max(0, this.timer.endsAt - this.clock.now()) };
    this.clearTimer();
    this.changed();
  }

  private resume() {
    if (!this.paused || !this.timer) return;
    this.paused = false;
    const remaining = this.timer.remainingMs ?? 0;
    this.timer = { endsAt: this.clock.now() + remaining, durationMs: this.timer.durationMs };
    this.timeoutHandle = this.clock.setTimeout(() => this.endTimerNow(), remaining);
    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  private addTime() {
    if (this.phase === "r2Answering" && !this.timer) {
      // The spoken-answer countdown already ran out: give them a fresh few seconds.
      const run = this.r2!;
      run.answerTimeUp = false;
      this.startTimer(ADD_TIME_MS, () => {
        run.answerTimeUp = true;
        this.changed();
      });
      this.changed();
      return;
    }
    if (!this.timer) return;
    if (this.phase === "r1Answer" && this.r1) this.r1.limitMs += ADD_TIME_MS;
    if (this.paused) {
      this.timer = {
        ...this.timer,
        durationMs: this.timer.durationMs + ADD_TIME_MS,
        remainingMs: (this.timer.remainingMs ?? 0) + ADD_TIME_MS,
      };
    } else {
      this.timer = { endsAt: this.timer.endsAt + ADD_TIME_MS, durationMs: this.timer.durationMs + ADD_TIME_MS };
      this.clearTimer();
      this.timeoutHandle = this.clock.setTimeout(() => this.endTimerNow(), this.timer.endsAt - this.clock.now());
    }
    this.changed();
  }

  /** Round 1 answer step ends early once every connected participant in the question has answered. */
  private endAnswerIfEveryoneAnswered() {
    const run = this.r1;
    if (this.phase !== "r1Answer" || !run || this.paused) return;
    const waitingOn = this.participants.filter((p) => p.connected && this.playsQuestion(p, run));
    // If every phone dropped at once (a Wi-Fi blip), let the timer run instead of racing ahead.
    if (waitingOn.length === 0) return;
    if (waitingOn.every((p) => run.answers.has(p.id))) this.endTimerNow();
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private changed() {
    this.cache.clear();
    this.onChange();
  }

  private cached<T>(key: string, build: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, build());
    return this.cache.get(key) as T;
  }

  private find(id: string) {
    return this.participants.find((p) => p.id === id);
  }

  private active() {
    return this.participants.filter((p) => p.status !== "removed");
  }

  private isRound1Phase() {
    return ROUND1_QUESTION_PHASES.includes(this.phase);
  }

  private isLastRound1Question() {
    return !!this.r1 && this.r1.index >= this.round1Questions.length - 1;
  }

  /** In Round 1 and allowed to answer this question (late joiners start later). */
  private playsQuestion(p: Participant, run: Round1Run) {
    return p.status === "playing" && p.firstQuestion <= run.index;
  }

  private questionOpenFor(p: Participant) {
    if ((this.phase === "r1Read" || this.phase === "r1Answer") && this.r1) return this.playsQuestion(p, this.r1);
    if (["r2Read", "r2BuzzOpen", "r2Answering"].includes(this.phase) && this.r2) return this.r2.inPlay.includes(p.id);
    return false;
  }

  /** Round 1 participants, best first: score, then lower total answer time, then who joined first. */
  private round1Ranking(): Participant[] {
    return this.cached("r1ranking", () => {
      const answerMs = this.config.round1.answerMs;
      const tieTime = (p: Participant) => {
        let missedBeforeJoining = 0;
        for (const [index, scored] of this.r1Scored) if (scored && index < p.firstQuestion) missedBeforeJoining += 1;
        return p.playedTimeMs + missedBeforeJoining * answerMs;
      };
      return this.participants
        .filter((p) => p.status === "playing")
        .sort((a, b) => b.score - a.score || tieTime(a) - tieTime(b) || a.joinIndex - b.joinIndex);
    });
  }

  /** Round 1 rank per participant: frozen cut rank after the cut, live rank before. */
  private round1RankMap(): Map<string, number> {
    return this.cached("r1rankmap", () => {
      if (this.cutOrder) {
        return new Map(this.participants.filter((p) => p.cutRank !== null).map((p) => [p.id, p.cutRank!]));
      }
      return new Map(this.round1Ranking().map((p, i) => [p.id, i + 1]));
    });
  }

  /** Finalist ids in seat order (removed ones dropped). Before the buzzer round, the next best fill empty seats. */
  private finalistIds(): string[] {
    return this.cached("finalistIds", () => {
      if (this.frozenFinalists) return this.frozenFinalists.filter((id) => this.find(id)?.status === "finalist");
      if (!this.cutOrder) return [];
      return this.cutOrder.filter((id) => this.find(id)?.status !== "removed").slice(0, this.config.finalists);
    });
  }

  private finalists(): Participant[] {
    return this.finalistIds().map((id) => this.find(id)!);
  }

  /** After the cut (and after removals before the buzzer round): finalists vs audience. */
  private syncFinalistStatuses() {
    this.cache.clear();
    const finalistIds = new Set(this.finalistIds());
    for (const id of this.cutOrder ?? []) {
      const p = this.find(id);
      if (!p || p.status === "removed") continue;
      if (finalistIds.has(id)) {
        if (p.status !== "finalist") p.backingId = null;
        p.status = "finalist";
      } else {
        p.status = "audience";
      }
    }
    this.cache.clear();
  }

  // ==========================================================================
  // Admin controls: what's allowed, the primary button, labels
  // ==========================================================================

  private canStart() {
    return this.participants.filter((p) => p.status === "playing").length >= this.config.minParticipants;
  }

  /** What comes after a buzzer question (from its reveal or the scores). */
  private afterRound2Question(): { action: AdminAction; label: string } {
    if (this.sudden) {
      // Over when someone answered correctly (or removals left only one tied finalist).
      return this.winnerId || this.tiedLeaders().length < 2
        ? { action: { type: "showWinner" }, label: "Show winner" }
        : { action: { type: "nextQuestion" }, label: "Next question" };
    }
    if (!this.plannedDone) return { action: { type: "nextQuestion" }, label: "Next question" };
    return this.tiedLeaders().length > 1
      ? { action: { type: "startSuddenDeath" }, label: "Start sudden death" }
      : { action: { type: "showWinner" }, label: "Show winner" };
  }

  private allowedActions(): Set<AdminActionType> {
    return this.cached("allowed", () => {
      const a = new Set<AdminActionType>(["setRoomCodeVisible", "setSound"]);
      const phase = this.phase;
      if (phase !== "podium") a.add("removeParticipant");
      if (phase !== "podium" && phase !== "lobby") a.add("endQuiz");
      if (this.timer) {
        a.add(this.paused ? "resume" : "pause");
        a.add("addTime");
        a.add("skipTimer");
      }
      const add = (...types: AdminActionType[]) => types.forEach((t) => a.add(t));
      const hasFinalists = this.finalistIds().length > 0;

      switch (phase) {
        case "lobby":
          if (this.canStart()) add("startQuiz");
          break;
        case "r1Intro":
          add("showQuestion", "restartRound");
          break;
        case "r1Read":
        case "r1Answer":
          add("voidQuestion", "restartQuestion", "restartRound");
          break;
        case "r1TimesUp":
          add("revealAnswer", "voidQuestion", "restartQuestion", "restartRound");
          break;
        case "r1Reveal":
        case "r1Results":
        case "r1Leaderboard": {
          const voided = this.r1!.voided;
          if (!voided && phase === "r1Reveal") add("showResults");
          if (!voided && phase !== "r1Leaderboard") add("showLeaderboard");
          if (!voided) add("voidQuestion");
          if (!this.isLastRound1Question()) add("nextQuestion");
          add("endRound1", "restartQuestion", "restartRound");
          break;
        }
        case "cut":
          if (hasFinalists) add("openPredictions", "startBuzzerRound");
          add("restartRound");
          break;
        case "predictions":
          if (hasFinalists) add("startBuzzerRound");
          break;
        case "r2Intro":
          if (hasFinalists) add("showQuestion");
          add("restartRound");
          break;
        case "r2Read":
          add("voidQuestion", "restartQuestion", "restartRound");
          break;
        case "r2BuzzOpen":
          add("voidQuestion", "restartQuestion", "restartRound");
          if (this.canUndo) add("undoMark");
          break;
        case "r2Answering":
          add("markCorrect", "markWrong", "addTime", "voidQuestion", "restartQuestion", "restartRound");
          break;
        case "r2Reveal": {
          add("showScores", this.afterRound2Question().action.type, "restartQuestion", "restartRound");
          if (this.r2!.outcome?.kind !== "voided") add("voidQuestion");
          if (this.canUndo) add("undoMark");
          break;
        }
        case "r2Scores":
          add(this.afterRound2Question().action.type, "restartRound");
          break;
        case "suddenDeath":
          add("showQuestion", "restartRound");
          break;
        case "podium":
          break;
      }
      return a;
    });
  }

  private primaryAndHint(): { primary: PrimaryAction | null; hint: string | null } {
    const finalistCount = this.finalistIds().length;
    const answeredLine = () => {
      const c = this.answerCounts();
      return c ? `${c.answered} of ${c.expected} answered.` : null;
    };
    switch (this.phase) {
      case "lobby": {
        const joined = this.active().length;
        return this.canStart()
          ? { primary: { action: { type: "startQuiz" }, label: "Start quiz" }, hint: `${joined} joined. Start when everyone's in.` }
          : { primary: null, hint: `Waiting for at least ${this.config.minParticipants} participants (${joined} joined).` };
      }
      case "r1Intro":
        return {
          primary: { action: { type: "showQuestion" }, label: "Show question" },
          hint: `Question 1 goes up. ${this.config.round1.readMs / 1000}s to read, then ${this.config.round1.answerMs / 1000}s to answer.`,
        };
      case "r1Read":
        return { primary: null, hint: "Reading time. Answers open by themselves." };
      case "r1Answer":
        return {
          primary: null,
          hint: ["Answering.", answeredLine(), "Time's up comes by itself, or when everyone has answered."].filter(Boolean).join(" "),
        };
      case "r1TimesUp":
        return {
          primary: { action: { type: "revealAnswer" }, label: "Reveal answer" },
          hint: ["Time's up.", answeredLine()].filter(Boolean).join(" "),
        };
      case "r1Reveal":
      case "r1Results":
      case "r1Leaderboard": {
        const run = this.r1!;
        const next: PrimaryAction = this.isLastRound1Question()
          ? { action: { type: "endRound1" }, label: "End round 1" }
          : { action: { type: "nextQuestion" }, label: "Next question" };
        if (run.voided) return { primary: next, hint: "Question cancelled. Nobody gained or lost points." };
        if (this.phase === "r1Reveal") {
          return { primary: { action: { type: "showResults" }, label: "Show results" }, hint: `Results and leaderboard are optional. "${next.label}" works now too.` };
        }
        if (this.phase === "r1Results") {
          return { primary: { action: { type: "showLeaderboard" }, label: "Show leaderboard" }, hint: `Leaderboard is optional. "${next.label}" works now too.` };
        }
        return {
          primary: next,
          hint: this.isLastRound1Question() ? `That was the last question. Next: the top ${this.config.finalists} are revealed.` : null,
        };
      }
      case "cut":
        return finalistCount
          ? {
              primary: { action: { type: "openPredictions" }, label: "Open predictions" },
              hint: `The top ${finalistCount} are on the Host. Next, the audience backs a finalist (or start the buzzer round straight away).`,
            }
          : { primary: null, hint: "Nobody played Round 1, so there are no finalists. Use End quiz now." };
      case "predictions": {
        const b = this.backing();
        return {
          primary: finalistCount ? { action: { type: "startBuzzerRound" }, label: "Start buzzer round" } : null,
          hint: `${b.backers} of ${b.audience} audience have backed someone. Backing closes when the buzzer round starts.`,
        };
      }
      case "r2Intro":
        return {
          primary: finalistCount ? { action: { type: "showQuestion" }, label: "Show question" } : null,
          hint: `Buzzer question 1 goes up with its options. ${this.config.round2.readMs / 1000}s to read, then buzzers open.`,
        };
      case "r2Read":
        return { primary: null, hint: "Reading time. Buzzers open by themselves." };
      case "r2BuzzOpen":
        return { primary: null, hint: this.r2!.lockedOut.length ? "Buzzers reopened for the others. Waiting for a buzz." : "Buzzers are open. Waiting for a buzz." };
      case "r2Answering": {
        const name = this.find(this.r2!.buzzedBy!)?.name ?? "";
        return {
          primary: null,
          hint: this.r2!.answerTimeUp ? `${name}'s time is up. Mark the answer: Correct or Wrong.` : `${name} is answering out loud. Mark it Correct or Wrong.`,
        };
      }
      case "r2Reveal": {
        const after = this.afterRound2Question();
        if (this.r2!.outcome?.kind === "voided") {
          return { primary: after, hint: "Question cancelled. It doesn't count; the next one takes its place." };
        }
        return { primary: { action: { type: "showScores" }, label: "Show scores" }, hint: `Scores are optional. "${after.label}" works now too.` };
      }
      case "r2Scores": {
        const after = this.afterRound2Question();
        const tied = this.tiedLeaders();
        return {
          primary: after,
          hint:
            after.action.type === "startSuddenDeath"
              ? `Tie for 1st: ${tied.map((p) => p.name).join(" and ")}.`
              : after.action.type === "showWinner"
                ? "That was the last question."
                : null,
        };
      }
      case "suddenDeath": {
        const names = (this.sudden?.tiedIds ?? []).map((id) => this.find(id)?.name).filter(Boolean);
        return {
          primary: { action: { type: "showQuestion" }, label: "Show question" },
          hint: `Only ${names.join(" and ")} can buzz. First correct answer wins.`,
        };
      }
      case "podium":
        return { primary: null, hint: "The quiz is finished. Download the results for prizes." };
    }
  }

  private stepLabel(): string {
    const r1 = this.r1;
    const r2 = this.r2;
    const r1Prefix = r1 ? `Round 1, question ${r1.index + 1} of ${this.round1Questions.length}` : "Round 1";
    const r2Prefix = r2
      ? r2.suddenDeath
        ? `Sudden death, question ${r2.number}`
        : `Buzzer round, question ${r2.number} of ${this.config.round2.questions}`
      : "Buzzer round";
    switch (this.phase) {
      case "lobby":
        return "Lobby";
      case "r1Intro":
        return "Round 1: intro";
      case "r1Read":
        return `${r1Prefix}: reading`;
      case "r1Answer":
        return `${r1Prefix}: answering`;
      case "r1TimesUp":
        return `${r1Prefix}: time's up`;
      case "r1Reveal":
        return `${r1Prefix}: ${r1?.voided ? "cancelled" : "answer revealed"}`;
      case "r1Results":
        return `${r1Prefix}: results`;
      case "r1Leaderboard":
        return `${r1Prefix}: leaderboard`;
      case "cut":
        return `End of round 1: top ${this.finalistIds().length} revealed`;
      case "predictions":
        return "Predictions: audience backing a finalist";
      case "r2Intro":
        return "Buzzer round: intro";
      case "r2Read":
        return `${r2Prefix}: reading`;
      case "r2BuzzOpen":
        return `${r2Prefix}: ${r2?.lockedOut.length ? "buzzers reopened" : "buzzers open"}`;
      case "r2Answering":
        return `${r2Prefix}: ${this.find(r2?.buzzedBy ?? "")?.name ?? "someone"} is answering`;
      case "r2Reveal":
        return `${r2Prefix}: ${r2?.outcome?.kind === "voided" ? "cancelled" : "answer revealed"}`;
      case "r2Scores":
        return `${r2Prefix}: scores`;
      case "suddenDeath":
        return "Sudden death: intro";
      case "podium":
        return "Podium: quiz finished";
    }
  }

  // ==========================================================================
  // View pieces
  // ==========================================================================

  private tag(p: Participant): ParticipantTag {
    return { id: p.id, name: p.name, color: p.color };
  }

  private settings(): QuizSettings {
    return this.cached("settings", () => ({
      preset: this.config.name,
      round1Questions: this.round1Questions.length,
      round1ReadSeconds: this.config.round1.readMs / 1000,
      round1AnswerSeconds: this.config.round1.answerMs / 1000,
      finalistCount: this.config.finalists,
      round2Questions: this.config.round2.questions,
      round2ReadSeconds: this.config.round2.readMs / 1000,
      buzzSeconds: this.config.round2.buzzMs / 1000,
      answerSeconds: this.config.round2.answerMs / 1000,
      reopenSeconds: this.config.round2.reopenMs / 1000,
    }));
  }

  private counts(): Counts {
    return this.cached("counts", () => {
      const c: Counts = { joined: 0, connected: 0, playing: 0, finalists: 0, audience: 0, removed: 0 };
      for (const p of this.participants) {
        if (p.status === "removed") {
          c.removed += 1;
          continue;
        }
        c.joined += 1;
        if (p.connected) c.connected += 1;
        if (p.status === "playing") c.playing += 1;
        if (p.status === "finalist") c.finalists += 1;
        if (p.status === "audience") c.audience += 1;
      }
      return c;
    });
  }

  /** answered / expected for the current Round 1 question (answer step onward). */
  private answerCounts(): { answered: number; expected: number } | null {
    const run = this.r1;
    if (!run || !["r1Answer", "r1TimesUp", "r1Reveal", "r1Results", "r1Leaderboard"].includes(this.phase)) return null;
    return this.cached("answerCounts", () => {
      let answered = 0;
      let expected = 0;
      for (const p of this.participants) {
        if (!this.playsQuestion(p, run)) continue;
        expected += 1;
        if (run.answers.has(p.id)) answered += 1;
      }
      return { answered, expected };
    });
  }

  private round1Question(run: Round1Run): Round1Question {
    return {
      id: run.id,
      number: run.index + 1,
      count: this.round1Questions.length,
      text: run.question.text,
      image: run.question.image,
    };
  }

  private optionsFor(run: Round1Run, id: string) {
    let order = run.orders.get(id);
    if (!order) {
      order = shuffle([0, 1, 2, 3], this.random);
      run.orders.set(id, order);
    }
    return order.map((i) => ({ id: run.optionIds[i], text: run.question.options[i] }));
  }

  private optionResults(run: Round1Run): OptionResult[] {
    const counts = [0, 0, 0, 0];
    for (const [id, a] of run.answers) {
      const p = this.find(id);
      if (p && p.status !== "removed") counts[a.optionIndex] += 1;
    }
    return run.hostOrder.map((i, slot) => ({
      letter: OPTION_LETTERS[slot],
      text: run.question.options[i],
      count: counts[i],
      correct: i === run.question.correct,
    }));
  }

  private leaderboard(): LeaderRow[] {
    return this.round1Ranking()
      .slice(0, this.config.leaderboardSize)
      .map((p, i) => ({ ...this.tag(p), rank: i + 1, score: p.score, previousRank: p.prevRank, change: p.change }));
  }

  private standings(): Standing[] {
    return this.cached("standings", () =>
      (this.cutOrder ?? [])
        .map((id) => this.find(id)!)
        .filter((p) => p.status !== "removed")
        .map((p) => ({ ...this.tag(p), rank: p.cutRank!, score: p.score, finalist: p.status === "finalist" })),
    );
  }

  private finalistStates(): FinalistState[] {
    return this.cached("finalistStates", () => {
      const run = this.r2 && ROUND2_QUESTION_PHASES.includes(this.phase) ? this.r2 : null;
      return this.finalists().map((p, i) => ({
        ...this.tag(p),
        points: p.points,
        seat: i + 1,
        connected: p.connected,
        lockedOut: !!run && run.lockedOut.includes(p.id),
        inPlay: run ? run.inPlay.includes(p.id) : this.sudden ? this.sudden.tiedIds.includes(p.id) : true,
      }));
    });
  }

  private backing(): Backing {
    return this.cached("backing", () => {
      const counts: Record<string, number> = {};
      for (const id of this.finalistIds()) counts[id] = 0;
      let backers = 0;
      let audience = 0;
      for (const p of this.participants) {
        if (p.status !== "audience") continue;
        audience += 1;
        if (p.backingId && p.backingId in counts) {
          counts[p.backingId] += 1;
          backers += 1;
        }
      }
      return { counts, backers, audience };
    });
  }

  private buzzerQuestion(run: Round2Run): BuzzerQuestion {
    return {
      id: run.id,
      number: run.number,
      count: run.suddenDeath ? 0 : this.config.round2.questions,
      suddenDeath: run.suddenDeath,
      text: run.question.text,
      image: run.question.image,
      options: run.hostOrder.map((i) => run.question.options[i]),
    };
  }

  private outcomeView(outcome: Outcome | null): BuzzOutcome | null {
    if (!outcome) return null;
    if (outcome.kind === "correct") {
      const p = this.find(outcome.by);
      return { kind: "correct", by: p ? this.tag(p) : { id: outcome.by, name: "", color: "#888888" } };
    }
    return outcome;
  }

  private round2State(): Round2State | null {
    const run = this.r2;
    if (!run || !ROUND2_QUESTION_PHASES.includes(this.phase)) return null;
    return this.cached("round2State", () => {
      const revealed = this.phase === "r2Reveal";
      const correctSlot = run.hostOrder.indexOf(run.question.correct);
      const tagOf = (id: string | null) => {
        const p = id ? this.find(id) : undefined;
        return p ? this.tag(p) : null;
      };
      return {
        question: this.buzzerQuestion(run),
        finalists: this.finalistStates(),
        buzzedBy: this.phase === "r2Answering" ? tagOf(run.buzzedBy) : null,
        answerTimeUp: this.phase === "r2Answering" && run.answerTimeUp,
        wrong: run.lockedOut.map((id) => tagOf(id)).filter((t): t is ParticipantTag => !!t),
        outcome: revealed ? this.outcomeView(run.outcome) : null,
        correct:
          revealed && run.outcome?.kind !== "voided"
            ? { letter: OPTION_LETTERS[correctSlot], text: run.question.options[run.question.correct] }
            : null,
        winner: tagOf(this.winnerId),
      };
    });
  }

  private podiumEntries(): PodiumEntry[] {
    const podium = this.podium;
    if (!podium) return [];
    return this.cached("podium", () => {
      const r1Rank = this.round1RankMap();
      return podium.order
        .map((id) => this.find(id)!)
        .filter((p) => p.status !== "removed")
        .map((p, i) => ({
          ...this.tag(p),
          place: i + 1,
          points: podium.basis === "buzzer" ? p.points : p.score,
          round1Rank: r1Rank.get(p.id) ?? null,
        }));
    });
  }

  /** What "Show question" / "Next question" would put up next. */
  private preview(): QuestionPreview | null {
    return this.cached("preview", () => this.buildPreview());
  }

  private buildPreview(): QuestionPreview | null {
    const r1Preview = (index: number): QuestionPreview => {
      const q = this.round1Questions[index];
      return { round: 1, number: index + 1, count: this.round1Questions.length, suddenDeath: false, text: q.text, image: q.image };
    };
    const r2Preview = (suddenDeath: boolean): QuestionPreview => {
      const q = this.round2Questions[this.r2Next % this.round2Questions.length];
      const number = suddenDeath ? (this.sudden?.number ?? 0) + 1 : this.r2Number + 1;
      return { round: 2, number, count: suddenDeath ? 0 : this.config.round2.questions, suddenDeath, text: q.text, image: q.image };
    };

    if (this.phase === "lobby" || this.phase === "r1Intro") return this.round1Questions.length ? r1Preview(0) : null;
    if (ROUND1_QUESTION_PHASES.includes(this.phase) && this.r1) {
      return this.isLastRound1Question() ? r2Preview(false) : r1Preview(this.r1.index + 1);
    }
    if (this.phase === "cut" || this.phase === "predictions" || this.phase === "r2Intro") return r2Preview(false);
    if (this.phase === "suddenDeath") return r2Preview(true);
    if (ROUND2_QUESTION_PHASES.includes(this.phase) || this.phase === "r2Scores") {
      if (this.sudden) return this.winnerId ? null : r2Preview(true);
      if (!this.plannedDone) return r2Preview(false);
      return this.tiedLeaders().length > 1 ? r2Preview(true) : null;
    }
    return null;
  }

  // ==========================================================================
  // HOST view
  // ==========================================================================

  private hostStage(): HostStage {
    const run1 = this.r1;
    switch (this.phase) {
      case "lobby":
        return { phase: "lobby" };
      case "r1Intro":
        return { phase: "r1Intro" };
      case "r1Read":
        return { phase: "r1Read", question: this.round1Question(run1!) };
      case "r1Answer":
      case "r1TimesUp": {
        const c = this.answerCounts()!;
        return { phase: this.phase, question: this.round1Question(run1!), answered: c.answered, expected: c.expected };
      }
      case "r1Reveal":
        return {
          phase: "r1Reveal",
          question: this.round1Question(run1!),
          correctText: run1!.voided ? null : run1!.question.options[run1!.question.correct],
          voided: run1!.voided,
        };
      case "r1Results": {
        const c = this.answerCounts()!;
        return { phase: "r1Results", question: this.round1Question(run1!), options: this.optionResults(run1!), answered: c.answered, expected: c.expected };
      }
      case "r1Leaderboard":
        return { phase: "r1Leaderboard", question: this.round1Question(run1!), rows: this.leaderboard() };
      case "cut":
        return { phase: "cut", standings: this.standings() };
      case "predictions":
        return { phase: "predictions", finalists: this.finalistStates(), backing: this.backing() };
      case "r2Intro":
        return { phase: "r2Intro", finalists: this.finalistStates(), backing: this.backing() };
      case "r2Read":
      case "r2BuzzOpen":
      case "r2Answering":
      case "r2Reveal":
        return { phase: this.phase, round2: this.round2State()!, backing: this.backing() };
      case "r2Scores":
        return {
          phase: "r2Scores",
          finalists: [...this.finalistStates()].sort((a, b) => b.points - a.points || a.seat - b.seat),
          questionNumber: this.r2?.number ?? 0,
          questionCount: this.r2?.suddenDeath ? 0 : this.config.round2.questions,
          suddenDeath: !!this.r2?.suddenDeath,
          backing: this.backing(),
        };
      case "suddenDeath":
        return {
          phase: "suddenDeath",
          tied: this.finalistStates().filter((f) => this.sudden?.tiedIds.includes(f.id)),
          backing: this.backing(),
        };
      case "podium": {
        const entries = this.podiumEntries();
        const winnerId = this.podium?.basis === "buzzer" ? entries[0]?.id : undefined;
        return {
          phase: "podium",
          basis: this.podium!.basis,
          entries,
          calledIt: winnerId ? this.participants.filter((p) => p.status === "audience" && p.backingId === winnerId).length : 0,
          backing: this.backing(),
        };
      }
    }
  }

  hostView(): HostView {
    return {
      roomCode: this.code,
      joinUrl: this.joinUrl,
      roomCodeVisible: this.roomCodeVisible,
      soundOn: this.soundOn,
      settings: this.settings(),
      participants: this.cached("hostParticipants", () => this.active().map((p) => this.tag(p))),
      counts: this.counts(),
      timer: this.timer,
      paused: this.paused,
      serverNow: this.clock.now(),
      nextImage: this.preview()?.image ?? null,
      stage: this.cached("hostStage", () => this.hostStage()),
    };
  }

  // ==========================================================================
  // PARTICIPANT view
  // ==========================================================================

  participantView(id: string): ParticipantView | null {
    const p = this.find(id);
    if (!p) return null;
    return {
      roomCode: this.code,
      me: { ...this.tag(p), status: p.status },
      timer: this.timer,
      paused: this.paused,
      serverNow: this.clock.now(),
      screen: this.participantScreen(p),
    };
  }

  private participantScreen(p: Participant): ParticipantScreen {
    if (p.status === "removed") return { kind: "removed" };
    if (this.phase === "podium") return this.podiumScreen(p);

    switch (this.phase) {
      case "lobby":
        return { kind: "lobby", joined: this.counts().joined };
      case "r1Intro":
        return { kind: "r1Intro", settings: this.settings() };
      case "cut":
        if (p.cutRank === null) return { kind: "audience" };
        return {
          kind: "cut",
          madeIt: p.status === "finalist",
          rank: p.cutRank,
          of: this.cutOrder!.length,
          finalistCount: this.finalistIds().length,
        };
      case "predictions":
        if (p.status === "finalist") {
          return { kind: "finalist", seat: this.finalistIds().indexOf(p.id) + 1, finalistCount: this.finalistIds().length };
        }
        return { kind: "backFinalist", finalists: this.finalistStates(), backedId: p.backingId };
    }

    if (this.isRound1Phase()) {
      const run = this.r1!;
      if (!this.playsQuestion(p, run)) return { kind: "nextQuestion" };
      const answer = run.answers.get(p.id);
      switch (this.phase) {
        case "r1Read":
          return { kind: "eyesUp", questionNumber: run.index + 1, questionCount: this.round1Questions.length };
        case "r1Answer":
          return answer
            ? { kind: "lockedIn", choiceText: run.question.options[answer.optionIndex], timeUp: false }
            : {
                kind: "answer",
                questionId: run.id,
                questionNumber: run.index + 1,
                questionCount: this.round1Questions.length,
                options: this.optionsFor(run, p.id),
              };
        case "r1TimesUp":
          return answer ? { kind: "lockedIn", choiceText: run.question.options[answer.optionIndex], timeUp: true } : { kind: "timesUp" };
        default:
          if (run.voided) return { kind: "voided" };
          return { kind: "result", outcome: !answer ? "missed" : answer.optionIndex === run.question.correct ? "correct" : "wrong" };
      }
    }

    // Buzzer round (r2Intro, questions, scores, sudden death)
    const phone = this.round2Phone();
    if (p.status === "finalist") {
      const run = this.r2 && ROUND2_QUESTION_PHASES.includes(this.phase) ? this.r2 : null;
      const inPlay = run ? run.inPlay.includes(p.id) : this.sudden ? this.sudden.tiedIds.includes(p.id) : true;
      const lockedOut = !!run && run.lockedOut.includes(p.id);
      return {
        ...phone,
        kind: "buzzer",
        canBuzz: this.phase === "r2BuzzOpen" && !this.paused && !!run && this.canBuzz(p.id, run),
        inPlay,
        lockedOut,
        points: p.points,
        myResult: this.r2 && (ROUND2_QUESTION_PHASES.includes(this.phase) || this.phase === "r2Scores")
          ? this.r2.awardedTo === p.id
            ? "correct"
            : this.r2.lockedOut.includes(p.id)
              ? "wrong"
              : null
          : null,
      };
    }
    return { ...phone, kind: "buzzerWatch", backedId: p.backingId };
  }

  private round2Phone(): Round2Phone {
    return this.cached("round2Phone", () => {
      const steps: Partial<Record<Phase, Round2Step>> = {
        r2Intro: "intro",
        r2Read: "read",
        r2BuzzOpen: "buzzOpen",
        r2Answering: "answering",
        r2Reveal: "reveal",
        r2Scores: "scores",
        suddenDeath: "suddenDeath",
      };
      const inQuestion = ROUND2_QUESTION_PHASES.includes(this.phase);
      const run = this.r2;
      const state = this.round2State();
      const showRun = !!run && (inQuestion || this.phase === "r2Scores");
      return {
        step: steps[this.phase] ?? "intro",
        questionId: inQuestion && run ? run.id : null,
        questionNumber: showRun ? run!.number : null,
        questionCount: this.sudden ? 0 : this.config.round2.questions,
        suddenDeath: this.phase === "suddenDeath" || !!(showRun && run!.suddenDeath),
        finalists: this.finalistStates(),
        buzzedBy: state?.buzzedBy ?? null,
        wrong: state?.wrong ?? [],
        outcome: state?.outcome ?? null,
        winner: this.winnerTag(),
      };
    });
  }

  private winnerTag(): ParticipantTag | null {
    const w = this.winnerId ? this.find(this.winnerId) : undefined;
    return w ? this.tag(w) : null;
  }

  private podiumScreen(p: Participant): ParticipantScreen {
    const entries = this.podiumEntries();
    const basis = this.podium!.basis;
    const winner = entries[0] ? { id: entries[0].id, name: entries[0].name, color: entries[0].color } : null;
    const mine = entries.find((e) => e.id === p.id);
    const backedP = p.status === "audience" && p.backingId ? this.find(p.backingId) : undefined;
    return {
      kind: "podium",
      basis,
      place: mine ? mine.place : null,
      of: entries.length,
      winner,
      backed: backedP ? this.tag(backedP) : null,
      calledIt: backedP && winner && basis === "buzzer" ? backedP.id === winner.id : null,
      round1Rank: this.round1RankMap().get(p.id) ?? null,
    };
  }

  // ==========================================================================
  // ADMIN view
  // ==========================================================================

  private adminQuestion(): AdminQuestion | null {
    if (this.isRound1Phase() && this.r1) {
      const run = this.r1;
      const options = run.hostOrder.map((i, slot) => ({
        letter: OPTION_LETTERS[slot],
        text: run.question.options[i],
        correct: i === run.question.correct,
      }));
      const correct = options.find((o) => o.correct)!;
      return {
        id: run.id,
        round: 1,
        number: run.index + 1,
        count: this.round1Questions.length,
        suddenDeath: false,
        text: run.question.text,
        image: run.question.image,
        options,
        correctLetter: correct.letter,
        correctText: correct.text,
      };
    }
    if ((ROUND2_QUESTION_PHASES.includes(this.phase) || this.phase === "r2Scores") && this.r2) {
      const run = this.r2;
      const options = run.hostOrder.map((i, slot) => ({
        letter: OPTION_LETTERS[slot],
        text: run.question.options[i],
        correct: i === run.question.correct,
      }));
      const correct = options.find((o) => o.correct)!;
      return {
        id: run.id,
        round: 2,
        number: run.number,
        count: run.suddenDeath ? 0 : this.config.round2.questions,
        suddenDeath: run.suddenDeath,
        text: run.question.text,
        image: run.question.image,
        options,
        correctLetter: correct.letter,
        correctText: correct.text,
      };
    }
    return null;
  }

  private adminParticipants(): AdminParticipant[] {
    return this.cached("adminParticipants", () => {
      const rank = this.round1RankMap();
      const run = this.r1 && ["r1Answer", "r1TimesUp", "r1Reveal", "r1Results", "r1Leaderboard"].includes(this.phase) ? this.r1 : null;
      return this.participants.map((p) => ({
        ...this.tag(p),
        status: p.status,
        connected: p.connected,
        joinedLate: p.joinedLate,
        pageHidden: p.pageHidden,
        leftPageCount: p.leftPageCount,
        score: p.score,
        rank: rank.get(p.id) ?? null,
        points: p.points,
        answered: run && this.playsQuestion(p, run) ? run.answers.has(p.id) : null,
        backingId: p.backingId,
      }));
    });
  }

  adminView(): AdminView {
    const { primary, hint } = this.cached("primary", () => this.primaryAndHint());
    const answerCounts = this.answerCounts();
    const mark = this.canUndo ? this.lastMark : null;
    const markBy = mark ? this.find(mark.by) : undefined;
    return {
      roomCode: this.code,
      joinUrl: this.joinUrl,
      settings: this.settings(),
      phase: this.phase,
      stepId: this.step,
      stepLabel: this.stepLabel(),
      primary,
      hint,
      allowed: [...this.allowedActions()],
      timer: this.timer,
      paused: this.paused,
      serverNow: this.clock.now(),
      roomCodeVisible: this.roomCodeVisible,
      soundOn: this.soundOn,
      question: this.cached("adminQuestion", () => this.adminQuestion()),
      nextQuestion: this.preview(),
      counts: { ...this.counts(), answered: answerCounts?.answered ?? null, expected: answerCounts?.expected ?? null },
      participants: this.adminParticipants(),
      round2: this.round2State(),
      finalists: this.cutOrder ? this.finalistStates() : [],
      backing: this.cutOrder ? this.backing() : null,
      canUndo: this.canUndo,
      lastMark: mark && markBy ? { by: this.tag(markBy), correct: mark.correct } : null,
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function cloneRun(run: Round2Run): Round2Run {
  return {
    ...run,
    inPlay: [...run.inPlay],
    lockedOut: [...run.lockedOut],
    outcome: run.outcome ? { ...run.outcome } : null,
  };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${n}${suffix[n % 10] ?? "th"}`;
}

function csvCell(value: string) {
  // Quote anything with separators, and neutralise spreadsheet formulas in names.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
