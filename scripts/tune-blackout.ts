/**
 * Tunes Blackout (docs/SPEC.md v3): simulates thousands of chases for every
 * candidate BASE_GAP and DARKNESS_STEPS pattern and prints the best five.
 *
 *   npm run tune-blackout [-- --chases 20000]
 *
 * Model: each runner has an accuracy (40–85%, the better Round 1 ranks skewed
 * higher, the wild card mid-table), a speed profile (how its correct answers
 * split across the first / middle / last third of the answer time) and a small
 * chance of not answering. The moves, catches and end rules are the ones in
 * server/quiz.ts. The chosen values go into server/config.ts by hand.
 */

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CHASES = Number(arg("chases", "20000"));

/** Small, fast, seeded random numbers (mulberry32), so runs are repeatable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RunnerModel {
  accuracy: number;
  /** Cumulative chance a correct answer lands in the first / first-or-middle third. */
  fast: number;
  fastOrMid: number;
  miss: number;
  headStart: number;
  /** "top3" | "safe" | "wildCard" */
  group: string;
}

/** 10 runners for the event (ranks 1–9 + the wild card), or 4 for the demo (3 safe + the wild card). */
/** The wild card's accuracy centre (overridden for the sensitivity check). */
let wildCardAccuracy = 0.6;

function makeField(random: () => number, safe: number): RunnerModel[] {
  const field: RunnerModel[] = [];
  for (let rank = 1; rank <= safe + 1; rank++) {
    const wildCard = rank === safe + 1;
    // Better Round 1 ranks answer better; the wild card is mid-table (it beat the rest).
    const centre = wildCard ? wildCardAccuracy : 0.82 - ((rank - 1) / Math.max(1, safe - 1)) * 0.22;
    const accuracy = Math.min(0.85, Math.max(0.4, centre + (random() - 0.5) * 0.24));
    // Speed: some answer fast, some slow. Shares of correct answers in each third.
    const fastShare = 0.2 + random() * 0.5;
    const midShare = (1 - fastShare) * (0.4 + random() * 0.4);
    field.push({
      accuracy,
      fast: fastShare,
      fastOrMid: fastShare + midShare,
      miss: 0.03 + random() * 0.05,
      headStart: wildCard ? 0 : rank <= 3 ? 2 : 1,
      group: wildCard ? "wildCard" : rank <= 3 ? "top3" : "safe",
    });
  }
  return field;
}

interface ChaseResult {
  firstCatch: number | null;
  aliveAfter: number[];
  /** Question after which the chase was decided (one or none left), or the last question. */
  endQuestion: number;
  reachedEndWith3Plus: boolean;
  everyoneAtOnce: boolean;
  winnerGroup: string;
}

function runChase(field: RunnerModel[], baseGap: number, darkness: number[], questions: number, random: () => number): ChaseResult {
  const pos = field.map((r) => baseGap + r.headStart);
  const alive = field.map(() => true);
  const time = field.map(() => 0);
  const caughtOn: (number | null)[] = field.map(() => null);
  const beforeDark: number[] = field.map(() => 0);
  let dark = 0;
  let firstCatch: number | null = null;
  const aliveAfter: number[] = [];
  let endQuestion = questions;
  let everyoneAtOnce = false;

  for (let q = 1; q <= questions; q++) {
    for (let i = 0; i < field.length; i++) {
      if (!alive[i]) continue;
      const r = field[i];
      const roll = random();
      if (roll < r.miss) {
        time[i] += 8000;
        continue;
      }
      if (random() < r.accuracy) {
        const s = random();
        const third = s < r.fast ? 0 : s < r.fastOrMid ? 1 : 2;
        pos[i] += 3 - third;
        time[i] += third * 2667 + random() * 2666;
      } else {
        pos[i] = Math.max(0, pos[i] - 1);
        time[i] += 8000;
      }
    }
    for (let i = 0; i < field.length; i++) beforeDark[i] = pos[i];
    dark += darkness[Math.min(q, darkness.length) - 1];
    const caught: number[] = [];
    for (let i = 0; i < field.length; i++) {
      if (alive[i] && pos[i] <= dark) {
        alive[i] = false;
        caughtOn[i] = q;
        caught.push(i);
      }
    }
    if (caught.length && firstCatch === null) firstCatch = q;
    const left = alive.filter(Boolean).length;
    aliveAfter[q] = left;
    if (left <= 1) {
      endQuestion = q;
      everyoneAtOnce = left === 0;
      break;
    }
  }
  for (let q = endQuestion + 1; q <= questions; q++) aliveAfter[q] = aliveAfter[endQuestion];

  // The winner: the last one running; everyone caught at once → best by catch order;
  // survivors at the end → furthest ahead, then lower time.
  const order = field
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(alive[b]) - Number(alive[a]) ||
        (alive[a] ? pos[b] - pos[a] : (caughtOn[b] ?? 0) - (caughtOn[a] ?? 0) || beforeDark[b] - beforeDark[a]) ||
        time[a] - time[b] ||
        a - b,
    );
  const left = alive.filter(Boolean).length;
  return {
    firstCatch,
    aliveAfter,
    endQuestion,
    reachedEndWith3Plus: left >= 3,
    everyoneAtOnce,
    winnerGroup: field[order[0]].group,
  };
}

interface Candidate {
  baseGap: number;
  darkness: number[];
  label: string;
}

function candidates(questions: number): Candidate[] {
  const out: Candidate[] = [];
  const seq = (f: (q: number) => number) => Array.from({ length: questions }, (_, i) => f(i + 1));
  const patterns: { label: string; steps: number[] }[] = [];
  for (const c of [1, 2]) patterns.push({ label: `constant ${c}`, steps: seq(() => c) });
  for (let k = 2; k <= Math.min(8, questions); k++) patterns.push({ label: `1, then 2 from Q${k}`, steps: seq((q) => (q < k ? 1 : 2)) });
  for (let k = 1; k <= Math.min(6, questions); k++) {
    for (let m = k + 2; m <= questions; m++) {
      patterns.push({ label: `1, 2 from Q${k}, 3 from Q${m}`, steps: seq((q) => (q < k ? 1 : q < m ? 2 : 3)) });
    }
  }
  // Steps of 2 with a single 3 now and then (keeps the end from swallowing everyone at once).
  for (let k = 1; k <= Math.min(5, questions); k++) {
    for (const every of [2, 3]) {
      patterns.push({ label: `1, 2 from Q${k}, 3 every ${every}th`, steps: seq((q) => (q < k ? 1 : q % every === 0 && q > 6 ? 3 : 2)) });
    }
  }
  patterns.push({ label: "1,1,2,2,2,3,3,3…", steps: seq((q) => (q <= 2 ? 1 : q <= 5 ? 2 : 3)) });
  for (let baseGap = 2; baseGap <= 8; baseGap++) for (const p of patterns) out.push({ baseGap, darkness: p.steps, label: p.label });
  return out;
}

interface Stats {
  c: Candidate;
  firstCatch34: number;
  firstCatchMedian: number;
  aliveAfter6Median: number;
  endMedian: number;
  end9to11: number;
  reachEnd3Plus: number;
  everyoneAtOnce: number;
  wins: Record<string, number>;
  score: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

function evaluate(c: Candidate, safe: number, questions: number, chases: number, targets: Targets): Stats {
  const random = rng(20261016);
  const firsts: number[] = [];
  const after6: number[] = [];
  const ends: number[] = [];
  let firstCatch34 = 0;
  let end9to11 = 0;
  let reach3 = 0;
  let atOnce = 0;
  const wins: Record<string, number> = { top3: 0, safe: 0, wildCard: 0 };
  for (let i = 0; i < chases; i++) {
    const field = makeField(random, safe);
    const r = runChase(field, c.baseGap, c.darkness, questions, random);
    firsts.push(r.firstCatch ?? questions + 1);
    if (r.firstCatch !== null && targets.firstCatch.includes(r.firstCatch)) firstCatch34++;
    after6.push(r.aliveAfter[Math.min(6, questions)] ?? 0);
    ends.push(r.endQuestion);
    // "1–2 left around the window": still 2+ before it, at most 2 by its end.
    const [w0, w1] = targets.endWindow;
    if ((r.aliveAfter[w0 - 1] ?? 0) >= 2 && (r.aliveAfter[w1] ?? 0) <= 2) end9to11++;
    if (r.reachedEndWith3Plus) reach3++;
    if (r.everyoneAtOnce) atOnce++;
    wins[r.winnerGroup]++;
  }
  const pct = (n: number) => (n / chases) * 100;
  const s: Stats = {
    c,
    firstCatch34: pct(firstCatch34),
    firstCatchMedian: median(firsts),
    aliveAfter6Median: median(after6),
    endMedian: median(ends),
    end9to11: pct(end9to11),
    reachEnd3Plus: pct(reach3),
    everyoneAtOnce: pct(atOnce),
    wins: { top3: pct(wins.top3), safe: pct(wins.safe), wildCard: pct(wins.wildCard) },
    score: 0,
  };
  // Lower is better: misses against each target, weighted.
  const miss = (value: number, lo: number, hi: number) => (value < lo ? lo - value : value > hi ? value - hi : 0);
  s.score =
    (100 - s.firstCatch34) * 0.5 +
    miss(s.aliveAfter6Median, targets.alive6[0], targets.alive6[1]) * 20 +
    (100 - s.end9to11) * 0.5 +
    Math.max(0, s.reachEnd3Plus - 10) * 3 +
    Math.max(0, s.everyoneAtOnce - 5) * 4 +
    Math.max(0, 5 - s.wins.wildCard) * 6;
  return s;
}

interface Targets {
  firstCatch: number[];
  alive6: [number, number];
  endWindow: [number, number];
}

function tune(name: string, safe: number, questions: number, chases: number, targets: Targets) {
  const all = candidates(questions);
  // Rough pass with fewer chases, then the best 25 again at full size.
  const rough = all.map((c) => evaluate(c, safe, questions, Math.max(1000, Math.round(chases / 10)), targets)).sort((a, b) => a.score - b.score);
  const fine = rough
    .slice(0, 25)
    .map((s) => evaluate(s.c, safe, questions, chases, targets))
    .sort((a, b) => a.score - b.score);
  console.log(`\n${name}: ${safe + 1} runners, ${questions} questions, ${chases.toLocaleString()} chases per candidate (${all.length} candidates)\n`);
  console.log(
    [
      "  #".padEnd(4),
      "gap".padEnd(4),
      "darkness".padEnd(26),
      `1st catch Q${targets.firstCatch.join("–")}`.padEnd(15),
      "alive@Q6".padEnd(9),
      "ends Q".padEnd(7),
      `1–2 left Q${targets.endWindow.join("–")}`.padEnd(15),
      "end 3+".padEnd(7),
      "all-at-once".padEnd(12),
      "wins top3/4–9/wild",
    ].join(" "),
  );
  fine.slice(0, 5).forEach((s, i) => {
    console.log(
      [
        `  ${i + 1}`.padEnd(4),
        String(s.c.baseGap).padEnd(4),
        s.c.label.padEnd(26),
        `${s.firstCatch34.toFixed(0)}% (med Q${s.firstCatchMedian})`.padEnd(15),
        String(s.aliveAfter6Median).padEnd(9),
        String(s.endMedian).padEnd(7),
        `${s.end9to11.toFixed(0)}%`.padEnd(15),
        `${s.reachEnd3Plus.toFixed(1)}%`.padEnd(7),
        `${s.everyoneAtOnce.toFixed(1)}%`.padEnd(12),
        `${s.wins.top3.toFixed(0)}% / ${s.wins.safe.toFixed(0)}% / ${s.wins.wildCard.toFixed(1)}%`,
      ].join(" "),
    );
  });
  const best = fine[0];
  const calm = rough.filter((s) => s.everyoneAtOnce < 5 && s.reachEnd3Plus < 10).sort((a, b) => a.score - b.score)[0];
  if (calm) {
    console.log(
      `\n  Best with everyone-at-once < 5% and end 3+ < 10%: gap ${calm.c.baseGap}, ${calm.c.label}: ` +
        `first catch Q${targets.firstCatch.join("–")} ${calm.firstCatch34.toFixed(0)}%, alive@Q6 ${calm.aliveAfter6Median}, ` +
        `1–2 left ${calm.end9to11.toFixed(0)}%, wild card wins ${calm.wins.wildCard.toFixed(1)}%`,
    );
  } else console.log("\n  No candidate keeps everyone-at-once under 5% and 3+ at the end under 10% together.");
  wildCardAccuracy = 0.7;
  const strongWild = evaluate(best.c, safe, questions, chases, targets);
  wildCardAccuracy = 0.6;
  console.log(`  Sensitivity: if the wild card answers like a mid-table finalist (~70%), it wins ${strongWild.wins.wildCard.toFixed(1)}% with the chosen setting.`);
  console.log(`\n  Chosen for ${name}: baseGap ${best.c.baseGap}, darkness [${best.c.darkness.join(", ")}]`);
}

tune("Event", 9, 12, CHASES, { firstCatch: [3, 4], alive6: [4, 6], endWindow: [9, 11] });
tune("Demo", 3, 6, Math.max(2000, Math.round(CHASES / 4)), { firstCatch: [2, 3], alive6: [0, 1], endWindow: [4, 6] });
