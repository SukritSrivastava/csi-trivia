"use client";

/**
 * Retro terminal beeps for the projector, made with Web Audio (no files).
 * Browsers block audio until someone clicks the page, so the Host calls
 * unlockSound() from a click; until then every sound is silently skipped.
 */

let ctx: AudioContext | null = null;

/** Call from a click/keypress. Safe to call more than once. */
export async function unlockSound(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export const soundUnlocked = () => ctx?.state === "running";

interface Note {
  /** Hz at the start (and optionally where it slides to). */
  freq: number;
  to?: number;
  /** Seconds from now. */
  at: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
}

function play(notes: Note[]) {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type ?? "square";
    osc.frequency.setValueAtTime(n.freq, now + n.at);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, now + n.at + n.dur);
    const v = n.vol ?? 1;
    gain.gain.setValueAtTime(0.0001, now + n.at);
    gain.gain.exponentialRampToValueAtTime(v, now + n.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
    osc.connect(gain).connect(master);
    osc.start(now + n.at);
    osc.stop(now + n.at + n.dur + 0.02);
  }
}

export const SOUNDS = {
  /** Last 3 seconds of a countdown. */
  tick: () => play([{ freq: 1320, at: 0, dur: 0.05, vol: 0.6 }]),
  /** The answer goes up (Round 1 reveal). */
  reveal: () => play([0, 1, 2].map((i) => ({ freq: [523, 659, 784][i], at: i * 0.09, dur: 0.12, vol: 0.7 }))),
  /** Someone buzzed. */
  buzz: () =>
    play([
      { freq: 140, at: 0, dur: 0.35, type: "sawtooth" },
      { freq: 147, at: 0, dur: 0.35, type: "square", vol: 0.5 },
    ]),
  correct: () =>
    play([
      { freq: 784, at: 0, dur: 0.12 },
      { freq: 1175, at: 0.12, dur: 0.25 },
    ]),
  wrong: () =>
    play([
      { freq: 311, at: 0, dur: 0.18, type: "sawtooth", vol: 0.8 },
      { freq: 233, at: 0.18, dur: 0.35, type: "sawtooth", vol: 0.8 },
    ]),
  /** The cut: the bots below the line power down. */
  powerDown: () => play([{ freq: 660, to: 55, at: 0, dur: 1.4, type: "sine", vol: 0.9 }]),
  win: () =>
    play([
      ...[523, 659, 784, 1047].map((freq, i) => ({ freq, at: i * 0.1, dur: 0.14 })),
      { freq: 523, at: 0.45, dur: 0.6, type: "triangle" as const },
      { freq: 659, at: 0.45, dur: 0.6, type: "triangle" as const },
      { freq: 784, at: 0.45, dur: 0.6, type: "triangle" as const },
    ]),
  /** A bot joined the lobby (quiet). */
  join: () => play([{ freq: 990, at: 0, dur: 0.04, vol: 0.25, type: "triangle" }]),
} as const;

export type SoundName = keyof typeof SOUNDS;
