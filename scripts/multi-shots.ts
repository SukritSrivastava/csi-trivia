/**
 * Multi-correct questions, end to end in real browsers, driven from Admin only:
 *
 *   $env:DATABASE_URL="off"; npm run dev          (another terminal, demo preset)
 *   npm run multi-shots [-- --bots 30 --out screenshots/multi]
 *
 * Admin (a 1440×900 laptop and a 390×844 phone, both in the room) opens a room with
 * the Demo quiz from its home screen and clicks the big button from the lobby to
 * the podium. Round 1's question 2 is multi-correct; six phone tabs cover every
 * case: Riya perfect and fast, Kabir partly right, Meera only wrong ticks, Dev
 * perfect but late, Zoe ticks one and never locks in (sent at time's up; she also
 * refreshes mid-question and her tick comes back), Aadi ticks nothing. 30 bots
 * (npm run bots) fill the room. Checks the points, the leaderboard and the cut,
 * and screenshots the Host (1920×1080, 1366×768), every phone state (375×667 and
 * 390×844, next to the reference phones from public/finaldesign.html in
 * compare.png) and Admin (the quiz editor with a multi-correct question, the live
 * question card before and after the reveal).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { io, type Socket } from "socket.io-client";
import type { AdminView, ClientToServerEvents, OpenRoomSummary, Phase, ServerToClientEvents } from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = arg("web", "http://localhost:3000");
const GAME = arg("game", "http://localhost:3001");
const BOTS = Number(arg("bots", "30"));
const OUT = path.resolve(arg("out", "screenshots/multi"));
const PIN = process.env.ADMIN_PIN ?? "1234";
const SIZES = [
  [375, 667],
  [390, 844],
] as const;
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
  page: Page;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pageErrors: string[] = [];
  const browser: Browser = await chromium.launch();
  const newPage = async (name: string, width: number, height: number, mobile: boolean) => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("WebSocket") && pageErrors.push(`${name} console: ${m.text()}`));
    return page;
  };
  const signIn = async (page: Page, code?: string) => {
    await page.goto(`${WEB}/admin${code ? `?code=${code}` : ""}`);
    await page.locator('input[name="pin"]').fill(PIN);
    await page.getByTestId("sign-in").click();
  };

  // ---- Admin (laptop): sign in, open a room with the Demo quiz from the home screen
  const laptop = await newPage("Admin 1440", 1440, 900, false);
  await signIn(laptop);
  await laptop.getByTestId("quiz-card").filter({ hasText: "Demo quiz" }).getByTestId("open-room").click();
  await laptop.getByTestId("room-quiz").filter({ hasText: "Demo quiz" }).waitFor();

  // A watching socket reads the Admin view for the checks (it never sends a command).
  const watcher: Client = io(GAME, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((res, rej) => {
    watcher.once("connect", () => res());
    watcher.once("connect_error", rej);
  });
  watcher.on("admin:state", (v) => (admin = v));
  await new Promise((r) => watcher.emit("admin:login", { pin: PIN }, r));
  const rooms = await new Promise<OpenRoomSummary[] | null>((r) => watcher.emit("admin:rooms", r));
  const room = rooms?.[0]?.roomCode;
  if (!room) throw new Error("No open room");
  await new Promise((r) => watcher.emit("admin:auth", { roomCode: room, pin: PIN }, r));
  console.log(`Room ${room}`);

  const adminPhone = await newPage("Admin 390", 390, 844, true);
  await signIn(adminPhone, room);
  await adminPhone.getByTestId("step-label").waitFor();

  /** The big button on the laptop; waits for the step to change. */
  const big = async (label?: string) => {
    // Admin ignores a second big-button press within 600 ms (double-tap guard), like a person would wait.
    await sleep(750);
    const v = await until("a big button", (x) => !!x.primary && x.allowed.includes(x.primary.action.type));
    if (label) check(v.primary!.label === label, `the big button says "${label}" (${v.primary!.label})`);
    const step = v.stepId;
    await laptop.getByTestId("primary").click();
    await until("the next step", (x) => x.stepId !== step, 5000);
  };

  // ---- The projector at two sizes
  const hosts: { page: Page; size: string }[] = [];
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
  ]) {
    const page = await newPage(`Host ${w}`, w, h, false);
    await page.goto(`${WEB}/host`);
    await page.locator('input[name="pin"]').fill(PIN);
    await page.getByTestId("host-sign-in").click();
    hosts.push({ page, size: `${w}x${h}` });
  }
  const hostShot = async (state: string, wait = 900) => {
    await sleep(wait);
    for (const h of hosts) await h.page.screenshot({ path: path.join(OUT, `${state}-host-${h.size}.png`) });
    console.log(`  📸 ${state} (Host)`);
  };
  const adminShot = async (state: string) => {
    await sleep(500);
    await laptop.screenshot({ path: path.join(OUT, `${state}-admin-1440x900.png`) });
    await adminPhone.screenshot({ path: path.join(OUT, `${state}-admin-390x844.png`), fullPage: true });
    console.log(`  📸 ${state} (Admin)`);
  };

  // ---- Six phones
  const phones: Phone[] = [];
  for (const [i, name] of ["Riya", "Kabir", "Meera", "Dev", "Zoe", "Aadi"].entries()) {
    const [w, h] = SIZES[i % 2];
    const page = await newPage(name, w, h, true);
    await page.goto(`${WEB}/play?code=${room}`);
    await page.locator('input[name="name"]').fill(name);
    await page.getByTestId("join").click();
    phones.push({ name, page });
  }
  const [riya, kabir, meera, dev, zoe, aadi] = phones;
  /** The phone at both sizes. */
  const shot = async (state: string, p: Phone, wait = 400) => {
    await sleep(wait);
    const before = p.page.viewportSize()!;
    for (const [w, h] of SIZES) {
      await p.page.setViewportSize({ width: w, height: h });
      await sleep(200);
      await p.page.screenshot({ path: path.join(OUT, `${state}-${p.name}-${w}x${h}.png`) });
      const wide = await p.page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      if (wide) check(false, `${state}: ${p.name} (${w}x${h}) scrolls sideways`);
      // LOCK IN must be on screen without scrolling (thumb reach) while answering.
      const lock = p.page.getByTestId("multi-lock-in");
      if (await lock.count()) {
        const box = await lock.boundingBox();
        if (!box || box.y + box.height > h + 1) check(false, `${state}: ${p.name} (${w}x${h}) LOCK IN is off screen`);
      }
    }
    await p.page.setViewportSize(before);
    console.log(`  📸 ${state} (${p.name})`);
  };
  const screen = (p: Phone, kind: string, ms = 30_000) => p.page.getByTestId(`screen-${kind}`).waitFor({ timeout: ms });
  const tap = (p: Phone, text: string) => p.page.getByTestId("option").filter({ hasText: text }).click();

  let bots: ChildProcess | null = null;
  try {
    for (const p of phones) await screen(p, "lobby");
    if (BOTS > 0) bots = spawn(`npx tsx scripts/bots.ts --room ${room} --count ${BOTS} --url ${GAME} --pin ${PIN} --accuracy 0.4-0.85`, { shell: true, stdio: "ignore" });
    await until("everyone joined", (v) => v.counts.joined >= phones.length + BOTS, 60_000);
    check(true, `${phones.length} phone tabs and ${BOTS} bots joined`);

    // ---- Question 1 (single answer): everyone taps the right one.
    await big("Start quiz");
    await big("Show question");
    await phase("r1Answer");
    const q1 = admin!.question!;
    check(!q1.multi, "question 1 is a single-answer question");
    for (const p of phones) {
      await screen(p, "answer");
      check((await p.page.getByTestId("multi-lock-in").count()) === 0, `${p.name}: no LOCK IN on a single-answer question (tap = lock)`);
      await tap(p, q1.correctText);
    }
    await phase("r1TimesUp", 20_000);
    await big("Reveal answer");
    const before = new Map(admin!.participants.map((p) => [p.name, p.score]));

    // ---- Question 2 (multi-correct)
    await big("Next question");
    await phase("r1Read");
    const q2 = admin!.question!;
    check(q2.multi && q2.correctNumbers.length >= 2, `question 2 is multi-correct (${q2.correctNumbers.length} right)`);
    await screen(riya, "eyesUp");
    check(!/(apply|ALL)/.test((await riya.page.locator("main").textContent()) ?? ""), "eyes up: nothing about how many are right");
    await hostShot("m00-read");
    await phase("r1Answer");
    const answerStarted = Date.now();
    check(admin!.timer?.durationMs === 15_000, `15 s to answer (${admin!.timer?.durationMs} ms)`);
    for (const p of phones) await screen(p, "answer");
    const rights = q2.options.filter((o) => o.correct).map((o) => o.text);
    const wrongs = q2.options.filter((o) => !o.correct).map((o) => o.text);
    check((await riya.page.getByText("Select ALL that apply").count()) === 1, "the phone says \"Select ALL that apply\"");
    check((await riya.page.getByTestId("multi-lock-in").isDisabled()) === true, "LOCK IN is disabled with nothing ticked");
    await hostShot("m01-host-answer");
    for (const h of hosts) check((await h.page.getByTestId("select-all").count()) === 1, `Host ${h.size}: SELECT ALL THAT APPLY`);
    await shot("m01-answer-nothing-ticked", riya, 100);

    // Riya: both right, fast.
    for (const t of rights) await tap(riya, t);
    check((await riya.page.locator('[data-testid="option"][aria-pressed="true"]').count()) === rights.length, "ticked options are aria-pressed");
    await shot("m02-answer-ticked", riya, 100);
    await riya.page.getByTestId("multi-lock-in").click();
    await riya.page.getByTestId("multi-locked").waitFor();
    check((await riya.page.getByTestId("multi-locked").textContent())?.includes("Locked in:"), "after LOCK IN: \"Locked in: 1, 3\"");
    await shot("m03-locked-in", riya, 150);
    // Kabir: one right. Meera: only wrong ones.
    await tap(kabir, rights[0]);
    await kabir.page.getByTestId("multi-lock-in").click();
    for (const t of wrongs.slice(0, 2)) await tap(meera, t);
    await meera.page.getByTestId("multi-lock-in").click();
    // Zoe: ticks one, refreshes, the tick comes back; never locks in.
    await tap(zoe, rights[0]);
    await sleep(400);
    await zoe.page.reload();
    await screen(zoe, "answer");
    await zoe.page.locator('[data-testid="option"][aria-pressed="true"]').first().waitFor();
    check((await zoe.page.locator('[data-testid="option"][aria-pressed="true"]').count()) === 1, "refresh mid-question: Zoe's tick came back");
    await shot("m04-refreshed-tick-back", zoe, 100);
    await until("ticking count", (v) => (v.counts.ticking ?? 0) >= 1);
    await adminShot("m05-live-before-reveal");
    check((await laptop.getByTestId("multi-tag").count()) >= 1, "Admin's question card says Multi-correct");
    check((await laptop.getByTestId("count-answered").textContent())?.includes("locked in"), "Admin counts lock-ins");
    // Dev: both right, late (about 12 s in).
    await sleep(Math.max(0, 12_000 - (Date.now() - answerStarted)));
    for (const t of rights) await tap(dev, t);
    await dev.page.getByTestId("multi-lock-in").click();
    await phase("r1TimesUp", 20_000);
    await screen(zoe, "lockedIn");
    check((await zoe.page.getByTestId("picks-sent").textContent())?.includes("We sent your picks"), "time's up: \"We sent your picks: …\"");
    await shot("m06-times-up-picks-sent", zoe);
    await screen(aadi, "timesUp");
    const delta = (n: string) => admin!.participants.find((p) => p.name === n)!.score - before.get(n)!;
    const d = Object.fromEntries(phones.map((p) => [p.name, delta(p.name)]));
    console.log(`  Question 2 points: ${JSON.stringify(d)}`);
    check(d.Riya >= 150 && d.Riya <= 200, "Riya (perfect, fast): 150–200");
    check(d.Dev >= 100 && d.Dev < d.Riya, "Dev (perfect, late): above 100, below Riya");
    check(d.Kabir >= 75 && d.Kabir <= 100 && d.Kabir < d.Riya, "Kabir (1 of 2 right): half his speed score (75–100)");
    check(d.Meera === 0, "Meera (only wrong ticks): 0");
    check(d.Zoe === 50, "Zoe (1 of 2, sent at time's up): 100 × ½ = 50");
    check(d.Aadi === 0, "Aadi (no ticks): 0");

    await big("Reveal answer");
    await screen(riya, "result");
    await riya.page.getByTestId("result-correct").waitFor();
    await kabir.page.getByTestId("result-partial").waitFor();
    await meera.page.getByTestId("result-wrong").waitFor();
    await aadi.page.getByTestId("result-missed").waitFor();
    await zoe.page.getByTestId("result-partial").waitFor();
    await dev.page.getByTestId("result-correct").waitFor();
    const partial = (await kabir.page.locator("main").textContent()) ?? "";
    check(partial.includes("PARTLY RIGHT") && partial.includes("of") && partial.includes("The right answers:"), "PARTLY RIGHT: \"You got 1 of 2 right\" and the right answers");
    check((await meera.page.getByTestId("right-answers").textContent())?.includes(rights[0]), "WRONG lists the right answers");
    check(!/\bpoints?\b/i.test(partial), "no points on the phone");
    await shot("m07-result-correct", riya, 900);
    await shot("m08-result-partly-right", kabir, 100);
    await shot("m09-result-wrong", meera, 100);
    await shot("m10-result-missed", aadi, 100);
    await shot("m11-result-sent-partly-right", zoe, 100);
    await hostShot("m12-host-reveal", 1600);
    await adminShot("m13-live-after-reveal");
    const reveal = admin!.question!;
    check(reveal.options.filter((o) => o.correct).every((o) => o.count !== null && o.count >= 3), "Admin: pick counts per option after the reveal");

    await laptop.getByTestId("optional-showResults").click();
    await phase("r1Results");
    await hostShot("m14-host-results");
    await laptop.getByTestId("optional-showLeaderboard").click();
    await phase("r1Leaderboard");
    await hostShot("m15-host-leaderboard", 2200);
    // The projector's leaderboard is the server's own ranking: same points as Admin.
    const hostView = await new Promise<import("../src/shared/protocol").HostView>((resolve) => {
      const h: Client = io(GAME, { transports: ["websocket"], forceNew: true });
      h.on("host:state", (v) => {
        if (v.stage.phase === "r1Leaderboard") {
          h.disconnect();
          resolve(v);
        }
      });
      h.on("connect", () => h.emit("host:auth", { pin: PIN, roomCode: room }, () => {}));
    });
    const rows = hostView.stage.phase === "r1Leaderboard" ? hostView.stage.rows : [];
    check(rows.length > 0 && rows.every((r) => admin!.participants.find((p) => p.id === r.id)?.score === r.score), "the leaderboard shows the same points as Admin");
    check(rows.findIndex((r) => r.name === "Riya") < rows.findIndex((r) => r.name === "Meera") || !rows.some((r) => r.name === "Meera"), "Riya ranks above Meera");

    // ---- Question 3 (single), then the cut
    await big("Next question");
    await phase("r1Answer");
    const q3 = admin!.question!;
    for (const p of phones) {
      await screen(p, "answer");
      await tap(p, q3.correctText);
    }
    await phase("r1TimesUp", 20_000);
    await big("Reveal answer");
    await big("End round 1");
    await phase("cut");
    const cut = admin!.cut!;
    const finalScores = new Map(admin!.participants.map((p) => [p.id, p.score]));
    check(cut.standings.every((s) => s.score === finalScores.get(s.id)), "the cut shows every player's Round 1 points (multi + single)");
    check(cut.standings.every((s, i, all) => i === 0 || all[i - 1].score > s.score || (all[i - 1].score === s.score && all[i - 1].timeMs <= s.timeMs)), "the cut is ranked by points, then time");
    await hostShot("m16-host-cut", 1500);

    // ---- The rest, from Admin only, to the podium (Blackout runs itself)
    const end = Date.now() + 8 * 60_000;
    while (admin!.phase !== "podium" && Date.now() < end) {
      const v = admin!;
      const autopilot = v.phase.startsWith("bo");
      if (!autopilot && v.primary && v.allowed.includes(v.primary.action.type) && v.primary.action.type !== "pause") {
        await big().catch(() => {});
      } else await sleep(300);
    }
    check(admin!.phase === "podium", "lobby to podium, driven from Admin only");
    await hostShot("m17-host-podium", 1500);

    // ---- Admin: the quiz editor with a multi-correct question (laptop and phone)
    const title = `Multi shots ${room}`;
    await adminPhone.getByTestId("tab-controls").click();
    await adminPhone.getByTestId("ctl-leave").click();
    await laptop.getByTestId("ctl-leave").click();
    await adminPhone.getByTestId("new-quiz").click({ timeout: 10_000 });
    await adminPhone.getByTestId("quiz-title").fill(title);
    await adminPhone.getByTestId("add-question").click();
    await adminPhone.getByTestId("q-text").fill("Which of these are large language models?");
    for (const [i, t] of ["Claude", "Linux", "GPT-4", "Python"].entries()) await adminPhone.getByTestId(`q-option-${i}`).fill(t);
    check((await adminPhone.getByTestId("q-kind").textContent())?.includes("Single answer"), "a new question: nothing ticked, \"Single answer\"");
    await adminPhone.getByTestId("q-correct-0").click();
    await adminPhone.getByTestId("q-correct-2").click();
    check((await adminPhone.getByTestId("q-kind").textContent())?.includes("Multi-correct: 2 right"), "ticking 2: \"Multi-correct: 2 right\"");
    const openPlaceholder = await adminPhone.locator('input[type="number"]').nth(1).getAttribute("placeholder");
    check(openPlaceholder === "15", `a multi-correct question defaults to 15 s (${openPlaceholder})`);
    await adminPhone.screenshot({ path: path.join(OUT, "m18-editor-multi-admin-390x844.png"), fullPage: true });
    await adminPhone.getByTestId("q-save").click();
    await adminPhone.getByTestId("question-card").first().waitFor();
    check((await adminPhone.getByTestId("multi-tag").count()) === 1, "the list shows \"multi-correct: 2 right\"");
    await adminPhone.screenshot({ path: path.join(OUT, "m19-editor-list-admin-390x844.png"), fullPage: true });
    // The wild card list allows one right answer only.
    await adminPhone.getByTestId("editor-tab-wildcard").click();
    await adminPhone.getByTestId("add-question").click();
    await adminPhone.getByTestId("q-correct-0").click();
    await adminPhone.getByTestId("q-correct-2").click();
    check((await adminPhone.getByTestId("q-kind").textContent())?.includes("Single answer"), "Wild card: one right answer only (radio)");
    check((await adminPhone.getByText("Only Round 1 questions can have more than one right answer.").count()) === 1, "Wild card: the one-line explanation");
    await adminPhone.screenshot({ path: path.join(OUT, "m20-editor-wildcard-admin-390x844.png"), fullPage: true });
    await adminPhone.getByText("← Back").first().click();
    // The same editor on the laptop.
    await sleep(1500); // the editor saves by itself
    await laptop.reload();
    await laptop.getByTestId("quiz-card").filter({ hasText: title }).waitFor({ timeout: 10_000 });
    await laptop.getByTestId("quiz-card").filter({ hasText: title }).getByRole("button", { name: "Edit" }).click();
    await sleep(800);
    await laptop.screenshot({ path: path.join(OUT, "m21-editor-admin-1440x900.png") });
    await laptop.getByTestId("question-card").first().click().catch(() => {});
    await sleep(600);
    await laptop.screenshot({ path: path.join(OUT, "m22-editor-multi-admin-1440x900.png") });
    console.log("  📸 the quiz editor (Admin)");
    // Tidy up: delete the test quiz.
    await new Promise((r) => (watcher.emit as (...a: unknown[]) => void)("library:list", r)).then(async (list) => {
      const mine = (list as { id: string; title: string }[] | null)?.find((q) => q.title === title);
      if (mine) await new Promise((r) => (watcher.emit as (...a: unknown[]) => void)("library:delete", { id: mine.id }, r));
    });

    // ---- The reference phones from public/finaldesign.html, next to ours.
    const refPage = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 4 })).newPage();
    await refPage.goto(`${WEB}/finaldesign.html`);
    await refPage.waitForTimeout(800);
    const refPhones = refPage.locator(".phones .phone");
    const refs = ["builder", "answering", "correct", "wrong"];
    for (let i = 0; i < 4; i++) await refPhones.nth(i).screenshot({ path: path.join(OUT, `ref-${refs[i]}.png`) });
    const pairs: [string, string, string][] = [];
    for (const [w, h] of SIZES) {
      const s = `${w}x${h}`;
      pairs.push(
        ["ref-answering.png", `m01-answer-nothing-ticked-Riya-${s}.png`, `Nothing ticked ${s}`],
        ["ref-answering.png", `m02-answer-ticked-Riya-${s}.png`, `Two ticked ${s}`],
        ["ref-answering.png", `m03-locked-in-Riya-${s}.png`, `Locked in ${s}`],
        ["ref-wrong.png", `m06-times-up-picks-sent-Zoe-${s}.png`, `Time's up, picks sent ${s}`],
        ["ref-correct.png", `m07-result-correct-Riya-${s}.png`, `Correct ${s}`],
        ["ref-correct.png", `m08-result-partly-right-Kabir-${s}.png`, `Partly right ${s}`],
        ["ref-wrong.png", `m09-result-wrong-Meera-${s}.png`, `Wrong ${s}`],
        ["ref-wrong.png", `m10-result-missed-Aadi-${s}.png`, `Missed ${s}`],
      );
    }
    writeFileSync(
      path.join(OUT, "compare.html"),
      `<!doctype html><body style="margin:0;background:#0f0d14;color:#ece6f4;font:16px sans-serif;display:flex;flex-wrap:wrap;gap:28px;padding:24px;width:2500px">${pairs
        .map(([a, b, t]) => `<figure style="margin:0"><figcaption>${t}: design | app</figcaption><div style="display:flex;gap:8px;margin-top:6px"><img src="${a}" style="height:520px"><img src="${b}" style="height:520px"></div></figure>`)
        .join("")}</body>`,
    );
    const cmp = await (await browser.newContext({ viewport: { width: 2548, height: 800 } })).newPage();
    await cmp.goto(`file://${path.join(OUT, "compare.html")}`);
    await cmp.waitForTimeout(800);
    await cmp.screenshot({ path: path.join(OUT, "compare.png"), fullPage: true });
    console.log("  📸 compare.png (design | app)");

    check(pageErrors.length === 0, pageErrors.length ? `page errors:\n    ${pageErrors.join("\n    ")}` : "no page errors");
    console.log(`\n${failures ? `${failures} check(s) failed` : "All checks passed"}. Screenshots in ${OUT}`);
  } finally {
    bots?.kill();
    if (process.platform === "win32" && bots?.pid) spawn("taskkill", ["/pid", String(bots.pid), "/T", "/F"], { stdio: "ignore" });
    watcher.disconnect();
    await browser.close();
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
