/**
 * Plays a whole demo game against `npm run dev` with real Participant tabs
 * (phones of different sizes) and screenshots every phone state: Round 1, the
 * cut, the wild card round (a tab wins it), predictions, Blackout and the podium.
 * Admin is driven over a socket. Also checks a refresh mid-question and
 * mid-Blackout, a name clash, a removal, a late joiner, and puts the app's
 * phones next to the four reference phones from public/finaldesign.html (compare.png).
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal)
 *   npm run play-shots [-- --bots 20 --out screenshots/play]
 *
 * Round 1: Riya and Kabir always right (fast), Meera always wrong, Dev never
 * answers, so the cut has phones on both sides. Wild card: Meera all right,
 * Dev nothing (he loses it). Blackout runs on autopilot (one Start Blackout):
 * Riya right fast, Kabir silent on question 1 (no move) then right but slow,
 * Meera wrong (she steps back and gets caught). Zoe joins late and backs Riya.
 * Screens are 375×667 and 390×844 (B7's 360×640 and 430×932 too, for the
 * answer and Blackout screens).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminAction, AdminView, ClientToServerEvents, OpenRoomResult, Phase, ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "20"));
const OUT = path.resolve(arg("out", "screenshots/play"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(ok: unknown, what: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}

let admin: AdminView | null = null;
async function until(what: string, test: (v: AdminView) => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (admin && test(admin)) return admin;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${what} (phase ${admin?.phase})`);
}
const phase = (p: Phase, ms?: number) => until(`phase ${p}`, (v) => v.phase === p, ms);

interface Phone {
  name: string;
  size: string;
  page: Page;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const watcher: Client = io(GAME, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res, rej) => {
    watcher.once("connect", () => res());
    watcher.once("connect_error", rej);
  });
  watcher.on("admin:state", (v) => (admin = v));
  await new Promise((r) => watcher.emit("admin:login", { pin: PIN }, r));
  const opened = await new Promise<OpenRoomResult>((r) => watcher.emit("admin:openRoom", { quizId: "demo" }, r));
  if (!opened.ok) throw new Error(`Couldn't open a room: ${opened.error}`);
  const room = opened.roomCode;
  console.log(`Room ${room}`);
  const send = async (action: AdminAction) => {
    const step = admin!.stepId;
    const r = await new Promise<{ ok: boolean; reason?: string }>((res) => watcher.emit("admin:command", { stepId: admin!.stepId, action }, res));
    if (!r.ok) throw new Error(`${action.type} refused: ${r.reason}`);
    // Wait for the new step's view, so the next command carries the right stepId.
    await until("the next step", (v) => v.stepId !== step, 1500).catch(() => {});
  };
  /** The big button's action right now (a function, so TypeScript doesn't narrow it across awaits). */
  const primaryType = () => admin?.primary?.action.type;

  const pageErrors: string[] = [];
  const browser: Browser = await chromium.launch();
  const makePhone = async (name: string, width: number, height: number): Promise<Phone> => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && pageErrors.push(`${name} console: ${m.text()}`));
    await page.goto(`${WEB}/play?code=${room}`);
    return { name, size: `${width}x${height}`, page };
  };
  const riya = await makePhone("Riya", 375, 667);
  const kabir = await makePhone("Kabir", 390, 844);
  const meera = await makePhone("Meera", 390, 844);
  const dev = await makePhone("Dev", 375, 667);
  const phones: Phone[] = [riya, kabir, meera, dev];

  const shot = async (state: string, which: Phone[] = phones, wait = 450) => {
    await sleep(wait);
    for (const p of which) {
      await p.page.screenshot({ path: path.join(OUT, `${state}-${p.name}-${p.size}.png`) });
      // No sideways scrolling, on any size.
      const wide = await p.page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      if (wide) check(false, `${state}: ${p.name} (${p.size}) scrolls sideways`);
    }
    console.log(`  📸 ${state}`);
  };
  /** The same screen at B7's other two sizes (360×640 and 430×932), then back. */
  const otherSizes = async (state: string, p: Phone) => {
    const [w, h] = p.size.split("x").map(Number);
    for (const [vw, vh] of [
      [360, 640],
      [430, 932],
    ]) {
      await p.page.setViewportSize({ width: vw, height: vh });
      await sleep(250);
      await p.page.screenshot({ path: path.join(OUT, `${state}-${p.name}-${vw}x${vh}.png`) });
      const wide = await p.page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      if (wide) check(false, `${state}: ${p.name} (${vw}x${vh}) scrolls sideways`);
    }
    await p.page.setViewportSize({ width: w, height: h });
  };
  const screen = (p: Phone, kind: string, ms = 20_000) => p.page.getByTestId(`screen-${kind}`).waitFor({ timeout: ms });
  const joinAs = async (p: Phone, name: string) => {
    await p.page.locator('input[name="name"]').fill(name);
    await p.page.getByTestId("join").click();
  };

  let bots: ChildProcess | null = null;
  try {
    await shot("00-join", [riya, meera], 1200);
    check((await riya.page.locator('input[name="code"]').inputValue()) === room, "the QR link fills in the room code");
    const fontPx = await riya.page.locator('input[name="name"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check(fontPx >= 16, `inputs are ${fontPx}px (16+ so iPhone doesn't zoom)`);

    await joinAs(riya, "Riya");
    await screen(riya, "lobby");
    await joinAs(dev, "riya");
    await dev.page.getByTestId("join-error").waitFor();
    check((await dev.page.getByTestId("join-error").textContent())?.includes("surname initial"), "a taken name says to add a surname initial");
    await shot("01-name-taken", [dev]);
    await joinAs(dev, "Dev");
    await joinAs(kabir, "Kabir");
    await joinAs(meera, "Meera");
    for (const p of phones) await screen(p, "lobby");
    if (BOTS > 0) bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --url ${GAME}`, { shell: true, stdio: "ignore" });
    await until("everyone joined", (v) => v.counts.joined >= 4 + BOTS, 60_000);
    await shot("02-build-your-bot", phones, 900);

    // Two phones pick the same colour and head: both keep it (bots may be shared).
    for (const p of [riya, kabir]) {
      await p.page.getByRole("button", { name: "Pick this colour" }).nth(3).click();
      await sleep(400);
      await p.page.getByTestId("bot-builder").getByRole("button", { name: /horns/i }).first().click();
    }
    await sleep(800);
    const look = (n: string) => admin!.participants.find((p) => p.name === n);
    check(look("Riya")?.color === look("Kabir")?.color && look("Riya")?.head === look("Kabir")?.head, "two phones share the same colour and head");
    await shot("03-same-bot", [riya, kabir]);
    await riya.page.getByTestId("lock-in").click();
    await shot("04-lobby-locked-in", [riya]);
    await riya.page.reload();
    await riya.page.getByTestId("lobby-locked").waitFor();
    check(true, "LOCK IN survives a refresh");

    await send({ type: "startQuiz" });
    for (const p of phones) await screen(p, "r1Intro");
    check((await riya.page.getByTestId("lock-in").count()) === 0, "the builder closes by itself when the quiz starts");
    await shot("05-round1-intro", [riya, meera]);

    // Question 1: every Round 1 state.
    await send({ type: "showQuestion" });
    await screen(riya, "eyesUp");
    await shot("06-eyes-up", [riya, dev]);
    await phase("r1Answer");
    await screen(riya, "answer");
    await shot("07-answer", phones, 300);
    await otherSizes("07-answer", riya);
    const correct = admin!.question!.correctText;
    const hostOrder = await riya.page.getByTestId("option").allTextContents();
    const kabirOrder = await kabir.page.getByTestId("option").allTextContents();
    check(hostOrder.join("|") === kabirOrder.join("|"), "every phone shows the options in the same order, numbered 1–4");
    await riya.page.getByTestId("option").filter({ hasText: correct }).click();
    await riya.page.screenshot({ path: path.join(OUT, `08-answer-tapped-Riya-${riya.size}.png`) });
    await kabir.page.getByTestId("option").filter({ hasText: correct }).click();
    await meera.page.getByTestId("option").filter({ hasNotText: correct }).first().click();
    await screen(riya, "lockedIn");
    await shot("09-locked-in", [riya, meera]);
    await send({ type: "pause" });
    await riya.page.getByTestId("paused").waitFor();
    await shot("10-paused", [riya, dev]);
    await send({ type: "resume" });
    await phase("r1TimesUp");
    await screen(dev, "timesUp");
    await shot("11-times-up", [riya, dev]);
    await send({ type: "revealAnswer" });
    await screen(riya, "result");
    await riya.page.getByTestId("result-correct").waitFor();
    await meera.page.getByTestId("result-wrong").waitFor();
    check((await meera.page.getByTestId("result-wrong").textContent())?.includes(correct), "WRONG says what the answer was");
    await shot("12-result", phones, 1200);
    check((await dev.page.getByTestId("result-missed").textContent())?.includes("It was"), "missed: TOO SLOW, it was …");
    // Reduced motion: no hop or shake, but the bot still shows its mood (red X eyes).
    await meera.page.emulateMedia({ reducedMotion: "reduce" });
    await sleep(300);
    const xEyes = await meera.page.locator('[data-testid="result-wrong"] .bot-eye').first().evaluate((el) => getComputedStyle(el, "::before").opacity);
    check(xEyes === "1", "reduced motion: the bot still shows its mood (WRONG: X eyes)");
    await shot("12b-reduced-motion", [meera], 100);
    await meera.page.emulateMedia({ reducedMotion: "no-preference" });
    await send({ type: "showResults" });
    await send({ type: "showLeaderboard" });

    // Question 2: Kabir refreshes in the middle of answering.
    await send({ type: "nextQuestion" });
    await phase("r1Answer");
    await screen(kabir, "answer");
    await kabir.page.reload();
    await screen(kabir, "answer");
    check((await kabir.page.getByTestId("phone-header").textContent())?.includes("Q2 of"), "refresh mid-question: back on the same question");
    check((await kabir.page.getByTestId("round-name").textContent())?.toUpperCase().includes("ROUND 1"), "the header names the round (ROUND 1)");
    await shot("13-refresh-mid-question", [kabir]);
    const correct2 = admin!.question!.correctText;
    for (const p of [riya, kabir]) await p.page.getByTestId("option").filter({ hasText: correct2 }).click();
    await meera.page.getByTestId("option").filter({ hasNotText: correct2 }).first().click();
    await phase("r1TimesUp");
    await send({ type: "revealAnswer" });
    await sleep(400);

    // Question 3: answered right, then voided by the quizmaster.
    await send({ type: "nextQuestion" });
    await phase("r1Answer");
    const correct3 = admin!.question!.correctText;
    for (const p of [riya, kabir]) {
      await screen(p, "answer");
      await p.page.getByTestId("option").filter({ hasText: correct3 }).click();
    }
    await meera.page.getByTestId("option").filter({ hasNotText: correct3 }).first().click();
    await sleep(300);
    await send({ type: "voidQuestion" });
    await screen(riya, "voided");
    await shot("14-voided", [riya]);

    await send({ type: "endRound1" });
    await phase("cut");
    const safe = admin!.finalists.map((f) => f.name);
    check(safe.includes("Riya") && safe.includes("Kabir"), `Riya and Kabir are safe (top ${safe.length})`);
    check(!safe.includes("Meera"), "Meera is in the wild card round");
    await screen(riya, "cut");
    await riya.page.getByTestId("cut-in").waitFor();
    await meera.page.getByTestId("cut-out").waitFor();
    check(!(await meera.page.locator("main").textContent())?.includes("out"), "nobody sees \"You're out\" at the cut");
    await shot("15-cut", [riya, meera, dev], 900);

    // Zoe arrives late: she watches as audience.
    const zoe = await makePhone("Zoe", 375, 667);
    await zoe.page.locator('input[name="name"]').fill("Zoe");
    await zoe.page.getByTestId("join").click();
    await screen(zoe, "audience");
    check(true, "joining after the cut: audience");

    // The wild card round: Meera answers right (and fast) every time.
    await send({ type: "startWildCard" });
    await screen(riya, "safeWatch");
    await screen(meera, "wcStatus");
    await shot("17-wildcard-intro", [riya, meera]);
    let wq = 0;
    while (wq === 0 || primaryType() === "nextQuestion") {
      wq += 1;
      await send({ type: wq === 1 ? "showQuestion" : "nextQuestion" });
      await phase("wcAnswer");
      await screen(meera, "answer");
      if (wq === 1) await shot("18-wildcard-answer", [meera, riya], 300);
      await meera.page.getByTestId("option").filter({ hasText: admin!.question!.correctText }).click();
      await phase("wcTimesUp", 30_000);
      await send({ type: "revealAnswer" });
      await screen(meera, "result");
      if (wq === 1) await shot("19-wildcard-result", [meera], 600);
    }
    check((await meera.page.locator("main").textContent())?.includes(`${wq} of ${wq} right`), `the wild card tally shows "${wq} of ${wq} right"`);
    await send({ type: "showStandings" });
    await send({ type: "revealWildCard" });
    await screen(meera, "wcWinner");
    const meeraWon = admin!.finalists.some((f) => f.name === "Meera");
    check(meeraWon, "Meera won the wild card (all right, fastest)");
    await dev.page.getByTestId("wc-lost").waitFor();
    await shot("20-wildcard-winner", [meera, dev], 900);

    // The quizmaster removes Dev (he lost the wild card and is in the audience).
    await send({ type: "removeParticipant", participantId: look("Dev")!.id });
    await screen(dev, "removed");
    await shot("16-removed", [dev]);

    await send({ type: "openPredictions" });
    await screen(zoe, "backFinalist");
    await shot("21-back-a-finalist", [zoe]);
    await zoe.page.getByTestId("back").filter({ hasText: "Riya" }).click();
    await zoe.page.getByTestId("back").filter({ hasText: "Riya" }).and(zoe.page.locator('[aria-pressed="true"]')).waitFor();
    check((await zoe.page.getByTestId("back").filter({ hasText: "Riya" }).textContent())?.includes("BACKING"), "the pick says BACKING");
    await shot("22-backed", [zoe, riya]);

    // Blackout on autopilot: ONE click. A runner's phone shows only the question and its options while
    // answering, and a plain "Eyes on the screen" otherwise (the chase is on the projector); caught: "You're out".
    // Riya right fast; Kabir silent on Q1, then right but slow; Meera wrong every time (the dark catches her).
    await send({ type: "startBlackout" });
    await screen(riya, "runnerStatus");
    await riya.page.getByTestId("runner-waiting").waitFor();
    await screen(zoe, "blackoutWatch");
    await shot("23-blackout-waiting", [riya, zoe]);
    let bq = 0;
    let lastQ = "";
    let sawBack = false;
    let caughtShot = false;
    for (;;) {
      const v = await until("the next Blackout question (autopilot)", (x) => x.phase === "podium" || x.phase === "boWinner" || (x.phase === "boAnswer" && x.question?.id !== lastQ), 60_000);
      if (v.phase !== "boAnswer") break;
      bq += 1;
      lastQ = v.question!.id;
      const alive = new Set(v.blackout!.runners.filter((r) => r.alive).map((r) => r.name));
      const correctB = v.question!.correctText;
      if (alive.has("Riya")) {
        await screen(riya, "answer");
        if (bq === 1) {
          check((await riya.page.locator("main").textContent())?.includes(v.question!.text), "the runner's phone shows the question with its options");
          check((await riya.page.getByTestId("gap").count()) === 0, "…and nothing else (no distance on the phone)");
          await shot("24-blackout-question", [riya, kabir], 200);
          await otherSizes("24-blackout-question", kabir);
        }
        await riya.page.getByTestId("option").filter({ hasText: correctB }).click();
        if (bq === 1) {
          await riya.page.locator('[data-testid="option"][aria-pressed="true"]').waitFor();
          await shot("25-blackout-locked", [riya], 200);
        }
      }
      if (alive.has("Meera")) await meera.page.getByTestId("option").filter({ hasNotText: correctB }).first().click();
      if (bq === 2 && alive.has("Kabir")) {
        // Kabir refreshes in the middle of a Blackout question: the same question and options come back.
        await kabir.page.reload();
        await screen(kabir, "answer");
        check((await kabir.page.locator("main").textContent())?.includes(v.question!.text), "refresh mid-Blackout: back on the same question");
      }
      if (bq > 1 && alive.has("Kabir")) {
        // Right but slow: the last third of the 10 s window (+1).
        await sleep(7200);
        if (admin!.phase === "boAnswer" && admin!.question?.id === lastQ) await kabir.page.getByTestId("option").filter({ hasText: correctB }).click().catch(() => {});
      }
      await until("the reveal", (x) => x.phase === "boReveal" && x.question?.id === lastQ, 30_000);
      if (bq === 1) {
        await riya.page.getByTestId("runner-waiting").waitFor();
        await shot("26-blackout-eyes-on-screen", [riya, kabir], 300);
      }
      if (admin!.blackout!.runners.find((r) => r.name === "Meera")?.delta === -1) sawBack = true;
      await until("the dark", (x) => ((x.phase === "boDark" || x.phase === "boWinner") && x.blackout!.questionNumber === v.blackout!.questionNumber) || x.phase === "podium", 30_000);
      if (!caughtShot && admin!.blackout!.runners.some((r) => r.name === "Meera" && !r.alive)) {
        caughtShot = true;
        await meera.page.getByTestId("runner-caught").waitFor();
        check((await meera.page.locator("main").textContent())?.includes("YOU'RE OUT"), "caught: the phone says YOU'RE OUT");
        await shot("27-blackout-out", [meera, zoe], 300);
      }
    }
    check(sawBack, "a wrong answer moved Meera back");
    check(caughtShot, "the dark caught Meera");
    await phase("boWinner", 60_000);
    const winner = admin!.blackout!.winner;
    await phase("podium", 20_000);
    for (const p of [riya, kabir, meera, zoe]) await screen(p, "podium");
    await shot("29-podium", [riya, kabir, meera, zoe], 1500);
    if (winner?.name === "Riya") {
      await zoe.page.getByTestId("podium-called").waitFor();
      check(true, "Zoe backed Riya: \"You called it!\"");
    } else check(true, `the winner was ${winner?.name} (not Riya), so Zoe's pick didn't win`);

    await new Promise((r) => watcher.emit("admin:closeRoom", { roomCode: room }, r));
    await riya.page.getByTestId("join-form").waitFor();
    check((await riya.page.getByTestId("join-error").textContent())?.includes("The quiz has ended"), "room closed: \"The quiz has ended.\"");
    await shot("30-quiz-closed", [riya]);

    // The four reference phones from public/finaldesign.html, next to ours.
    const refPage = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 4 })).newPage();
    await refPage.goto(`${WEB}/finaldesign.html`);
    await refPage.waitForTimeout(800);
    const refPhones = refPage.locator(".phones .phone");
    const refs = ["builder", "answering", "correct", "wrong"];
    for (let i = 0; i < 4; i++) await refPhones.nth(i).screenshot({ path: path.join(OUT, `ref-${refs[i]}.png`) });
    const pairs = [
      ["ref-builder.png", `02-build-your-bot-Riya-${riya.size}.png`, "Build your bot"],
      ["ref-answering.png", `07-answer-Riya-${riya.size}.png`, "Answering"],
      ["ref-correct.png", `12-result-Riya-${riya.size}.png`, "Correct"],
      ["ref-wrong.png", `12-result-Meera-${meera.size}.png`, "Wrong"],
    ];
    writeFileSync(
      path.join(OUT, "compare.html"),
      `<!doctype html><body style="margin:0;background:#0f0d14;color:#ece6f4;font:16px sans-serif;display:flex;gap:28px;padding:24px">${pairs
        .map(([a, b, t]) => `<figure style="margin:0"><figcaption>${t}: design | app</figcaption><div style="display:flex;gap:8px;margin-top:6px"><img src="${a}" style="height:560px"><img src="${b}" style="height:560px"></div></figure>`)
        .join("")}</body>`,
    );
    const cmp = await (await browser.newContext({ viewport: { width: 2300, height: 640 } })).newPage();
    await cmp.goto(`file://${path.join(OUT, "compare.html")}`);
    await cmp.waitForTimeout(500);
    await cmp.screenshot({ path: path.join(OUT, "compare.png"), fullPage: true });
    console.log("  📸 compare.png (design | app)");

    check(pageErrors.length === 0, pageErrors.length ? `page errors:\n    ${pageErrors.join("\n    ")}` : "no page errors");
    console.log(`\n${failures ? `${failures} check(s) failed` : "All checks passed"}. Screenshots in ${OUT}`);
  } finally {
    await browser.close();
    bots?.kill();
    if (bots?.pid && process.platform === "win32") spawn(`taskkill /pid ${bots.pid} /T /F`, { shell: true, stdio: "ignore" });
    await new Promise((r) => watcher.emit("admin:closeRoom", { roomCode: room }, r));
    watcher.disconnect();
  }
  if (failures) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
