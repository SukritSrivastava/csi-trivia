/**
 * The quiz library: quizzes the quizmaster creates in Admin, and their images.
 *
 * Three stores with the same interface:
 *   PostgresLibrary  Supabase (when DATABASE_URL is set): tables quizzes, quiz_images (db.ts)
 *   FileLibrary      a folder (local development without a database): data/library/
 *   MemoryLibrary    tests
 *
 * A room never reads the library while it plays: admin:openRoom takes a frozen
 * copy (quizToGame), so editing a quiz never changes a game in progress.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Quiz, QuizRules } from "../src/shared/protocol";
import { blankQuestion, isLegacyQuiz } from "../src/shared/quiz";
import type { GameConfig } from "./config";
import type { Database } from "./db";
import { loadQuestions, type QuizQuestion } from "./questions";

export interface StoredImage {
  bytes: Buffer;
  mime: string;
}

export interface LibraryStore {
  list(): Promise<Quiz[]>;
  get(id: string): Promise<Quiz | null>;
  save(quiz: Quiz): Promise<void>;
  remove(id: string): Promise<boolean>;
  /** Returns the image id. */
  putImage(image: StoredImage): Promise<string>;
  getImage(id: string): Promise<StoredImage | null>;
}

export const newImageId = () => randomBytes(10).toString("hex");

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export class MemoryLibrary implements LibraryStore {
  private quizzes = new Map<string, Quiz>();
  private images = new Map<string, StoredImage>();
  async list() {
    return [...this.quizzes.values()].map((q) => structuredClone(q));
  }
  async get(id: string) {
    const q = this.quizzes.get(id);
    return q ? structuredClone(q) : null;
  }
  async save(quiz: Quiz) {
    this.quizzes.set(quiz.id, structuredClone(quiz));
  }
  async remove(id: string) {
    return this.quizzes.delete(id);
  }
  async putImage(image: StoredImage) {
    const id = newImageId();
    this.images.set(id, image);
    return id;
  }
  async getImage(id: string) {
    return this.images.get(id) ?? null;
  }
}

/** One JSON file per quiz plus an images folder. For running locally without Supabase. */
export class FileLibrary implements LibraryStore {
  private quizDir: string;
  private imageDir: string;
  constructor(dir: string) {
    this.quizDir = path.join(dir, "quizzes");
    this.imageDir = path.join(dir, "images");
    mkdirSync(this.quizDir, { recursive: true });
    mkdirSync(this.imageDir, { recursive: true });
  }
  private file = (id: string) => path.join(this.quizDir, `${id.replace(/[^\w-]/g, "")}.json`);
  async list() {
    return readdirSync(this.quizDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(this.quizDir, f), "utf8")) as Quiz);
  }
  async get(id: string) {
    try {
      return JSON.parse(readFileSync(this.file(id), "utf8")) as Quiz;
    } catch {
      return null;
    }
  }
  async save(quiz: Quiz) {
    writeFileSync(this.file(quiz.id), JSON.stringify(quiz, null, 2));
  }
  async remove(id: string) {
    try {
      rmSync(this.file(id));
      return true;
    } catch {
      return false;
    }
  }
  async putImage(image: StoredImage) {
    const id = newImageId();
    writeFileSync(path.join(this.imageDir, id), image.bytes);
    writeFileSync(path.join(this.imageDir, `${id}.type`), image.mime);
    return id;
  }
  async getImage(id: string) {
    if (!/^[a-f0-9]{20}$/.test(id)) return null;
    try {
      return { bytes: readFileSync(path.join(this.imageDir, id)), mime: readFileSync(path.join(this.imageDir, `${id}.type`), "utf8") };
    } catch {
      return null;
    }
  }
}

/** Supabase / Postgres: tables quizzes (jsonb) and quiz_images (base64 text), created by db.ts. */
export class PostgresLibrary implements LibraryStore {
  constructor(private readonly db: Database) {}
  async list() {
    const rows = await this.db.query<{ data: Quiz | string }>("SELECT data FROM quizzes ORDER BY updated_at DESC");
    return rows.map((r) => (typeof r.data === "string" ? (JSON.parse(r.data) as Quiz) : r.data));
  }
  async get(id: string) {
    const rows = await this.db.query<{ data: Quiz | string }>("SELECT data FROM quizzes WHERE id = $1", [id]);
    if (!rows[0]) return null;
    return typeof rows[0].data === "string" ? (JSON.parse(rows[0].data) as Quiz) : rows[0].data;
  }
  async save(quiz: Quiz) {
    await this.db.query(
      `INSERT INTO quizzes (id, title, data, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [quiz.id, quiz.title, JSON.stringify(quiz), new Date(quiz.updatedAt).toISOString()],
    );
  }
  async remove(id: string) {
    const rows = await this.db.query<{ id: string }>("DELETE FROM quizzes WHERE id = $1 RETURNING id", [id]);
    return rows.length > 0;
  }
  async putImage(image: StoredImage) {
    const id = newImageId();
    await this.db.query("INSERT INTO quiz_images (id, mime, data) VALUES ($1, $2, $3)", [id, image.mime, image.bytes.toString("base64")]);
    return id;
  }
  async getImage(id: string) {
    if (!/^[a-f0-9]{20}$/.test(id)) return null;
    const rows = await this.db.query<{ mime: string; data: string }>("SELECT mime, data FROM quiz_images WHERE id = $1", [id]);
    return rows[0] ? { mime: rows[0].mime, bytes: Buffer.from(rows[0].data, "base64") } : null;
  }
}

// ---------------------------------------------------------------------------
// Quiz ↔ game
// ---------------------------------------------------------------------------

/** The server preset's rules, for a new quiz (or capped to the lists' lengths, when given). */
export function defaultRules(config: GameConfig, counts?: Partial<Record<"round1" | "wildcard" | "blackout", number>>): QuizRules {
  const cap = (planned: number, have: number | undefined) => Math.max(1, have ? Math.min(planned, have) : planned);
  return {
    round1Questions: cap(config.round1.questions, counts?.round1),
    round1ReadSeconds: config.round1.readMs / 1000,
    round1AnswerSeconds: config.round1.answerMs / 1000,
    safe: config.safe,
    wildCardQuestions: cap(config.wildCard.questions, counts?.wildcard),
    blackoutReadSeconds: config.blackout.readMs / 1000,
    blackoutAnswerSeconds: config.blackout.answerMs / 1000,
  };
}

/**
 * The frozen copy a room plays: its config (the quiz's rules over the preset;
 * the Blackout tuning always from the preset) and its questions, tagged 1, 2, 3.
 */
export function quizToGame(quiz: Quiz, base: GameConfig): { config: GameConfig; questions: QuizQuestion[] } {
  const r = quiz.rules;
  const ms = (s: number | null) => (s === null ? undefined : s * 1000);
  const toQuestion = (round: 1 | 2 | 3, prefix: string) => (q: Quiz["round1"][number]): QuizQuestion => ({
    id: `${prefix}${q.id}`,
    round,
    text: q.text,
    image: q.image,
    options: q.options,
    correct: q.correct,
    readMs: ms(q.readSeconds),
    openMs: ms(q.openSeconds),
  });
  return {
    config: {
      ...base,
      round1: { questions: r.round1Questions, readMs: r.round1ReadSeconds * 1000, answerMs: r.round1AnswerSeconds * 1000 },
      safe: r.safe,
      // The wild card round uses Round 1's timings (docs/SPEC.md v3).
      wildCard: { ...base.wildCard, questions: r.wildCardQuestions, readMs: r.round1ReadSeconds * 1000, answerMs: r.round1AnswerSeconds * 1000 },
      // Blackout plays its whole list (no count); the tuning and the autopilot holds come from the preset.
      blackout: { ...base.blackout, readMs: r.blackoutReadSeconds * 1000, answerMs: r.blackoutAnswerSeconds * 1000 },
    },
    questions: [
      ...quiz.round1.map(toQuestion(1, "r1-")),
      ...quiz.wildcard.map(toQuestion(2, "wc-")),
      ...quiz.blackout.map(toQuestion(3, "bo-")),
    ],
  };
}

export const DEMO_QUIZ_ID = "demo";

/**
 * Makes sure the library isn't empty: adds a "Demo quiz" built from
 * data/questions.json. Each list takes the questions tagged for it, else the
 * untagged ones, repeated to fill the preset's counts (the demo reuses its 3
 * questions in every round; each run still gets fresh ids). A Demo quiz saved
 * before v3 (no Blackout list) or with too few Blackout questions is rebuilt.
 */
export async function ensureDemoQuiz(store: LibraryStore, config: GameConfig, questionsFile?: string) {
  const quizzes = await store.list();
  const demo = quizzes.find((q) => q.id === DEMO_QUIZ_ID);
  // Rebuilt when it was saved before v3 (no Blackout list) or before v3.1 (too few Blackout questions for the autopilot).
  // …or built for the other preset (switching between `npm run dev` and the event preset locally).
  const outdated =
    !!demo &&
    (isLegacyQuiz(demo) ||
      (Array.isArray(demo.blackout) ? demo.blackout.length : 0) < config.blackout.minQuestions ||
      demo.rules?.safe !== config.safe ||
      demo.rules?.round1Questions !== config.round1.questions);
  if (quizzes.length > 0 && !outdated) return;
  const all = loadQuestions(questionsFile);
  const toLib = (q: QuizQuestion) => ({ ...blankQuestion(), text: q.text, options: q.options, correct: q.correct, image: q.image });
  const fill = (round: 1 | 2 | 3, count: number) => {
    const tagged = all.filter((q) => q.round === round);
    const pool = tagged.length ? tagged : all.filter((q) => q.round === null);
    const source = pool.length ? pool : all;
    return Array.from({ length: Math.max(count, tagged.length) }, (_, i) => toLib(source[i % source.length]));
  };
  const round1 = fill(1, config.round1.questions);
  const wildcard = fill(2, config.wildCard.questions + config.wildCard.suddenDeathMax);
  const blackout = fill(3, config.blackout.minQuestions);
  await store.save({
    id: DEMO_QUIZ_ID,
    title: "Demo quiz",
    rules: defaultRules(config, { round1: round1.length, wildcard: wildcard.length, blackout: blackout.length }),
    round1,
    wildcard,
    blackout,
    updatedAt: Date.now(),
  });
}
