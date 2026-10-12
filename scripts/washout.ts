/**
 * Projector washout check. Takes screenshots (from host-shots, rehearsal or
 * play-shots) and shows each one as a washed-out projector would: next to the
 * original, at 70% contrast and +30% brightness. Also prints the contrast ratio
 * of every text colour against the backgrounds it sits on.
 *
 *   npm run washout [-- --in screenshots/rehearsal --out screenshots/washout]
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const IN = path.resolve(arg("in", "screenshots/rehearsal"));
const OUT = path.resolve(arg("out", "screenshots/washout"));

// ---- Contrast of the design's text colours (WCAG 2 ratio; 4.5 = body text, 3 = large text)
const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "#000000";
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
console.log("\nContrast (text on background):");
for (const [fg, bgs] of [
  ["bright", ["void", "rack"]],
  ["ghost", ["void", "panel", "deep"]],
  ["mint", ["void", "panel", "deep"]],
  ["mint-soft", ["void", "panel", "deep"]],
  ["amber", ["void", "panel", "deep"]],
  ["wrong", ["void", "panel", "deep"]],
  ["fog", ["void", "panel", "deep"]],
  ["void", ["mint", "clock"]],
] as const) {
  for (const bg of bgs) {
    const r = ratio(token(fg), token(bg));
    console.log(`  ${`${fg} on ${bg}`.padEnd(22)} ${r.toFixed(1).padStart(5)} : 1  ${r >= 4.5 ? "✓ text" : r >= 3 ? "✓ large text only" : "✗ too low"}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(IN).filter((f) => f.endsWith(".png") && !f.includes("1366"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 560 } });
  for (const f of files) {
    // Inline, because a page made with setContent can't read file:// paths.
    const src = `data:image/png;base64,${readFileSync(path.join(IN, f)).toString("base64")}`;
    await page.setContent(
      `<body style="margin:0;background:#111;display:flex;gap:16px;padding:16px;font:14px sans-serif;color:#ccc">
        <figure style="margin:0"><img src="${src}" style="width:932px"><figcaption>as rendered</figcaption></figure>
        <figure style="margin:0"><img src="${src}" style="width:932px;filter:contrast(0.7) brightness(1.3)"><figcaption>projector washout: 70% contrast, +30% brightness</figcaption></figure>
      </body>`,
    );
    await page.waitForLoadState("load");
    await page.screenshot({ path: path.join(OUT, f.replace(".png", "-washout.png")), fullPage: true });
  }
  await browser.close();
  console.log(`\n${files.length} washout comparisons in ${OUT}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
