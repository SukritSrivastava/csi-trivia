/**
 * Do the night's longest answers fit on small phones?
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal)
 *   npm run phone-fit [-- --out screenshots/phone-fit]
 *
 * Builds a temporary quiz (deleted afterwards) whose Round 1 is the questions from
 * final_quiz.json with the longest answers (text unchanged), opens a room, joins
 * from phones at 320×568, 360×640 and 375×667, and checks each answer screen: no
 * sideways scrolling, every answer button inside the screen, no clipped text,
 * LOCK IN reachable on a multi-correct question. Screenshots in the out folder.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminView, ClientToServerEvents, OpenRoomResult, Quiz, SaveQuizResult, ServerToClientEvents } from "../src/shared/protocol";
import { defaultRules } from "../server/library";
import { PRESETS } from "../server/config";
import { FINAL_QUIZ_FILE, loadFinalQuiz } from "../server/finalQuiz";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const OUT = path.resolve(arg("out", "screenshots/phone-fit"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const SIZES = [
  [320, 568],
  [360, 640],
  [375, 667],
] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: unknown, what: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures += 1;
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const final = loadFinalQuiz(FINAL_QUIZ_FILE, defaultRules(PRESETS.demo), PRESETS.demo.blackout.minQuestions);
  const all = [...final.round1, ...final.wildcard, ...final.blackout];
  const longest = (q: (typeof all)[number]) => Math.max(...q.options.map((o) => o.length));
  // The 6 questions with the longest answers, plus a multi-correct one (LOCK IN at the bottom).
  const picked = [...all].sort((a, b) => longest(b) - longest(a)).slice(0, 6);
  const multi = final.round1.find((q) => Array.isArray(q.correct))!;
  if (!picked.includes(multi)) picked.push(multi);
  console.log(`Longest answers: ${picked.map((q) => `${q.id} (${longest(q)})`).join(", ")}`);

  const admin: Client = io(GAME, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((r) => admin.once("connect", () => r()));
  let view: AdminView | null = null;
  admin.on("admin:state", (v) => (view = v));
  const ask = <T>(event: string, payload?: unknown) =>
    new Promise<T>((r) => (admin.emit as (...a: unknown[]) => void)(event, ...(payload === undefined ? [] : [payload]), r));
  await ask("admin:login", { pin: PIN });
  const made = await ask<SaveQuizResult>("library:create", { title: "Phone fit (temporary)" });
  if (!made.ok) throw new Error("couldn't create the temporary quiz");
  const quiz: Quiz = {
    ...made.quiz,
    rules: { ...made.quiz.rules, round1Questions: picked.length, wildCardQuestions: 1 },
    round1: picked.map((q) => ({ ...q, correct: q.correct, id: `fit-${q.id}` })),
    wildcard: final.wildcard.slice(0, 2),
    blackout: final.blackout,
  };
  // Questions from other rounds play here as single-answer Round 1 questions; their text is unchanged.
  const saved = await ask<SaveQuizResult>("library:save", quiz);
  if (!saved.ok) throw new Error(`couldn't save the temporary quiz: ${saved.error} ${saved.problems?.join("; ")}`);
  const opened = await ask<OpenRoomResult>("admin:openRoom", { quizId: quiz.id });
  if (!opened.ok) throw new Error(`couldn't open a room: ${opened.error} ${opened.problems?.join("; ")}`);
  const until = async (test: (v: AdminView) => boolean) => {
    for (let i = 0; i < 400; i++) {
      if (view && test(view)) return view;
      await sleep(50);
    }
    throw new Error(`timed out (phase ${(view as AdminView | null)?.phase})`);
  };
  const send = async (type: "startQuiz" | "showQuestion" | "nextQuestion" | "skipTimer" | "revealAnswer") => {
    const v = await until((x) => x.allowed.includes(type));
    await new Promise((r) => admin.emit("admin:command", { stepId: v.stepId, action: { type } }, r));
    await until((x) => x.stepId !== v.stepId);
  };

  const browser = await chromium.launch();
  const phones = [];
  for (const [w, h] of SIZES) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    await page.goto(`${WEB}/play?code=${opened.roomCode}`);
    await page.locator('input[name="name"]').fill(`Fit ${w}`);
    await page.getByTestId("join").click();
    await page.getByTestId("screen-lobby").waitFor();
    phones.push({ page, w, h });
  }
  // A second "player" that never answers keeps each answer step open while we look.
  const idle: Client = io(GAME, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((r) => idle.once("connect", () => r()));
  await new Promise((r) => idle.emit("participant:join", { roomCode: opened.roomCode, name: "Waiting" }, r));

  await send("startQuiz");
  for (let i = 0; i < picked.length; i++) {
    await send(i === 0 ? "showQuestion" : "nextQuestion");
    await send("skipTimer"); // read → answer
    await until((x) => x.phase === "r1Answer");
    const q = picked[i];
    for (const { page, w, h } of phones) {
      await page.getByTestId("screen-answer").waitFor();
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `${q.id}-${w}x${h}.png`), fullPage: true });
      const sideways = await page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      const buttons = await page.getByTestId("option").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { inside: r.left >= 0 && r.right <= window.innerWidth + 0.5, clipped: el.scrollWidth > el.clientWidth + 1, text: el.textContent ?? "" };
        }),
      );
      const lockIn = page.getByTestId("multi-lock-in");
      const lockOk = (await lockIn.count()) === 0 || ((await lockIn.boundingBox())?.y ?? 9999) + ((await lockIn.boundingBox())?.height ?? 0) <= h + 1;
      check(
        !sideways && buttons.length === 4 && buttons.every((b) => b.inside && !b.clipped) && lockOk,
        `${q.id} at ${w}×${h}: 4 answers fully on screen, no sideways scroll${(await lockIn.count()) ? ", LOCK IN in reach" : ""}`,
      );
    }
    await send("skipTimer"); // answer → time's up
    await send("revealAnswer");
  }

  await browser.close();
  idle.disconnect();
  await ask("admin:closeRoom", { roomCode: opened.roomCode });
  await ask("library:delete", { id: quiz.id });
  admin.disconnect();
  console.log(`\n${failures ? `${failures} check(s) failed` : "All checks passed"}. Screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
