/**
 * One quiz room: every rule from docs/SPEC.md (v3.1), with no socket code, so it
 * can be tested on its own (npm run simulate).
 *
 * Three rounds: Round 1 (everyone, points), the wild card round (everyone
 * outside the top 9, most correct answers wins the 10th seat) and Blackout (the
 * 10 finalists race a darkness down the corridor). Every answer is a phone tap,
 * marked here; the quizmaster only moves the steps along (`command()`).
 * Round 1 and the wild card: timers only run where SPEC says so, and when one
 * ends the room holds. Blackout runs on autopilot: after Start Blackout every
 * step is a timer (a step or a hold) that starts the next one, until the podium.
 *
 * Views are built on demand (hostView, participantView, adminView). Derived
 * data (rankings, standings) is cached until the next change, so building 100
 * phone views after an update stays cheap.
 */
import { randomUUID } from "node:crypto";
import {
  ADD_TIME_MS,
  type AdminAction,
  type AdminActionType,
  type AdminParticipant,
  type AdminQuestion,
  type AdminView,
  type AnswerOption,
  type AutopilotState,
  type Backing,
  type BlackoutState,
  BOT_HEADS,
  type BotHead,
  type BotMood,
  type BotResult,
  type CommandResult,
  type Counts,
  type DarkPreview,
  type FinalistInfo,
  type HostStage,
  type HostView,
  type JoinResult,
  type LeaderRow,
  type McqQuestion,
  NAME_MAX_LENGTH,
  type OptionResult,
  normalizeBotColor,
  PARTICIPANT_COLORS,
  type ParticipantScreen,
  type ParticipantStatus,
  type ParticipantTag,
  type ParticipantView,
  type Phase,
  type PodiumBasis,
  type PodiumEntry,
  type PodiumSummary,
  type PrimaryAction,
  type QuestionPreview,
  type QuizSettings,
  type Reveal,
  type RoundNumber,
  type Runner,
  type Standing,
  STEP_INDEPENDENT_ACTIONS,
  type Timer,
  type WildCardStanding,
  type WildCardState,
} from "../src/shared/protocol";
import { darknessStep, type GameConfig, R1_MAX_POINTS, round1Points } from "./config";
import { pickRound, type QuizQuestion } from "./questions";

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

/** A participant's wild card tally. Planned questions and sudden death kept apart. */
interface WildRecord {
  correct: number;
  /** Answer time over the planned questions (wrong / miss = the full time). */
  timeMs: number;
  /** Planned questions they were asked (scored, not voided). */
  asked: number;
  /** Sudden death: answer time over its questions (wrong / miss = the full time). */
  sdTimeMs: number;
}

/** A finalist's place in the chase. */
interface RunnerState {
  start: number;
  headStart: number;
  position: number;
  /** Position before the last reveal. */
  from: number;
  /** The last reveal's move, or null (none yet this question run). */
  delta: number | null;
  alive: boolean;
  caughtOnQuestion: number | null;
  /** Position just before the dark moved on the question they were caught. */
  beforeDark: number;
  /** Total Blackout answer time (wrong / miss = the full time). */
  timeMs: number;
}

interface Participant {
  id: string;
  name: string;
  /** Bot colour and head (see PARTICIPANT_COLORS in protocol.ts). */
  color: string;
  head: BotHead;
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
  /** Round 1 tie-break time, frozen at the cut. */
  cutTimeMs: number;
  /** Played the wild card round (status was "wildcard" at its start). */
  wild: WildRecord | null;
  /** Won the wild card (or took a seat after it). */
  isWildCard: boolean;
  runner: RunnerState | null;
  backingId: string | null;
  pageHidden: boolean;
  leftPageCount: number;
}

/** One question being played, in any round. */
interface Run {
  id: string;
  round: RoundNumber;
  /** Index into that round's question list. */
  index: number;
  /** 1-based number shown on screen (wild card sudden death counts on). */
  number: number;
  suddenDeath: boolean;
  question: QuizQuestion;
  /** Opaque id per option, same index as question.options. */
  optionIds: string[];
  /** Option indexes in the 1–4 order every screen shows. */
  hostOrder: number[];
  /** Who may answer: Round 1 decides per participant (late joiners); later rounds fix the list here. */
  players: Set<string>;
  answers: Map<string, { optionIndex: number; elapsedMs: number }>;
  /** Answer time for this question, including any "+5 seconds". */
  limitMs: number;
  /** Round 1: points and time applied per participant, so a void can undo them. */
  applied: Map<string, { points: number; timeMs: number }>;
  scored: boolean;
  voided: boolean;
  /** Wild card / Blackout: the round's state before this question, restored by void or restart. */
  before: WildSnapshot | BlackoutSnapshot | null;
}

interface WildSnapshot {
  kind: "wild";
  records: Map<string, WildRecord>;
  sudden: SuddenDeath | null;
  winnerId: string | null;
  fallback: boolean;
  number: number;
}

interface BlackoutSnapshot {
  kind: "blackout";
  runners: Map<string, RunnerState>;
  dark: number;
  darkFrom: number;
  caught: string[];
  over: boolean;
  number: number;
}

interface SuddenDeath {
  /** Still in it. */
  alive: string[];
  /** Knocked out of it, in order. */
  out: string[];
  /** Sudden-death questions started. */
  number: number;
}

const randomId = () => randomUUID().replace(/-/g, "").slice(0, 12);

/**
 * Optional listener for saving results (server/db.ts). The room calls it,
 * never waits for it, and works the same without it.
 */
export interface QuizRecorder {
  /** A Round 1 question was scored: one row per participant who played it. */
  round1Scored(questionIndex: number, rows: AnswerRecord[]): void;
  /** Its points were taken back (void, restart question, restart round). */
  round1Unscored(questionIndex: number): void;
}

export interface AnswerRecord {
  participantId: string;
  /** Index into the question's options as written in the quiz; null = no answer. */
  optionIndex: number | null;
  correct: boolean;
  points: number;
  elapsedMs: number | null;
}

/** Everything worth saving about the room right now (see RoomManager, db.ts). */
export interface RoomSnapshot {
  phase: Phase;
  /** The current question's number in its round, -1 before any. */
  questionIndex: number;
  players: {
    id: string;
    name: string;
    status: ParticipantStatus;
    score: number;
    round1Rank: number | null;
    wildCorrect: number | null;
    blackoutPlace: number | null;
    blackoutPosition: number | null;
  }[];
}

const R1_QUESTION_PHASES: Phase[] = ["r1Read", "r1Answer", "r1TimesUp", "r1Reveal", "r1Results", "r1Leaderboard"];
const R1_PHASES: Phase[] = ["r1Intro", ...R1_QUESTION_PHASES];
const WC_QUESTION_PHASES: Phase[] = ["wcRead", "wcAnswer", "wcTimesUp", "wcReveal", "wcStandings"];
const WC_PHASES: Phase[] = ["wcIntro", ...WC_QUESTION_PHASES];
const BO_QUESTION_PHASES: Phase[] = ["boRead", "boAnswer", "boTimesUp", "boReveal", "boDark"];
const BO_PHASES: Phase[] = ["boIntro", ...BO_QUESTION_PHASES, "boWinner"];
const READ_PHASES: Phase[] = ["r1Read", "wcRead", "boRead"];
const ANSWER_PHASES: Phase[] = ["r1Answer", "wcAnswer", "boAnswer"];
const TIMES_UP_PHASES: Phase[] = ["r1TimesUp", "wcTimesUp", "boTimesUp"];
const REVEALED_PHASES: Phase[] = ["r1Reveal", "r1Results", "r1Leaderboard", "wcReveal", "wcStandings", "boReveal", "boDark"];

// ============================================================================
// The room
// ============================================================================

export class QuizRoom {
  /** Set by the server to save results; null in tests. */
  recorder: QuizRecorder | null = null;
  /** The library quiz this room plays (shown on Admin). */
  quizTitle = "Quiz";

  private participants: Participant[] = [];
  private phase: Phase = "lobby";
  private step = 1;
  /** The question being played (any round), from Show question until the round moves on. */
  private run: Run | null = null;

  // Questions per round, picked once
  private readonly round1Questions: QuizQuestion[];
  private readonly wildQuestions: QuizQuestion[];
  private readonly blackoutQuestions: QuizQuestion[];

  // Round 1
  /** Round 1 question index → scored and not voided. */
  private r1Scored = new Map<number, boolean>();

  // The cut
  /** Round 1 participants in rank order, frozen at "End round 1". */
  private cutOrder: string[] | null = null;
  /** No wild card round (fewer played Round 1 than there are safe seats + 1). */
  private wildSkipped = false;

  // Wild card
  private wcStarted = false;
  /** Next index into wildQuestions. */
  private wcNext = 0;
  /** Planned wild card questions started (voids give their number back). */
  private wcNumber = 0;
  private sudden: SuddenDeath | null = null;
  private wcWinnerId: string | null = null;
  private wcFallback = false;
  /** Reveal wild card has been clicked. */
  private wcRevealed = false;

  // Blackout
  private boStarted = false;
  /** The first Blackout question has been shown: seats are final. */
  private boLocked = false;
  private boNext = 0;
  /** Blackout questions started (voids give their number back). */
  private boNumber = 0;
  private dark = 0;
  private darkFrom = 0;
  private caughtThisQuestion: string[] = [];
  private boOver = false;
  /** Ran out of questions with 2+ still running (furthest ahead wins). */
  private boOutOfQuestions = false;

  // Podium (frozen when shown)
  private podium: { basis: PodiumBasis; order: string[] } | null = null;

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
    // Each round takes its own questions; only the demo preset reuses them (fresh ids every run).
    const used = new Set<string>();
    const reuse = config.name === "demo";
    this.round1Questions = pickRound(questions, 1, config.round1.questions, used, reuse);
    this.wildQuestions = pickRound(questions, 2, config.wildCard.questions + config.wildCard.suddenDeathMax, used, reuse);
    // Blackout plays every question it can get, until one runner is left (the demo cycles its few).
    const boCount = reuse ? Math.max(config.blackout.minQuestions, questions.filter((q) => q.round === 3).length) : Number.MAX_SAFE_INTEGER;
    this.blackoutQuestions = pickRound(questions, 3, boCount, used, reuse);
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

    const inRound1 = this.phase === "lobby" || R1_PHASES.includes(this.phase);
    let firstQuestion = 0;
    if (this.run && this.run.round === 1 && R1_QUESTION_PHASES.includes(this.phase)) {
      // Joined during the read step: plays this question. Later: from the next one.
      firstQuestion = this.phase === "r1Read" ? this.run.index : this.run.index + 1;
    }
    const participant: Participant = {
      id: randomId(),
      name,
      ...this.freeBot(),
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
      cutTimeMs: 0,
      wild: null,
      isWildCard: false,
      runner: null,
      backingId: null,
      pageHidden: false,
      leftPageCount: 0,
    };
    this.participants.push(participant);
    this.changed();
    return ok(participant);
  }

  /** Lobby only: change a participant's bot. Any colour (dark ones brightened), any head; bots may be shared. */
  setBot(id: string, look: { color: string; head: string }): BotResult {
    const p = this.find(id);
    if (!p || p.status === "removed") return { ok: false, error: "invalid" };
    if (this.phase !== "lobby") return { ok: false, error: "too-late" };
    const color = normalizeBotColor(look?.color);
    const head = BOT_HEADS.find((h) => h === look?.head);
    if (!color || !head) return { ok: false, error: "invalid" };
    if (p.color === color && p.head === head) return { ok: true };
    p.color = color;
    p.head = head;
    this.changed();
    return { ok: true };
  }

  disconnect(id: string) {
    const p = this.find(id);
    if (!p || !p.connected) return;
    p.connected = false;
    p.pageHidden = false;
    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  /** The quiz page was hidden or shown on this phone. Counted only while a question is open for them. */
  setPageHidden(id: string, hidden: boolean) {
    const p = this.find(id);
    if (!p || p.status === "removed" || p.pageHidden === hidden) return;
    p.pageHidden = hidden;
    if (hidden && this.questionOpenFor(p)) p.leftPageCount += 1;
    this.changed();
  }

  /** Every round: the first tap counts; anyone who can't answer this question is ignored. */
  answer(id: string, questionId: string, optionId: string) {
    const p = this.find(id);
    const run = this.run;
    if (!p || !run || !ANSWER_PHASES.includes(this.phase) || this.paused || !this.timer) return;
    if (run.id !== questionId || !this.canAnswer(p, run) || run.answers.has(id)) return;
    const optionIndex = run.optionIds.indexOf(optionId);
    if (optionIndex === -1) return;
    const elapsedMs = Math.min(run.limitMs, Math.max(0, this.timer.durationMs - (this.timer.endsAt - this.clock.now())));
    run.answers.set(id, { optionIndex, elapsedMs });
    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  /** Audience backs a finalist during predictions. */
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
      case "nextQuestion":
        this.nextQuestion();
        break;
      case "revealAnswer":
        this.reveal();
        break;
      case "showResults":
        this.go("r1Results");
        break;
      case "showLeaderboard":
        this.go("r1Leaderboard");
        break;
      case "endRound1":
        this.cut();
        break;
      case "startWildCard":
        this.startWildCard();
        break;
      case "showStandings":
        this.go("wcStandings");
        break;
      case "revealWildCard":
        this.revealWildCard();
        break;
      case "openPredictions":
        this.go("predictions");
        break;
      case "startBlackout":
        this.startBlackout();
        break;
      case "advanceDarkness":
        this.advanceDarkness();
        break;
      case "showWinner":
        this.finish("blackout");
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
        this.endQuizNow();
        break;
    }
    return { ok: true };
  }

  /** Results for prizes: one row per participant, best first (docs/SPEC.md v3 "Results CSV"). */
  resultsCsv(): { csv: string; filename: string } {
    const header = [
      "Place",
      "Name",
      "Result",
      "Round 1 score",
      "Round 1 rank",
      "Wild card correct",
      "Wild card time (s)",
      "Blackout place",
      "Blackout final position",
      "Backed",
      "Called it",
      "Left page",
    ];
    const order = this.podium?.order ?? [];
    const r1Rank = this.round1RankMap();
    const places = this.blackoutPlaces();
    const winnerId = order[0] ?? null;
    const sorted = [...this.participants].sort((a, b) => {
      const pa = order.indexOf(a.id);
      const pb = order.indexOf(b.id);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 1e6 : pa) - (pb === -1 ? 1e6 : pb);
      if ((a.status === "removed") !== (b.status === "removed")) return a.status === "removed" ? 1 : -1;
      return (r1Rank.get(a.id) ?? 1e6) - (r1Rank.get(b.id) ?? 1e6) || a.joinIndex - b.joinIndex;
    });
    const rows = sorted.map((p, i) => {
      const place = order.indexOf(p.id);
      let result: string;
      if (p.status === "removed") result = "removed";
      else if (place === 0) result = "winner";
      else if (place === 1) result = "2nd";
      else if (place === 2) result = "3rd";
      else if (p.status === "finalist") result = "finalist";
      else if (p.wild) result = "wildcard";
      else if (p.status === "playing" || p.cutRank !== null) result = "played";
      else result = "audience";
      const backed = p.backingId ? this.find(p.backingId)?.name ?? "" : "";
      const calledIt = p.backingId && winnerId && this.podium?.basis === "blackout" ? (p.backingId === winnerId ? "yes" : "no") : "";
      return [
        String(i + 1),
        p.name,
        result,
        p.cutRank !== null || p.status === "playing" ? String(p.score) : "",
        r1Rank.has(p.id) ? String(r1Rank.get(p.id)) : "",
        p.wild ? String(p.wild.correct) : "",
        p.wild ? (p.wild.timeMs / 1000).toFixed(1) : "",
        places.has(p.id) ? String(places.get(p.id)) : "",
        p.runner ? String(p.runner.position) : "",
        backed,
        calledIt,
        String(p.leftPageCount),
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
  // Questions (all rounds)
  // ==========================================================================

  /** Show question / Next question: the next question of whichever round we're in. */
  private nextQuestion() {
    if (R1_PHASES.includes(this.phase)) {
      this.beginQuestion(1, this.run && this.run.round === 1 ? this.run.index + 1 : 0, 0, false);
      return;
    }
    if (WC_PHASES.includes(this.phase)) {
      const suddenDeath = !!this.sudden;
      if (suddenDeath) this.sudden!.number += 1;
      else this.wcNumber += 1;
      const number = suddenDeath ? this.config.wildCard.questions + this.sudden!.number : this.wcNumber;
      this.beginQuestion(2, this.wcNext++, number, suddenDeath);
      return;
    }
  }

  private beginQuestion(round: RoundNumber, index: number, number: number, suddenDeath: boolean) {
    const list = this.questionsFor(round);
    const question = list[index];
    const players = new Set<string>();
    if (round === 2) for (const id of this.sudden ? this.sudden.alive : this.wildPlayerIds()) players.add(id);
    if (round === 3) for (const p of this.runners()) if (p.runner!.alive) players.add(p.id);
    this.run = {
      id: randomId(),
      round,
      index,
      number: round === 1 ? index + 1 : number,
      suddenDeath,
      question,
      optionIds: question.options.map(() => randomId()),
      hostOrder: shuffle([0, 1, 2, 3], this.random),
      players,
      answers: new Map(),
      limitMs: this.answerMsFor(round, question),
      applied: new Map(),
      scored: false,
      voided: false,
      before: round === 2 ? this.wildSnapshot() : round === 3 ? this.blackoutSnapshot() : null,
    };
    if (round === 3) {
      for (const p of this.runners()) p.runner!.delta = null;
      this.caughtThisQuestion = [];
    }
    const readPhase: Phase = round === 1 ? "r1Read" : round === 2 ? "wcRead" : "boRead";
    this.go(readPhase, question.readMs ?? this.readMsFor(round), () => this.openAnswers());
  }

  private openAnswers() {
    const run = this.run!;
    run.limitMs = this.answerMsFor(run.round, run.question);
    const answerPhase: Phase = run.round === 1 ? "r1Answer" : run.round === 2 ? "wcAnswer" : "boAnswer";
    this.go(answerPhase, run.limitMs, () => this.timesUp());
    this.endAnswerIfEveryoneAnswered();
  }

  private timesUp() {
    const run = this.run!;
    if (run.round === 1) this.scoreRound1(run);
    if (run.round === 3) return this.go("boTimesUp", this.config.blackout.holds.timesUpMs, () => this.reveal());
    this.go(run.round === 1 ? "r1TimesUp" : "wcTimesUp");
  }

  /** Reveal answer: Round 1 was scored at time's up; the wild card and Blackout apply here (Blackout: by the autopilot). */
  private reveal() {
    const run = this.run!;
    if (run.round === 1) return this.go("r1Reveal");
    if (run.round === 2) {
      this.scoreWildCard(run);
      return this.go("wcReveal");
    }
    this.moveRunners(run);
    const h = this.config.blackout.holds;
    this.go("boReveal", h.revealMs + h.revealPerRunnerMs * this.aliveRunners().length, () => this.advanceDarkness());
  }

  private questionsFor(round: RoundNumber) {
    return round === 1 ? this.round1Questions : round === 2 ? this.wildQuestions : this.blackoutQuestions;
  }

  private readMsFor(round: RoundNumber) {
    return round === 1 ? this.config.round1.readMs : round === 2 ? this.config.wildCard.readMs : this.config.blackout.readMs;
  }

  private answerMsFor(round: RoundNumber, question: QuizQuestion) {
    if (question.openMs) return question.openMs;
    return round === 1 ? this.config.round1.answerMs : round === 2 ? this.config.wildCard.answerMs : this.config.blackout.answerMs;
  }

  private isCorrect(run: Run, id: string) {
    const a = run.answers.get(id);
    return !!a && a.optionIndex === run.question.correct;
  }

  // ==========================================================================
  // Round 1
  // ==========================================================================

  /** correct = round(200 − 100 × elapsed / limit) (round1Points in config.ts); wrong or none = 0. */
  private scoreRound1(run: Run) {
    const rankBefore = new Map(this.round1Ranking().map((p, i) => [p.id, i + 1]));
    const records: AnswerRecord[] = [];
    for (const p of this.participants) {
      if (!this.playsRound1Question(p, run)) continue;
      const a = run.answers.get(p.id);
      let points = 0;
      let timeMs = run.limitMs;
      if (a) {
        timeMs = a.elapsedMs;
        if (a.optionIndex === run.question.correct) points = round1Points(a.elapsedMs, run.limitMs);
      }
      p.prevRank = p.hasRank ? rankBefore.get(p.id) ?? null : null;
      p.hasRank = true;
      p.score += points;
      p.playedTimeMs += timeMs;
      p.change = points;
      run.applied.set(p.id, { points, timeMs });
      records.push({
        participantId: p.id,
        optionIndex: a ? a.optionIndex : null,
        correct: !!a && a.optionIndex === run.question.correct,
        points,
        elapsedMs: a ? a.elapsedMs : null,
      });
    }
    run.scored = true;
    this.r1Scored.set(run.index, true);
    this.recorder?.round1Scored(run.index, records);
    this.changed();
  }

  /** Takes back the points (and time) a Round 1 question gave. */
  private unscoreRound1(run: Run) {
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
    this.recorder?.round1Unscored(run.index);
  }

  /** "End round 1": freeze the ranking; the top `safe` are finalists, everyone else plays the wild card. */
  private cut() {
    const ranking = this.round1Ranking();
    const times = new Map(ranking.map((p) => [p.id, this.round1TieTime(p)]));
    this.cutOrder = ranking.map((p) => p.id);
    ranking.forEach((p, i) => {
      p.cutRank = i + 1;
      p.cutTimeMs = times.get(p.id) ?? 0;
    });
    // Fewer than safe + 1 played: everyone is a finalist and the wild card round is skipped.
    this.wildSkipped = ranking.length <= this.config.safe;
    ranking.forEach((p, i) => {
      p.status = this.wildSkipped || i < this.config.safe ? "finalist" : "wildcard";
    });
    this.run = null;
    this.go("cut");
  }

  // ==========================================================================
  // Wild card round
  // ==========================================================================

  private startWildCard() {
    this.wcStarted = true;
    for (const p of this.participants) if (p.status === "wildcard") p.wild = { correct: 0, timeMs: 0, asked: 0, sdTimeMs: 0 };
    // No wild card questions at all: decide straight away (the fallback).
    if (this.wildQuestions.length === 0) this.decideWildCard();
    this.go("wcIntro");
  }

  /** Wild card players still in it (not removed). */
  private wildPlayerIds(): string[] {
    return this.participants.filter((p) => p.status === "wildcard").map((p) => p.id);
  }

  /** At the reveal: tallies, sudden death outs, and whether the round is decided. */
  private scoreWildCard(run: Run) {
    if (run.scored) return;
    const limit = run.limitMs;
    if (!run.suddenDeath) {
      for (const id of run.players) {
        const p = this.find(id);
        if (!p?.wild || p.status !== "wildcard") continue;
        const a = run.answers.get(id);
        const right = this.isCorrect(run, id);
        p.wild.asked += 1;
        if (right) p.wild.correct += 1;
        p.wild.timeMs += right && a ? a.elapsedMs : limit;
      }
    } else {
      const sudden = this.sudden!;
      const stillIn = sudden.alive.filter((id) => this.find(id)?.status === "wildcard");
      for (const id of stillIn) {
        const p = this.find(id)!;
        const a = run.answers.get(id);
        p.wild!.sdTimeMs += this.isCorrect(run, id) && a ? a.elapsedMs : limit;
      }
      const right = stillIn.filter((id) => this.isCorrect(run, id));
      // Wrong or no answer = out; but if everyone left is wrong, they all stay in.
      if (right.length > 0) {
        sudden.out.push(...stillIn.filter((id) => !right.includes(id)));
        sudden.alive = right;
      } else sudden.alive = stillIn;
    }
    run.scored = true;
    this.decideWildCard();
    this.changed();
  }

  /**
   * After a scored wild card question: is there a winner yet? Only once the
   * planned questions are done (or the list ran out): most correct, then lower
   * time; an exact tie starts sudden death, capped at suddenDeathMax.
   */
  private decideWildCard() {
    if (this.wcWinnerId) return;
    const players = this.participants.filter((p) => p.status === "wildcard" && p.wild);
    if (players.length === 0) return;
    const outOfQuestions = this.wcNext >= this.wildQuestions.length;
    if (!this.sudden && this.wcNumber < this.config.wildCard.questions && !outOfQuestions) return;

    if (this.sudden) {
      const alive = this.sudden.alive.filter((id) => this.find(id)?.status === "wildcard");
      if (alive.length === 1) this.wcWinnerId = alive[0];
      else if (alive.length === 0 || this.sudden.number >= this.config.wildCard.suddenDeathMax || outOfQuestions) {
        // Lowest total time over all their wild card questions, then the better Round 1 rank.
        const pool = (alive.length ? alive : this.sudden.out).map((id) => this.find(id)!).filter((p) => p.status === "wildcard");
        pool.sort((a, b) => a.wild!.timeMs + a.wild!.sdTimeMs - (b.wild!.timeMs + b.wild!.sdTimeMs) || (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6));
        this.wcWinnerId = pool[0]?.id ?? this.wildStandingOrder()[0]?.id ?? null;
      }
      return;
    }

    const order = this.wildStandingOrder();
    const top = order[0];
    if (!top) return;
    if (top.wild!.correct === 0) {
      // Fallback: nobody got one right. The best Round 1 rank outside the safe seats takes it.
      this.wcFallback = true;
      this.wcWinnerId = [...players].sort((a, b) => (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6))[0].id;
      return;
    }
    const tied = order.filter((p) => p.wild!.correct === top.wild!.correct && p.wild!.timeMs === top.wild!.timeMs);
    if (tied.length === 1) this.wcWinnerId = top.id;
    else if (this.config.wildCard.suddenDeathMax > 0 && !outOfQuestions) this.sudden = { alive: tied.map((p) => p.id), out: [], number: 0 };
    else this.wcWinnerId = [...tied].sort((a, b) => (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6))[0].id;
  }

  /** Wild card players best first: most correct, lower time, better Round 1 rank. */
  private wildStandingOrder(): Participant[] {
    return this.cached("wildOrder", () =>
      this.participants
        .filter((p) => p.wild && (p.status === "wildcard" || (this.wcRevealed && p.status !== "removed")))
        .sort((a, b) => b.wild!.correct - a.wild!.correct || a.wild!.timeMs - b.wild!.timeMs || (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6)),
    );
  }

  /** Reveal wild card: the winner becomes a finalist; the rest of the wild card players become audience. */
  private revealWildCard() {
    const winner = this.wcWinnerId ? this.find(this.wcWinnerId) : undefined;
    // Seats left empty by removals during the wild card round go to the next best.
    const seats = Math.max(1, this.config.safe + 1 - this.participants.filter((p) => p.status === "finalist").length);
    const ranked = this.wildStandingOrder().filter((p) => p.status === "wildcard");
    const winners = [winner, ...ranked.filter((p) => p !== winner)].filter((p): p is Participant => !!p && p.status === "wildcard").slice(0, seats);
    for (const p of this.participants) {
      if (p.status !== "wildcard") continue;
      if (winners.includes(p)) {
        p.status = "finalist";
        p.isWildCard = true;
      } else p.status = "audience";
    }
    this.wcRevealed = true;
    this.run = null;
    this.go("wcWinner");
  }

  // ==========================================================================
  // Blackout
  // ==========================================================================

  /** Start Blackout: every finalist on the track at BASE_GAP + their head start. From here the autopilot runs. */
  private startBlackout() {
    this.boStarted = true;
    this.placeRunners();
    this.go("boIntro", this.config.blackout.holds.introMs, () => this.nextBlackoutQuestion());
  }

  /** Autopilot: the next Blackout question, or the end if one (or no) runner is left or the questions ran out. */
  private nextBlackoutQuestion() {
    if (this.boLocked && this.aliveRunners().length <= 1) return this.winnerMoment();
    if (this.runners().length === 0) return this.finish("blackout");
    if (this.boNext >= this.blackoutQuestions.length) {
      // Out of questions with 2+ running: the one furthest ahead wins.
      this.boOutOfQuestions = true;
      return this.winnerMoment();
    }
    this.boLocked = true;
    this.boNumber += 1;
    this.beginQuestion(3, this.boNext++, this.boNumber, false);
  }

  /** Autopilot: after the dark's hold (or a voided question), the winner or the next question. */
  private afterDark() {
    if (this.boOver || this.aliveRunners().length <= 1) return this.winnerMoment();
    this.nextBlackoutQuestion();
  }

  /** The chase is decided: the winner on screen for a moment, then the podium by itself. */
  private winnerMoment() {
    this.boOver = true;
    this.cache.clear();
    this.go("boWinner", this.config.blackout.holds.winnerMs, () => this.finish("blackout"));
  }

  private aliveRunners(): Participant[] {
    return this.runners().filter((p) => p.runner!.alive);
  }

  private placeRunners() {
    const { baseGap, headStart } = this.config.blackout;
    for (const p of this.finalists()) {
      const hs = p.isWildCard ? headStart.wildCard : (p.cutRank ?? 99) <= 3 ? headStart.top3 : headStart.safe;
      const start = baseGap + hs;
      p.runner = { start, headStart: hs, position: start, from: start, delta: null, alive: true, caughtOnQuestion: null, beforeDark: start, timeMs: 0 };
    }
    this.dark = 0;
    this.darkFrom = 0;
    this.caughtThisQuestion = [];
    this.boOver = false;
    this.boOutOfQuestions = false;
  }

  /** Finalists on the track (removed ones leave the chase). */
  private runners(): Participant[] {
    return this.participants.filter((p) => p.runner && p.status === "finalist");
  }

  /**
   * At the reveal: correct +3 / +2 / +1 by the third of the answer time it
   * arrived in; wrong −1 (not below 0); no answer 0. Nobody is caught here.
   */
  private moveRunners(run: Run) {
    if (run.scored) return;
    const limit = run.limitMs;
    for (const id of run.players) {
      const p = this.find(id);
      const r = p?.runner;
      if (!p || !r || !r.alive || p.status !== "finalist") continue;
      const a = run.answers.get(id);
      let delta = 0;
      if (a && a.optionIndex === run.question.correct) {
        delta = a.elapsedMs < limit / 3 ? 3 : a.elapsedMs < (2 * limit) / 3 ? 2 : 1;
        r.timeMs += a.elapsedMs;
      } else {
        if (a) delta = r.position > 0 ? -1 : 0;
        r.timeMs += limit;
      }
      r.from = r.position;
      r.position += delta;
      r.delta = a ? delta : 0;
    }
    run.scored = true;
    this.changed();
  }

  /** Autopilot, after the reveal's hold: the dark moves; everyone at or behind it is caught. Then: is it over? */
  private advanceDarkness() {
    const run = this.run!;
    this.darkFrom = this.dark;
    this.dark += darknessStep(this.config, run.number);
    const caught: string[] = [];
    for (const p of this.runners()) {
      const r = p.runner!;
      if (!r.alive) continue;
      r.beforeDark = r.position;
      if (r.position <= this.dark) {
        r.alive = false;
        r.caughtOnQuestion = run.number;
        caught.push(p.id);
      }
    }
    this.caughtThisQuestion = caught;
    this.checkBlackoutOver();
    const h = this.config.blackout.holds;
    const steps = this.dark - this.darkFrom;
    this.go("boDark", h.darkMs + h.darkPerStepMs * steps + (caught.length ? h.darkCaughtMs : 0), () => this.afterDark());
  }

  /** Over when one (or no) runner is left, or the questions ran out. */
  private checkBlackoutOver() {
    this.boOutOfQuestions = this.boNext >= this.blackoutQuestions.length;
    this.boOver = this.aliveRunners().length <= 1 || this.boOutOfQuestions;
  }

  /**
   * The chase's final order: runners still running by position (then lower total
   * time, then Round 1 rank), then caught ones by catch order: caught later
   * first; same question → further ahead before the dark moved, lower time,
   * better Round 1 rank. Removed runners aren't placed.
   */
  private blackoutOrder(): Participant[] {
    return this.cached("blackoutOrder", () => {
      const byRank = (a: Participant, b: Participant) => (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6) || a.joinIndex - b.joinIndex;
      const all = this.runners();
      const alive = all
        .filter((p) => p.runner!.alive)
        .sort((a, b) => b.runner!.position - a.runner!.position || a.runner!.timeMs - b.runner!.timeMs || byRank(a, b));
      const caught = all
        .filter((p) => !p.runner!.alive)
        .sort(
          (a, b) =>
            (b.runner!.caughtOnQuestion ?? 0) - (a.runner!.caughtOnQuestion ?? 0) ||
            b.runner!.beforeDark - a.runner!.beforeDark ||
            a.runner!.timeMs - b.runner!.timeMs ||
            byRank(a, b),
        );
      return [...alive, ...caught];
    });
  }

  /** Place per runner: caught runners (their place is already final) and everyone once it's over. */
  private blackoutPlaces(): Map<string, number> {
    return this.cached("blackoutPlaces", () => {
      const places = new Map<string, number>();
      if (!this.boStarted) return places;
      this.blackoutOrder().forEach((p, i) => {
        if (!p.runner!.alive || this.boOver || this.phase === "podium") places.set(p.id, i + 1);
      });
      return places;
    });
  }

  private blackoutWinner(): Participant | null {
    return this.boOver ? this.blackoutOrder()[0] ?? null : null;
  }

  // ==========================================================================
  // Snapshots (void and restart question in the wild card round and Blackout)
  // ==========================================================================

  private wildSnapshot(): WildSnapshot {
    const records = new Map<string, WildRecord>();
    for (const p of this.participants) if (p.wild) records.set(p.id, { ...p.wild });
    return {
      kind: "wild",
      records,
      sudden: this.sudden ? { alive: [...this.sudden.alive], out: [...this.sudden.out], number: this.sudden.number } : null,
      winnerId: this.wcWinnerId,
      fallback: this.wcFallback,
      number: this.wcNumber,
    };
  }

  private blackoutSnapshot(): BlackoutSnapshot {
    const runners = new Map<string, RunnerState>();
    for (const p of this.participants) if (p.runner) runners.set(p.id, { ...p.runner });
    return { kind: "blackout", runners, dark: this.dark, darkFrom: this.darkFrom, caught: [...this.caughtThisQuestion], over: this.boOver, number: this.boNumber };
  }

  /** Puts the round back as it was before this question (removals since then stay removed). */
  private restoreBefore(run: Run) {
    const s = run.before;
    if (!s) return;
    if (s.kind === "wild") {
      for (const p of this.participants) {
        const rec = s.records.get(p.id);
        if (rec) p.wild = { ...rec };
      }
      this.sudden = s.sudden ? { alive: [...s.sudden.alive], out: [...s.sudden.out], number: s.sudden.number } : null;
      this.wcWinnerId = s.winnerId;
      this.wcFallback = s.fallback;
    } else {
      for (const p of this.participants) {
        const r = s.runners.get(p.id);
        if (r) p.runner = { ...r };
      }
      this.dark = s.dark;
      this.darkFrom = s.darkFrom;
      this.caughtThisQuestion = [...s.caught];
      this.boOver = s.over;
    }
  }

  // ==========================================================================
  // Fixing mistakes
  // ==========================================================================

  /**
   * Void: the question doesn't count. Round 1: dropped. Wild card: the next
   * unused question takes its number. Blackout: no moves, the dark doesn't
   * move; "cancelled" for a moment, then the next question takes its number.
   */
  private voidQuestion() {
    const run = this.run!;
    if (run.round === 1) {
      this.unscoreRound1(run);
      run.voided = true;
      this.go("r1Reveal");
      return;
    }
    this.restoreBefore(run);
    run.voided = true;
    run.scored = true;
    if (run.round === 2) {
      if (run.suddenDeath) this.sudden!.number -= 1;
      else this.wcNumber -= 1;
      // Out of questions to replace it: decide with what was played.
      if (this.wcNext >= this.wildQuestions.length) this.decideWildCard();
      this.go("wcReveal");
      return;
    }
    this.boNumber -= 1;
    for (const p of this.runners()) {
      p.runner!.delta = 0;
      p.runner!.from = p.runner!.position;
    }
    this.go("boReveal", this.config.blackout.holds.voidMs, () => this.afterDark());
  }

  /** Restart question: undo everything it did and play it again from its read step, with fresh ids. */
  private restartQuestion() {
    const run = this.run!;
    if (run.round === 1) {
      this.unscoreRound1(run);
      this.beginQuestion(1, run.index, 0, false);
      return;
    }
    this.restoreBefore(run);
    this.beginQuestion(run.round, run.index, run.number, run.suddenDeath);
  }

  private restartRound() {
    if (R1_PHASES.includes(this.phase) || this.phase === "cut") {
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
          cutTimeMs: 0,
          backingId: null,
        } satisfies Partial<Participant>);
      }
      this.run = null;
      for (const index of this.r1Scored.keys()) this.recorder?.round1Unscored(index);
      this.r1Scored.clear();
      this.cutOrder = null;
      this.wildSkipped = false;
      this.go("r1Intro");
      return;
    }
    if (WC_PHASES.includes(this.phase)) {
      for (const p of this.participants) if (p.wild) p.wild = { correct: 0, timeMs: 0, asked: 0, sdTimeMs: 0 };
      this.run = null;
      this.wcNext = 0;
      this.wcNumber = 0;
      this.sudden = null;
      this.wcWinnerId = null;
      this.wcFallback = false;
      this.go("wcIntro");
      return;
    }
    // Blackout: back to the start positions; the autopilot starts again from the intro.
    this.run = null;
    this.boNext = 0;
    this.boNumber = 0;
    this.boLocked = false;
    this.placeRunners();
    this.go("boIntro", this.config.blackout.holds.introMs, () => this.nextBlackoutQuestion());
  }

  private remove(id: string) {
    const p = this.find(id);
    if (!p || p.status === "removed") return;
    const was = p.status;
    p.status = "removed";
    p.connected = false;
    p.backingId = null;

    if (was === "finalist") {
      for (const other of this.participants) if (other.backingId === id) other.backingId = null;
      if (!this.boLocked) this.fillSeat();
      if (this.boStarted && !this.boLocked) this.placeRunners();
    }
    if (was === "wildcard" && this.sudden) {
      this.sudden.alive = this.sudden.alive.filter((x) => x !== id);
      if (this.sudden.alive.length <= 1 && (this.phase === "wcReveal" || this.phase === "wcStandings")) this.decideWildCard();
    }
    // A removed runner leaves the chase; if that leaves one (or none), the winner moment comes now.
    if (was === "finalist" && this.boLocked && BO_PHASES.includes(this.phase) && this.phase !== "boWinner") {
      if (this.aliveRunners().length <= 1) return this.winnerMoment();
      if (this.phase === "boDark") this.checkBlackoutOver();
    }

    this.changed();
    this.endAnswerIfEveryoneAnswered();
  }

  /**
   * Before the first Blackout question, a removed finalist's seat goes to the
   * next best: the next Round 1 rank outside the finalists (before the wild card
   * round starts), the wild card runner-up (after it's revealed). During the
   * wild card round the seat is filled at Reveal wild card.
   */
  private fillSeat() {
    if (!this.cutOrder) return;
    if (this.wcRevealed) {
      const next = this.wildStandingOrder().find((p) => p.status === "audience");
      if (next) {
        next.status = "finalist";
        next.isWildCard = true;
      }
      return;
    }
    if (this.wcStarted || this.wildSkipped) return;
    const next = this.cutOrder.map((x) => this.find(x)!).find((x) => x.status === "wildcard");
    if (next) next.status = "finalist";
  }

  /** End quiz now: the podium with the standings as they are, for whichever round we're in. */
  private endQuizNow() {
    if (!this.cutOrder) return this.finish("round1");
    if (!this.boStarted && !this.wcRevealed && !this.wildSkipped) return this.finish("wildcard");
    this.finish("blackout");
  }

  private finish(basis: PodiumBasis) {
    let order: string[];
    if (basis === "round1") order = this.round1Ranking().map((p) => p.id);
    else if (basis === "wildcard") {
      order = this.participants
        .filter((p) => p.status === "finalist" && !p.isWildCard)
        .sort((a, b) => (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6))
        .map((p) => p.id);
    } else if (this.boStarted) {
      this.boOver = true;
      this.cache.clear();
      order = this.blackoutOrder().map((p) => p.id);
    } else order = this.finalists().map((p) => p.id);
    this.podium = { basis, order };
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
    if (!this.timer) return;
    if (ANSWER_PHASES.includes(this.phase) && this.run) this.run.limitMs += ADD_TIME_MS;
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

  /** An answer step ends early once everyone connected who can answer it has answered. */
  private endAnswerIfEveryoneAnswered() {
    const run = this.run;
    if (!ANSWER_PHASES.includes(this.phase) || !run || this.paused) return;
    const waitingOn = this.participants.filter((p) => p.connected && this.canAnswer(p, run));
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

  /**
   * A starting bot for a new participant, so the room looks varied before anyone
   * customises: the least-used of the 12 quick-pick colours (palette order breaks
   * ties), with the first head nobody has in that colour. Repeats are fine
   * (bots may be shared); people change it in the lobby.
   */
  private freeBot(): { color: string; head: BotHead } {
    const others = this.active();
    const uses = (c: string) => others.filter((o) => o.color === c).length;
    const color = [...PARTICIPANT_COLORS].sort((a, b) => uses(a) - uses(b))[0];
    const head = BOT_HEADS.find((h) => !others.some((o) => o.color === color && o.head === h)) ?? BOT_HEADS[uses(color) % BOT_HEADS.length];
    return { color, head };
  }

  /** Can `p` answer this question run? */
  private canAnswer(p: Participant, run: Run): boolean {
    if (run.round === 1) return this.playsRound1Question(p, run);
    if (!run.players.has(p.id)) return false;
    if (run.round === 2) return p.status === "wildcard";
    return p.status === "finalist" && !!p.runner?.alive;
  }

  /** In Round 1 and allowed to answer this question (late joiners start later). */
  private playsRound1Question(p: Participant, run: Run) {
    return p.status === "playing" && p.firstQuestion <= run.index;
  }

  private questionOpenFor(p: Participant) {
    if (!this.run || !(READ_PHASES.includes(this.phase) || ANSWER_PHASES.includes(this.phase))) return false;
    return this.canAnswer(p, this.run);
  }

  /** What `p`'s bot eyes are doing on the Host right now (see BotMood and docs/SPEC.md v3). */
  private botMood(p: Participant): BotMood {
    if (p.status === "removed") return "out";
    const phase = this.phase;
    const run = this.run;

    if (phase === "lobby" || phase === "r1Intro") return "idle";
    if (phase === "podium") return this.podium?.order[0] === p.id ? "right" : "idle";

    // A question in any round: the same eyes for whoever can answer it.
    if (run && (READ_PHASES.includes(phase) || ANSWER_PHASES.includes(phase) || TIMES_UP_PHASES.includes(phase) || REVEALED_PHASES.includes(phase))) {
      if (run.round === 3 && p.runner && !p.runner.alive) return "out";
      const plays = run.round === 1 ? this.playsRound1Question(p, run) : run.players.has(p.id);
      if (!plays) return run.round === 2 && p.status === "audience" ? "out" : "idle";
      const answered = run.answers.has(p.id);
      if (READ_PHASES.includes(phase)) return "idle";
      if (ANSWER_PHASES.includes(phase)) return answered ? "locked" : "thinking";
      if (TIMES_UP_PHASES.includes(phase)) return answered ? "locked" : "idle";
      if (run.voided) return "idle";
      if (phase === "boDark") return "idle";
      if (run.round === 3 && !answered) return "idle";
      return this.isCorrect(run, p.id) ? "right" : "wrong";
    }

    if (phase === "cut") return p.status === "finalist" ? "right" : p.status === "wildcard" ? "idle" : "out";
    if (WC_PHASES.includes(phase)) return p.status === "wildcard" ? "idle" : p.status === "finalist" ? "idle" : "out";
    if (phase === "wcWinner") return p.isWildCard && p.status === "finalist" ? "right" : p.status === "finalist" ? "idle" : "out";
    if (phase === "boWinner") return this.blackoutWinner()?.id === p.id ? "right" : p.runner && !p.runner.alive ? "out" : p.status === "finalist" ? "idle" : "out";
    if (p.runner && !p.runner.alive) return "out";
    return p.status === "finalist" ? "idle" : "out";
  }

  private active() {
    return this.participants.filter((p) => p.status !== "removed");
  }

  /** Round 1 tie-break time: time over the questions played, plus the full time for those before joining. */
  private round1TieTime(p: Participant) {
    const answerMs = (index: number) => this.round1Questions[index]?.openMs ?? this.config.round1.answerMs;
    let missedBeforeJoining = 0;
    for (const [index, scored] of this.r1Scored) if (scored && index < p.firstQuestion) missedBeforeJoining += answerMs(index);
    return p.playedTimeMs + missedBeforeJoining;
  }

  /** Round 1 participants, best first: score, then lower total answer time, then who joined first. */
  private round1Ranking(): Participant[] {
    return this.cached("r1ranking", () =>
      this.participants
        .filter((p) => p.status === "playing")
        .sort((a, b) => b.score - a.score || this.round1TieTime(a) - this.round1TieTime(b) || a.joinIndex - b.joinIndex),
    );
  }

  /** Round 1 rank per participant: frozen cut rank after the cut, live rank before. */
  private round1RankMap(): Map<string, number> {
    return this.cached("r1rankmap", () => {
      if (this.cutOrder) return new Map(this.participants.filter((p) => p.cutRank !== null).map((p) => [p.id, p.cutRank!]));
      return new Map(this.round1Ranking().map((p, i) => [p.id, i + 1]));
    });
  }

  /** Finalist ids in seat order: Round 1 rank, the wild card(s) last. */
  private finalistIds(): string[] {
    return this.cached("finalistIds", () =>
      this.participants
        .filter((p) => p.status === "finalist")
        .sort((a, b) => Number(a.isWildCard) - Number(b.isWildCard) || (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6))
        .map((p) => p.id),
    );
  }

  private finalists(): Participant[] {
    return this.finalistIds().map((id) => this.find(id)!);
  }

  // ==========================================================================
  // Admin controls: what's allowed, the primary button, labels
  // ==========================================================================

  private canStart() {
    return this.participants.filter((p) => p.status === "playing").length >= this.config.minParticipants;
  }

  /** Is the wild card decided (so the next step is Reveal wild card)? */
  private get wildDecided() {
    return !!this.wcWinnerId || this.wildPlayerIds().length === 0;
  }

  /** What comes after a wild card question (from its reveal or the standings). */
  private afterWildQuestion(): PrimaryAction {
    if (this.wildDecided) return { action: { type: "revealWildCard" }, label: "Reveal wild card" };
    return { action: { type: "nextQuestion" }, label: this.sudden ? "Next question (sudden death)" : "Next question" };
  }

  private allowedActions(): Set<AdminActionType> {
    return this.cached("allowed", () => {
      const a = new Set<AdminActionType>(["setRoomCodeVisible", "setSound"]);
      const phase = this.phase;
      if (phase !== "podium") a.add("removeParticipant");
      if (phase !== "podium" && phase !== "lobby") a.add("endQuiz");
      if (this.timer) {
        a.add(this.paused ? "resume" : "pause");
        // Blackout: +5 s only while answering (the holds just Skip).
        if (!BO_PHASES.includes(phase) || phase === "boAnswer") a.add("addTime");
        a.add("skipTimer");
      }
      const add = (...types: AdminActionType[]) => types.forEach((t) => a.add(t));
      const hasFinalists = this.finalistIds().length > 0;
      const voided = !!this.run?.voided;

      switch (phase) {
        case "lobby":
          if (this.canStart()) add("startQuiz");
          break;
        case "r1Intro":
          if (this.round1Questions.length > 0) add("showQuestion");
          add("restartRound");
          break;
        case "r1Read":
        case "r1Answer":
        case "wcRead":
        case "wcAnswer":
        case "boRead":
        case "boAnswer":
        case "boTimesUp":
          add("voidQuestion", "restartQuestion", "restartRound");
          break;
        case "r1TimesUp":
        case "wcTimesUp":
          add("revealAnswer", "voidQuestion", "restartQuestion", "restartRound");
          break;
        case "r1Reveal":
        case "r1Results":
        case "r1Leaderboard": {
          if (!voided && phase === "r1Reveal") add("showResults");
          if (!voided && phase !== "r1Leaderboard") add("showLeaderboard");
          if (!voided) add("voidQuestion");
          if (!this.isLastRound1Question()) add("nextQuestion");
          add("endRound1", "restartQuestion", "restartRound");
          break;
        }
        case "cut":
          if (this.wildPlayerIds().length > 0) add("startWildCard");
          else if (hasFinalists) add("openPredictions", "startBlackout");
          add("restartRound");
          break;
        case "wcIntro":
          if (this.wildQuestions.length > 0 && !this.wildDecided) add("showQuestion");
          if (this.wildDecided) add("revealWildCard");
          add("restartRound");
          break;
        case "wcReveal":
        case "wcStandings":
          if (!voided && phase === "wcReveal") add("showStandings");
          if (!voided) add("voidQuestion");
          add(this.afterWildQuestion().action.type, "restartQuestion", "restartRound");
          break;
        case "wcWinner":
          if (hasFinalists) add("openPredictions", "startBlackout");
          break;
        case "predictions":
          if (hasFinalists) add("startBlackout");
          break;
        // Blackout runs on autopilot: no flow buttons, only the fixes.
        case "boIntro":
          add("restartRound");
          break;
        case "boReveal":
          if (!voided) add("restartQuestion");
          add("restartRound");
          break;
        case "boDark":
          add("restartRound");
          break;
        case "boWinner":
          break;
        case "podium":
          break;
      }
      return a;
    });
  }

  /** The big button (main path), the optional steps offered beside it, and the hint. */
  private primaryAndHint(): { primary: PrimaryAction | null; optional: PrimaryAction[]; hint: string | null } {
    return { optional: [], ...this.primaryAndHintFor() };
  }

  private primaryAndHintFor(): { primary: PrimaryAction | null; optional?: PrimaryAction[]; hint: string | null } {
    const showResults: PrimaryAction = { action: { type: "showResults" }, label: "Show results" };
    const showLeaderboard: PrimaryAction = { action: { type: "showLeaderboard" }, label: "Show leaderboard" };
    const showStandings: PrimaryAction = { action: { type: "showStandings" }, label: "Show standings" };
    const openPredictions: PrimaryAction = { action: { type: "openPredictions" }, label: "Open predictions" };
    const startBlackout: PrimaryAction = { action: { type: "startBlackout" }, label: "Start Blackout" };
    const answeredLine = () => {
      const c = this.answerCounts();
      return c ? `${c.answered} of ${c.expected} answered.` : null;
    };
    const run = this.run;
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
          hint: `Question 1 goes up. ${(this.round1Questions[0]?.readMs ?? this.config.round1.readMs) / 1000}s to read, then ${(this.round1Questions[0]?.openMs ?? this.config.round1.answerMs) / 1000}s to answer.`,
        };
      case "r1Read":
      case "wcRead":
        return { primary: null, hint: "Reading time. Answers open by themselves." };
      case "r1Answer":
      case "wcAnswer":
        return { primary: null, hint: ["Answering.", answeredLine(), "Time's up comes by itself, or when everyone has answered."].filter(Boolean).join(" ") };
      case "r1TimesUp":
      case "wcTimesUp":
        return { primary: { action: { type: "revealAnswer" }, label: "Reveal answer" }, hint: ["Time's up.", answeredLine()].filter(Boolean).join(" ") };
      case "r1Reveal":
      case "r1Results":
      case "r1Leaderboard": {
        const next: PrimaryAction = this.isLastRound1Question()
          ? { action: { type: "endRound1" }, label: "End round 1" }
          : { action: { type: "nextQuestion" }, label: "Next question" };
        if (run!.voided) return { primary: next, hint: "Question cancelled. Nobody gained or lost points." };
        const last = this.isLastRound1Question() ? `That was the last question. Next: the cut (top ${this.config.safe} safe).` : null;
        if (this.phase === "r1Reveal") return { primary: next, optional: [showResults, showLeaderboard], hint: last ?? "Answer revealed. The results and the leaderboard are optional." };
        if (this.phase === "r1Results") return { primary: next, optional: [showLeaderboard], hint: last ?? "The leaderboard is optional." };
        return { primary: next, hint: last ?? "End round 1 (in Controls) also works now, to cut Round 1 short." };
      }
      case "cut": {
        const wild = this.wildPlayerIds().length;
        if (wild > 0) {
          return {
            primary: { action: { type: "startWildCard" }, label: "Start wild card round" },
            hint: `${this.finalistIds().length} safe. ${wild} play the wild card round for the last seat.`,
          };
        }
        return this.finalistIds().length
          ? {
              primary: startBlackout,
              optional: [openPredictions],
              hint: `Fewer than ${this.config.safe + 1} played, so everyone is a finalist and there's no wild card round. Predictions are optional.`,
            }
          : { primary: null, hint: "Nobody played Round 1, so there are no finalists. Use End quiz now." };
      }
      case "wcIntro":
        return this.wildDecided
          ? { primary: { action: { type: "revealWildCard" }, label: "Reveal wild card" }, hint: "Nobody is left in the wild card round." }
          : {
              primary: { action: { type: "showQuestion" }, label: "Show question" },
              hint: `Wild card question 1 goes up. ${this.wildPlayerIds().length} play; the ${this.finalistIds().length} safe finalists watch.`,
            };
      case "wcReveal":
      case "wcStandings": {
        const after = this.afterWildQuestion();
        const noSpare = this.wcNext >= this.wildQuestions.length && !this.wildDecided ? " No spare questions left." : "";
        if (run!.voided) return { primary: after, hint: `Question cancelled. It doesn't count; the next one takes its place.${noSpare}` };
        const lead = this.sudden && after.action.type === "nextQuestion" ? `Exact tie: sudden death between ${this.sudden.alive.map((id) => this.find(id)?.name).join(", ")}. ` : "";
        const decided = after.action.type === "revealWildCard" ? "The wild card is decided. " : "";
        if (this.phase === "wcReveal") return { primary: after, optional: [showStandings], hint: `${lead}${decided}The standings are optional.` };
        return { primary: after, hint: lead || decided.trim() || null };
      }
      case "wcWinner":
        return {
          primary: startBlackout,
          optional: [openPredictions],
          hint: "Predictions (the audience backs a finalist) are optional. Start Blackout and it runs by itself to the podium.",
        };
      case "predictions": {
        const b = this.backing();
        return {
          primary: startBlackout,
          hint: `${b.backers} of ${b.audience} audience have backed someone. Predictions lock when you start Blackout; then it runs by itself to the podium.`,
        };
      }
      case "boIntro":
      case "boRead":
      case "boAnswer":
      case "boTimesUp":
      case "boReveal":
      case "boDark":
      case "boWinner":
        return this.autopilotPrimary();
      case "podium":
        return { primary: null, hint: "The quiz is finished. Download the results for prizes." };
    }
  }

  /** Blackout: the big button is Pause / Resume; the hint says what the autopilot does next. */
  private autopilotPrimary(): { primary: PrimaryAction | null; hint: string } {
    const primary: PrimaryAction | null = !this.timer
      ? null
      : this.paused
        ? { action: { type: "resume" }, label: "Resume" }
        : { action: { type: "pause" }, label: "Pause" };
    if (this.paused) return { primary, hint: "Paused on every screen. Resume carries on from the same moment." };
    const run = this.run;
    const c = this.answerCounts();
    const alive = this.aliveRunners().length;
    switch (this.phase) {
      case "boIntro":
        return { primary, hint: `Autopilot: ${this.runners().length} runners on the track. Question 1 starts by itself.` };
      case "boRead":
        return { primary, hint: "Autopilot: answers open by themselves." };
      case "boAnswer":
        return { primary, hint: `Autopilot: ${c ? `${c.answered} of ${c.expected} answered. ` : ""}The answer shows by itself.` };
      case "boTimesUp":
        return { primary, hint: "Autopilot: time's up. The runners move next." };
      case "boReveal":
        if (run?.voided) return { primary, hint: "Question cancelled: nobody moves and the dark stays. The next question comes by itself." };
        return { primary, hint: `Autopilot: runners moved. The dark moves ${darknessStep(this.config, run!.number)} next.` };
      case "boDark": {
        const caught = this.caughtThisQuestion.map((id) => this.find(id)?.name).filter(Boolean);
        const next = this.boOver ? "The winner comes next." : "The next question comes by itself.";
        return { primary, hint: `${caught.length ? `Caught: ${caught.join(", ")}. ` : "Nobody caught. "}${alive} still running. ${next}` };
      }
      default:
        return { primary, hint: "Autopilot: the podium shows by itself." };
    }
  }

  private stepLabel(): string {
    const run = this.run;
    const r1 = run && run.round === 1 ? `Round 1, question ${run.index + 1} of ${this.round1Questions.length}` : "Round 1";
    const wc =
      run && run.round === 2
        ? run.suddenDeath
          ? `Wild card, sudden death ${this.sudden?.number ?? 1} of ${this.config.wildCard.suddenDeathMax}`
          : `Wild card, question ${run.number} of ${this.config.wildCard.questions}`
        : "Wild card";
    const bo = run && run.round === 3 ? `Blackout, question ${run.number}` : "Blackout";
    switch (this.phase) {
      case "lobby":
        return "Lobby";
      case "r1Intro":
        return "Round 1: intro";
      case "r1Read":
        return `${r1}: reading`;
      case "r1Answer":
        return `${r1}: answering`;
      case "r1TimesUp":
        return `${r1}: time's up`;
      case "r1Reveal":
        return `${r1}: ${run?.voided ? "cancelled" : "answer revealed"}`;
      case "r1Results":
        return `${r1}: results`;
      case "r1Leaderboard":
        return `${r1}: leaderboard`;
      case "cut":
        return `The cut: top ${this.finalistIds().length} safe`;
      case "wcIntro":
        return "Wild card: intro";
      case "wcRead":
        return `${wc}: reading`;
      case "wcAnswer":
        return `${wc}: answering`;
      case "wcTimesUp":
        return `${wc}: time's up`;
      case "wcReveal":
        return `${wc}: ${run?.voided ? "cancelled" : "reveal"}`;
      case "wcStandings":
        return `${wc}: standings`;
      case "wcWinner":
        return "Wild card revealed";
      case "predictions":
        return "Predictions: audience backing a finalist";
      case "boIntro":
        return "Blackout: intro (autopilot)";
      case "boRead":
        return `${bo}: reading (autopilot)`;
      case "boAnswer":
        return `${bo}: answering (autopilot)`;
      case "boTimesUp":
        return `${bo}: time's up (autopilot)`;
      case "boReveal":
        return `${bo}: ${run?.voided ? "cancelled" : "runners move"} (autopilot)`;
      case "boDark":
        return `${bo}: the dark moves (autopilot)`;
      case "boWinner":
        return "Blackout: the winner (autopilot)";
      case "podium":
        return "Podium: quiz finished";
    }
  }

  private isLastRound1Question() {
    return !!this.run && this.run.round === 1 && this.run.index >= this.round1Questions.length - 1;
  }

  // ==========================================================================
  // View pieces
  // ==========================================================================

  private tag(p: Participant): ParticipantTag {
    return { id: p.id, name: p.name, color: p.color, head: p.head };
  }

  private settings(): QuizSettings {
    return this.cached("settings", () => ({
      preset: this.config.name,
      round1Questions: this.round1Questions.length,
      round1ReadSeconds: this.config.round1.readMs / 1000,
      round1AnswerSeconds: this.config.round1.answerMs / 1000,
      round1MaxPoints: R1_MAX_POINTS,
      safeCount: this.config.safe,
      wildCardQuestions: this.config.wildCard.questions,
      wildCardSuddenDeathMax: this.config.wildCard.suddenDeathMax,
      blackoutReadSeconds: this.config.blackout.readMs / 1000,
      blackoutAnswerSeconds: this.config.blackout.answerMs / 1000,
    }));
  }

  private counts(): Counts {
    return this.cached("counts", () => {
      const c: Counts = { joined: 0, connected: 0, playing: 0, finalists: 0, wildcard: 0, audience: 0, removed: 0 };
      for (const p of this.participants) {
        if (p.status === "removed") {
          c.removed += 1;
          continue;
        }
        c.joined += 1;
        if (p.connected) c.connected += 1;
        if (p.status === "playing") c.playing += 1;
        if (p.status === "finalist") c.finalists += 1;
        if (p.status === "wildcard") c.wildcard += 1;
        if (p.status === "audience") c.audience += 1;
      }
      return c;
    });
  }

  /** answered / expected for the current question (answer step onward, until the next question). */
  private answerCounts(): { answered: number; expected: number } | null {
    const run = this.run;
    if (!run || READ_PHASES.includes(this.phase) || !(ANSWER_PHASES.includes(this.phase) || TIMES_UP_PHASES.includes(this.phase) || REVEALED_PHASES.includes(this.phase))) return null;
    return this.cached("answerCounts", () => {
      let answered = 0;
      let expected = 0;
      for (const p of this.participants) {
        const plays = run.round === 1 ? this.playsRound1Question(p, run) : run.players.has(p.id) && p.status !== "removed";
        if (!plays) continue;
        expected += 1;
        if (run.answers.has(p.id)) answered += 1;
      }
      return { answered, expected };
    });
  }

  private mcqQuestion(run: Run): McqQuestion {
    const count = run.round === 1 ? this.round1Questions.length : run.round === 2 ? this.config.wildCard.questions : null;
    return {
      id: run.id,
      round: run.round,
      number: run.number,
      count,
      suddenDeath: run.suddenDeath,
      text: run.question.text,
      image: run.question.image,
      // Shown from the answer step on, numbered 1–4 in this order (the same on every phone).
      options: READ_PHASES.includes(this.phase) ? null : run.hostOrder.map((i) => run.question.options[i]),
    };
  }

  /** After a reveal only: the right answer and where it is in the 1–4 order. */
  private revealOf(run: Run): Reveal {
    if (run.voided) return { correctText: null, correctIndex: null, voided: true };
    return { correctText: run.question.options[run.question.correct], correctIndex: run.hostOrder.indexOf(run.question.correct), voided: false };
  }

  /** The phone's answer buttons: the Host's order, so "2" means the same thing on every screen. */
  private optionsFor(run: Run): AnswerOption[] {
    return run.hostOrder.map((i) => ({ id: run.optionIds[i], text: run.question.options[i] }));
  }

  private optionResults(run: Run): OptionResult[] {
    const counts = [0, 0, 0, 0];
    for (const [id, a] of run.answers) {
      const p = this.find(id);
      if (p && p.status !== "removed") counts[a.optionIndex] += 1;
    }
    return run.hostOrder.map((i, slot) => ({ number: slot + 1, text: run.question.options[i], count: counts[i], correct: i === run.question.correct }));
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
        .map((p) => ({ ...this.tag(p), rank: p.cutRank!, score: p.score, timeMs: p.cutTimeMs, finalist: p.status === "finalist" && !p.isWildCard })),
    );
  }

  /** The wild card round as screens see it. `full`: every standing (Admin); else the top 10, and only when shown. */
  private wildCardState(full: boolean): WildCardState | null {
    if (!this.cutOrder || this.wildSkipped) return null;
    return this.cached(`wildCard:${full}`, () => {
      const run = this.run && this.run.round === 2 ? this.run : null;
      const counts = run && (ANSWER_PHASES.includes(this.phase) || TIMES_UP_PHASES.includes(this.phase)) ? this.answerCounts() : null;
      const showStandings = full || this.phase === "wcStandings" || this.phase === "wcWinner";
      const order = this.wcStarted ? this.wildStandingOrder() : [];
      const standings: WildCardStanding[] = showStandings
        ? (full ? order : order.slice(0, this.config.standingsSize)).map((p, i) => ({ ...this.tag(p), rank: i + 1, correct: p.wild!.correct, timeMs: p.wild!.timeMs }))
        : [];
      const winner = this.wcWinnerId ? this.find(this.wcWinnerId) : undefined;
      const showWinner = full || this.wcRevealed;
      return {
        players: this.wcRevealed ? order.length : this.wildPlayerIds().length,
        questionNumber: run ? run.number : this.wcNumber,
        questionCount: this.config.wildCard.questions,
        answered: counts?.answered ?? null,
        expected: counts?.expected ?? null,
        standings,
        safe: this.participants.filter((p) => p.status === "finalist" && !p.isWildCard).sort((a, b) => (a.cutRank ?? 0) - (b.cutRank ?? 0)).map((p) => this.tag(p)),
        suddenDeath: this.sudden
          ? {
              active: true,
              number: this.sudden.number,
              max: this.config.wildCard.suddenDeathMax,
              alive: this.sudden.alive.map((id) => this.find(id)).filter((p): p is Participant => !!p && p.status !== "removed").map((p) => this.tag(p)),
            }
          : null,
        winner: showWinner && winner ? this.tag(winner) : null,
        fallback: showWinner && this.wcFallback,
      };
    });
  }

  private finalistInfos(): FinalistInfo[] {
    return this.cached("finalistInfos", () =>
      this.finalists().map((p, i) => ({ ...this.tag(p), seat: i + 1, round1Rank: p.cutRank, wildCard: p.isWildCard, connected: p.connected })),
    );
  }

  /** The chase as screens see it. Moves (delta) only after the reveal; no correctness before. */
  private blackoutState(): BlackoutState | null {
    if (!this.boStarted) return null;
    return this.cached("blackout", () => {
      const run = this.run && this.run.round === 3 ? this.run : null;
      const places = this.blackoutPlaces();
      const revealed = this.phase === "boReveal" || this.phase === "boDark";
      const winnerShown = ["boReveal", "boDark", "boWinner", "podium"].includes(this.phase);
      const runners: Runner[] = this.runners()
        .sort((a, b) => Number(a.isWildCard) - Number(b.isWildCard) || (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6))
        .map((p) => {
          const r = p.runner!;
          return {
            ...this.tag(p),
            mood: this.botMood(p),
            position: r.position,
            from: revealed ? r.from : r.position,
            delta: revealed ? r.delta : null,
            gap: r.position - this.dark,
            alive: r.alive,
            caughtOnQuestion: r.caughtOnQuestion,
            place: places.get(p.id) ?? null,
            headStart: r.headStart,
            wildCard: p.isWildCard,
            round1Rank: p.cutRank,
          };
        });
      const winner = this.blackoutWinner();
      return {
        questionNumber: run ? run.number : this.boNumber,
        questionsLeft: this.blackoutQuestions.length - this.boNext,
        dark: this.dark,
        darkFrom: this.phase === "boDark" ? this.darkFrom : this.dark,
        runners,
        caughtThisQuestion: this.phase === "boDark" ? [...this.caughtThisQuestion] : [],
        alive: runners.filter((r) => r.alive).length,
        over: this.boOver,
        winner: winner && winnerShown ? this.tag(winner) : null,
      };
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
          round1Rank: r1Rank.get(p.id) ?? null,
          round1Score: p.score,
          position: p.runner ? p.runner.position : null,
          caughtOnQuestion: p.runner?.caughtOnQuestion ?? null,
          wildCard: p.isWildCard,
        }));
    });
  }

  /** What "Show question" / "Next question" would put up next. */
  private preview(): QuestionPreview | null {
    return this.cached("preview", () => this.buildPreview());
  }

  private buildPreview(): QuestionPreview | null {
    const make = (round: RoundNumber, index: number, number: number, suddenDeath: boolean): QuestionPreview | null => {
      const q = this.questionsFor(round)[index];
      if (!q) return null;
      const count = round === 1 ? this.round1Questions.length : round === 2 ? this.config.wildCard.questions : null;
      return { round, number, count, suddenDeath, text: q.text, image: q.image, correctText: q.options[q.correct] };
    };
    const run = this.run;
    const phase = this.phase;
    if (phase === "lobby" || phase === "r1Intro") return make(1, 0, 1, false);
    if (run?.round === 1 && R1_QUESTION_PHASES.includes(phase)) {
      return this.isLastRound1Question() ? (this.wildQuestions.length ? make(2, 0, 1, false) : make(3, 0, 1, false)) : make(1, run.index + 1, run.index + 2, false);
    }
    if (phase === "cut") return this.wildPlayerIds().length ? make(2, 0, 1, false) : make(3, 0, 1, false);
    if (WC_PHASES.includes(phase)) {
      if (this.wildDecided) return make(3, 0, 1, false);
      const sd = !!this.sudden;
      return make(2, this.wcNext, sd ? this.config.wildCard.questions + this.sudden!.number + 1 : this.wcNumber + 1, sd);
    }
    if (phase === "wcWinner" || phase === "predictions" || phase === "boIntro") return make(3, this.boNext, this.boNumber + 1, false);
    if (BO_QUESTION_PHASES.includes(phase)) return this.boOver ? null : make(3, this.boNext, this.boNumber + 1, false);
    return null;
  }

  // ==========================================================================
  // HOST view
  // ==========================================================================

  private hostStage(): HostStage {
    const run = this.run;
    const backing = () => this.backing();
    const counts = () => this.answerCounts() ?? { answered: 0, expected: 0 };
    switch (this.phase) {
      case "lobby":
        return { phase: "lobby" };
      case "r1Intro":
        return { phase: "r1Intro" };
      case "r1Read":
        return { phase: "r1Read", question: this.mcqQuestion(run!) };
      case "r1Answer":
      case "r1TimesUp":
        return { phase: this.phase, question: this.mcqQuestion(run!), ...counts() };
      case "r1Reveal":
        return { phase: "r1Reveal", question: this.mcqQuestion(run!), ...this.revealOf(run!) };
      case "r1Results":
        return { phase: "r1Results", question: this.mcqQuestion(run!), options: this.optionResults(run!), ...counts() };
      case "r1Leaderboard":
        return { phase: "r1Leaderboard", question: this.mcqQuestion(run!), rows: this.leaderboard() };
      case "cut":
        return {
          phase: "cut",
          standings: this.standings(),
          safeCount: this.participants.filter((p) => p.status === "finalist").length,
          wildCardCount: this.wildPlayerIds().length,
          wildCardSkipped: this.wildSkipped,
        };
      case "wcIntro":
      case "wcStandings":
      case "wcWinner":
        return { phase: this.phase, wildCard: this.wildCardState(false)! };
      case "wcRead":
      case "wcAnswer":
      case "wcTimesUp":
        return { phase: this.phase, question: this.mcqQuestion(run!), wildCard: this.wildCardState(false)! };
      case "wcReveal":
        return { phase: "wcReveal", question: this.mcqQuestion(run!), wildCard: this.wildCardState(false)!, ...this.revealOf(run!) };
      case "predictions":
        return { phase: "predictions", finalists: this.finalistInfos(), backing: backing() };
      case "boIntro":
        return { phase: "boIntro", blackout: this.blackoutState()!, backing: backing() };
      case "boRead":
      case "boAnswer":
      case "boTimesUp":
        return { phase: this.phase, question: this.mcqQuestion(run!), blackout: this.blackoutState()!, ...counts(), backing: backing() };
      case "boReveal":
        return { phase: "boReveal", question: this.mcqQuestion(run!), blackout: this.blackoutState()!, backing: backing(), ...this.revealOf(run!) };
      case "boDark":
        return { phase: "boDark", question: this.mcqQuestion(run!), blackout: this.blackoutState()!, backing: backing(), ...this.revealOf(run!) };
      case "boWinner":
        return { phase: "boWinner", blackout: this.blackoutState()!, backing: backing() };
      case "podium":
        return { phase: "podium", ...this.podiumSummary()!, backing: backing() };
    }
  }

  /** The final order and how many called it (Host podium and Admin). null before the podium. */
  private podiumSummary(): PodiumSummary | null {
    if (this.phase !== "podium" || !this.podium) return null;
    const entries = this.podiumEntries();
    const winnerId = this.podium.basis === "blackout" ? entries[0]?.id : undefined;
    return {
      basis: this.podium.basis,
      entries,
      calledIt: winnerId ? this.participants.filter((p) => p.status === "audience" && p.backingId === winnerId).length : 0,
    };
  }

  /** The bots across the top: everyone, then from the wild card round the players in it, from Blackout the finalists. */
  private castMembers(): Participant[] {
    const phase = this.phase;
    if (WC_PHASES.includes(phase)) return this.participants.filter((p) => p.status === "wildcard");
    if (phase === "wcWinner") return this.participants.filter((p) => p.wild && p.status !== "removed");
    if (phase === "predictions") return this.finalists();
    if (BO_PHASES.includes(phase)) return this.runners().sort((a, b) => Number(a.isWildCard) - Number(b.isWildCard) || (a.cutRank ?? 1e6) - (b.cutRank ?? 1e6));
    if (phase === "podium" && this.podium?.basis !== "round1") return this.podium!.order.map((id) => this.find(id)!).filter((p) => p.status !== "removed");
    return this.active();
  }

  hostView(): HostView {
    return {
      roomCode: this.code,
      joinUrl: this.joinUrl,
      roomCodeVisible: this.roomCodeVisible,
      soundOn: this.soundOn,
      settings: this.settings(),
      participants: this.cached("hostParticipants", () => this.active().map((p) => this.tag(p))),
      cast: this.cached("hostCast", () => this.castMembers().map((p) => ({ ...this.tag(p), mood: this.botMood(p) }))),
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

  /** A question step on a phone (read, answer, time's up), for whoever can answer it. */
  private questionScreen(p: Participant, run: Run): ParticipantScreen {
    const answer = run.answers.get(p.id);
    const gap = run.round === 3 && p.runner ? p.runner.position - this.dark : null;
    const base = { round: run.round, questionNumber: run.number, questionCount: this.mcqQuestion(run).count, suddenDeath: run.suddenDeath, gap };
    const locked = (timeUp: boolean): ParticipantScreen => ({
      kind: "lockedIn",
      round: run.round,
      choiceNumber: run.hostOrder.indexOf(answer!.optionIndex) + 1,
      choiceText: run.question.options[answer!.optionIndex],
      timeUp,
      gap,
    });
    if (READ_PHASES.includes(this.phase)) return { kind: "eyesUp", ...base };
    // Blackout: the runner's phone keeps the question and its options up, the tapped one locked.
    if (run.round === 3 && ANSWER_PHASES.includes(this.phase)) {
      return {
        kind: "answer",
        ...base,
        questionId: run.id,
        options: this.optionsFor(run),
        text: run.question.text,
        chosenId: answer ? run.optionIds[answer.optionIndex] : null,
      };
    }
    if (ANSWER_PHASES.includes(this.phase))
      return answer ? locked(false) : { kind: "answer", ...base, questionId: run.id, options: this.optionsFor(run), text: null, chosenId: null };
    return answer ? locked(true) : { kind: "timesUp", round: run.round };
  }

  private participantScreen(p: Participant): ParticipantScreen {
    if (p.status === "removed") return { kind: "removed" };
    const phase = this.phase;
    const run = this.run;
    if (phase === "podium") return this.podiumScreen(p);
    if (phase === "lobby") return { kind: "lobby", joined: this.counts().joined };
    if (phase === "r1Intro") return { kind: "r1Intro", settings: this.settings() };

    // Round 1
    if (run?.round === 1 && R1_QUESTION_PHASES.includes(phase)) {
      if (!this.playsRound1Question(p, run)) return p.status === "playing" ? { kind: "nextQuestion" } : { kind: "audience" };
      if (!REVEALED_PHASES.includes(phase)) return this.questionScreen(p, run);
      if (run.voided) return { kind: "voided", round: 1 };
      const a = run.answers.get(p.id);
      return {
        kind: "result",
        round: 1,
        outcome: !a ? "missed" : a.optionIndex === run.question.correct ? "correct" : "wrong",
        correctText: run.question.options[run.question.correct],
        tally: null,
      };
    }

    if (phase === "cut") {
      if (p.cutRank === null) return { kind: "audience" };
      return { kind: "cut", outcome: p.status === "finalist" ? "safe" : "wildcard", rank: p.cutRank, of: this.cutOrder!.length, safeCount: this.config.safe };
    }

    // Wild card round
    if (WC_PHASES.includes(phase)) {
      if (p.status === "finalist") {
        return { kind: "safeWatch", players: this.wildPlayerIds().length, questionNumber: run?.round === 2 ? run.number : this.wcNumber, questionCount: this.config.wildCard.questions };
      }
      if (p.status !== "wildcard" || !p.wild) return { kind: "audience" };
      const sd: "in" | "out" | null = this.sudden ? (this.sudden.alive.includes(p.id) ? "in" : this.sudden.out.includes(p.id) ? "out" : null) : null;
      const status: ParticipantScreen = { kind: "wcStatus", right: p.wild.correct, asked: p.wild.asked, questionCount: this.config.wildCard.questions, suddenDeath: sd };
      if (!run || run.round !== 2 || phase === "wcIntro" || phase === "wcStandings") return status;
      if (!run.players.has(p.id)) return status;
      if (!REVEALED_PHASES.includes(phase)) return this.questionScreen(p, run);
      if (run.voided) return { kind: "voided", round: 2 };
      const a = run.answers.get(p.id);
      return {
        kind: "result",
        round: 2,
        outcome: !a ? "missed" : a.optionIndex === run.question.correct ? "correct" : "wrong",
        correctText: run.question.options[run.question.correct],
        tally: { right: p.wild.correct, asked: p.wild.asked },
      };
    }

    if (phase === "wcWinner") {
      if (!p.wild) return p.status === "finalist" ? { kind: "safeWatch", players: 0, questionNumber: this.wcNumber, questionCount: this.config.wildCard.questions } : { kind: "audience" };
      const winner = this.wcWinnerId ? this.find(this.wcWinnerId) : undefined;
      return { kind: "wcWinner", you: p.isWildCard && p.status === "finalist" ? "won" : "lost", winner: winner ? this.tag(winner) : null };
    }

    if (phase === "predictions") {
      if (p.status === "finalist") return this.runnerStatus(p);
      return { kind: "backFinalist", finalists: this.finalistInfos(), backedId: p.backingId };
    }

    // Blackout
    if (BO_PHASES.includes(phase)) {
      if (p.status !== "finalist" || !p.runner) return this.blackoutWatch(p);
      if (!p.runner.alive || !run || run.round !== 3 || phase === "boIntro" || phase === "boDark" || phase === "boWinner" || !run.players.has(p.id)) {
        return this.runnerStatus(p);
      }
      // A runner's phone shows only the question and its options while answering; every other step is a plain wait.
      if (phase === "boAnswer") return this.questionScreen(p, run);
      return this.runnerStatus(p);
    }
    return { kind: "audience" };
  }

  private runnerStatus(p: Participant): ParticipantScreen {
    const r = p.runner;
    const alive = this.runners().filter((x) => x.runner!.alive).length;
    const headStart = r?.headStart ?? (p.isWildCard ? this.config.blackout.headStart.wildCard : (p.cutRank ?? 99) <= 3 ? this.config.blackout.headStart.top3 : this.config.blackout.headStart.safe);
    const position = r?.position ?? this.config.blackout.baseGap + headStart;
    return {
      kind: "runnerStatus",
      alive: r ? r.alive : true,
      gap: position - this.dark,
      position,
      headStart,
      caughtNow: this.phase === "boDark" && this.caughtThisQuestion.includes(p.id),
      place: this.blackoutPlaces().get(p.id) ?? null,
      aliveCount: this.boStarted ? alive : this.finalistIds().length,
      questionNumber: this.run?.round === 3 ? this.run.number : this.boNumber,
      questionsLeft: this.boStarted ? this.blackoutQuestions.length - this.boNext : null,
      nextUp: this.autopilotNext(),
    };
  }

  /** What the running Blackout hold leads to, for the phones' "Next question in 3". */
  private autopilotNext(): "question" | "winner" | "podium" | null {
    if (!this.timer) return null;
    if (this.phase === "boIntro" || (this.phase === "boReveal" && this.run?.voided)) return "question";
    if (this.phase === "boDark") return this.boOver || this.aliveRunners().length <= 1 ? "winner" : "question";
    if (this.phase === "boWinner") return "podium";
    return null;
  }

  private blackoutWatch(p: Participant): ParticipantScreen {
    const state = this.blackoutState();
    const backed = p.backingId ? this.find(p.backingId) : undefined;
    const runners = (state?.runners ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color, head: r.head, mood: r.mood, gap: r.gap, alive: r.alive, place: r.place }));
    return {
      kind: "blackoutWatch",
      backed: backed ? this.tag(backed) : null,
      runners,
      alive: runners.filter((r) => r.alive).length,
      questionNumber: state?.questionNumber ?? 0,
      questionsLeft: state?.questionsLeft ?? null,
      winner: state?.winner ?? null,
    };
  }

  private podiumScreen(p: Participant): ParticipantScreen {
    const entries = this.podiumEntries();
    const basis = this.podium!.basis;
    const winner = entries[0] ? this.tag(this.find(entries[0].id)!) : null;
    const mine = entries.find((e) => e.id === p.id);
    const backedP = p.status === "audience" && p.backingId ? this.find(p.backingId) : undefined;
    return {
      kind: "podium",
      basis,
      place: mine ? mine.place : null,
      of: entries.length,
      winner,
      backed: backedP ? this.tag(backedP) : null,
      calledIt: backedP && winner && basis === "blackout" ? backedP.id === winner.id : null,
      round1Rank: this.round1RankMap().get(p.id) ?? null,
    };
  }

  // ==========================================================================
  // ADMIN view
  // ==========================================================================

  private adminQuestion(): AdminQuestion | null {
    const run = this.run;
    if (!run) return null;
    const revealed = REVEALED_PHASES.includes(this.phase) || this.phase === "podium";
    const counts = revealed ? this.optionResults(run) : null;
    const options = run.hostOrder.map((i, slot) => ({
      number: slot + 1,
      text: run.question.options[i],
      correct: i === run.question.correct,
      count: counts ? counts[slot].count : null,
    }));
    const correct = options.find((o) => o.correct)!;
    const q = this.mcqQuestion(run);
    return {
      id: run.id,
      round: run.round,
      number: run.number,
      count: q.count,
      suddenDeath: run.suddenDeath,
      text: run.question.text,
      image: run.question.image,
      options,
      correctNumber: correct.number,
      correctText: correct.text,
      voided: run.voided,
    };
  }

  /** What db.ts saves: the step and everyone's standing. */
  snapshot(): RoomSnapshot {
    const rank = this.round1RankMap();
    const places = this.blackoutPlaces();
    return {
      phase: this.phase,
      questionIndex: this.run ? this.run.number : -1,
      players: this.participants.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        score: p.score,
        round1Rank: rank.get(p.id) ?? null,
        wildCorrect: p.wild ? p.wild.correct : null,
        blackoutPlace: places.get(p.id) ?? null,
        blackoutPosition: p.runner ? p.runner.position : null,
      })),
    };
  }

  private adminParticipants(): AdminParticipant[] {
    return this.cached("adminParticipants", () => {
      const rank = this.round1RankMap();
      const places = this.blackoutPlaces();
      const run = this.run && (ANSWER_PHASES.includes(this.phase) || TIMES_UP_PHASES.includes(this.phase) || REVEALED_PHASES.includes(this.phase)) ? this.run : null;
      return this.participants.map((p) => ({
        ...this.tag(p),
        status: p.status,
        connected: p.connected,
        joinedLate: p.joinedLate,
        pageHidden: p.pageHidden,
        leftPageCount: p.leftPageCount,
        score: p.score,
        rank: rank.get(p.id) ?? null,
        wildCorrect: p.wild ? p.wild.correct : null,
        wildTimeMs: p.wild ? p.wild.timeMs : null,
        isWildCard: p.isWildCard,
        blackout: p.runner
          ? { position: p.runner.position, gap: p.runner.position - this.dark, caughtOnQuestion: p.runner.caughtOnQuestion, place: places.get(p.id) ?? null }
          : null,
        answered: run && (run.round === 1 ? this.playsRound1Question(p, run) : run.players.has(p.id)) ? run.answers.has(p.id) : null,
        backingId: p.backingId,
      }));
    });
  }

  /** Blackout's autopilot for Admin (boIntro to boWinner). */
  private autopilotState(): AutopilotState | null {
    if (!this.boStarted || !BO_PHASES.includes(this.phase)) return null;
    const step = (
      { boIntro: "intro", boRead: "read", boAnswer: "answer", boTimesUp: "timesUp", boReveal: "reveal", boDark: "dark", boWinner: "winner" } as const
    )[this.phase as "boIntro"];
    const voided = !!this.run?.voided;
    const next: Record<AutopilotState["step"], string> = {
      intro: "Question 1",
      read: "Answers open",
      answer: "Time's up",
      timesUp: "Runners move",
      reveal: voided ? "Next question" : "The dark moves",
      dark: this.boOver || this.aliveRunners().length <= 1 ? "Winner" : "Next question",
      winner: "Podium",
    };
    const t = this.timer;
    return {
      running: true,
      paused: this.paused,
      step,
      nextInMs: t ? (this.paused ? t.remainingMs ?? 0 : Math.max(0, t.endsAt - this.clock.now())) : null,
      nextLabel: next[step],
      questionNumber: this.run?.round === 3 ? this.run.number : this.boNumber,
      questionsLeft: this.blackoutQuestions.length - this.boNext,
    };
  }

  /** Admin only: where the dark goes next and who it would catch (exact once the runners have moved). */
  private darkPreview(): DarkPreview | null {
    const run = this.run;
    if (!run || run.round !== 3 || run.voided || !["boRead", "boAnswer", "boTimesUp", "boReveal"].includes(this.phase)) return null;
    const steps = darknessStep(this.config, run.number);
    const to = this.dark + steps;
    return {
      steps,
      to,
      catches: this.aliveRunners()
        .filter((p) => p.runner!.position <= to)
        .map((p) => this.tag(p)),
      exact: this.phase === "boReveal",
    };
  }

  adminView(): AdminView {
    const { primary, optional, hint } = this.cached("primary", () => this.primaryAndHint());
    const answerCounts = this.answerCounts();
    return {
      roomCode: this.code,
      joinUrl: this.joinUrl,
      settings: this.settings(),
      phase: this.phase,
      stepId: this.step,
      stepLabel: this.stepLabel(),
      primary,
      optional: optional.filter((o) => this.allowedActions().has(o.action.type)),
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
      finalists: this.cutOrder ? this.finalistInfos() : [],
      wildCard: this.wildCardState(true),
      blackout: this.blackoutState(),
      cut: this.cutOrder
        ? {
            standings: this.standings(),
            safeCount: this.participants.filter((p) => p.status === "finalist" && !p.isWildCard).length,
            wildCardCount: this.wildPlayerIds().length,
            wildCardSkipped: this.wildSkipped,
          }
        : null,
      autopilot: this.autopilotState(),
      darkPreview: this.cached("darkPreview", () => this.darkPreview()),
      backing: this.cutOrder ? this.backing() : null,
      podium: this.podiumSummary(),
      quizTitle: this.quizTitle,
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

function csvCell(value: string) {
  // Quote anything with separators, and neutralise spreadsheet formulas in names.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
