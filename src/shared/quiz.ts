/**
 * Quiz library logic shared by the Admin editor and the game server: checking a
 * quiz, cleaning up what arrives from the network, importing questions (pasted
 * text, CSV, spreadsheet rows, JSON) and exporting them. No browser or Node APIs.
 */
import { type LibraryQuestion, type Quiz, QUIZ_LIMITS, type QuizRules } from "./protocol";

const L = QUIZ_LIMITS;

export const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`)
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12);

export function blankQuestion(): LibraryQuestion {
  return { id: newId(), text: "", options: ["", "", "", ""], correct: 0, image: null, readSeconds: null, openSeconds: null };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

const inRange = (n: unknown, r: { min: number; max: number }) => typeof n === "number" && Number.isInteger(n) && n >= r.min && n <= r.max;

/** Problems with one question, in plain words (empty = fine). `where` e.g. "Round 1, question 3". */
export function questionProblems(q: LibraryQuestion, where: string): string[] {
  const p: string[] = [];
  if (!q.text.trim()) p.push(`${where}: the question is empty.`);
  const filled = q.options.map((o) => o.trim());
  if (filled.some((o) => !o)) p.push(`${where}: all 4 answers need text.`);
  else if (new Set(filled.map((o) => o.toLowerCase())).size !== 4) p.push(`${where}: the 4 answers must all be different.`);
  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) p.push(`${where}: pick the right answer.`);
  if (q.readSeconds !== null && !inRange(q.readSeconds, L.readSeconds)) {
    p.push(`${where}: read time must be ${L.readSeconds.min}–${L.readSeconds.max} s.`);
  }
  if (q.openSeconds !== null && !inRange(q.openSeconds, L.openSeconds)) {
    p.push(`${where}: answer time must be ${L.openSeconds.min}–${L.openSeconds.max} s.`);
  }
  return p;
}

export function rulesProblems(r: QuizRules, round1Count: number, buzzerCount: number): string[] {
  const p: string[] = [];
  const secs = (v: number, range: { min: number; max: number }, label: string) => {
    if (!inRange(v, range)) p.push(`${label} must be ${range.min}–${range.max} seconds.`);
  };
  if (!Number.isInteger(r.round1Questions) || r.round1Questions < 1) p.push("Play at least 1 Round 1 question.");
  else if (r.round1Questions > round1Count) {
    p.push(`Round 1 is set to ${r.round1Questions} questions but the list has ${round1Count}. Add questions or lower the number.`);
  }
  if (!Number.isInteger(r.buzzerQuestions) || r.buzzerQuestions < 1) p.push("Play at least 1 buzzer question.");
  else if (r.buzzerQuestions > buzzerCount) {
    p.push(`The buzzer round is set to ${r.buzzerQuestions} questions but the list has ${buzzerCount}. Add questions or lower the number.`);
  }
  if (!inRange(r.finalists, L.finalists)) p.push(`Finalists must be ${L.finalists.min}–${L.finalists.max}.`);
  secs(r.round1ReadSeconds, L.readSeconds, "Round 1 read time");
  secs(r.round1AnswerSeconds, L.openSeconds, "Round 1 answer time");
  secs(r.buzzerReadSeconds, L.readSeconds, "Buzzer read time");
  secs(r.buzzWindowSeconds, L.openSeconds, "Buzz window");
  secs(r.spokenAnswerSeconds, L.openSeconds, "Spoken answer time");
  secs(r.reopenSeconds, L.openSeconds, "Reopen window");
  return p;
}

/** Everything that stops this quiz being played. Empty = ready to open a room. */
export function quizProblems(quiz: Quiz): string[] {
  const p: string[] = [];
  if (!quiz.title.trim()) p.push("Give the quiz a title.");
  if (quiz.round1.length === 0) p.push("Add at least one Round 1 question.");
  if (quiz.buzzer.length === 0) p.push("Add at least one buzzer-round question.");
  quiz.round1.forEach((q, i) => p.push(...questionProblems(q, `Round 1, question ${i + 1}`)));
  quiz.buzzer.forEach((q, i) => p.push(...questionProblems(q, `Buzzer round, question ${i + 1}`)));
  p.push(...rulesProblems(quiz.rules, quiz.round1.length, quiz.buzzer.length));
  return p;
}

// ---------------------------------------------------------------------------
// Cleaning up what arrives from the network (lenient: drafts may be incomplete)
// ---------------------------------------------------------------------------

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);
const optInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const imagePath = (v: unknown) => (typeof v === "string" && /^\/[\w./-]{1,200}$/.test(v) && !v.includes("..") ? v : null);

export function cleanQuestion(raw: unknown): LibraryQuestion {
  const q = (raw ?? {}) as Record<string, unknown>;
  const opts = Array.isArray(q.options) ? q.options : [];
  return {
    id: typeof q.id === "string" && /^[\w-]{1,40}$/.test(q.id) ? q.id : newId(),
    text: text(q.text, L.questionText),
    options: [0, 1, 2, 3].map((i) => text(opts[i], L.optionText)) as LibraryQuestion["options"],
    correct: Math.min(3, Math.max(0, int(q.correct, 0))),
    image: imagePath(q.image),
    readSeconds: optInt(q.readSeconds),
    openSeconds: optInt(q.openSeconds),
  };
}

/** A quiz from the network, cleaned up. `fallback` fills missing rules. null if it isn't a quiz at all. */
export function cleanQuiz(raw: unknown, fallback: QuizRules): Quiz | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[\w-]{1,40}$/.test(r.id)) return null;
  const rules = (r.rules ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, L.questionsPerList).map(cleanQuestion) : []);
  return {
    id: r.id,
    title: text(r.title, L.title),
    rules: Object.fromEntries(Object.entries(fallback).map(([k, d]) => [k, int(rules[k], d)])) as unknown as QuizRules,
    round1: list(r.round1),
    buzzer: list(r.buzzer),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------

export type ListName = "round1" | "buzzer";

export interface ImportResult {
  /** Questions per list. Questions with no round go to the list the import was started from. */
  round1: LibraryQuestion[];
  buzzer: LibraryQuestion[];
  /** Lines/rows that couldn't be read, in plain words. */
  problems: string[];
}

function roundOf(value: string, fallback: ListName): ListName {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  if (/^(1|r1|round ?1|one|normal|main)$/.test(v)) return "round1";
  if (/^(2|r2|round ?2|two|buzz|buzzer|buzzer round|final)$/.test(v)) return "buzzer";
  return fallback;
}

const LETTER = /^\(?([a-d1-4])[).:\]]\s+/i;

/** "B", "2", "b)", or the answer's own text → index 0–3, or -1. */
function correctIndex(value: string, options: string[]): number {
  const v = value.trim().replace(/[).:\]]$/, "").trim();
  if (/^[a-d]$/i.test(v)) return v.toLowerCase().charCodeAt(0) - 97;
  if (/^[1-4]$/.test(v)) return Number(v) - 1;
  return options.findIndex((o) => o.trim().toLowerCase() === v.toLowerCase());
}

/**
 * Pasted text. Questions are separated by a blank line:
 *
 *   What does LLM stand for?
 *   Linear Logic Machine
 *   * Large Language Model        ← * marks the right answer (or "Answer: B" on its own line)
 *   Layered Learning Matrix
 *   Long-term Language Memory
 *
 * Answers may start with "A)", "b.", "1)" etc. A line "# Buzzer" (or "# Round 1")
 * puts the questions after it into that list.
 */
export function importText(input: string, target: ListName): ImportResult {
  const out: ImportResult = { round1: [], buzzer: [], problems: [] };
  let list = target;
  const blocks: { lines: string[]; list: ListName }[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push({ lines: current, list });
    current = [];
  };
  for (const raw of input.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (/^#+\s*/.test(line)) {
      flush();
      list = roundOf(line.replace(/^#+\s*/, ""), list);
      continue;
    }
    if (!line) flush();
    else current.push(line);
  }
  flush();

  blocks.forEach(({ lines, list: into }, b) => {
    const where = `Question ${b + 1} ("${lines[0].slice(0, 40)}")`;
    const question = lines[0].replace(/^(q(uestion)?\s*)?\d+[).:]\s*/i, "");
    let answerLine = "";
    const rest = lines.slice(1).filter((l) => {
      const m = l.match(/^(answer|ans|correct)\s*[:=-]\s*(.+)$/i);
      if (m) answerLine = m[2];
      return !m;
    });
    if (rest.length !== 4) {
      out.problems.push(`${where}: needs exactly 4 answers (found ${rest.length}).`);
      return;
    }
    let correct = -1;
    const options = rest.map((l, i) => {
      let o = l;
      if (/^\*|\*$|\(correct\)$/i.test(o)) {
        correct = i;
        o = o.replace(/^\*\s*|\s*\*$|\s*\(correct\)$/gi, "");
      }
      return o.replace(LETTER, "").replace(/^[-•]\s+/, "").trim();
    });
    if (answerLine) correct = correctIndex(answerLine, options);
    if (correct < 0) {
      out.problems.push(`${where}: mark the right answer with * (or add a line "Answer: B").`);
      return;
    }
    out[into].push({ ...blankQuestion(), text: text(question, L.questionText), options: options.map((o) => text(o, L.optionText)) as LibraryQuestion["options"], correct });
  });
  return out;
}

/** Splits CSV text into rows (quotes, commas and newlines inside quotes handled). */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const HEADERS: Record<string, string[]> = {
  question: ["question", "q", "text", "question text"],
  a: ["a", "option a", "option 1", "answer a", "answer 1", "1", "option1", "a)"],
  b: ["b", "option b", "option 2", "answer b", "answer 2", "2", "option2", "b)"],
  c: ["c", "option c", "option 3", "answer c", "answer 3", "3", "option3", "c)"],
  d: ["d", "option d", "option 4", "answer d", "answer 4", "4", "option4", "d)"],
  correct: ["correct", "answer", "right answer", "correct answer", "correct option", "key"],
  round: ["round", "list"],
  read: ["read seconds", "read", "read time"],
  open: ["answer seconds", "open seconds", "time", "answer time", "seconds"],
};

/**
 * Spreadsheet rows (from CSV or Excel). The first row is the header; columns are
 * matched by name: question, A, B, C, D, correct (A–D, 1–4 or the answer's text),
 * and optionally round (1 / buzzer), read seconds, answer seconds.
 */
export function importRows(rows: unknown[][], target: ListName): ImportResult {
  const out: ImportResult = { round1: [], buzzer: [], problems: [] };
  if (rows.length < 2) {
    out.problems.push("The sheet needs a header row and at least one question row.");
    return out;
  }
  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADERS)) col[key] = header.findIndex((h) => names.includes(h));
  const missing = ["question", "a", "b", "c", "d", "correct"].filter((k) => col[k] < 0);
  if (missing.length) {
    out.problems.push(`Couldn't find these columns: ${missing.join(", ")}. Use the template's header row: ${TEMPLATE_HEADER.join(", ")}.`);
    return out;
  }
  rows.slice(1).forEach((r, i) => {
    const cell = (k: string) => (col[k] >= 0 ? String(r[col[k]] ?? "").trim() : "");
    const where = `Row ${i + 2}`;
    if (!cell("question") && !cell("a")) return; // blank row
    const options = [cell("a"), cell("b"), cell("c"), cell("d")];
    const correct = correctIndex(cell("correct"), options);
    if (correct < 0) {
      out.problems.push(`${where}: "correct" should be A, B, C, D (or 1–4, or the right answer's text); got "${cell("correct")}".`);
      return;
    }
    const secs = (v: string) => (v && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    out[roundOf(cell("round"), target)].push({
      ...blankQuestion(),
      text: text(cell("question"), L.questionText),
      options: options.map((o) => text(o, L.optionText)) as LibraryQuestion["options"],
      correct,
      readSeconds: secs(cell("read")),
      openSeconds: secs(cell("open")),
    });
  });
  return out;
}

/**
 * JSON: a quiz exported from this editor ({ round1, buzzer }), the repo's
 * data/questions.json ({ questions: [{ text, options, correct, round }] }), or a plain array.
 */
export function importJson(input: string, target: ListName): ImportResult {
  const out: ImportResult = { round1: [], buzzer: [], problems: [] };
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch (e) {
    out.problems.push(`That isn't valid JSON (${e instanceof Error ? e.message : "parse error"}).`);
    return out;
  }
  const d = data as Record<string, unknown>;
  if (d && typeof d === "object" && (Array.isArray(d.round1) || Array.isArray(d.buzzer))) {
    out.round1 = (Array.isArray(d.round1) ? d.round1 : []).map((q) => ({ ...cleanQuestion(q), id: newId() }));
    out.buzzer = (Array.isArray(d.buzzer) ? d.buzzer : []).map((q) => ({ ...cleanQuestion(q), id: newId() }));
    return out;
  }
  const list = Array.isArray(data) ? data : Array.isArray(d?.questions) ? (d.questions as unknown[]) : null;
  if (!list) {
    out.problems.push('Expected a list of questions, { "questions": [...] }, or a quiz exported from here.');
    return out;
  }
  list.forEach((raw) => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const into: ListName = q.round === 2 ? "buzzer" : q.round === 1 ? "round1" : target;
    out[into].push({ ...cleanQuestion({ ...q, text: q.text ?? q.question, correct: q.correct ?? q.correctOption }), id: newId() });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Exporting
// ---------------------------------------------------------------------------

export const TEMPLATE_HEADER = ["question", "A", "B", "C", "D", "correct", "round", "read seconds", "answer seconds"];

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The quiz as a spreadsheet (the same columns the import reads). */
export function quizToCsv(quiz: Pick<Quiz, "round1" | "buzzer">): string {
  const line = (q: LibraryQuestion, round: string) =>
    [q.text, ...q.options, "ABCD"[q.correct], round, q.readSeconds, q.openSeconds].map(csvCell).join(",");
  return [TEMPLATE_HEADER.join(","), ...quiz.round1.map((q) => line(q, "1")), ...quiz.buzzer.map((q) => line(q, "buzzer"))].join("\r\n") + "\r\n";
}

/** A filled-in example to download and copy. */
export const TEMPLATE_CSV = quizToCsv({
  round1: [
    { ...blankQuestion(), text: "What does LLM stand for?", options: ["Large Language Model", "Linear Logic Machine", "Layered Learning Matrix", "Long-term Language Memory"], correct: 0 },
    { ...blankQuestion(), text: "In an AI agent, what is a tool call?", options: ["The agent asking a program to do something", "A phone call to support", "A bug report", "A software licence"], correct: 0, openSeconds: 12 },
  ],
  buzzer: [{ ...blankQuestion(), text: "Which company makes Claude?", options: ["Anthropic", "OpenAI", "Google", "Meta"], correct: 0 }],
});
