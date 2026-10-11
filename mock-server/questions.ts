import { readFileSync } from "node:fs";
import path from "node:path";

/** One MCQ as written in data/questions.json. */
export interface QuizQuestion {
  id: string;
  /** 1–5 pins it to a round, "duel" to the final, null = any round. */
  round: number | "duel" | null;
  text: string;
  image: string | null;
  options: [string, string, string, string];
  /** Index (0–3) of the right option. */
  correct: number;
}

export const QUESTIONS_FILE = path.join(process.cwd(), "data", "questions.json");

/** Reads and checks the question file. Throws a clear error if something's wrong. */
export function loadQuestions(file = QUESTIONS_FILE): QuizQuestion[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { questions?: unknown[] };
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error(`${file} needs a non-empty "questions" array.`);
  }
  return raw.questions.map((q, i) => validate(q, i));
}

function validate(value: unknown, index: number): QuizQuestion {
  const q = value as Partial<QuizQuestion>;
  const where = `Question ${index + 1}${q?.id ? ` (${q.id})` : ""}`;
  if (!q || typeof q.text !== "string" || !q.text.trim()) throw new Error(`${where}: missing text.`);
  if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => typeof o !== "string")) {
    throw new Error(`${where}: needs exactly 4 text options.`);
  }
  if (typeof q.correct !== "number" || q.correct < 0 || q.correct > 3) {
    throw new Error(`${where}: "correct" must be 0, 1, 2 or 3.`);
  }
  return {
    id: typeof q.id === "string" ? q.id : `q${index + 1}`,
    round: q.round === "duel" || typeof q.round === "number" ? q.round : null,
    text: q.text.trim(),
    image: typeof q.image === "string" && q.image ? q.image : null,
    options: q.options as QuizQuestion["options"],
    correct: q.correct,
  };
}

/**
 * Questions for one round (or the duel): the ones pinned to it first, then
 * unpinned ones, repeating if there aren't enough (the demo has only 3).
 */
export function pickQuestions(all: QuizQuestion[], round: number | "duel", count: number): QuizQuestion[] {
  const pinned = all.filter((q) => q.round === round);
  const any = all.filter((q) => q.round === null);
  const pool = [...pinned, ...any];
  const source = pool.length > 0 ? pool : all;
  return Array.from({ length: count }, (_, i) => source[i % source.length]);
}
