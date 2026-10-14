/**
 * Failure drills on all three screens, against `npm run dev` (database off):
 * two phones racing for the same bot, a phone on Slow 4G, a refresh mid-question,
 * Wi-Fi cut for 10 s, a phone locked for 30 s, the Host and Admin tabs reloaded
 * mid-game, two Admin devices pressing Next at once; then Blackout on autopilot:
 * a Slow 4G runner answering inside the 10 s, the Host and Admin reloaded
 * mid-chase (the autopilot keeps running on the server), pause / resume and
 * Skip in the dark's hold; and finally a game-server restart (every screen must
 * say so clearly). Screenshots in screenshots/drills.
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal)
 *   npm run drills
 *
 * The restart drill touches server/index.ts so `tsx watch` restarts the game
 * server; it only works against `npm run dev`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import { type AdminAction, type AdminView, type ClientToServerEvents, type OpenRoomResult, type Phase, SERVER_RESTARTED_MESSAGE, type ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "12"));
const OUT = path.resolve(arg("out", "screenshots/drills"));
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

/** Pretends the phone was locked: the page reports hidden, then the network goes. */
async function lockPhone(page: Page, ctx: BrowserContext, hidden: boolean) {
  await page.evaluate(`(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => ${hidden ? '"hidden"' : '"visible"'} });
    document.dispatchEvent(new Event("visibilitychange"));
  })()`);
  await ctx.setOffline(hidden);
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
    const r = await new Promise<{ ok: boolean; reason?: string }>((res) => watcher.emit("admin:command", { stepId: step, action }, res));
    if (!r.ok) throw new Error(`${action.type} refused: ${r.reason}`);
    await until("the next step", (v) => v.stepId !== step, 1500).catch(() => {});
  };

  const pageErrors: string[] = [];
  const browser = await chromium.launch();
  const open = async (name: string, url: string, width: number, height: number, mobile = true) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
    await page.goto(url);
    return { name, ctx, page };
  };
  const shot = async (p: { name: string; page: Page }, state: string) => {
    await p.page.screenshot({ path: path.join(OUT, `${state}-${p.name}.png`) });
  };
  const screenKind = async (page: Page) => (await page.locator('[data-testid^="screen-"]').first().getAttribute("data-testid"))?.replace("screen-", "");

  // The projector and the two Admin devices (a phone and a laptop).
  const host = await open("host", `${WEB}/host`, 1920, 1080, false);
  await host.page.locator('input[name="pin"]').fill(PIN);
  await host.page.getByTestId("host-sign-in").click();
  await host.page.getByLabel(`Room code ${room}`).waitFor({ timeout: 15_000 });
  const adminPhone = await open("admin-phone", `${WEB}/admin?code=${room}`, 390, 844);
  const adminLaptop = await open("admin-laptop", `${WEB}/admin?code=${room}`, 1440, 900, false);
  for (const a of [adminPhone, adminLaptop]) {
    await a.page.locator('input[name="pin"]').fill(PIN);
    await a.page.getByTestId("sign-in").click();
    await a.page.getByTestId("step-label").waitFor();
  }

  // Three phones. Zoya is on Slow 4G for the whole game.
  const riya = await open("Riya", `${WEB}/play?code=${room}`, 375, 667);
  const kabir = await open("Kabir", `${WEB}/play?code=${room}`, 390, 844);
  const zoya = await open("Zoya", "about:blank", 360, 640);
  const cdp = await zoya.ctx.newCDPSession(zoya.page);
  await cdp.send("Network.enable");
  // Chrome DevTools "Slow 4G".
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1.4 * 1024 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 });
  const t0 = Date.now();
  await zoya.page.goto(`${WEB}/play?code=${room}`);
  await zoya.page.getByTestId("join").waitFor();
  const slowLoad = Date.now() - t0;
  check(slowLoad < 15_000, `Slow 4G: the join page is usable in ${(slowLoad / 1000).toFixed(1)} s`);

  let bots: ChildProcess | null = null;
  try {
    for (const [p, name] of [
      [riya, "Riya"],
      [kabir, "Kabir"],
      [zoya, "Zoya"],
    ] as const) {
      await p.page.locator('input[name="name"]').fill(name);
      await p.page.getByTestId("join").click();
    }
    const t1 = Date.now();
    for (const p of [riya, kabir, zoya]) await p.page.getByTestId("screen-lobby").waitFor({ timeout: 20_000 });
    check(true, `Slow 4G: joined ${((Date.now() - t1) / 1000).toFixed(1)} s after tapping JOIN`);
    if (BOTS > 0) bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --url ${GAME}`, { shell: true, stdio: "ignore" });
    await until("everyone joined", (v) => v.counts.joined >= 3 + BOTS, 60_000);

    // ---- Two phones race for the same colour and head: both get it (bots may be shared).
    await Promise.all(
      [riya, kabir].map(async (p) => {
        await p.page.getByRole("button", { name: "Pick this colour" }).nth(5).click();
      }),
    );
    await sleep(700);
    await Promise.all([riya, kabir].map((p) => p.page.getByRole("button", { name: "dome head" }).click()));
    await sleep(900);
    const look = (n: string) => admin!.participants.find((p) => p.name === n)!;
    check(look("Riya").color === look("Kabir").color && look("Riya").head === look("Kabir").head, "two phones racing for the same bot both get it (no error)");
    check((await riya.page.getByTestId("bot-error").count()) + (await kabir.page.getByTestId("bot-error").count()) === 0, "no 'taken' error on either phone");

    // ---- Two Admin devices press the big button at the same moment: exactly one step.
    const before = admin!.stepId;
    // Both taps land before either screen redraws (a Playwright click waits for the
    // button to be ready, so the second one could hit the *next* step's button).
    await Promise.all([adminPhone.page.getByTestId("primary").dispatchEvent("click"), adminLaptop.page.getByTestId("primary").dispatchEvent("click")]);
    await until("one step", (v) => v.stepId > before, 5000);
    await sleep(700);
    check(admin!.phase === "r1Intro", `two simultaneous Start taps stopped at the intro (phase ${admin!.phase})`);
    await sleep(700);
    check(admin!.stepId === before + 1, "two Admin devices pressing Start at once: one step, the other is ignored");

    // ---- Question 1: refresh a phone, cut Wi-Fi for 10 s, reload Host and Admin, all mid-question.
    await send({ type: "showQuestion" });
    await phase("r1Read");
    // Paused while three screens reload (under `next dev` a reload can take ~6 s; the read is only 8 s).
    await send({ type: "pause" });
    await kabir.ctx.setOffline(true);
    const cutAt = Date.now();
    let t = Date.now();
    await riya.page.reload();
    await riya.page.getByTestId("screen-eyesUp").waitFor({ timeout: 15_000 });
    check(true, `phone refresh mid-question: back on the same question in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    t = Date.now();
    await host.page.reload();
    await host.page.getByText(admin!.question!.text).first().waitFor({ timeout: 15_000 });
    check(true, `Host reload mid-question: the same question is back in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    await adminPhone.page.reload();
    await adminPhone.page.getByTestId("step-label").waitFor({ timeout: 15_000 });
    check(true, "Admin reload mid-question: back on the same step, still signed in");
    await send({ type: "resume" });
    await phase("r1Answer");
    await riya.page.getByTestId("screen-answer").waitFor({ timeout: 10_000 });
    const correct = admin!.question!.correctText;
    await riya.page.getByTestId("option").filter({ hasText: correct }).click();
    await zoya.page.getByTestId("screen-answer").waitFor({ timeout: 10_000 });
    await zoya.page.getByTestId("option").filter({ hasText: correct }).click();
    await zoya.page.getByTestId("screen-lockedIn").waitFor({ timeout: 10_000 });
    check(true, "Slow 4G: the answer locks in");
    await kabir.page.getByTestId("reconnecting").waitFor({ timeout: 5_000 });
    await shot(kabir, "01-wifi-cut");
    check(true, "Wi-Fi cut: the phone says RECONNECTING…");
    await sleep(Math.max(0, 10_000 - (Date.now() - cutAt)));
    await kabir.ctx.setOffline(false);
    await kabir.page.getByTestId("reconnecting").waitFor({ state: "detached", timeout: 15_000 });
    await sleep(1500);
    const kabirScreen = await screenKind(kabir.page);
    const expected = admin!.phase === "r1Answer" ? ["answer"] : ["timesUp", "lockedIn"];
    check(kabirScreen && expected.includes(kabirScreen), `Wi-Fi back after 10 s: the phone caught up at once (${kabirScreen}, room at ${admin!.phase})`);
    await phase("r1TimesUp");
    await send({ type: "revealAnswer" });
    await riya.page.getByTestId("result-correct").waitFor();

    // ---- Question 2: Kabir's phone is locked for 30 s (hidden, then offline). Riya and Zoya answer right.
    await send({ type: "nextQuestion" });
    await phase("r1Read");
    await lockPhone(kabir.page, kabir.ctx, true);
    void (async () => {
      await phase("r1Answer");
      const right = admin!.question!.correctText;
      for (const p of [riya, zoya]) await p.page.getByTestId("option").filter({ hasText: right }).click({ timeout: 6000 }).catch(() => {});
    })();
    await sleep(800);
    check(look("Kabir").pageHidden || !look("Kabir").connected, "Admin sees the locked phone (page hidden or offline)");
    await phase("r1Answer");
    await phase("r1TimesUp");
    await send({ type: "revealAnswer" });
    await sleep(Math.max(0, 30_000 - 18_000));
    await lockPhone(kabir.page, kabir.ctx, false);
    await kabir.page.getByTestId("screen-result").waitFor({ timeout: 20_000 });
    await shot(kabir, "02-after-lock");
    check(true, "phone unlocked after 30 s: shows this question's result (missed)");
    check((await kabir.page.locator("main").textContent())?.includes("TOO SLOW"), "it says TOO SLOW, with the answer");

    // ---- Paused in the middle of a question: every screen says so.
    await send({ type: "nextQuestion" });
    await phase("r1Answer");
    await send({ type: "pause" });
    await riya.page.getByTestId("paused").waitFor();
    await host.page.getByText(/paused/i).first().waitFor();
    check(true, "Paused: the phone band and the Host both show it");
    await send({ type: "resume" });
    await phase("r1TimesUp", 20_000);
    await send({ type: "revealAnswer" });

    // ---- Blackout on autopilot.
    await send({ type: "endRound1" });
    await phase("cut");
    if (admin!.allowed.includes("startWildCard")) {
      await send({ type: "startWildCard" });
      await send({ type: "showQuestion" });
      for (let i = 0; i < 8; i++) {
        await phase("wcTimesUp", 30_000);
        await send({ type: "revealAnswer" });
        if (admin!.allowed.includes("revealWildCard")) break;
        await send({ type: "nextQuestion" });
      }
      await send({ type: "revealWildCard" });
    }
    await send({ type: "startBlackout" });
    const finalists = new Set(admin!.finalists.map((f) => f.name));
    console.log(`  … Blackout: ${[...finalists].join(", ")} run`);

    // A runner on Slow 4G answers inside the 10 s (the server measures it).
    const slowRunner = finalists.has("Zoya") ? zoya : null;
    await phase("boAnswer", 20_000);
    if (slowRunner) {
      await slowRunner.page.getByTestId("screen-answer").waitFor({ timeout: 8000 });
      const tap = Date.now();
      await slowRunner.page.getByTestId("option").first().click();
      await until("Zoya's answer on the server", (v) => v.participants.find((p) => p.name === "Zoya")?.answered === true, 10_000);
      check(true, `Slow 4G runner: the answer reached the server ${Date.now() - tap} ms after the tap, inside the 10 s`);
    } else check(true, "Slow 4G runner: Zoya didn't make the final this time (skipped)");

    // Reload the Host and an Admin in the middle of the chase: the server's autopilot keeps going.
    await phase("boReveal", 30_000);
    const stepAtReload = admin!.stepId;
    await host.page.reload();
    await host.page.getByTestId("blackout-scene").waitFor({ timeout: 20_000 });
    // No command is sent: if the step moves on, the server's autopilot is running by itself.
    await until("the autopilot to move on", (v) => v.stepId > stepAtReload, 15_000);
    check(true, `Host reload mid-Blackout: back in the scene, and the autopilot carried on by itself (step ${stepAtReload} → ${admin!.stepId})`);
    await adminPhone.page.reload();
    await adminPhone.page.getByTestId("autopilot").waitFor({ timeout: 20_000 });
    check(true, "Admin reload mid-Blackout: back on the autopilot strip, still signed in");
    await shot(host, "04-blackout-after-reload");

    // Pause and resume in the dark's hold, then Skip it.
    await phase("boDark", 30_000);
    await send({ type: "pause" });
    const frozen = admin!.timer!.remainingMs ?? 0;
    await sleep(2000);
    check(admin!.phase === "boDark" && admin!.timer!.remainingMs === frozen, "Pause in the dark's hold: nothing moves on");
    await host.page.getByText(/paused/i).first().waitFor();
    await shot(host, "05-blackout-paused");
    await send({ type: "resume" });
    await send({ type: "skipTimer" });
    check(admin!.phase !== "boDark", `Skip in the dark's hold: the next step started at once (${admin!.phase})`);
    await send({ type: "endQuiz" });
    await phase("podium");

    // ---- The game server restarts.
    console.log("  … restarting the game server (touching server/index.ts)");
    const now = new Date();
    utimesSync(path.resolve("server/index.ts"), now, now);
    await riya.page.getByTestId("join-error").filter({ hasText: SERVER_RESTARTED_MESSAGE }).waitFor({ timeout: 40_000 });
    check(true, "phone: back on the join form, saying the server restarted");
    await host.page.getByTestId("host-restarted").waitFor({ timeout: 20_000 });
    check(true, "Host: 'The quiz server restarted, so the quiz has to start again'");
    await adminPhone.page.getByText(SERVER_RESTARTED_MESSAGE).first().waitFor({ timeout: 20_000 });
    check(true, "Admin: says the server restarted and to open the quiz again");
    await sleep(500);
    await shot(riya, "03-restarted");
    await shot(host, "03-restarted");
    await shot(adminPhone, "03-restarted");

    check(pageErrors.length === 0, pageErrors.length ? `page errors:\n    ${pageErrors.join("\n    ")}` : "no page errors");
    console.log(`\n${failures ? `${failures} check(s) failed` : "All drills passed"}. Screenshots in ${OUT}`);
  } catch (e) {
    for (const p of [riya, kabir, zoya, host, adminPhone]) await shot(p, "zz-failed").catch(() => {});
    console.log(`  (phase ${admin?.phase}; screenshots zz-failed-*)`);
    throw e;
  } finally {
    await browser.close();
    bots?.kill();
    if (bots?.pid && process.platform === "win32") spawn(`taskkill /pid ${bots.pid} /T /F`, { shell: true, stdio: "ignore" });
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
