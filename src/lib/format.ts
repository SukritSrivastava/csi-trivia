/** 1 → "1st", 2 → "2nd", 11 → "11th" */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${n}${suffixes[n % 10] ?? "th"}`;
}

/** Strips the scheme so the projector shows a short, typeable address. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** A short buzz on phones that support it (Android). Silently does nothing elsewhere. */
export function vibrate(pattern: number | number[]) {
  try {
    // Browsers only allow vibration after the person has tapped the page.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported.
  }
}
