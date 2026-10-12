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
import { blankQuestion } from "../src/shared/quiz";
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

/** The server preset's rules, for a new quiz. */
export function defaultRules(config: GameConfig, round1Count = 0, buzzerCount = 0): QuizRules {
  const r1 = config.round1.questions === "all" ? round1Count : config.round1.questions;
  return {
    round1Questions: Math.max(1, round1Count ? Math.min(r1, round1Count) : r1),
    round1ReadSeconds: config.round1.readMs / 1000,
    round1AnswerSeconds: config.round1.answerMs / 1000,
    finalists: config.finalists,
    buzzerQuestions: Math.max(1, buzzerCount ? Math.min(config.round2.questions, buzzerCount) : config.round2.questions),
    buzzerReadSeconds: config.round2.readMs / 1000,
    buzzWindowSeconds: config.round2.buzzMs / 1000,
    spokenAnswerSeconds: config.round2.answerMs / 1000,
    reopenSeconds: config.round2.reopenMs / 1000,
  };
}

/** The frozen copy a room plays: its config (from the quiz's rules) and its questions. */
export function quizToGame(quiz: Quiz, base: GameConfig): { config: GameConfig; questions: QuizQuestion[] } {
  const r = quiz.rules;
  const ms = (s: number | null) => (s === null ? undefined : s * 1000);
  const toQuestion = (round: 1 | 2, prefix: string) => (q: Quiz["round1"][number]): QuizQuestion => ({
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
      finalists: r.finalists,
      round2: {
        questions: r.buzzerQuestions,
        readMs: r.buzzerReadSeconds * 1000,
        buzzMs: r.buzzWindowSeconds * 1000,
        answerMs: r.spokenAnswerSeconds * 1000,
        reopenMs: r.reopenSeconds * 1000,
      },
    },
    questions: [...quiz.round1.map(toQuestion(1, "r1-")), ...quiz.buzzer.map(toQuestion(2, "b-"))],
  };
}

export const DEMO_QUIZ_ID = "demo";

/**
 * Makes sure the library isn't empty: adds a "Demo quiz" built from
 * data/questions.json (Round 1: questions tagged 1 or untagged; buzzer: tagged 2,
 * or a copy of Round 1 when there are none).
 */
export async function ensureDemoQuiz(store: LibraryStore, config: GameConfig, questionsFile?: string) {
  if ((await store.list()).length > 0) return;
  const all = loadQuestions(questionsFile);
  const toLib = (q: QuizQuestion) => ({ ...blankQuestion(), text: q.text, options: q.options, correct: q.correct, image: q.image });
  const round1 = all.filter((q) => q.round !== 2).map(toLib);
  const tagged = all.filter((q) => q.round === 2).map(toLib);
  const buzzer = tagged.length ? tagged : round1.map((q) => ({ ...q, ...blankQuestion(), text: q.text, options: q.options, correct: q.correct, image: q.image }));
  await store.save({
    id: DEMO_QUIZ_ID,
    title: "Demo quiz",
    rules: defaultRules(config, round1.length, buzzer.length),
    round1,
    buzzer,
    updatedAt: Date.now(),
  });
}
