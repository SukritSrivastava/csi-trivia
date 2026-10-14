import { readFileSync } from "node:fs";
import path from "node:path";
import { correctList, isMultiCorrect, packCorrect } from "../src/shared/quiz";

/** One MCQ as written in data/questions.json. */
export interface QuizQuestion {
  id: string;
  /** 1 = Round 1, 2 = wild card round, 3 = Blackout, null = any round. */
  round: 1 | 2 | 3 | null;
  text: string;
  /** Path under /public (e.g. "/questions/hexagon.svg"), shown on the Host only. */
  image: string | null;
  options: [string, string, string, string];
  /** Index (0–3) of the right option, or 2–4 indexes for a multi-correct question (Round 1 only). */
  correct: number | number[];
  /** This question's own read time (ms), overriding the quiz's. From the quiz library only. */
  readMs?: number;
  /** This question's own answer time (ms), overriding the quiz's. From the quiz library only. */
  openMs?: number;
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
    if (round !== null && round !== 1 && round !== 2 && round !== 3) {
      problems.push(`${where}: "round" must be 1 (Round 1), 2 (wild card), 3 (Blackout) or null (got ${JSON.stringify(q.round)}).`);
    }

    const options = q.options;
    if (!Array.isArray(options) || options.length !== 4 || options.some((o) => typeof o !== "string" || !o.trim())) {
      problems.push(`${where}: needs exactly 4 non-empty text options.`);
    } else if (new Set(options.map((o: string) => o.trim().toLowerCase())).size !== 4) {
      problems.push(`${where}: the 4 options must all be different.`);
    }

    const correctRaw = q.correct;
    const isIndex = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3;
    if (Array.isArray(correctRaw)) {
      if (correctRaw.length === 0 || !correctRaw.every(isIndex) || new Set(correctRaw).size !== correctRaw.length) {
        problems.push(`${where}: "correct" as a list must hold 0–3 indexes, each once (like [0, 2]).`);
      } else if (correctRaw.length >= 2 && round !== 1) {
        problems.push(`${where}: several right answers are allowed in Round 1 only: set "round": 1.`);
      }
    } else if (!isIndex(correctRaw)) {
      problems.push(`${where}: "correct" must be 0, 1, 2 or 3 (the index of the right option), or a list like [0, 2] for a Round 1 question with several right answers.`);
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
        correct: packCorrect(correctList(correctRaw as number | number[])),
      });
    }
  });

  if (problems.length) {
    throw new Error(`${file} has ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  }
  return questions;
}

/**
 * The questions one round plays, in order: those tagged for it (file order),
 * then untagged ones nobody has used yet. `used` holds ids already taken by
 * earlier rounds (and is updated). With `reuse` (the demo preset only), a short
 * list is topped up by cycling through every question; each run still gets
 * fresh opaque ids. Without it, the list is simply as long as it can be.
 */
export function pickRound(all: QuizQuestion[], round: 1 | 2 | 3, count: number, used: Set<string>, reuse = false): QuizQuestion[] {
  // Multi-correct questions are Round 1 only: the wild card and Blackout never take one.
  const fits = (q: QuizQuestion) => round === 1 || !isMultiCorrect(q);
  const tagged = all.filter((q) => q.round === round && !used.has(q.id) && fits(q));
  const untagged = all.filter((q) => q.round === null && !used.has(q.id) && fits(q));
  const picked = [...tagged, ...untagged].slice(0, count);
  for (const q of picked) used.add(q.id);
  if (picked.length < count && reuse && all.length > 0) {
    const pool = all.filter((q) => (q.round === round || q.round === null) && fits(q));
    const source = pool.length ? pool : all.filter(fits);
    for (let i = 0; source.length && picked.length < count; i++) picked.push(source[i % source.length]);
  }
  return picked;
}
