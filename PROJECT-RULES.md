# PROJECT RULES: Hermes Quiz (the AI handoff)

> **Every AI model or agent working on this project reads this file first, all of it.**
> It is the single source of truth for constraints, architecture, stack, the to-do list,
> skills, agent roles, plugins and the frontend↔backend API. If you change anything it
> describes, update this file in the same change (see §10 "Keeping this file true").
>
> Last updated: 11 Oct 2026 (night) · Owner: Sukrit Srivastava (frontend) · Repo: `Leleouch14/jackbox_2.0`

---

## 0. The project in 60 seconds

**Hermes Quiz** is a Jackbox-style live quiz for **60–100 people in one hall**, run by the
**Computer Society of India (CSI) student chapter at KJSCE, Mumbai**, right after a workshop
on the **Hermes AI agent**. The **event is within a week of 11 Oct 2026**.

- One laptop drives the **projector** (`/host`). Everyone answers on their **phone** (`/play`).
  A **quizmaster** runs every step from **Admin** (`/admin`, PIN), usually on a phone.
- **Round 1:** everyone answers multiple-choice questions (8 s to read, 8 s to answer, faster
  correct answers score more). **Top 6** go through. The rest become the **audience** and back
  a finalist. **Round 2:** a **6-player buzzer round**, answers said out loud, the quizmaster
  marks Correct or Wrong. Then the **podium**.
- **Look:** "Server Corridor, Lights Low", inspired by Jackbox's *Murder Trivia 2*. A dark
  server-room corridor, typewriter type, terminal digits, and every player is a **robot** whose
  eyes react to their answers. The approved reference is **`public/finaldesign.html`**.
- **Team:** Sukrit builds the **frontend** (this Next.js app). A teammate builds the **real
  backend**. Until it's ready, **`mock-server/`** runs the whole game and is the reference
  implementation of the contract in **`src/shared/protocol.ts`**.

**Where we are:** Phase 1 of 5 is done (engine, contract, mock server, tests). The design system
and bots are in. `/host`, `/play` and `/admin` are temporary pages already styled in the final
look. Next: run Prompt 1 in `docs/BUILD-PHASES.md` (see §4).

### Read these, in this order
1. **This file.**
2. `docs/SPEC.md` (v2.1): every game rule, step by step. Rules there override anything else.
3. `src/shared/protocol.ts`: the contract (every view, event and payload, fully commented).
4. `public/finaldesign.html`: the approved design (open http://localhost:3000/finaldesign.html).
5. `docs/BUILD-PHASES.md` (v4): the 5 build prompts. Do the next unfinished phase only.
6. `CLAUDE.md`, `AGENTS.md`, `README.md`: short notes that point back here.

### Run it (Windows PowerShell)
```powershell
npm install
npm run dev            # Next.js on :3000 + mock game server on :3001 (demo preset)
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
| C1 | **Never `git push`** unless Sukrit literally says "push". Commit locally on the **`frontend`** branch only. | Shared repo; the teammate works on `main`/backend. |
| C2 | **The server is the source of truth.** Screens send actions and draw the view they receive. They never compute game state, scores, timers, ranks or bot moods. | 100 phones must agree; nobody can cheat by editing the page. |
| C3 | **No answer leaks.** Phones and the Host never receive the correct answer before the reveal. Only Admin gets it. Option ids and question ids are opaque random strings, new for every question run. | The projector laptop may be screen-shared; phones can be inspected. |
| C4 | **Contract first.** Every event and view type lives in `src/shared/protocol.ts`. To change the API: edit it there → implement in `mock-server/` → follow the TypeScript errors → update §8 of this file → tell the backend teammate. | Two people build against one contract. |
| C5 | **The quizmaster drives the flow.** Timers run only for Round 1 read/answer and Round 2 read / buzz window / spoken-answer countdown. When a timer ends, the room **holds** for the next click. The spoken-answer countdown **never** marks an answer. | SPEC v2. |
| C6 | **Every Admin command carries `stepId`.** The server ignores a command from an old step (except `STEP_INDEPENDENT_ACTIONS`). | A double tap or two Admin phones must never skip two steps. |
| C7 | **The look is approved and final.** Match `public/finaldesign.html` exactly. Use the tokens/classes in `src/app/globals.css` and the components in `src/components/ui/`. No new colours or fonts. Extend only in the same visual language and say so. | Sukrit approved it: "do not change anything". |
| C8 | **One answer order.** In Round 1 the options are shuffled once per question; the Host (from the answer step) and every phone show that same order, numbered **1–4**. | Decided 11 Oct 2026 to match the design. |
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
- **Deadline:** event within a week of 11 Oct 2026. Prefer simple, robust choices over clever ones.
- **Admin PIN:** default `1234` for testing; set a longer `ADMIN_PIN` on the night.
- **Questions:** MCQ only, exactly 4 options, in `data/questions.json`. Images (Host only) in
  `public/questions/`. Real Hermes questions still to be written (§4).

### 1.3 Decisions already made (don't reopen without Sukrit)
| Date | Decision |
|---|---|
| 11 Oct | SPEC v2: two rounds, 6-player buzzer round, quizmaster controls everything. |
| 11 Oct | Look: "Server Corridor, Lights Low" (Direction E v2). Approved, final. |
| 11 Oct | Fonts: Special Elite (words), VT323 (numbers); Archivo only for dense Admin tables. |
| 11 Oct | Bots: 12 colours × 8 heads, picked in the lobby; unique colour while any colour is free, then unique colour+head (96 unique). |
| 11 Oct | Bot eyes show the game: idle / thinking / locked / right / wrong / out, computed by the server (`HostView.cast`). |
| 11 Oct | One 1–4 answer order on the Host and every phone in Round 1 (no per-phone shuffle). |
| 11 Oct | Host cast: up to 12 bots in a named row; 13+ as a dense wall of smaller bots without names. |

---

## 2. Architecture

### 2.1 System picture
```
                 ┌──────────────────────────── Next.js app (this repo, port 3000) ───────────────────────────┐
 Projector  ───► │ /host   Host screen      (src/components/temp/TempHost + TempStage → real screens in Ph.4) │
 Phones     ───► │ /play   Participant      (src/components/temp/TempPlay  → real screens in Phase 3)         │
 Quizmaster ───► │ /admin  Admin panel      (src/components/temp/TempAdmin → real panel in Phase 2)           │
                 │ /       home · /finaldesign.html  approved design reference (static)                       │
                 │   Zustand stores (src/stores/*) ── socket.io-client (src/lib/socket.ts)                    │
                 └───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                             │  Socket.IO v4 (WebSocket, polling fallback)
                                                             │  events + views defined in src/shared/protocol.ts
                 ┌───────────────────────────────────────────▼──────────────────────────────────────────────┐
                 │ Game server (port 3001)                                                                    │
                 │   NOW:   mock-server/  (TypeScript, tsx)  ← complete, tested reference                     │
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
- **Sessions:** `sessionStorage` per tab (so several test tabs work on one laptop). Host keeps
  `hostToken` to resume after a refresh; phones keep `participantId` to rejoin; typing the same
  name again also reclaims a dropped seat.

### 2.3 The game flow (phases, from `protocol.ts`)
```
lobby → r1Intro → [ r1Read (8s) → r1Answer (8s) → r1TimesUp → r1Reveal → r1Results? → r1Leaderboard? ] × N
      → cut → predictions? → r2Intro
      → [ r2Read (5s) → r2BuzzOpen (15s) → r2Answering (10s, say it aloud) → Correct → r2Reveal
                                                            └ Wrong → r2BuzzOpen (10s reopen) or r2Reveal
          → r2Scores? ] × 10
      → suddenDeath (only on a tie for 1st) → podium
(?) = optional step the quizmaster may skip. Timed steps advance by themselves; every other step is a click.
```
Scoring (Round 1): correct = **500 → 1000** points, linearly faster = more
(`round(500 + 500 × (1 − elapsed/limit))`); wrong or no answer = 0. Ties: lower total answer
time ranks higher (a miss counts as the full time). Round 2: +1 per correct buzz, no penalty.
Full rules and edge cases: `docs/SPEC.md`.

### 2.4 Folder map
```
PROJECT-RULES.md            ← this file (the handoff)
AGENTS.md / CLAUDE.md       short pointers + the must-follow rules
data/questions.json         the questions (MCQ, 4 options, correct = index, round 1/2/null)
docs/SPEC.md                game rules v2.1 (source of truth for rules)
docs/BUILD-PHASES.md        the 5 build prompts (v4)
mock-server/config.ts       presets: every timing and count
mock-server/quiz.ts         all the rules (QuizRoom), no socket code
mock-server/rooms.ts        Socket.IO glue: roles, PIN, rooms, sending views
mock-server/server.ts       starts the Socket.IO server; validates incoming payloads
mock-server/simulate.ts     npm run simulate: 23 rule checks with a fake clock, 100-player games
scripts/smoke.ts            npm run smoke: whole demo game over real Socket.IO
scripts/bots.ts             npm run bots: N fake participants
server/                     placeholder for the real backend (teammate)
public/finaldesign.html     the approved design, every animation
public/questions/           question images (Host only)
src/shared/protocol.ts      THE CONTRACT
src/app/                    routes: / (home), /host, /play, /admin; globals.css; layout.tsx (fonts)
src/components/ui/          Bot (+botDelay), BotBuilder, Corridor, TimerRing  ← the design system
src/components/temp/        temporary pages, styled in the final look (replaced in Phases 2–4)
src/components/host/useJoinUrl.ts   join link for phones (LAN address when the Host is on localhost)
src/stores/                 Zustand: hostStore, participantStore, adminStore
src/lib/                    socket, session, useCountdown, useWakeLock, usePageVisibility, confetti, format, adminLabels
```
**Leftovers to delete (they break the typecheck; Prompt 1 does it):** `src/components/host/HostApp.tsx`,
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
`clock`, `bot` (+`data-head`, `data-mood`), `corridor-*`. Legacy marigold tokens (`plate`, `press`,
`bg-paper`…) are unused leftovers; delete in Phase 5.

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
| Mock server | Node ≥ 20.9, **tsx** (`tsx watch mock-server/index.ts`) | `concurrently` runs web + game |
| Tests | `mock-server/simulate.ts` (rules, fake clock), `scripts/smoke.ts` (real sockets), Playwright for screenshots | |
| Real backend (teammate, in progress) | Node, currently raw **`ws`** + **pg** (Supabase Postgres) / sqlite3 | **Not yet on the contract**; see §8.9 |
| Hosting plan | Frontend on **Vercel**; game server on **Render** (or similar, WebSocket-capable) | not deployed yet |

npm scripts: `dev`, `dev:event`, `dev:web`, `dev:game`, `build`, `start`, `typecheck`, `simulate`, `smoke`, `bots`.

Environment variables (`.env.local`, see `.env.example`):
| Var | Default | Used by |
|---|---|---|
| `NEXT_PUBLIC_SOCKET_URL` | same host, port 3001 | browser: where the game server is |
| `GAME_PRESET` | `demo` | server: `demo` or `event` |
| `ADMIN_PIN` | `1234` | server |
| `GAME_PORT` / `WEB_PORT` | `3001` / `3000` | server (web port only for printed links) |
| `PUBLIC_WEB_URL` | `http://<LAN-IP>:3000` | server: builds the join link |
| `CORS_ORIGIN` | any | server: comma-separated allowed origins |

---

## 4. To-do list

Status: ✅ done · 🟡 done but unverified · ⬜ to do. Work top to bottom. Phases are in `docs/BUILD-PHASES.md`.

### Done
- ✅ SPEC v2 → v2.1 (rules, bots, one answer order, the Look).
- ✅ Phase 1: contract (`protocol.ts`), mock server (`quiz.ts`, `rooms.ts`), presets, `simulate` (23 checks pass), `smoke`, `bots`.
- ✅ Design approved: `public/finaldesign.html` (Direction E v2).
- 🟡 Design system in code: `globals.css`, fonts, `Bot`, `BotBuilder`, `Corridor`, `TimerRing`, home page. (Written without `npm install`; Prompt 1 verifies.)
- 🟡 Bots in the contract and mock server: `participant:bot`, `BotPicker`, `HostView.cast` moods; one 1–4 order; `result.correctText`. (`simulate` passes; `smoke`/`build` not yet run.)
- 🟡 Temporary `/host`, `/play`, `/admin` restyled in the final look, `/host` with the projector stage (`TempStage`).

### Next
1. ⬜ **Prompt 1, design foundation check:** git setup (`.git-setup/setup.ps1` exists; read it first), delete the leftovers (§2.4), `npm install`, make typecheck/build/simulate/smoke pass, extend `smoke` (bots, moods, 1–4 order), `bots.ts` picks a free bot, screenshots vs `finaldesign.html`.
2. ⬜ **Prompt 2, Admin screen** (phone-first control panel in the corridor look).
3. ⬜ **Prompt 3, Participant screens** (join, bot builder, answers 1–4, results with bot, buzzer, podium).
4. ⬜ **Prompt 4, Host screens** (corridor, cast wall, motion, sound).
5. ⬜ **Prompt 5, event-proofing** (failure drills, 100-bot scale test, design QA, run sheet, backend notes, deploy notes).

### Not in a phase yet
- ⬜ **Backend alignment (blocking for the event):** the teammate's `backend/` uses a different protocol (§8.9). Agree on the path and finish it.
- ⬜ Write the **real Hermes questions** (round 1 count, 10+ buzzer questions plus spares) into `data/questions.json`.
- ⬜ Deploy: frontend to Vercel, game server to Render; set `NEXT_PUBLIC_SOCKET_URL`, `PUBLIC_WEB_URL`, `CORS_ORIGIN`, `ADMIN_PIN`, `GAME_PRESET=event`.
- ⬜ CSI club logo in a corner (optional, "later").
- ⬜ Rehearsal in the actual hall with the real projector (brightness, hall lights, sound).

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
6. Commit locally on `frontend` with a clear message (`Phase N: …` for phase work).

### 6.2 Roles (one agent can hold several; never two agents on the same files at once)
| Role | Owns (may edit) | Must not edit | Done when |
|---|---|---|---|
| **Contract & game-rules agent** | `src/shared/protocol.ts`, `mock-server/**`, `data/questions.json`, `docs/SPEC.md`, §8 of this file | screens | `simulate` + `smoke` pass with new tests; §8 updated |
| **Admin screen agent** | `src/app/admin/**`, `src/components/admin/**`, `src/stores/adminStore.ts`, `src/lib/adminLabels.ts` | contract (ask the contract agent) | Prompt 2 verified |
| **Participant screen agent** | `src/app/play/**`, `src/components/play/**`, `src/stores/participantStore.ts` | contract | Prompt 3 verified |
| **Host screen agent** | `src/app/host/**`, `src/components/host/**`, `src/stores/hostStore.ts`, sounds | contract | Prompt 4 verified |
| **Design-system agent** | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/**`, `public/finaldesign.html` (read-only unless Sukrit approves a change) | screens' logic | screens still match the reference |
| **QA / event-proofing agent** | `scripts/**`, `docs/RUN-SHEET.md`, `docs/BACKEND-NOTES.md` | product code except bug fixes it reports | Prompt 5 verified |
| **Backend agent (teammate's side)** | `server/**` or `backend/**` | `src/**`, `mock-server/**` | passes `smoke` pointed at the real server (§8.9) |

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
exactly this**; `mock-server/` is the working reference.

### 8.1 Transport
- **Socket.IO v4** server. Default URL: same host as the website, **port 3001**
  (`NEXT_PUBLIC_SOCKET_URL` overrides). Client transports: `["websocket", "polling"]`.
- CORS: allow the website's origin (`CORS_ORIGIN`).
- **Request/response** = an event with an **ack callback** (Socket.IO acknowledgement).
  **Fire-and-forget** = an event without an ack. **Server pushes** = views and `room:closed`.
- A socket has one role: **host**, **participant** or **admin**, set by the first successful
  `host:create`/`host:resume`, `participant:join`, or `admin:auth`.

### 8.2 Events: client → server
| Event | Payload | Ack result | Who / when |
|---|---|---|---|
| `host:create` | none | `{ roomCode, hostToken }` | Host opens `/host`. Keep `hostToken` in sessionStorage. |
| `host:resume` | `{ roomCode, hostToken }` | `{ ok: boolean }` | Host refreshed. |
| `participant:join` | `{ roomCode, name, participantId? }` | `JoinResult` = `{ ok:true, participantId, roomCode, status }` or `{ ok:false, error: JoinError }` | Phone joins or rejoins (with saved id, or same name if the old phone dropped). |
| `participant:bot` | `BotLook` `{ color, head }` | `BotResult` = `{ ok:true }` or `{ ok:false, error: "taken"\|"invalid"\|"too-late" }` | Phone changes its bot. **Lobby only.** |
| `participant:answer` | `{ questionId, optionId }` | none | Round 1 answer step. First tap wins; later ones ignored. |
| `participant:buzz` | `{ questionId }` | none | Finalist, buzz window. First buzz wins the turn. |
| `participant:back` | `{ finalistId }` | none | Audience backs a finalist (changeable until the buzzer round starts). |
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

Send a view **whenever it changes, only to the sockets whose view changed** (the mock throttles
phone updates to 150 ms). Every view carries `serverNow` (ms).

### 8.4 The three views (shape summary)
**`HostView`**: `roomCode`, `joinUrl`, `roomCodeVisible`, `soundOn`, `settings: QuizSettings`,
`participants: ParticipantTag[]` (join order, not removed), **`cast: CastMember[]`** (each with
`mood`), `counts: Counts`, `timer: Timer|null`, `paused`, `serverNow`, `nextImage` (to preload),
`stage: HostStage` (a union keyed by `phase`; e.g. `r1Answer` has `question: Round1Question`
with **`options` 1–4** plus `answered`/`expected`; `r1Reveal` has `correctText`; `r2*` has
`round2: Round2State`; `podium` has `entries`, `calledIt`).

**`ParticipantView`**: `roomCode`, `me: ParticipantTag & { status }`, `timer`, `paused`,
`serverNow`, `screen: ParticipantScreen` (a union keyed by `kind`): `lobby` (with
**`botPicker: { lockedColors, taken }`**), `r1Intro`, `nextQuestion`, `eyesUp`, `answer`
(`questionId`, options in the Host's 1–4 order, **never a correct flag**), `lockedIn`, `timesUp`,
`result` (`outcome`, **`correctText`**, sent only after the reveal), `voided`, `cut` (`madeIt`,
`rank`; the only time a rank shows), `audience`, `backFinalist`, `finalist`, `buzzer` (finalist:
`canBuzz`, `lockedOut`, `points`, `myResult`), `buzzerWatch` (audience), `podium`, `removed`.

**`AdminView`**: `phase`, **`stepId`**, `stepLabel`, **`primary`** (`{ action, label }` or null),
`hint`, **`allowed: AdminActionType[]`**, `timer`, `paused`, `question: AdminQuestion` (**with
the answer**), `nextQuestion`, `counts` (+ `answered`/`expected`), `participants: AdminParticipant[]`
(connected, status, score, rank, points, answered, `leftPageCount`, `pageHidden`, `backingId`),
`round2`, `finalists`, `backing`, `canUndo`, `lastMark`, `roomCodeVisible`, `soundOn`.

Shared types: `ParticipantTag { id, name, color, head }`, `CastMember = ParticipantTag & { mood }`,
`BotMood = "idle"|"thinking"|"locked"|"right"|"wrong"|"out"`, `BotHead` (8), `PARTICIPANT_COLORS` (12),
`Timer { endsAt, durationMs, remainingMs? }` (remainingMs only while paused).

### 8.5 Admin commands (`AdminAction.type`)
| Group | Actions |
|---|---|
| Flow (the big button sends one) | `startQuiz`, `showQuestion`, `revealAnswer`, `showResults`, `showLeaderboard`, `nextQuestion`, `endRound1`, `openPredictions`, `startBuzzerRound`, `showScores`, `startSuddenDeath`, `showWinner` |
| Judging | `markCorrect`, `markWrong`, `undoMark` |
| Timers | `pause`, `resume`, `addTime` (+5 s), `skipTimer` |
| Fixes | `voidQuestion`, `restartQuestion`, `restartRound` |
| Room | `removeParticipant {participantId}`, `setRoomCodeVisible {visible}`, `setSound {on}`, `endQuiz` |

Step-independent (accepted from any step): `pause`, `resume`, `removeParticipant`,
`setRoomCodeVisible`, `setSound`, `endQuiz`. Everything else must carry the current `stepId`.
Destructive (UI asks for a second tap): `voidQuestion`, `restartQuestion`, `restartRound`, `endQuiz`, `removeParticipant`.

### 8.6 Bot rules the server enforces
- On join, assign a free bot: least-used colour (palette order breaks ties), first head nobody has in that colour.
- `participant:bot` is accepted only in `lobby`. Colour must be in `PARTICIPANT_COLORS`, head in `BOT_HEADS`.
- While **any colour is unused**, a colour held by someone else is **locked** (`taken`). Once all 12
  are in use, colours can be shared but **never the same colour + head**.
- **Moods** (`HostView.cast`): lobby/intro/read → `idle`; Round 1 answer step → `thinking` (not
  answered) / `locked` (answered); time's up → `locked` / `idle`; reveal/results/leaderboard →
  `right` / `wrong` (miss = wrong; voided → idle); from the cut on, non-finalists → `out`; buzzer
  round: buzz open → `thinking`, the buzzer → `locked`, locked out → `wrong`, correct on reveal →
  `right`; podium: winner `right`. `locked` never reveals correctness.

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
  "screen":{"kind":"lobby","joined":12,"botPicker":{"lockedColors":["#6CF0B0","#FF5FA2"],"taken":[{"color":"#6CF0B0","head":"box"}]}} }
// admin:command
{ "stepId": 12, "action": { "type": "markWrong" } }
```

### 8.9 ⚠️ The current real backend does not match this contract yet
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

**Options (the team decides; recommended first):**
1. **Recommended:** the real server *is* `mock-server/` (already complete and tested against this
   contract): deploy it to Render as-is, and add the teammate's Postgres persistence (`db.js`:
   save room state, scores, answer log) behind `quiz.ts` without changing the contract.
2. Teammate rewrites `backend/` to Socket.IO implementing §8 exactly, using `mock-server/` as the
   reference, and proves it by pointing `npm run smoke` at it.
3. Not recommended this close to the event: change the frontend to the raw-ws protocol.
Whichever is chosen: record it in §1.3 and §4.

### 8.10 Contract changelog
| Date | Change | Screens must |
|---|---|---|
| 11 Oct 2026 | v2 contract (Phase 1) | n/a |
| 11 Oct 2026 (night) | `ParticipantTag.head`; `PARTICIPANT_COLORS` = 12 bot colours; `BOT_HEADS`, `BotMood`, `BotLook`, `BotPicker`, `CastMember`; `HostView.cast`; lobby `botPicker`; `participant:bot` + `BotResult`; `Round1Question.options`; phones get the Host's order; `result.correctText` | draw bots everywhere a person appears; use `cast[i].mood`; number options 1–4 |

---

## 9. Glossary
| Term | Meaning |
|---|---|
| Host | the projector screen (`/host`), no controls |
| Participant / phone | a player's phone (`/play`) |
| Admin / quizmaster | the person running the quiz (`/admin`, PIN) |
| Finalist | one of the top 6 after Round 1 |
| Audience | everyone not in the final; backs a finalist |
| The cut | end of Round 1: the ranked list with a line under 6th |
| Bot | a participant's robot avatar (colour + head) |
| Mood | what a bot's eyes are doing (`BotMood`) |
| Step / stepId | the current position in the flow; changes every step |
| Void | cancel a question: nobody gains or loses points |
| Preset | `demo` (3 questions, top 3) or `event` (all questions, top 6) |

---

## 10. Keeping this file true
- Update this file **in the same commit** as any change to rules, contract, stack, structure,
  design or status. Bump "Last updated".
- Contract changes: also §8 tables and §8.10 changelog. New decisions: §1.3. Progress: §4.
- If this file and the code disagree, the code and `docs/SPEC.md` win; fix this file.
