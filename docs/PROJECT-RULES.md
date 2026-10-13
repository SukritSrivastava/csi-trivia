# PROJECT RULES: Hermes Quiz (the AI handoff)

> **Every AI model or agent working on this project reads this file first, all of it.**
> It is the single source of truth for constraints, architecture, stack, the to-do list,
> skills, agent roles, plugins and the frontend↔backend API. If you change anything it
> describes, update this file in the same change (see §10 "Keeping this file true").
>
> Last updated: 14 Oct 2026 (SPEC v3) · Owner: Sukrit Srivastava (frontend) · Repo: `Leleouch14/jackbox_2.0`

---

## 0. The project in 60 seconds

**Hermes Quiz** is a Jackbox-style live quiz for **60–100 people in one hall**, run by the
**Computer Society of India (CSI) student chapter at KJSCE, Mumbai**, right after a workshop
on the **Hermes AI agent**. The **event is Thursday 16 Oct 2026**.

- One laptop drives the **projector** (`/host`). Everyone answers on their **phone** (`/play`).
  A **quizmaster** runs every step from **Admin** (`/admin`, PIN), usually on a phone.
- **Round 1:** everyone answers multiple-choice questions (8 s to read, 8 s to answer, faster
  correct answers score more). **Top 9 are safe.** Everyone else plays the **wild card round**
  (5 questions, most right wins) for the **10th seat**; the rest become the **audience** and back
  a finalist. **Blackout:** the 10 finalists' bots race a darkness down the corridor: right answers
  move them forward (+3/+2/+1 by speed), wrong ones back, and the dark catches whoever it reaches.
  Last bot running wins. **Every answer is a phone tap marked by the server** (no judging).
  Then the **podium**. Rules: `docs/SPEC.md` v3 (14 Oct).
- **Look:** "Server Corridor, Lights Low", inspired by Jackbox's *Murder Trivia 2*. A dark
  server-room corridor, typewriter type, terminal digits, and every player is a **robot** whose
  eyes react to their answers. The approved reference is **`public/finaldesign.html`**.
- **Team:** Sukrit builds the **frontend** (this Next.js app). Lelouch (teammate) owns the
  **backend**: **`server/`** runs the whole game, implements the contract in
  **`src/shared/protocol.ts`**, and saves results to Supabase. It's what's deployed on Render.
  (Lelouch's first prototype is kept in `archive/ws-backend-v1/`.)

**Where we are (14 Oct):** SPEC v3 (three rounds: Round 1, wild card, Blackout) replaced the buzzer
round. The engine, contract, server and tests are done (`docs/BUILD-PHASES.md` v5 Phase 1); the screens
work for the new flow in a plain form (the existing Host, phone and Admin screens, extended) and are
polished in Phases 2–3. The live deployment still runs the v2 buzzer-round version until Sukrit says "push".

### Read these, in this order
1. **This file.**
2. `docs/SPEC.md` (v3, 14 Oct): every game rule, step by step. Rules there override anything else.
3. `src/shared/protocol.ts`: the contract (every view, event and payload, fully commented).
4. `public/finaldesign.html`: the approved design (open http://localhost:3000/finaldesign.html).
5. `docs/BUILD-PHASES.md`: the build prompts (v4 in the repo: the first 5 phases, all done; the v5
   three-phase plan for the new game was pasted in chat on 14 Oct). Do the next unfinished phase only.
6. `CLAUDE.md`, `AGENTS.md`, `README.md`: short notes that point back here.

### Run it (Windows PowerShell)
```powershell
npm install
npm run dev            # Next.js on :3000 + game server on :3001 (demo preset)
# Host:        http://localhost:3000/host
# Admin:       http://localhost:3000/admin     (PIN 1234)
# Participant: http://<your-LAN-IP>:3000/play  (phones on the same Wi-Fi; the server prints it)
npm run bots -- --room ABCD --count 20   # fake players
npm run typecheck; npm run build; npm run simulate; npm run smoke   # all must pass
```

---

## 1. Constraints

### 1.1 Hard rules (never break these)
| # | Rule | Why |
|---|---|---|
| C1 | **Branches:** `main` = the whole app (what Render and Vercel deploy). `frontend` (screens) and `backend` (game server, database) branch off `main`; merge back only with all checks green. Pushing is allowed (Sukrit, 12 Oct). | One deployable truth; two people work side by side. |
| C2 | **The server is the source of truth.** Screens send actions and draw the view they receive. They never compute game state, scores, timers, ranks or bot moods. | 100 phones must agree; nobody can cheat by editing the page. |
| C3 | **No answer leaks.** Phones and the Host never receive the correct answer before the reveal. Only Admin gets it. Option ids and question ids are opaque random strings, new for every question run. | The projector laptop may be screen-shared; phones can be inspected. |
| C4 | **Contract first.** Every event and view type lives in `src/shared/protocol.ts`. To change the API: edit it there → implement in `server/` → follow the TypeScript errors → update §8 of this file → tell the backend teammate. | Two people build against one contract. |
| C5 | **The quizmaster drives the flow.** Timers run only for the read and answer steps (Round 1 and wild card 8 s + 8 s; Blackout 5 s + 8 s). When a timer ends, the room **holds** for the next click. Nothing is judged by hand: every answer is a tap marked by the server. | SPEC v3. |
| C6 | **Every Admin command carries `stepId`.** The server ignores a command from an old step (except `STEP_INDEPENDENT_ACTIONS`). | A double tap or two Admin phones must never skip two steps. |
| C7 | **The look is approved and final.** Match `public/finaldesign.html` exactly. Use the tokens/classes in `src/app/globals.css` and the components in `src/components/ui/`. No new colours or fonts. Extend only in the same visual language and say so. | Sukrit approved it: "do not change anything". |
| C8 | **One answer order.** In every round the options are shuffled once per question; the Host (from the answer step) and every phone show that same order, numbered **1–4**. | Decided 11 Oct 2026 to match the design. |
| C9 | **Answer times are measured on the server**, never trusted from a phone. | Fair scoring. |
| C10 | **Sukrit is on Windows (PowerShell).** No bash-only commands in scripts or docs. | |
| C11 | `npm run typecheck`, `npm run build`, `npm run simulate`, `npm run smoke` **must all pass** at the end of every change. | |
| C12 | Respect **reduced motion** everywhere (`MotionConfig reducedMotion="user"`; the CSS already disables animation loops). | Accessibility. |

### 1.2 Event and environment constraints
- **Scale:** 60–100 participants, one phone each, solo. Max room size 200 (config).
- **Network:** a mix of college Wi-Fi and mobile data, so the **game server runs online** on the
  night (not just on the laptop). Phones must cope with drops: auto-rejoin, wake lock.
- **Projector:** laptop over HDMI, text must read from the back of the hall; dark themes wash out
  on cheap projectors, hence the dark pools (scrims) behind text. Sizes in `rem` on the Host.
- **Phones:** iPhone Safari and Android Chrome, 360–430 px wide. Inputs ≥ 16 px (no iOS zoom).
- **Deadline:** the event is Thursday 16 Oct 2026. Prefer simple, robust choices over clever ones.
- **Admin PIN:** default `1234` for testing; set a longer `ADMIN_PIN` on the night.
- **Questions:** MCQ only, exactly 4 options, in `data/questions.json`. Images (Host only) in
  `public/questions/`. Real Hermes questions still to be written (§4).

### 1.3 Decisions already made (don't reopen without Sukrit)
| Date | Decision |
|---|---|
| 11 Oct | SPEC v2: two rounds, 6-player buzzer round, quizmaster controls everything. |
| 11 Oct | Look: "Server Corridor, Lights Low" (Direction E v2). Approved, final. |
| 11 Oct | Fonts: Special Elite (words), VT323 (numbers); Archivo only for dense Admin tables. |
| 11 Oct | Bots: 12 colours × 8 heads, picked in the lobby; unique colour while any colour is free, then unique colour+head (96 unique). *Replaced 12 Oct, see below.* |
| 12 Oct | Bots for 100 people: any colour (12 quick picks + a colour wheel), 8 heads, and **bots may be shared**; only names must be unique. Dark colours are brightened by the server. |
| 11 Oct | Bot eyes show the game: idle / thinking / locked / right / wrong / out, computed by the server (`HostView.cast`). |
| 11 Oct | One 1–4 answer order on the Host and every phone in Round 1 (no per-phone shuffle). |
| 11 Oct | Host cast: up to 12 bots in a named row; 13+ as a dense wall of smaller bots without names. |
| 12 Oct | **Quiz library in Admin:** quizzes are made in Admin (type, paste text, CSV/Excel, JSON), saved in Supabase; two lists (Round 1, buzzer + spares), always 4 options, shuffled, played in the order arranged; every count and timer per quiz, timers overridable per question; optional picture per question (projector only); a room plays a frozen copy (no live edits). **Admin opens rooms**; the **Host needs the same PIN** and shows the newest open room. |
| 14 Oct | **SPEC v3: three rounds, no buzzer round.** Round 1 → the cut (top 9 safe) → wild card round (everyone else, 5 questions, most right wins; tie → lower total time with wrong/miss = the full time; exact tie → up to 3 sudden-death questions; nobody right → 10th place) → predictions → **Blackout** (10 finalists) → podium. Nothing is judged by hand. |
| 14 Oct | **Blackout rules:** start at BASE_GAP + head start (ranks 1–3 +2, 4–9 +1, wild card 0); right +3/+2/+1 by third of the answer time, wrong −1, none 0; **two clicks per question** after time's up: Reveal answer (runners move, nobody caught) then **Advance the darkness** (the dark moves `DARKNESS_STEPS[q]`, anyone at or behind it is caught). Catch order: later catch higher; same question → further ahead before the dark, lower time, better Round 1 rank. One left → winner; all caught at once → best by catch order; survivors after Q12 → furthest ahead. Tuned by `npm run tune-blackout` (event: BASE_GAP 4, `[1,1,2,2,2,2,2,3,3,3,3,3]`). |
| 14 Oct | On the Host the bots run toward the camera in the corridor as the rack lights die behind them (Phase 2; Phase 1 has a plain lane track). |
| 14 Oct | The game server in `server/` (the prompt called it "mock-server") **is the real server on the night**. Event preset: 20 Round 1 questions, 9 safe, 5 wild card (+3 sudden death), 12 Blackout (+3 spares), 8 s/8 s, Blackout 5 s/8 s. |
| 14 Oct | Quiz library: three lists per quiz (Round 1, Wild card, Blackout); quizzes saved before v3 are upgraded on read (buzzer list → Wild card, Blackout empty, rules from the preset except Round 1's own). Bots stay shared (12 Oct decision), even though the v5 prompt repeated the old unique-bot rule. |
| 14 Oct | If time runs short, **sound is the first thing to cut**. |
| 12 Oct | **Backend = option 1 (§8.9):** the game server in `server/` is the real backend; the teammate's Postgres/Supabase tables (`archive/ws-backend-v1/db.js`) are wired in via `server/db.ts` when `DATABASE_URL` is set. Frontend contract unchanged. |

---

## 2. Architecture

### 2.1 System picture
```
                 ┌──────────────────────────── Next.js app (this repo, port 3000) ───────────────────────────┐
 Projector  ───► │ /host   Host screen      (src/components/host/HostApp + stages/)                           │
 Phones     ───► │ /play   Participant      (src/components/play/PlayApp + screens)                           │
 Quizmaster ───► │ /admin  Admin panel      (src/components/admin/AdminApp + panels)                          │
                 │ /       home · /finaldesign.html  approved design reference (static)                       │
                 │   Zustand stores (src/stores/*) ── socket.io-client (src/lib/socket.ts)                    │
                 └───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                             │  Socket.IO v4 (WebSocket, polling fallback)
                                                             │  events + views defined in src/shared/protocol.ts
                 ┌───────────────────────────────────────────▼──────────────────────────────────────────────┐
                 │ Game server (port 3001)                                                                    │
                 │   NOW:   server/  (TypeScript, tsx)  ← complete, tested reference                     │
                 │          rooms.ts  sockets, roles, PIN, sending only changed views (150 ms throttle)       │
                 │          quiz.ts   ALL the rules, no socket code, injectable clock (QuizRoom class)        │
                 │          config.ts presets (event / demo) · questions.ts loads data/questions.json         │
                 │   LATER: the real backend (teammate) implementing the SAME contract (see §8.9)             │
                 └────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Principles
- **Views, not events-as-state.** The server pushes a complete view to each socket whenever it
  changes: `HostView` to the Host, a private `ParticipantView` to each phone, `AdminView` to
  Admin devices. Screens are pure functions of their latest view. Missing an update is harmless:
  the next view is complete.
- **Only changed views are sent** (100 phones): the server compares and skips identical views.
- **Clock correction:** every view has `serverNow`; screens compute
  `clockOffset = serverNow − Date.now()` and count down to `timer.endsAt` with it.
- **Server computes everything the UI needs:** Admin's big button (`primary`), what's allowed
  (`allowed`), labels (`stepLabel`, `hint`), bot moods (`cast[i].mood`), the cut, the podium.
- **Sessions:** `sessionStorage` per tab (so several test tabs work on one laptop). Host and Admin
  keep the PIN (and their room code) to sign back in after a refresh; phones keep `participantId` to rejoin; typing the same
  name again also reclaims a dropped seat.

### 2.3 The game flow (phases, from `protocol.ts`)
```
lobby → r1Intro → [ r1Read (8s) → r1Answer (8s) → r1TimesUp → r1Reveal → r1Results? → r1Leaderboard? ] × 20
      → cut (top 9 safe; fewer than 10 played → everyone safe, no wild card round)
      → wcIntro → [ wcRead (8s) → wcAnswer (8s) → wcTimesUp → wcReveal → wcStandings? ] × 5 (+ up to 3 sudden death)
      → wcWinner (the 10th finalist) → predictions?
      → boIntro → [ boRead (5s) → boAnswer (8s) → boTimesUp → boReveal (runners move) → boDark (the dark moves, catches) ] × ≤12
      → podium (Show winner)
(?) = optional step the quizmaster may skip. Timed steps advance by themselves; every other step is a click.
```
Scoring: **Round 1** correct = `round(500 + 500 × (1 − elapsed/limit))`, wrong or none = 0; ties →
lower total answer time (a miss = the full time). **Wild card**: number right; ties → lower total time
(wrong/miss = the full time); exact tie → sudden death. **Blackout**: right +3/+2/+1 by third of the
answer time, wrong −1, none 0; the dark advances by `DARKNESS_STEPS[q]` and catches anyone at or behind it.
Full rules and edge cases: `docs/SPEC.md` v3.

### 2.4 Folder map
```
README.md                   the front door: what it is, live links, run it, repo map
docs/PROJECT-RULES.md       ← this file (the full handoff)
AGENTS.md / CLAUDE.md       short pointers + the must-follow rules (read by AI tools; stay at the root)
data/questions.json         the questions (MCQ, 4 options, correct = index, round 1/2/3/null); seeds the Demo quiz
docs/SPEC.md                game rules v3 (source of truth for rules)
docs/BUILD-PHASES.md        the build prompts (v4, done; the v5 three-phase plan came in chat on 14 Oct)
docs/RUN-SHEET.md           the quizmaster's checklist and script for the night
docs/BACKEND-NOTES.md       every event and view, what the server must enforce
docs/DEPLOY.md              live addresses; Supabase + Render + Vercel, step by step
render.yaml                 Render Blueprint for the game server
server/index.ts             starts the game server (npm run dev:game / start:game): env, preset, database
server/config.ts            presets: every timing and count, Blackout BASE_GAP / DARKNESS_STEPS / head starts
server/quiz.ts              all the rules (QuizRoom), no socket code
server/rooms.ts             Socket.IO glue: roles, PIN, rooms, sending views
server/server.ts            the Socket.IO server; validates incoming payloads
server/db.ts                saves results to Postgres/Supabase when DATABASE_URL is set
server/questions.ts         loads and checks data/questions.json; pickRound (tagged, then untagged unused)
server/library.ts           the quiz library (Supabase or data/library/), quizToGame, the Demo quiz
server/simulate.ts          npm run simulate: 33 rule checks with a fake clock, 100-player games (50 seeds with GAME_PRESET=event)
scripts/smoke.ts            npm run smoke: whole demo game over real Socket.IO
scripts/bots.ts             npm run bots: N fake participants, every round, per-bot accuracy (--accuracy, --slow, --pin)
scripts/tune-blackout.ts    npm run tune-blackout: 20,000 simulated chases per candidate → BASE_GAP and DARKNESS_STEPS
scripts/check-questions.ts  npm run check-questions: enough questions for each round, images readable on the dark Host
scripts/play-shots.ts       npm run play-shots: phones play a whole game, screenshots of every phone state
scripts/host-shots.ts       npm run host-shots: every projector state at 1920×1080 and 1366×768
scripts/drills.ts           npm run drills: failure drills (refresh, Wi-Fi, locked phone, Slow 4G, two Admins, restart)
scripts/rehearsal.ts        npm run rehearsal: 100 bots + 4 phones + Host + Admin, fps and memory
scripts/db-check.ts         npm run db-check: a game over sockets with an in-memory Postgres; checks the saved rows
scripts/admin-run.ts        npm run admin-run: Playwright runs a whole game from Admin + screenshots
scripts/deploy.ts           npm run deploy: Render + Vercel
archive/ws-backend-v1/      Lelouch's first backend prototype (raw ws). Not used; its tables live on in server/db.ts
public/finaldesign.html     the approved design, every animation
public/questions/           question images (Host only)
src/shared/protocol.ts      THE CONTRACT
src/app/                    routes: / (home), /host, /play, /admin; globals.css; layout.tsx (fonts)
src/components/ui/          Bot (+botDelay), BotBuilder, Corridor, TimerRing  ← the design system
src/components/host/        the projector (HostApp, parts, stages/: Lobby, Round1, Cut, WildCard, Blackout, Podium; sound)
src/components/play/        the phones (PlayApp, JoinScreen, LobbyScreen, Round1Screens, FinalScreens: wild card + Blackout, parts)
src/components/admin/       the quizmaster's panel and the quiz library
src/stores/                 Zustand: hostStore, participantStore, adminStore
src/lib/                    socket, session, useCountdown, useWakeLock, usePageVisibility, confetti, format, adminLabels
```
**Leftovers (removed 12 Oct, backed up outside the repo; listed for history):** `src/components/host/HostApp.tsx`,
`HostTopBar.tsx`, `LobbyStage.tsx`, `PlaceholderStages.tsx`; the whole `src/components/play/`;
`src/components/admin/AdminApp.tsx`; `src/stores/playerStore.ts`; `src/lib/usePageAway.ts`;
`src/components/ui/Avatar.tsx`.

### 2.5 Design system (summary; the reference is `public/finaldesign.html`)
| Token (Tailwind name) | Value | Use |
|---|---|---|
| `void` | `#05080a` | page background |
| `rack` / `panel` / `deep` | `#091013` / `#0b1114` / `#132027` | walls / cards / phone gradient |
| `line` | `#1e3036` | borders |
| `mint` | `#6cf0b0` | the room's light: outlines, glows, primary actions |
| `mint-soft` / `ghost` / `bright` | `#bfe9d6` / `#e7fff4` / `#f1fff8` | secondary text / text / Host question text |
| `amber` | `#ffb627` | answer numbers 1–4 and counts only (the one warm colour) |
| `alarm` / `wrong` | `#d6334d` / `#ff4d5e` | alarm pulse, timer wedge, PAUSED / wrong answers, X eyes |
| `clock` / `fog` | `#fffbf0` / `#7d9690` | timer face / muted text |
| `font-type` | Special Elite | words: questions, answers, names, labels |
| `font-term` | VT323 | numbers: answer keys, timer, counts, room code, big result words |
| `font-sans` | Archivo | Admin dense tables only |

Classes: `host-q`, `host-q-center`, `host-opts`, `host-opt`, `opt-num`, `host-count`, `host-hint`,
`host-banner`, `host-watermark`, `host-name`, `phone-bg`, `phone-opt`, `phone-go`, `phone-result`,
`phone-buzz` (unused since v3; the buzzer round is gone), `clock`, `bot` (+`data-head`, `data-mood`), `corridor-*`. (The old marigold tokens were deleted in Phase 5.)

Components (`src/components/ui/`):
- `<Bot color head mood size delay label />`: a robot. `mood` ∈ idle/thinking/locked/right/wrong/out.
  Use `delay={botDelay(id)}` so a wall doesn't blink in sync.
- `<BotBuilder value picker onPick busy />`: the phone's "Build your bot" panel.
- `<Corridor scrim="split|center|full|none" alarm />`: the Host background.
- `<TimerRing timer clockOffset size />`: the clock with a red wedge for time used.

Host layout (answer step): question left (5% / 34%, 42% wide, tilted −3°); options right (top 30%,
44% wide, 1–4 in amber, staggered ±1.5°); clock bottom-left (left 13%, bottom 7%, 14.4rem); count
beside it ("38 / 64 answered"); cast across the top; `hermes://quiz` bottom-right. Read step: the
question centred, hint under it. At 1920 px, 1% of the width ≈ 1.2rem (`html:has(.host-root)`).

---

## 3. Tech stack

| Layer | Choice (version) | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router), **React 19** | `next dev -H 0.0.0.0 -p 3000` so phones on the LAN can open it |
| Language | **TypeScript 5.9**, strict | `@/*` → `src/*` |
| Styling | **Tailwind CSS 4** (`@tailwindcss/postcss`), tokens in `@theme` in `globals.css` | |
| Realtime | **Socket.IO 4** (`socket.io` server, `socket.io-client`) | transports: websocket, then polling |
| State | **Zustand 5** | one store per screen |
| Motion | **motion 12** (`motion/react`), **@number-flow/react**, **canvas-confetti** | respect reduced motion |
| QR | **qrcode.react 4** | lobby QR to `/play?code=ABCD` |
| Fonts | `next/font/google`: Special Elite, VT323, Archivo (wdth axis) | |
| Game server | Node ≥ 20.9, **tsx** (`tsx watch server/index.ts`) | `concurrently` runs web + game |
| Tests | `server/simulate.ts` (rules, fake clock), `scripts/smoke.ts` (real sockets), Playwright for screenshots | |
| Game server = backend | `server/` (Socket.IO, tsx) + **pg** to Supabase Postgres (`server/db.ts`, the teammate's schema, on when `DATABASE_URL` is set) | decided 12 Oct, see §8.9 |
| Hosting | Website on **Vercel**, game server on **Render** (`render.yaml`, `npm run start:game`), results in **Supabase** Postgres | live since 12 Oct; addresses and updating in `docs/DEPLOY.md` |

npm scripts: `dev`, `dev:event`, `dev:web`, `dev:game`, `build`, `start`, `preview`, `typecheck`, `simulate`, `smoke`, `bots`,
`tune-blackout`, `check-questions`, `play-shots`, `host-shots`, `admin-run`, `drills`, `rehearsal`, `washout`, `db-check`, `deploy`.

Environment variables (`.env.local`, see `.env.example`):
| Var | Default | Used by |
|---|---|---|
| `NEXT_PUBLIC_SOCKET_URL` | same host, port 3001 | browser: where the game server is |
| `GAME_PRESET` | `demo` | server: `demo` or `event` |
| `ADMIN_PIN` | `1234` | server |
| `GAME_PORT` / `WEB_PORT` | `PORT` (Render) else `3001` / `3000` | server (web port only for printed links) |
| `PUBLIC_WEB_URL` | `http://<LAN-IP>:3000` | server: builds the join link |
| `CORS_ORIGIN` | any | server: comma-separated allowed origins |
| `DATABASE_URL` | unset (memory only) | server: Postgres/Supabase; saves rooms, players (score, rank, wild card correct, Blackout place/position), every Round 1 answer |

---

## 4. To-do list

Status: ✅ done · 🟡 done but unverified · ⬜ to do. Work top to bottom. Phases are in `docs/BUILD-PHASES.md`.

### Done
- ✅ v4 Phases 1–5 (12–13 Oct): design foundation, Admin, phones, Host, event-proofing. Deployed 13 Oct (v2 buzzer-round game).
- ✅ **v5 Phase 1, the engine (14 Oct):** SPEC v3; contract (`protocol.ts`: `wc*` and `bo*` phases, `McqQuestion`, `WildCardState`, `BlackoutState`, `Runner`, new phone screens, new Admin actions); `server/quiz.ts` (wild card with sudden death and the fallback, Blackout with catches and catch order, seat hand-over, void/restart/restart round/end quiz in every round); `npm run tune-blackout`; `simulate` (33 checks, 50 event seeds), `smoke` (whole three-round game over sockets), `bots` (every round, accuracy); quiz library with three lists (old quizzes upgraded); `/health` JSON; the existing Host / phone / Admin screens extended to the new flow (plain stages for the wild card and Blackout); play-shots, host-shots, admin-run (68 checks) and drills pass.

### Next
1. ⬜ **v5 Phase 2:** the Host (projector) for the wild card round and Blackout in the approved look (the bots running toward the camera, rack lights dying behind them).
2. ⬜ **v5 Phase 3:** the phone and Admin screens for the new rounds, polished.
3. ⬜ **Write 48 questions** (20 Round 1, 5 + 3 wild card, 12 + 3 Blackout + spares) in Admin → Quizzes; `npm run check-questions -- --preset event` for a file.
4. ⬜ **Push and deploy** (only when Sukrit says "push"); the live site runs the v2 buzzer game until then.

### Not in a phase yet
- ⬜ CSI club logo in a corner (optional, "later").
- ⬜ Rehearsal in the actual hall with the real projector (brightness, hall lights, sound).
- ⬜ After the event: revoke the Render / Vercel keys in `.env.local`, reset the Supabase password.

---

## 5. Skills

"Skills" here = reusable know-how an AI should load or follow for a kind of task. Claude Code
users: load the matching skill if it's installed; other models: follow the checklist yourself.

| When you're… | Skill (Claude) | Checklist for any model |
|---|---|---|
| Building or changing any screen | `frontend-design` | Match `public/finaldesign.html`; tokens only; typewriter for words, terminal for numbers; amber only for numbers/counts; check 1920×1080 + 1366×768 (Host) and 360–430 px (phones). |
| Reviewing a screen | `design:design-critique` | Screenshot it beside the reference; hierarchy, back-row readability, alignment, colour, motion. |
| Accessibility pass | `design:accessibility-review` | Contrast, focus (mint outline), labels (bots need `label` when no name is printed), targets ≥ 44 px (Admin main ≥ 56 px), reduced motion. |
| Writing UI words | `design:ux-copy` | Short, plain, from the player's side; same word for the same thing everywhere; errors say what to do. |
| Changing rules / the contract | `engineering:system-design` | §1 C2–C6, C8; contract first (C4); keep `simulate` green; add a test for each new rule. |
| Testing | `engineering:testing-strategy` | Rules → `simulate.ts`; sockets → `smoke.ts`; scale → `bots.ts`; visuals → Playwright screenshots. |
| Debugging | `engineering:debug` | Reproduce with `npm run dev` + bots; read the server log; check the raw view under "Test tools". |
| Reviewing a change | `engineering:code-review` (plugin enabled in `.claude/settings.json`) | Leaks (C3), stale stepId (C6), state on the client (C2), Windows-safe scripts (C10). |
| Before the event | `engineering:deploy-checklist` | §4 "Not in a phase yet" + `docs/RUN-SHEET.md` (Phase 5). |
| Writing docs | `engineering:documentation` | Update this file (§10), README, SPEC. |

---

## 6. AGENTS.md (how AI agents work on this project)

The repo root `AGENTS.md` is a short copy of the must-follow rules that tools like Codex, Cursor,
Copilot and Gemini read automatically. The full version is here.

### 6.1 Every agent, every time
1. Read this file, then `docs/SPEC.md`, `src/shared/protocol.ts`, and the code you'll touch.
2. Post a short plan (files, risks) before coding; then carry on.
3. Follow §1 Constraints. If a rule is genuinely ambiguous and hard to undo, ask Sukrit; otherwise
   choose the sensible option and list it under **Assumptions** in your report.
4. Keep the four checks green (C11). Never push (C1).
5. Finish with a report: what you changed, how you verified it, URLs to test, a checklist for
   Sukrit, assumptions, anything left undone. Update §4 (to-do) and anything else here that changed.
6. Commit on `frontend` or `backend` with a clear message (`Phase N: …` for phase work), push, merge into `main` when green.

### 6.2 Roles (one agent can hold several; never two agents on the same files at once)
| Role | Owns (may edit) | Must not edit | Done when |
|---|---|---|---|
| **Contract & game-rules agent** | `src/shared/protocol.ts`, `server/**`, `data/questions.json`, `docs/SPEC.md`, §8 of this file | screens | `simulate` + `smoke` pass with new tests; §8 updated |
| **Admin screen agent** | `src/app/admin/**`, `src/components/admin/**`, `src/stores/adminStore.ts`, `src/lib/adminLabels.ts` | contract (ask the contract agent) | Prompt 2 verified |
| **Participant screen agent** | `src/app/play/**`, `src/components/play/**`, `src/stores/participantStore.ts` | contract | Prompt 3 verified |
| **Host screen agent** | `src/app/host/**`, `src/components/host/**`, `src/stores/hostStore.ts`, sounds | contract | Prompt 4 verified |
| **Design-system agent** | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/**`, `public/finaldesign.html` (read-only unless Sukrit approves a change) | screens' logic | screens still match the reference |
| **QA / event-proofing agent** | `scripts/**`, `docs/RUN-SHEET.md`, `docs/BACKEND-NOTES.md` | product code except bug fixes it reports | Prompt 5 verified |
| **Backend agent (teammate's side)** | `server/db.ts`, `server/index.ts`, `server/config.ts`, `render.yaml`, `docs/DEPLOY.md` (rules in `server/quiz.ts` with the contract agent) | `src/**` | `simulate`, `smoke` and `db-check` pass; the live server's `/health` is ok |

### 6.3 Hand-off protocol between agents or models
- Leave the tree **building and green**. If you must stop half-way, say so at the top of your report.
- Write what the next agent needs into **§4** (status) and, for lasting knowledge, into the right
  section of this file. Don't leave knowledge only in chat.
- A contract change is announced in §8.10 (changelog) with the date and what screens must do.
- Never "fix" the design by changing it; report the mismatch instead.

---

## 7. Plugins and tools

### 7.1 In the project
- **Claude Code plugin enabled:** `code-review@anthropic-plugin-directory` (`.claude/settings.json`).

### 7.2 Recommended (install if missing; none are required to run the app)
| Tool | Why |
|---|---|
| VS Code: **Tailwind CSS IntelliSense** | autocompletes the design tokens (`bg-void`, `text-mint`, `font-term`) |
| VS Code: **ESLint**, **Prettier** | consistent code |
| VS Code: **Playwright Test** | run screenshot checks |
| **Playwright** (`npx playwright install chromium`) | screenshots of every screen vs the reference |
| **Git** (`winget install Git.Git`), **GitHub Desktop** | version control (repo isn't initialised yet: Prompt 1) |
| Claude skills: `frontend-design`, `design:design-critique`, `design:accessibility-review`, `design:ux-copy`, `engineering:testing-strategy`, `engineering:debug`, `engineering:deploy-checklist` | see §5 |
| Optional MCP: Playwright MCP / GitHub MCP | let an agent drive the browser or read PRs |

---

## 8. API documentation (frontend ↔ backend)

The authoritative definition is **`src/shared/protocol.ts`** (TypeScript types with comments).
This section explains it for anyone building either side. **The real backend must implement
exactly this**; `server/` is the working reference.

### 8.1 Transport
- **Socket.IO v4** server. Default URL: same host as the website, **port 3001**
  (`NEXT_PUBLIC_SOCKET_URL` overrides). Client transports: `["websocket", "polling"]`.
- CORS: allow the website's origin (`CORS_ORIGIN`).
- **Request/response** = an event with an **ack callback** (Socket.IO acknowledgement).
  **Fire-and-forget** = an event without an ack. **Server pushes** = views and `room:closed`.
- A socket has one room role: **host**, **participant** or **admin**, set by `host:auth`,
  `participant:join`, or `admin:auth` / `admin:openRoom`. Passing the PIN (`admin:login`,
  `admin:auth`, `host:auth`) also unlocks the quiz library on that socket.
- **Rooms are opened by Admin** with a quiz from the library (a frozen copy: editing the quiz later
  never changes a game in progress). The Host signs in with the same PIN and shows a room.

### 8.2 Events: client → server
| Event | Payload | Ack result | Who / when |
|---|---|---|---|
| `host:auth` | `{ pin, roomCode? }` | `HostAuthResult` = `{ ok:true, roomCode }` or `{ ok:false, error:"wrong-pin"\|"no-room" }` | Projector: shows `roomCode` if open, else the newest open room. `no-room`: ask again in ~3 s. |
| `admin:login` | `{ pin }` | `{ ok:true }` or `{ ok:false, error:"wrong-pin" }` | Admin's PIN screen (no room needed). |
| `admin:rooms` | none | `OpenRoomSummary[]` (newest first) or `null` | Admin home: rooms open now. |
| `admin:openRoom` | `{ quizId }` | `OpenRoomResult` = `{ ok:true, roomCode }` or `{ ok:false, error:"not-signed-in"\|"not-found"\|"not-ready", problems? }` | Opens a room with a frozen copy of the quiz; the socket becomes its Admin. |
| `admin:closeRoom` | `{ roomCode }` | `{ ok }` | Closes a room for good (`room:closed` to everyone in it). |
| `library:list` | none | `QuizSummary[]` (with `problems`) or `null` | Quiz library. All `library:*` need the PIN on this socket. |
| `library:get` | `{ id }` | `Quiz` or `null` | Open a quiz in the editor. |
| `library:create` | `{ title }` | `SaveQuizResult` | New empty quiz with the server's default rules. |
| `library:duplicate` | `{ id }` | `SaveQuizResult` | Copy a quiz. |
| `library:save` | `Quiz` | `SaveQuizResult` = `{ ok:true, quiz }` or `{ ok:false, error, problems? }` | Save (create or replace by id). The server cleans it (`cleanQuiz`); drafts may be incomplete. |
| `library:delete` | `{ id }` | `{ ok }` | Delete a quiz. |
| *(HTTP)* `POST /api/images` | image bytes (JPEG/PNG/WebP, ≤ 2.5 MB), header `x-admin-pin` | `{ url: "/images/<id>" }` | Question pictures. `GET /images/<id>` serves them (cached forever). |
| `participant:join` | `{ roomCode, name, participantId? }` | `JoinResult` = `{ ok:true, participantId, roomCode, status }` or `{ ok:false, error: JoinError }` | Phone joins or rejoins (with saved id, or same name if the old phone dropped). |
| `participant:bot` | `BotLook` `{ color, head }` | `BotResult` = `{ ok:true }` or `{ ok:false, error: "invalid"\|"too-late" }` | Phone changes its bot (any colour, any head, may match others). **Lobby only.** |
| `participant:answer` | `{ questionId, optionId }` | none | Any round's answer step. First tap wins; ignored from anyone who can't answer this question (finalists in the wild card round, caught runners, the audience). |
| `participant:back` | `{ finalistId }` | none | Audience backs a finalist (changeable until Start Blackout). |
| `participant:visibility` | `{ hidden: boolean }` | none | Page hidden/shown. Admin-only flag ("left page"). |
| `admin:auth` | `{ roomCode, pin }` | `{ ok:true, roomCode }` or `{ ok:false, error:"room-not-found"\|"wrong-pin" }` | After 5 wrong PINs the socket is refused (reload to retry). |
| `admin:command` | `{ stepId, action: AdminAction }` | `CommandResult` = `{ ok:true }` or `{ ok:false, reason:"stale-step"\|"not-allowed"\|"not-signed-in"\|"invalid" }` | Every quizmaster action (§8.5). |
| `admin:results` | none | `{ csv, filename }` or `null` | Results CSV download. |

`JoinError`: `room-not-found`, `name-taken` (exact duplicate, any case: "add your surname
initial"), `name-invalid` (empty or over 20 chars after trimming), `quiz-ended`, `removed`,
`room-full`. User-facing texts: `JOIN_ERROR_MESSAGES`, `BOT_ERROR_MESSAGES`, `ADMIN_AUTH_ERROR_MESSAGES`.

### 8.3 Events: server → client
| Event | Payload | To |
|---|---|---|
| `host:state` | `HostView` | the room's Host socket(s) |
| `participant:state` | `ParticipantView` (private, per phone) | each participant socket |
| `admin:state` | `AdminView` (includes the correct answer) | every signed-in Admin socket |
| `room:closed` | `{ reason }` | everyone in a room that's gone (new room, abandoned 30 min after the Host left with no Admin) |
| `server:hello` | `{ bootId }` | every new connection; a new `bootId` means the server restarted (rooms lost) |

Send a view **whenever it changes, only to the sockets whose view changed** (the server throttles
phone updates to 150 ms). Every view carries `serverNow` (ms).

### 8.4 The three views (shape summary)
**`HostView`**: `roomCode`, `joinUrl`, `roomCodeVisible`, `soundOn`, `settings: QuizSettings`
(`safeCount`, `wildCardQuestions`, `blackoutQuestions`, timings), `participants`, **`cast: CastMember[]`**
(each with `mood`; everyone, then in the wild card round only its players, in Blackout the runners),
`counts` (+ `wildcard`), `timer`, `paused`, `serverNow`, `nextImage`, `stage: HostStage` keyed by
`phase`: question steps carry `question: McqQuestion` (`round` 1/2/3, `number`, `count`,
`suddenDeath`, **`options` 1–4** from the answer step); reveals add `correctText` / `correctIndex` /
`voided`; `cut` has `standings` (rank, score, timeMs, finalist), `safeCount`, `wildCardCount`,
`wildCardSkipped`; `wc*` stages carry `wildCard: WildCardState` (standings only on `wcStandings` /
`wcWinner`); `bo*` stages carry `blackout: BlackoutState` (`dark`, `darkFrom`, `runners` with position,
from, delta (after the reveal only), gap, alive, caughtOnQuestion, place, headStart, mood),
`caughtThisQuestion`, `alive`, `over`, `winner`; `podium` has `basis` (blackout / wildcard / round1),
`entries`, `calledIt`.

**`ParticipantView`**: `roomCode`, `me` (+ `status`: playing / finalist / wildcard / audience /
removed), `timer`, `paused`, `serverNow`, `screen` keyed by `kind`: `lobby`, `r1Intro`,
`nextQuestion`, `eyesUp` / `answer` / `lockedIn` / `timesUp` (all with `round`), `result` (Round 1
and wild card: `outcome`, **`correctText`** after the reveal only, wild card `tally`), `voided`,
`cut` (`outcome` safe / wildcard, `rank`: the only time a rank shows), `safeWatch`, `wcStatus`
(`right`, `asked`, `suddenDeath` in / out), `wcWinner` (`you` won / lost), `audience`,
`backFinalist`, `runnerResult` (`outcome`, `delta`, `position`, `gap`, `correctText` when wrong or
missed), `runnerStatus` (alive, gap, headStart, caughtNow, place), `blackoutWatch` (audience: backed,
runners with gap, alive count), `podium`, `removed`.

**`AdminView`**: `phase`, **`stepId`**, `stepLabel`, **`primary`**, `hint`, **`allowed`**, `timer`,
`paused`, `question: AdminQuestion` (**with the answer**, numbered 1–4), `nextQuestion`, `counts`
(+ `answered`/`expected`), `participants` (score, rank, `wildCorrect`, `wildTimeMs`, `isWildCard`,
`blackout` {position, gap, caughtOnQuestion, place}, answered, flags, backing), `finalists:
FinalistInfo[]`, `wildCard` (full standings), `blackout`, `backing`, `podium`, `quizTitle`.

Shared types: `ParticipantTag { id, name, color, head }`, `CastMember = ParticipantTag & { mood }`,
`BotMood = "idle"|"thinking"|"locked"|"right"|"wrong"|"out"`, `BotHead` (8), `PARTICIPANT_COLORS` (12),
`Timer { endsAt, durationMs, remainingMs? }` (remainingMs only while paused).

### 8.5 Admin commands (`AdminAction.type`)
| Group | Actions |
|---|---|
| Flow (the big button sends one) | `startQuiz`, `showQuestion`, `revealAnswer`, `showResults`, `showLeaderboard`, `nextQuestion`, `endRound1`, `startWildCard`, `showStandings`, `revealWildCard`, `openPredictions`, `startBlackout`, `advanceDarkness`, `showWinner` |
| Timers | `pause`, `resume`, `addTime` (+5 s), `skipTimer` |
| Fixes | `voidQuestion`, `restartQuestion`, `restartRound` |
| Room | `removeParticipant {participantId}`, `setRoomCodeVisible {visible}`, `setSound {on}`, `endQuiz` |

Step-independent (accepted from any step): `pause`, `resume`, `removeParticipant`,
`setRoomCodeVisible`, `setSound`, `endQuiz`. Everything else must carry the current `stepId`.
Destructive (UI asks for a second tap): `voidQuestion`, `restartQuestion`, `restartRound`, `endQuiz`, `removeParticipant`.

### 8.6 Bot rules the server enforces
- On join, assign a starting bot: least-used of the 12 `PARTICIPANT_COLORS` (palette order breaks ties), first head nobody has in that colour. Repeats are fine.
- `participant:bot` is accepted only in `lobby`. **Any colour** (`#rrggbb` or `#rgb`), stored by
  `normalizeBotColor` (lowercase, lightness clamped to `BOT_LIGHTNESS` 45–92 % so it shows on the dark
  screens); head in `BOT_HEADS`. **Nothing is ever taken:** several people may share a colour and head
  (decided 12 Oct for 100 people). Names stay unique (`name-taken`).
- **Moods** (`HostView.cast` and the moods inside stage data): lobby/intro/read → `idle`; answer
  step → `thinking` (not answered) / `locked` (answered); time's up → `locked` / `idle`; reveal →
  `right` / `wrong` (Round 1 and wild card: a miss is wrong; Blackout: no answer → `idle`; voided →
  idle). The cut: safe `right`, wild card players `idle`. Wild card revealed: the winner `right`, the
  rest `out`. Blackout: after the dark moves, caught runners `out`, survivors `idle`. Podium: the
  winner `right`. `locked` never reveals correctness.

### 8.7 A Round 1 question, end to end
```
Admin  → admin:command {stepId:12, action:{type:"showQuestion"}}            ack {ok:true}
Server → host:state   stage {phase:"r1Read", question:{…, options:null}}   timer 8s
       → participant:state screen {kind:"eyesUp"} · cast moods "idle"
(8 s)  → host:state   stage {phase:"r1Answer", question:{…, options:["A","B","C","D"]}, answered:0, expected:64}
       → participant:state screen {kind:"answer", questionId:"q_7f…", options:[{id:"o_a1…",text:"A"},…]}  (same order)
Phone  → participant:answer {questionId:"q_7f…", optionId:"o_a1…"}
Server → that phone: {kind:"lockedIn"} · Host: answered 1/64 · cast mood "locked"
(8 s or everyone answered) → r1TimesUp (holds)
Admin  → revealAnswer → Host r1Reveal {correctText} · phones {kind:"result", outcome, correctText} · moods right/wrong
```

### 8.8 Example payloads
```jsonc
// participant:join ack
{ "ok": true, "participantId": "3f9c2a1b7d4e", "roomCode": "KJSC", "status": "playing" }
// participant:state (lobby)
{ "roomCode":"KJSC", "me":{"id":"3f9c…","name":"Riya","color":"#4CC9F0","head":"antenna","status":"playing"},
  "timer":null, "paused":false, "serverNow":1791735000000,
  "screen":{"kind":"lobby","joined":12} }
// admin:command
{ "stepId": 12, "action": { "type": "advanceDarkness" } }
```

### 8.9 The first backend prototype (resolved 12 Oct: the backend is `server/`)
*(History: this section is resolved, see "Decided 12 Oct 2026" below. The prototype it describes now
lives in `archive/ws-backend-v1/`; the paths below are where it used to be.)*

The teammate's `backend/` (on `main` in `Leleouch14/jackbox_2.0`, last checked 11 Oct 2026) is a
different, earlier design:
| | Contract (frontend) | `backend/server.js` today |
|---|---|---|
| Transport | Socket.IO v4, port 3001 | raw `ws` WebSocket, port 8080, routes `/host` and `/player?room=&playerId=` |
| Messages | events above, full views | JSON `{event:…}`: `room_created`, `next_question`, `question_started`, `show_controller_options`, `submit_answer`, `answer_locked`, `answer_progress`, `end_question`, `question_results`, `round_over`, `game_over`, `player_joined`, `player_left` |
| Who drives | Admin (PIN) with `stepId` | the Host sends `next_question` / `end_question` |
| Rounds | Round 1 + top 6 + buzzer round + predictions + podium | one round of questions, leaderboard at the end |
| Timing / scoring | 8 s read + 8 s answer; 500–1000 by speed | 15 s; 1000 + up to 500 speed bonus |
| Questions | `data/questions.json` `{id, round, text, image, options[4], correct}` | `backend/questions.json` `{question, options, correctOption}` |
| Extras | bots, moods, reconnect, wake lock, CSV | Postgres (`DATABASE_URL`, Supabase) / sqlite tables `rooms`, `players`, `game_history` |

**Decided 12 Oct 2026: option 1.** What was done: `server/db.ts` ports `archive/ws-backend-v1/db.js` (same `rooms`, `players`, `game_history` tables, same `DATABASE_URL`, SSL for Supabase). It only **adds** columns: `players.name/status/round1_rank/buzzer_points`, `game_history.round/answer_ms`. `rooms.room_code` = code + creation time in UTC (e.g. `KJSC-2026-10-12T13:35`) so codes reused on another night never mix. Writes are queued in the background (a room at most every 2 s, answers as each question is scored, removed again on void/restart), and a DB failure is logged and never stops the quiz. `backend/` on `main` is untouched.

**Options that were considered (recommended first):**
1. **Recommended:** the real server *is* `server/` (already complete and tested against this
   contract): deploy it to Render as-is, and add the teammate's Postgres persistence (`db.js`:
   save room state, scores, answer log) behind `quiz.ts` without changing the contract.
2. Teammate rewrites `backend/` to Socket.IO implementing §8 exactly, using `server/` as the
   reference, and proves it by pointing `npm run smoke` at it.
3. Not recommended this close to the event: change the frontend to the raw-ws protocol.
Whichever is chosen: record it in §1.3 and §4.

### 8.10 Contract changelog
| Date | Change | Screens must |
|---|---|---|
| 11 Oct 2026 | v2 contract (Phase 1) | n/a |
| 14 Oct 2026 | **v3: three rounds.** Phases `r2*`/`suddenDeath` → `wcIntro…wcWinner`, `boIntro…boDark`. `Round1Question`/`BuzzerQuestion` → `McqQuestion` (with `round`, `suddenDeath`); `OptionResult.letter` → `number`; `Reveal` (`correctText`, `correctIndex`, `voided`). New `WildCardState`, `WildCardStanding`, `BlackoutState`, `Runner`, `RunnerLite`, `FinalistInfo` (replaces `FinalistState`), `PodiumBasis`; `PodiumEntry` gets `round1Score`, `position`, `caughtOnQuestion`, `wildCard` (no `points`). `ParticipantStatus` + `wildcard`; `Counts.wildcard`; `QuizSettings` (`safeCount`, `wildCardQuestions`, `wildCardSuddenDeathMax`, `blackoutQuestions`, Blackout timings). Phone screens: `cut` (`outcome`), `safeWatch`, `wcStatus`, `wcWinner`, `runnerResult`, `runnerStatus`, `blackoutWatch`; question screens carry `round`; removed `finalist`, `buzzer`, `buzzerWatch`. `AdminAction`: − `markCorrect`, `markWrong`, `undoMark`, `startBuzzerRound`, `showScores`, `startSuddenDeath`; + `startWildCard`, `showStandings`, `revealWildCard`, `startBlackout`, `advanceDarkness`. `AdminQuestion` numbered 1–4 (`correctNumber`). `AdminParticipant` − `points`, + `wildCorrect`, `wildTimeMs`, `isWildCard`, `blackout`. `AdminView` − `round2`, `canUndo`, `lastMark`; + `wildCard`, `blackout`. Removed `participant:buzz`. Library: `Quiz.wildcard` + `Quiz.blackout` (was `buzzer`), `QuizRules` (`safe`, `wildCardQuestions`, `blackoutQuestions`, Blackout timings), `QuizSummary` counts. `/health` returns JSON. | Draw the new stages and screens; Admin shows the wild card standings and the runners |
| 12 Oct 2026 | `AdminView.podium` (`PodiumSummary`, or null before the podium) (same data as the Host podium stage) | Admin shows the winner; the real backend must send it on the podium |
| 12 Oct 2026 (evening) | **Bots for 100:** removed `BotPicker` and the lobby's `botPicker`; `BotError` no longer has `"taken"`; `participant:bot` takes any `#rrggbb`; new `normalizeBotColor`, `hexToHsl`, `hslToHex`, `BOT_LIGHTNESS`. | `BotBuilder` has no `picker` prop; colour swatches + wheel; nothing greyed out |
| 12 Oct 2026 (later) | **Quiz library.** Removed `host:create`/`host:resume`; added `host:auth` (PIN), `admin:login`, `admin:rooms`, `admin:openRoom`, `admin:closeRoom`, `library:list/get/create/duplicate/save/delete`, HTTP `POST /api/images` + `GET /images/<id>`; types `Quiz`, `QuizRules`, `LibraryQuestion`, `QuizSummary`, `OpenRoomSummary`, `QUIZ_LIMITS`; `AdminView.quizTitle`. Rules/imports shared in `src/shared/quiz.ts`. Server: `server/library.ts` (Supabase tables `quizzes`, `quiz_images`), per-question `readMs`/`openMs`. | Admin opens rooms from a quiz; the Host asks for the PIN; question images via `assetUrl()` |
| 11 Oct 2026 (night) | `ParticipantTag.head`; `PARTICIPANT_COLORS` = 12 bot colours; `BOT_HEADS`, `BotMood`, `BotLook`, `BotPicker`, `CastMember`; `HostView.cast`; lobby `botPicker`; `participant:bot` + `BotResult`; `Round1Question.options`; phones get the Host's order; `result.correctText` | draw bots everywhere a person appears; use `cast[i].mood`; number options 1–4 |

---

## 9. Glossary
| Term | Meaning |
|---|---|
| Host | the projector screen (`/host`), no controls |
| Participant / phone | a player's phone (`/play`) |
| Admin / quizmaster | the person running the quiz (`/admin`, PIN) |
| Finalist | the top 9 after Round 1 (safe) plus the wild card winner: the 10 Blackout runners |
| Wild card | the round for everyone outside the top 9; most right answers wins the 10th seat |
| Blackout | the final: runners move on right answers, the dark advances and catches them; last one running wins |
| Runner / the dark / gap | a finalist in Blackout / the darkness's position / steps a runner is ahead of it |
| Audience | everyone not in the final; backs a finalist |
| The cut | end of Round 1: the ranked list with a line under 9th |
| Bot | a participant's robot avatar (colour + head) |
| Mood | what a bot's eyes are doing (`BotMood`) |
| Step / stepId | the current position in the flow; changes every step |
| Void | cancel a question: it doesn't count (Blackout: no moves, the dark stays) |
| Preset | `demo` (3 questions, top 3 safe, short Blackout) or `event` (20 / top 9 / 5 / 12) |

---

## 10. Keeping this file true
- Update this file **in the same commit** as any change to rules, contract, stack, structure,
  design or status. Bump "Last updated".
- Contract changes: also §8 tables and §8.10 changelog. New decisions: §1.3. Progress: §4.
- If this file and the code disagree, the code and `docs/SPEC.md` win; fix this file.
