/**
 * Checks the question file before the event and prints a summary.
 *
 *   npm run check-questions                        (data/questions.json, the GAME_PRESET or demo preset)
 *   npm run check-questions -- --preset event      (is there enough for the real night?)
 *   npm run check-questions -- --file my-questions.json
 *
 * Errors (exit code 1): not exactly 4 different options, a "correct" that isn't
 * 0–3, duplicate ids, a missing image file, not enough questions for the preset.
 * Warnings: images that won't read on the Host's dark card (transparent
 * background with dark lines), buzzer questions that would have to repeat.
 * Also checks every quiz saved in the local library (data/library/quizzes/).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { loadConfig } from "../server/config";
import { pickRound1, pickRound2, QUESTIONS_FILE, loadQuestions } from "../server/questions";
import type { Quiz } from "../src/shared/protocol";
import { quizProblems } from "../src/shared/quiz";

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
  const r1Pool = questions.filter((q) => q.round === 1 || q.round === null);
  const tagged2 = questions.filter((q) => q.round === 2);
  const round1 = pickRound1(questions, config.round1.questions);
  const r1Unique = new Set(round1.map((q) => q.id)).size;
  if (r1Pool.length === 0) errors.push('No Round 1 questions: tag some with "round": 1 or null.');
  else if (r1Unique < round1.length) warnings.push(`Round 1 plays ${round1.length} questions but only ${r1Unique} exist, so some repeat. Add ${round1.length - r1Unique} more.`);

  // Buzzer round: the planned questions plus a few spares (voids, sudden death).
  const spares = 3;
  const round2 = pickRound2(questions, config.round2.questions + spares, round1);
  const fresh = new Set(round2.map((q) => q.id).filter((id) => !round1.some((r) => r.id === id))).size;
  if (fresh < config.round2.questions) {
    const need = config.round2.questions - fresh;
    (config.name === "event" ? errors : warnings).push(
      `The buzzer round needs ${config.round2.questions} questions nobody has seen; there are ${fresh}. Add ${need} more tagged "round": 2.`,
    );
  } else if (fresh < config.round2.questions + spares) {
    warnings.push(`Only ${fresh - config.round2.questions} spare buzzer question(s) for a void or sudden death. ${spares} are recommended.`);
  }

  console.log(`  ${questions.length} questions: ${tagged2.length} tagged buzzer round, ${questions.filter((q) => q.round === 1).length} tagged Round 1, ${questions.filter((q) => q.round === null).length} either`);
  console.log(`  ${questions.filter((q) => q.image).length} with an image`);
  console.log(`  Round 1 plays ${round1.length} (${config.round1.readMs / 1000}s read + ${config.round1.answerMs / 1000}s answer each)`);
  console.log(`  Buzzer round plays ${config.round2.questions} for the top ${config.finalists}; ${fresh} fresh buzzer questions available`);
}

// ---------------------------------------------------------------------------
// Quizzes saved in the local library (the live one is in Supabase: check it in Admin)
// ---------------------------------------------------------------------------

const libDir = path.join(process.cwd(), "data", "library", "quizzes");
if (existsSync(libDir)) {
  for (const name of readdirSync(libDir).filter((n) => n.endsWith(".json"))) {
    try {
      const quiz = JSON.parse(readFileSync(path.join(libDir, name), "utf8")) as Quiz;
      const problems = quizProblems(quiz);
      for (const p of problems) warnings.push(`Library quiz "${quiz.title}": ${p}`);
      [...quiz.round1, ...quiz.buzzer].forEach((q, i) => q.image && checkImage(q.image, `Library quiz "${quiz.title}", question ${i + 1}`));
      console.log(`  Library: "${quiz.title}" (${quiz.round1.length} Round 1 + ${quiz.buzzer.length} buzzer)${problems.length ? ", not ready" : ", ready to play"}`);
    } catch {
      warnings.push(`Library file ${name} isn't valid JSON.`);
    }
  }
}

for (const w of warnings) console.log(`\n  ! ${w}`);
for (const e of errors) console.log(`\n  ✗ ${e}`);
console.log(errors.length ? `\n${errors.length} error(s). Fix them before the event.\n` : `\n✓ No errors${warnings.length ? ` (${warnings.length} warning(s))` : ""}.\n`);
process.exit(errors.length ? 1 : 0);
