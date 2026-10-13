/**
 * The look is "Server Corridor, Lights Low" with NO GLOW (decided 14 Oct 2026):
 * light is flat and crisp. This check fails on any glow left in the code or in
 * the reference design:
 *
 *   npm run check-glow
 *
 * Scans src/ (css, ts, tsx) and public/finaldesign.html for:
 *   - text-shadow / box-shadow (CSS, inline styles, Tailwind) with a blur > 0,
 *     or a zero-offset coloured spread (a halo ring)
 *   - drop-shadow(…), Tailwind drop-shadow-*, blur(…), backdrop-blur
 *   - a radial-gradient that fades a light colour out softly (a bloom)
 *   - keyframes named like "glow"
 * Allowed: hard offset shadows with zero blur ("4px 4px 0 mint"), insets with
 * zero blur, the dark scrims and the vignette (radial gradients of near-black),
 * hard-edged LED dots, and a line marked `no-glow: allow` (or the line after
 * such a comment), for things that aren't light at all (the colour wheel).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGETS = ["src", "public/finaldesign.html"];
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".html"]);

function files(target: string): string[] {
  const full = path.join(ROOT, target);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && EXTENSIONS.has(path.extname(d.name)))
    .map((d) => path.join(d.parentPath, d.name));
}

interface Problem {
  file: string;
  line: number;
  what: string;
  text: string;
}

const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|cqw|vw|vh|%)?$/;

/** Splits on commas that aren't inside parentheses. */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Why this shadow value glows, or null if it's flat (zero blur, no halo ring). */
function shadowGlow(value: string): string | null {
  const v = value.trim();
  if (!v || v === "none" || v.startsWith("var(")) return null;
  for (const shadow of splitTop(v.replace(/_/g, " "))) {
    const tokens = shadow.replace(/\([^)]*\)/g, "(…)").split(/\s+/);
    const inset = tokens.includes("inset");
    const lengths = tokens.filter((t) => LENGTH.test(t)).map((t) => parseFloat(t));
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    if (blur > 0) return `blur ${blur}`;
    if (!inset && x === 0 && y === 0 && spread !== 0) return "a coloured halo ring (zero offset, spread)";
  }
  return null;
}

/** The text inside the balanced parentheses that start at `open`. */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const DARK = /rgba?\(\s*(0|3)[\s,]+(0|5)[\s,]+(0|6)\b|#0[0-9a-f]0[0-9a-f]0[0-9a-f]\b|#000\b|black/i;

/** A radial gradient is fine if it darkens (scrim, vignette) or is a hard-edged dot. */
function radialGlow(inner: string): string | null {
  if (DARK.test(inner)) return null;
  const dot = inner.match(/\s0\s+(-?[\d.]+)(rem|cqw|px|em),\s*transparent\s+([\d.]+)\2/);
  if (dot && parseFloat(dot[3]) - parseFloat(dot[1]) <= 0.02) return null;
  return "a radial-gradient bloom (a light colour fading out softly)";
}

const problems: Problem[] = [];

for (const target of TARGETS) {
  for (const file of files(target)) {
    if (file.endsWith(`no-glow.ts`)) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const lineOf = (index: number) => text.slice(0, index).split("\n").length;
    const allowed = (line: number) => [line - 1, line - 2].some((l) => l >= 0 && /no-glow: allow/.test(lines[l] ?? ""));
    const add = (index: number, what: string) => {
      const line = lineOf(index);
      if (allowed(line)) return;
      problems.push({ file: path.relative(ROOT, file), line, what, text: (lines[line - 1] ?? "").trim().slice(0, 140) });
    };

    // CSS properties (also inside <style> and Tailwind arbitrary properties [text-shadow:…]).
    for (const m of text.matchAll(/(?<![\w-])(text-shadow|box-shadow)\s*:\s*([^;}\]"'`]*)/g)) {
      const why = shadowGlow(m[2]);
      if (why) add(m.index!, `${m[1]}: ${why}`);
    }
    // Inline styles: textShadow: "…", boxShadow: `…`
    for (const m of text.matchAll(/\b(textShadow|boxShadow)\s*:\s*[`"']([^`"']*)[`"']/g)) {
      const why = shadowGlow(m[2]);
      if (why) add(m.index!, `${m[1]}: ${why}`);
    }
    // Tailwind shadow-[…] and text-shadow-[…]
    for (const m of text.matchAll(/(?<![\w-])(?:text-)?shadow-\[([^\]]+)\]/g)) {
      const why = shadowGlow(m[1]);
      if (why) add(m.index!, `shadow-[…]: ${why}`);
    }
    for (const m of text.matchAll(/drop-shadow|(?<![\w-])blur\(|backdrop-blur|(?<![\w-])blur-(?:sm|md|lg|xl|2xl|3xl|\[)/g)) {
      add(m.index!, `${m[0]}: a blur or drop-shadow halo`);
    }
    for (const m of text.matchAll(/radial-gradient\(/g)) {
      const why = radialGlow(balanced(text, m.index! + "radial-gradient".length));
      if (why) add(m.index!, why);
    }
    for (const m of text.matchAll(/@keyframes\s+[\w-]*glow[\w-]*/gi)) add(m.index!, "a glow animation");
  }
}

if (problems.length) {
  console.log(`✗ ${problems.length} glow effect(s) found. The look is flat: solid fills, 1–2 px borders, colour and opacity changes.\n`);
  for (const p of problems) console.log(`  ${p.file}:${p.line}  ${p.what}\n      ${p.text}`);
  process.exit(1);
}
console.log(`✓ No glow in src/ or public/finaldesign.html (${TARGETS.flatMap(files).length} files checked).`);
