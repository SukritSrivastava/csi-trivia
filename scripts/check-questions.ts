/**
 * Checks the question file before the event and prints a summary.
 *
 *   npm run check-questions                        (data/questions.json, the GAME_PRESET or demo preset)
 *   npm run check-questions -- --preset event      (is there enough for the real night?)
 *   npm run check-questions -- --file my-questions.json
 *
 * Errors (exit code 1): not exactly 4 different options, a "correct" that isn't
 * 0–3 (or a list of them), a multi-correct question outside Round 1 (in the file
 * or a library quiz), duplicate ids, a missing image file, not enough questions for the preset.
 * Prints how many multi-correct questions each list has.
 * Warnings: images that won't read on the Host's dark card (transparent
 * background with dark lines), buzzer questions that would have to repeat.
 * Also checks every quiz saved in the local library (data/library/quizzes/).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { loadConfig } from "../server/config";
import { loadEnvFiles } from "../server/env";
import { loadQuestions, pickRound, QUESTIONS_FILE } from "../server/questions";
import type { Quiz } from "../src/shared/protocol";
import { cleanQuiz, isMultiCorrect, quizProblems } from "../src/shared/quiz";
import { defaultRules } from "../server/library";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const errors: string[] = [];
const warnings: string[] = [];

// ---------------------------------------------------------------------------
// Images: does it exist, and will it read on a dark card?
// ---------------------------------------------------------------------------

const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Decodes an 8-bit, non-interlaced PNG to RGBA. null for anything else. */
function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } | null {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (depth !== 8 || interlace !== 0 || !channels) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (type === 6) out.set(line.subarray(s, s + 4), o);
      else if (type === 4) out.set([line[s], line[s], line[s], line[s + 1]], o);
      else if (type === 2) out.set([line[s], line[s + 1], line[s + 2], 255], o);
      else if (type === 0) out.set([line[s], line[s], line[s], 255], o);
      else if (palette) {
        const idx = line[s];
        out.set([palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], trns && idx < trns.length ? trns[idx] : 255], o);
      }
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

/** The colours an SVG paints with, and whether something covers the whole picture first. */
function svgReadability(text: string): { dark: boolean; background: boolean } {
  const colours = [...text.matchAll(/(?:fill|stroke)\s*[=:]\s*["']?\s*(#[0-9a-f]{3,8}|black)/gi)].map((m) => m[1].toLowerCase());
  const dark = colours.some((c) => {
    if (c === "black") return true;
    const hex = c.length === 4 ? c.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : c.slice(0, 7);
    const n = parseInt(hex.slice(1), 16);
    return luminance((n >> 16) & 255, (n >> 8) & 255, n & 255) < 0.25;
  });
  const firstShape = text.replace(/<metadata[\s\S]*?<\/metadata>/i, "").match(/<(rect|path|polygon|circle|ellipse|g)\b[^>]*>/i)?.[0] ?? "";
  const background = /<rect\b/i.test(firstShape) && /width=["']?(100%|\d{3,})/.test(firstShape) && /fill=/.test(firstShape) && !/fill=["']?none/.test(firstShape);
  return { dark, background };
}

function checkImage(image: string, where: string) {
  if (image.startsWith("/images/")) return; // uploaded in Admin, served by the game server
  const file = path.join(process.cwd(), "public", image);
  if (!existsSync(file)) {
    errors.push(`${where}: the image ${image} doesn't exist (looked for public${image}).`);
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const advice = "On the Host's dark card the dark lines disappear: give it a light background.";
  if (ext === ".svg") {
    const { dark, background } = svgReadability(readFileSync(file, "utf8"));
    if (dark && !background) warnings.push(`${where}: ${image} has a transparent background and dark lines. ${advice}`);
  } else if (ext === ".png") {
    const png = decodePng(readFileSync(file));
    if (!png) {
      warnings.push(`${where}: couldn't read ${image} to check it (16-bit or interlaced PNG). Look at it on the dark card.`);
      return;
    }
    let clear = 0;
    let darkInk = 0;
    const total = png.width * png.height;
    for (let i = 0; i < png.rgba.length; i += 4) {
      const a = png.rgba[i + 3];
      if (a < 24) clear++;
      else if (a > 128 && luminance(png.rgba[i], png.rgba[i + 1], png.rgba[i + 2]) < 0.25) darkInk++;
    }
    if (clear / total > 0.1 && darkInk / total > 0.005) warnings.push(`${where}: ${image} has a transparent background and dark lines. ${advice}`);
  } else if (![".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(ext)) {
    warnings.push(`${where}: ${image} isn't a usual image type (${ext}).`);
  }
}

// ---------------------------------------------------------------------------
// The question file
// ---------------------------------------------------------------------------

// The same settings the game server uses: .env.local / .env (ROUND1_QUESTIONS, SAFE_SEATS, BLACKOUT_MIN_QUESTIONS…).
loadEnvFiles();
const file = path.resolve(arg("file") ?? QUESTIONS_FILE);
const presetName = arg("preset") ?? process.env.GAME_PRESET ?? "demo";
const config = loadConfig(presetName);
console.log(`\nChecking ${path.relative(process.cwd(), file)} for the "${config.name}" preset\n`);

let questions: ReturnType<typeof loadQuestions> = [];
try {
  questions = loadQuestions(file);
} catch (e) {
  errors.push(e instanceof Error ? e.message : String(e));
}
// Images straight from the file, so they're checked even when a question has another problem.
try {
  const raw = (JSON.parse(readFileSync(file, "utf8")) as { questions?: { id?: string; image?: unknown }[] }).questions ?? [];
  raw.forEach((q, i) => typeof q?.image === "string" && q.image && checkImage(q.image, `Question ${i + 1} (${q.id ?? "no id"})`));
} catch {
  // Unreadable: already reported above.
}

if (questions.length) {
  // The same picking the game server does: each round takes the questions tagged
  // for it, then untagged ones nobody has used. No reuse here: the event preset never repeats one.
  const used = new Set<string>();
  const rounds = [
    { round: 1 as const, name: "Round 1", planned: config.round1.questions, spares: 0, tag: 1 },
    { round: 2 as const, name: "The wild card round", planned: config.wildCard.questions, spares: config.wildCard.suddenDeathMax, tag: 2 },
    // Blackout plays until one runner is left: it needs minQuestions, and warnBelow is safer (voids use them up).
    { round: 3 as const, name: "Blackout", planned: config.blackout.minQuestions, spares: Math.max(0, config.blackout.warnBelow - config.blackout.minQuestions), tag: 3 },
  ];
  const lines: string[] = [];
  for (const r of rounds) {
    // Blackout takes every question it can get; the other rounds take what they plan to play.
    const got = pickRound(questions, r.round, r.round === 3 ? Number.MAX_SAFE_INTEGER : r.planned + r.spares, used, false);
    if (got.length < r.planned) {
      // Event: a hard stop (the server refuses to open a room). Demo: it reuses questions, so a warning.
      (config.name === "event" ? errors : warnings).push(
        `${r.name} needs ${r.planned} questions; there are ${got.length}. Add ${r.planned - got.length} more tagged "round": ${r.tag} (or untagged ones).`,
      );
    } else if (got.length < r.planned + r.spares) {
      warnings.push(`${r.name}: only ${got.length - r.planned} spare question(s) for voids${r.round === 2 ? " and sudden death" : ""}; ${r.spares} recommended.`);
    }
    lines.push(r.round === 3 ? `  Blackout will play up to ${got.length} questions on autopilot, until one runner is left (needs ${r.planned}, ${r.planned + r.spares}+ is safer)` : `  ${r.name} plays ${r.planned} (${got.length} available)`);
  }
  const tagged = (n: 1 | 2 | 3 | null) => questions.filter((q) => q.round === n).length;
  console.log(`  ${questions.length} questions: ${tagged(1)} tagged Round 1, ${tagged(2)} wild card, ${tagged(3)} Blackout, ${tagged(null)} any round`);
  // (A multi-correct question outside Round 1 is already an error from loadQuestions.)
  console.log(`  ${questions.filter((q) => isMultiCorrect(q)).length} multi-correct (Round 1 only; 15 s to answer unless they have their own time)`);
  console.log(`  ${questions.filter((q) => q.image).length} with an image`);
  for (const l of lines) console.log(l);
  console.log(`  Top ${config.safe} safe at the cut; the wild card makes ${config.safe + 1} Blackout runners`);
}

// ---------------------------------------------------------------------------
// Quizzes saved in the local library (the live one is in Supabase: check it in Admin)
// ---------------------------------------------------------------------------

const libDir = path.join(process.cwd(), "data", "library", "quizzes");
if (existsSync(libDir)) {
  for (const name of readdirSync(libDir).filter((n) => n.endsWith(".json"))) {
    try {
      const raw = JSON.parse(readFileSync(path.join(libDir, name), "utf8"));
      // Saved before v3? Upgraded the way the server reads it (buzzer list → Wild card).
      const quiz = (cleanQuiz(raw, defaultRules(config), true) ?? raw) as Quiz;
      const problems = quizProblems(quiz, config.blackout.minQuestions);
      // A multi-correct question outside Round 1 is an error; anything else that stops it opening is a warning (drafts are fine).
      for (const p of problems) (p.includes("only Round 1") ? errors : warnings).push(`Library quiz "${quiz.title}": ${p}`);
      const lists = { round1: quiz.round1 ?? [], wildcard: quiz.wildcard ?? (quiz as unknown as { buzzer?: Quiz["round1"] }).buzzer ?? [], blackout: quiz.blackout ?? [] };
      [...lists.round1, ...lists.wildcard, ...lists.blackout].forEach((q, i) => q.image && checkImage(q.image, `Library quiz "${quiz.title}", question ${i + 1}`));
      const multi = (list: Quiz["round1"]) => list.filter((q) => isMultiCorrect(q)).length;
      console.log(
        `  Library: "${quiz.title}" (${lists.round1.length} Round 1 + ${lists.wildcard.length} wild card + ${lists.blackout.length} Blackout; multi-correct: ${multi(lists.round1)} / ${multi(lists.wildcard)} / ${multi(lists.blackout)})${problems.length ? ", not ready" : ", ready to play"}`,
      );
    } catch {
      warnings.push(`Library file ${name} isn't valid JSON.`);
    }
  }
}

for (const w of warnings) console.log(`\n  ! ${w}`);
for (const e of errors) console.log(`\n  ✗ ${e}`);
console.log(errors.length ? `\n${errors.length} error(s). Fix them before the event.\n` : `\n✓ No errors${warnings.length ? ` (${warnings.length} warning(s))` : ""}.\n`);
process.exit(errors.length ? 1 : 0);
