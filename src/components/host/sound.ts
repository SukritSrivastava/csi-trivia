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
  master.gain.value = MASTER;
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

/** One master volume for everything (constant; the Host's mute and Admin's toggle switch it off). */
const MASTER = 0.18;

let hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;

/** The low hum under the whole Blackout chase. Safe to call repeatedly. */
export function humOn() {
  if (!ctx || ctx.state !== "running" || hum) return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(MASTER * 0.35, ctx.currentTime + 0.8);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 82.4;
  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc2.start();
  hum = { osc, osc2, gain };
}

/** Stops the hum (Pause, the podium, mute). */
export function humOff() {
  if (!ctx || !hum) return;
  const h = hum;
  hum = null;
  h.gain.gain.cancelScheduledValues(ctx.currentTime);
  h.gain.gain.setValueAtTime(Math.max(0.0001, h.gain.gain.value), ctx.currentTime);
  h.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
  h.osc.stop(ctx.currentTime + 0.45);
  h.osc2.stop(ctx.currentTime + 0.45);
}

export const SOUNDS = {
  /** Last 3 seconds of a countdown. */
  tick: () => play([{ freq: 1320, at: 0, dur: 0.05, vol: 0.6 }]),
  /** The answer goes up (Round 1 reveal). */
  reveal: () => play([0, 1, 2].map((i) => ({ freq: [523, 659, 784][i], at: i * 0.09, dur: 0.12, vol: 0.7 }))),
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
  /** The wild card reveal: the wall powering down, left to right. */
  sweep: () => play([{ freq: 880, to: 70, at: 0, dur: 1.2, type: "sawtooth", vol: 0.5 }]),
  /** …and the winner's seat granted: a rising tone. */
  seat: () =>
    play([
      { freq: 392, to: 784, at: 0, dur: 0.45, type: "triangle" },
      { freq: 784, at: 0.45, dur: 0.35, type: "square", vol: 0.6 },
    ]),
  /** A rack row in Blackout dies. */
  clunk: () =>
    play([
      { freq: 110, to: 60, at: 0, dur: 0.12, type: "square", vol: 0.8 },
      { freq: 2200, at: 0, dur: 0.02, type: "square", vol: 0.2 },
    ]),
  /** The dark caught someone. */
  thud: () =>
    play([
      { freq: 90, to: 38, at: 0, dur: 0.5, type: "sine", vol: 1 },
      { freq: 180, to: 60, at: 0, dur: 0.25, type: "sawtooth", vol: 0.5 },
    ]),
  /** The lights come back on for the winner. */
  swell: () => play([0, 1, 2, 3, 4].map((i) => ({ freq: [262, 330, 392, 523, 659][i], at: i * 0.12, dur: 0.6 - i * 0.05, type: "triangle" as const, vol: 0.7 }))),
} as const;

export type SoundName = keyof typeof SOUNDS;
