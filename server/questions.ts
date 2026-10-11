import { readFileSync } from "node:fs";
import path from "node:path";

/** One MCQ as written in data/questions.json. */
export interface QuizQuestion {
  id: string;
  /** 1 = Round 1, 2 = buzzer round, null = either. */
  round: 1 | 2 | null;
  text: string;
  /** Path under /public (e.g. "/questions/hexagon.svg"), shown on the Host only. */
  image: string | null;
  options: [string, string, string, string];
  /** Index (0–3) of the right option. */
  correct: number;
}

export const QUESTIONS_FILE = path.join(process.cwd(), "data", "questions.json");

/**
 * Reads and checks the question file. Throws one error listing every problem,
 * so a typo in question 37 doesn't take five restarts to find.
 */
export function loadQuestions(file = QUESTIONS_FILE): QuizQuestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Can't read ${file}: ${reason}`);
  }
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${file} needs a non-empty "questions" array.`);
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  const questions: QuizQuestion[] = [];
  list.forEach((value, index) => {
    const q = (value ?? {}) as Record<string, unknown>;
    const id = typeof q.id === "string" && q.id.trim() ? q.id.trim() : `q${index + 1}`;
    const where = `Question ${index + 1} (${id})`;
    const before = problems.length;

    if (seen.has(id)) problems.push(`${where}: the id "${id}" is used twice.`);
    seen.add(id);

    if (typeof q.text !== "string" || !q.text.trim()) problems.push(`${where}: missing "text".`);

    const round = q.round === undefined ? null : q.round;
    if (round !== null && round !== 1 && round !== 2) {
      problems.push(`${where}: "round" must be 1, 2 or null (got ${JSON.stringify(q.round)}).`);
    }

    const options = q.options;
    if (!Array.isArray(options) || options.length !== 4 || options.some((o) => typeof o !== "string" || !o.trim())) {
      problems.push(`${where}: needs exactly 4 non-empty text options.`);
    } else if (new Set(options.map((o: string) => o.trim().toLowerCase())).size !== 4) {
      problems.push(`${where}: the 4 options must all be different.`);
    }

    if (typeof q.correct !== "number" || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
      problems.push(`${where}: "correct" must be 0, 1, 2 or 3 (the index of the right option).`);
    }

    const image = q.image === undefined || q.image === null || q.image === "" ? null : q.image;
    if (image !== null && (typeof image !== "string" || !image.startsWith("/"))) {
      problems.push(`${where}: "image" must be a path starting with "/" (like "/questions/hexagon.svg") or null.`);
    }

    if (problems.length === before) {
      questions.push({
        id,
        round: round as QuizQuestion["round"],
        text: (q.text as string).trim(),
        image: image as string | null,
        options: (options as string[]).map((o) => o.trim()) as QuizQuestion["options"],
        correct: q.correct as number,
      });
    }
  });

  if (problems.length) {
    throw new Error(`${file} has ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }
  return questions;
}

/**
 * Round 1: questions tagged 1, then untagged ones, in file order.
 * "all" takes every one of them; a number repeats the list if there aren't
 * enough (the demo has only 3).
 */
export function pickRound1(all: QuizQuestion[], count: number | "all"): QuizQuestion[] {
  const pool = all.filter((q) => q.round === 1 || q.round === null);
  const source = pool.length > 0 ? pool : all;
  const n = count === "all" ? source.length : count;
  return Array.from({ length: n }, (_, i) => source[i % source.length]);
}

/**
 * Buzzer round: questions tagged 2 first, then untagged ones Round 1 didn't
 * use, then (only if those run out) anything else. Returns `count` questions
 * cycling through that order, so there are always spares for sudden death.
 */
export function pickRound2(all: QuizQuestion[], count: number, usedInRound1: QuizQuestion[]): QuizQuestion[] {
  const used = new Set(usedInRound1.map((q) => q.id));
  const tagged = all.filter((q) => q.round === 2);
  const fresh = all.filter((q) => q.round === null && !used.has(q.id));
  const rest = all.filter((q) => !tagged.includes(q) && !fresh.includes(q));
  const order = [...tagged, ...fresh, ...rest];
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}
