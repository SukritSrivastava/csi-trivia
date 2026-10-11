/** 1 → "1st", 2 → "2nd", 11 → "11th" */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  const suffix = suffixes[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

export function roundTitle(index: number, kind: "duel" | "final"): string {
  return kind === "final" ? "Final round" : `Round ${index + 1}`;
}

/** Strips the scheme so the TV shows a short, typeable address. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** Ink or paper, whichever reads better on the given background colour. */
export function textOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  const inkLum = 0.012; // #1b1340
  const contrastWithInk = (lum + 0.05) / (inkLum + 0.05);
  const contrastWithPaper = (0.97 + 0.05) / (lum + 0.05);
  return contrastWithInk >= contrastWithPaper ? "#1b1340" : "#fffbf0";
}
