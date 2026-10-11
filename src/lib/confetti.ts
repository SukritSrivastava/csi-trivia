"use client";

/**
 * Confetti bursts, loaded only when needed. Respects "reduce motion".
 * Colours are the quiz palette.
 */
const COLORS = ["#ffb627", "#ff3d7f", "#00a6a6", "#7b5cff", "#fffbf0"];

export async function celebrate(size: "small" | "big" = "small") {
  if (typeof window === "undefined") return;
  const { default: confetti } = await import("canvas-confetti");
  const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 60 };
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
