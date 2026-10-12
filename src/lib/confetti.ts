"use client";

/**
 * Confetti bursts, loaded only when needed. Respects "reduce motion".
 * Default colours are the corridor's light (mint, amber, ghost); pass the bots'
 * colours for the podium.
 */
const COLORS = ["#6cf0b0", "#ffb627", "#e7fff4", "#4cc9f0"];

export async function celebrate(size: "small" | "big" = "small", colors: string[] = COLORS) {
  if (typeof window === "undefined") return;
  const { default: confetti } = await import("canvas-confetti");
  const base = { colors: colors.length ? colors : COLORS, disableForReducedMotion: true, zIndex: 60 };
  if (size === "small") {
    void confetti({ ...base, particleCount: 80, spread: 70, origin: { y: 0.65 } });
    return;
  }
  const end = Date.now() + 1500;
  const frame = () => {
    void confetti({ ...base, particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } });
    void confetti({ ...base, particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
