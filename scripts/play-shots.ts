/**
 * Plays a whole demo game against `npm run dev` with four real Participant tabs
 * (phones of different sizes) and screenshots every phone state. Admin is driven
 * over a socket. Also checks a refresh mid-question and mid-buzzer-round, a name
 * clash, a removal, and puts the app's phones next to the four reference phones
 * from public/finaldesign.html (compare.png).
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal)
 *   npm run play-shots [-- --bots 20 --out screenshots/play]
 *
 * Riya and Kabir always answer right (fast), Meera always wrong, Dev never
 * answers, so the cut has phones on both sides. Crowd bots never buzz.
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
  const meera = await makePhone("Meera", 360, 640);
  const dev = await makePhone("Dev", 430, 932);
  const phones = [riya, kabir, meera, dev];

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
    if (BOTS > 0) bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --buzz 0 --url ${GAME}`, { shell: true, stdio: "ignore" });
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
    const finalists = admin!.finalists.map((f) => f.name);
    check(finalists.includes("Riya") && finalists.includes("Kabir"), `Riya and Kabir made the top ${finalists.length}`);
    check(!finalists.includes("Meera"), "Meera is out");
    await screen(riya, "cut");
    await riya.page.getByTestId("cut-in").waitFor();
    await meera.page.getByTestId("cut-out").waitFor();
    await shot("15-cut", [riya, meera, dev], 900);

    // The quizmaster removes Dev.
    await send({ type: "removeParticipant", participantId: look("Dev")!.id });
    await screen(dev, "removed");
    await shot("16-removed", [dev]);

    await send({ type: "openPredictions" });
    await screen(meera, "backFinalist");
    await shot("17-back-a-finalist", [meera]);
    await meera.page.getByTestId("back").filter({ hasText: "Riya" }).click();
    await meera.page.getByTestId("back").filter({ hasText: "Riya" }).and(meera.page.locator('[aria-pressed="true"]')).waitFor();
    await shot("18-backed", [meera, riya]);

    await send({ type: "startBuzzerRound" });
    await screen(riya, "buzzer");
    await screen(meera, "buzzerWatch");
    await shot("19-buzzer-intro", [riya, meera]);
    await send({ type: "showQuestion" });
    await phase("r2Read");
    await shot("20-buzzers-locked", [riya, meera], 300);
    check(await riya.page.getByTestId("buzz").isDisabled(), "BUZZ is dim while the question is read");
    await phase("r2BuzzOpen");
    await riya.page.locator('[data-testid="buzz"][data-live="true"]').waitFor();
    const buzzBox = await riya.page.getByTestId("buzz").boundingBox();
    check(buzzBox && buzzBox.width >= 375 * 0.6, `BUZZ is ${Math.round(buzzBox?.width ?? 0)}px wide (60%+ of the screen)`);
    await shot("21-buzzers-open", [riya, kabir, meera], 300);
    await riya.page.getByTestId("buzz").click();
    await phase("r2Answering");
    await shot("22-buzzed", [riya, kabir, meera], 700);
    check((await kabir.page.getByTestId("buzzer-line").textContent())?.includes("Riya buzzed"), "the other finalists see who buzzed");
    await send({ type: "markWrong" });
    await phase("r2BuzzOpen");
    await shot("23-locked-out", [riya], 500);
    check((await riya.page.getByTestId("buzzer-line").textContent())?.includes("Locked out"), "a wrong answer locks you out for the question");
    await kabir.page.locator('[data-testid="buzz"][data-live="true"]').waitFor();
    await kabir.page.getByTestId("buzz").click();
    await phase("r2Answering");
    await send({ type: "markCorrect" });
    await phase("r2Reveal");
    await send({ type: "undoMark" });
    await phase("r2Answering");
    check(true, "undo a mark goes back to judging");
    await send({ type: "markCorrect" });
    await phase("r2Reveal");
    await shot("24-buzzer-reveal", [riya, kabir, meera], 900);

    // Riya refreshes in the middle of the buzzer round.
    const pointsBefore = await kabir.page.getByTestId("my-points").textContent();
    await kabir.page.reload();
    await screen(kabir, "buzzer");
    check((await kabir.page.getByTestId("my-points").textContent()) === pointsBefore, `refresh mid-buzzer-round: same points (${pointsBefore})`);
    await shot("25-refresh-buzzer-round", [kabir]);

    await send({ type: "showScores" });
    await send({ type: "endQuiz" });
    await phase("podium");
    for (const p of [riya, kabir, meera]) await screen(p, "podium");
    await shot("26-podium", [riya, kabir, meera], 1500);

    await new Promise((r) => watcher.emit("admin:closeRoom", { roomCode: room }, r));
    await riya.page.getByTestId("join-form").waitFor();
    await shot("27-quiz-closed", [riya]);

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
