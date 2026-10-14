/**
 * The question bank for the night: final_quiz.json in the project root.
 *
 * Its format (see its own `_format` field) differs from data/questions.json:
 * rounds are "1" / "wild card" / "blackout", options are keyed A–D, `correct` is
 * a list of letters (2+ only in Round 1), `spare: true` questions are backups
 * kept at the bottom of their round. `loadFinalQuiz` checks every rule and
 * throws ONE error listing every problem, so the server refuses to start with a
 * broken file instead of failing mid-quiz. The result is a library Quiz (id
 * FINAL_QUIZ_ID) that Admin opens like any other.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type LibraryQuestion, type Quiz, QUIZ_LIMITS, type QuizRules } from "../src/shared/protocol";
import { LIST_LABELS, type ListName, packCorrect, quizProblems } from "../src/shared/quiz";

export const FINAL_QUIZ_FILE = path.join(process.cwd(), "final_quiz.json");
export const FINAL_QUIZ_ID = "final";
export const FINAL_QUIZ_TITLE = "Hermes final quiz";

const ROUNDS: Record<string, ListName> = { "1": "round1", "wild card": "wildcard", blackout: "blackout" };
const LETTERS = ["A", "B", "C", "D"] as const;

/**
 * Reads and checks final_quiz.json. `rules` supplies what the file doesn't say
 * (safe seats, the round timings); the number of Round 1 and wild card questions
 * played is the number of non-spare questions in each. `minBlackout` is the
 * server's minimum Blackout list (12 at the event).
 */
export function loadFinalQuiz(file: string, rules: QuizRules, minBlackout: number): Quiz {
  const fail = (problems: string[]): never => {
    throw new Error(`${path.basename(file)} has ${problems.length} problem(s), so the quiz server won't start:\n  - ${problems.join("\n  - ")}`);
  };
  if (!existsSync(file)) fail([`${file} doesn't exist.`]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail([`it isn't valid JSON (${e instanceof Error ? e.message : String(e)}).`]);
  }
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list) || list.length === 0) fail(['it needs a non-empty "questions" array.']);

  const problems: string[] = [];
  const seenIds = new Set<string>();
  const lists: Record<ListName, { q: LibraryQuestion; spare: boolean }[]> = { round1: [], wildcard: [], blackout: [] };

  (list as unknown[]).forEach((value, i) => {
    const q = (value ?? {}) as Record<string, unknown>;
    const id = typeof q.id === "string" && q.id.trim() ? q.id.trim() : "";
    const where = `Question ${i + 1}${id ? ` (${id})` : ""}`;
    const before = problems.length;

    if (!id) problems.push(`${where}: missing "id".`);
    else if (seenIds.has(id)) problems.push(`${where}: the id "${id}" is used twice.`);
    seenIds.add(id);

    const listName = typeof q.round === "string" ? ROUNDS[q.round.trim().toLowerCase()] : undefined;
    if (!listName) problems.push(`${where}: "round" must be "1", "wild card" or "blackout" (got ${JSON.stringify(q.round)}).`);
    if (typeof q.spare !== "boolean") problems.push(`${where}: "spare" must be true or false.`);

    const text = typeof q.text === "string" ? q.text.trim() : "";
    if (!text) problems.push(`${where}: missing "text".`);
    else if (text.length > QUIZ_LIMITS.questionText) problems.push(`${where}: the text is ${text.length} characters (max ${QUIZ_LIMITS.questionText}).`);

    const opts = q.options as Record<string, unknown> | null;
    const keys = opts && typeof opts === "object" && !Array.isArray(opts) ? Object.keys(opts) : [];
    const options: string[] = [];
    if (keys.length !== 4 || !LETTERS.every((l) => keys.includes(l))) {
      problems.push(`${where}: "options" must have exactly the keys A, B, C and D.`);
    } else {
      for (const l of LETTERS) {
        const o = opts![l];
        if (typeof o !== "string" || !o.trim()) problems.push(`${where}: option ${l} is empty.`);
        else if (o.trim().length > QUIZ_LIMITS.optionText) problems.push(`${where}: option ${l} is ${o.trim().length} characters (max ${QUIZ_LIMITS.optionText}).`);
        else options.push(o.trim());
      }
      if (options.length === 4 && new Set(options.map((o) => o.toLowerCase())).size !== 4) problems.push(`${where}: the 4 options must all be different.`);
    }

    const correct = q.correct;
    let indexes: number[] = [];
    if (!Array.isArray(correct) || correct.length === 0 || correct.length > 4) {
      problems.push(`${where}: "correct" must be a list of 1–4 letters, like ["B"] or ["A", "C"].`);
    } else {
      indexes = correct.map((c) => (typeof c === "string" ? LETTERS.indexOf(c.trim().toUpperCase() as (typeof LETTERS)[number]) : -1));
      if (indexes.some((x) => x < 0)) problems.push(`${where}: "correct" may only hold the letters A, B, C and D (got ${JSON.stringify(correct)}).`);
      else if (new Set(indexes).size !== indexes.length) problems.push(`${where}: "correct" lists a letter twice.`);
      else if (indexes.length >= 2 && listName && listName !== "round1") problems.push(`${where}: only Round 1 questions may have more than one right answer.`);
    }

    const image = q.image === undefined || q.image === null || q.image === "" ? null : q.image;
    if (image !== null) {
      if (typeof image !== "string" || !/^\/[\w./-]{1,200}$/.test(image) || image.includes("..")) problems.push(`${where}: "image" must be a path under /public like "/questions/x.png", or null.`);
      else if (!image.startsWith("/images/") && !existsSync(path.join(process.cwd(), "public", image))) problems.push(`${where}: the image public${image} doesn't exist.`);
    }

    const seconds = (key: "readSeconds" | "answerSeconds", range: { min: number; max: number }): number | null => {
      const v = q[key];
      if (v === null || v === undefined) return null;
      if (typeof v !== "number" || !Number.isInteger(v) || v < range.min || v > range.max) {
        problems.push(`${where}: "${key}" must be null or a whole number of seconds, ${range.min}–${range.max}.`);
        return null;
      }
      return v;
    };
    const readSeconds = seconds("readSeconds", QUIZ_LIMITS.readSeconds);
    const openSeconds = seconds("answerSeconds", QUIZ_LIMITS.openSeconds);

    if (problems.length === before && listName) {
      lists[listName].push({
        spare: q.spare === true,
        q: { id: id.replace(/[^\w-]/g, "-").slice(0, 40), text, options: options as LibraryQuestion["options"], correct: packCorrect(indexes), image: image as string | null, readSeconds, openSeconds },
      });
    }
  });
  if (problems.length) fail(problems);

  // Spares go to the bottom of their round (the file keeps them there; this makes sure).
  const ordered = (name: ListName) => [...lists[name].filter((x) => !x.spare), ...lists[name].filter((x) => x.spare)].map((x) => x.q);
  const played = (name: ListName) => lists[name].filter((x) => !x.spare).length;

  // The "counts" block, when present, must match the questions (catches a question in the wrong round).
  const counts = (raw as { counts?: Record<string, Record<string, number>> }).counts;
  if (counts) {
    const check = (label: string, got: number, want: unknown) => {
      if (typeof want === "number" && got !== want) problems.push(`counts.${label} says ${want} but the file has ${got}.`);
    };
    check("round1.played", played("round1"), counts.round1?.played);
    check("round1.total", lists.round1.length, counts.round1?.total);
    check("round1.spares", lists.round1.length - played("round1"), counts.round1?.spares);
    check("wildCard.played", played("wildcard"), counts.wildCard?.played);
    check("wildCard.total", lists.wildcard.length, counts.wildCard?.total);
    check("wildCard.spares", lists.wildcard.length - played("wildcard"), counts.wildCard?.spares);
    check("blackout.total", lists.blackout.length, counts.blackout?.total);
    if (typeof counts.blackout?.minimum === "number" && lists.blackout.length < counts.blackout.minimum) {
      problems.push(`Blackout needs at least ${counts.blackout.minimum} questions; the file has ${lists.blackout.length}.`);
    }
  }
  if (problems.length) fail(problems);

  const quiz: Quiz = {
    id: FINAL_QUIZ_ID,
    title: FINAL_QUIZ_TITLE,
    rules: { ...rules, round1Questions: played("round1"), wildCardQuestions: played("wildcard") },
    round1: ordered("round1"),
    wildcard: ordered("wildcard"),
    blackout: ordered("blackout"),
    updatedAt: Date.now(),
  };
  // The same checks as opening a room (enough questions for the server's Blackout minimum, every rule in range).
  const ready = quizProblems(quiz, minBlackout);
  if (ready.length) fail(ready);
  for (const name of ["round1", "wildcard"] as const) {
    if (played(name) === 0) fail([`${LIST_LABELS[name]} has no questions that aren't spares.`]);
  }
  return quiz;
}
