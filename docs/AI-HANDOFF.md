# Hermes Quiz — complete AI handoff

> **For the AI model reading this:** this one file is meant to let you work on the project with no
> other context. Read it top to bottom before touching anything. It reflects the code as of
> **15 Oct 2026** (branch `main` = `quiz-prep`, repo `csikjsce/jackbox_2.0`). Where this file and the
> code disagree, the code wins; where this file and `docs/SPEC.md` (the game rules) disagree, SPEC
> wins. Other docs worth opening once you've read this: `docs/SPEC.md` (rules, v3.2),
> `docs/PROJECT-RULES.md` (the long-running handoff log, decisions and contract changelog),
> `docs/RUN-SHEET.md` (the quizmaster's script for the night), `docs/DEPLOY.md`, `CLAUDE.md`.

---

## 1. What this is, in one minute

**Hermes Quiz** is a live, Jackbox-style multiple-choice quiz game for **60–100 people in one hall**,
run by the CSI student chapter at **KJSCE** (Mumbai) after a workshop on the **Hermes AI agent**. The
event is **Thursday 16 Oct 2026**. Owner: **Sukrit Srivastava** (frontend, and most of the code). A
teammate (GitHub `Leleouch14`, "Lelouch_14") worked on an early backend prototype and on questions.

Three screens, always called by these names:

| Name | Route | Who | What |
|---|---|---|---|
| **Host** | `/host` | everyone, on the **projector** | shows the quiz; has **no game controls** |
| **Participant** | `/play` | each player, on their **phone** | join, build a bot, answer, back a finalist |
| **Admin** | `/admin` | the **quizmaster** (PIN) | drives every step, fixes mistakes, quiz library |

The game: **lobby → Round 1** (everyone, speed-scored MCQ) → **the cut** (top 9 safe) → **wild card
round** (everyone else; most right answers wins the 10th seat) → **predictions** (audience backs a
finalist, optional) → **Blackout** (the 10 finalists race a "darkness" on a track; last one running
wins; runs on autopilot) → **podium**. Every answer is a tap on a phone, marked by the server. Nothing
is judged by hand.

Look: **"Server Corridor, Lights Low"** — a dark server-room corridor, mint and amber, robot avatars
("bots"), typewriter + terminal fonts, **no glow**. The approved reference is `public/finaldesign.html`.

---

## 2. Status right now (15 Oct 2026)

**Done and tested** (all on GitHub `main`):
- The whole three-round game, server and all three screens, with sound, event-proofing (reconnects,
  server-restart detection, wake lock), the quiz library in Admin, imports/exports.
- **Multi-correct questions** in Round 1 (SPEC v3.2): 2–4 right answers, tick then LOCK IN, partial credit.
- **The night's questions**: `final_quiz.json` in the repo root, loaded and validated on every server
  start, shown in Admin as **"Hermes final quiz"** (Round 1 20 + 2 spares, wild card 5 + 3 spares,
  Blackout 18). **Never change their wording, answers or correct letters.**
- **Round 1 spares**: a skipped (voided) question gives its number back and a spare takes its place.
- **Crash safety**: an uncaught error after start is logged, not fatal.
- **In-game settings from environment variables** (read/answer times, counts), with Admin's per-quiz
  Settings still overriding them.
- Load tests: 2 × 100 bots and 1 × 150 bots through a whole game — every check passed (see §14).

**Not done / blocked:**
- **The live site is still the 13 Oct version** (old buzzer-round game, no Blackout). Redeploy is
  **blocked**: the Render service is still linked to the old repo `Leleouch14/jackbox_2.0`; the repo
  moved to the `csikjsce` GitHub organisation, and **Render's GitHub app has no access to `csikjsce`**
  (Render API answers "repository URL is invalid or unfetchable"). A `csikjsce` **org admin** must grant
  Render access to `jackbox_2.0` (GitHub → org Settings → GitHub Apps → Render → Configure → Repository
  access). Then: point the Render service at `csikjsce/jackbox_2.0` branch `main`, make sure `ADMIN_PIN`
  is set on Render (not `1234`), and run `npm run deploy` from `main`. Do **not** deploy only the
  website: the new website can't talk to the old game server.
- **Fallback for the night**: run everything on a laptop on the hall Wi-Fi (§15.4).
- Some older browser-test scripts (`admin-run`, `drills`, `rehearsal`) answer Round 1 by tapping one
  option; the Demo quiz's question 2 is now multi-correct, so they will probably fail there until taught
  to tick + LOCK IN (`play-shots` and `multi-shots` already handle it).

---

## 3. Hard rules (never break these)

1. **The server is the source of truth.** Screens send actions and draw the view they receive. They
   never compute scores, timers, ranks, moods or game state.
2. **Contract first.** Every event and view type lives in `src/shared/protocol.ts`. Change it there
   first, then the server (`server/`), then follow the TypeScript errors into the screens, then tests,
   then docs (`docs/PROJECT-RULES.md` §8 + its changelog).
3. **No answer leaks.** Phones and the Host never receive which option is right before the reveal (only
   Admin does). Question and option ids are opaque random strings, new for every question run. The
   phone tally field is named `right`, never `correct`, so the leak scans (`"correct` must not appear in
   a phone view before the reveal) stay strict. `simulate` and `smoke` enforce this.
4. **One shuffle per question.** Options are shuffled once per question run and shown in that same
   order, numbered 1–4, on the Host (from the answer step) and every phone. (A per-phone shuffle was
   requested on 15 Oct and **declined**: the projector's numbered answers would stop matching phones.)
5. **Answer times are measured on the server**, never trusted from a phone.
6. **Every Admin command carries `stepId`**; the server ignores a command from a stale step (except the
   step-independent ones in `STEP_INDEPENDENT_ACTIONS`: resume, removeParticipant, setRoomCodeVisible,
   setSound, endQuiz). This makes double taps and two Admin devices safe.
7. **`server/quiz.ts` has all the rules and no socket/IO code.** After changing rules run
   `npm run simulate` and `npm run smoke`.
8. **The approved design is final.** Match `public/finaldesign.html`; don't redesign. Ask Sukrit before
   changing the approved design. **No glow** (§11). `npm run check-glow` enforces it.
9. **Before claiming done:** `npm run typecheck`, `npm run build`, `npm run simulate`, `npm run smoke`,
   `npm run check-glow` must all pass.
10. **Windows / PowerShell.** The owner uses Windows PowerShell 5.1. No bash-only commands in scripts,
    `package.json` or docs. (PowerShell 5.1 gotchas: no `&&`; native-command stderr shows as red
    "errors" even on success; quotes inside `-m "..."` for git break — use `git commit -F file`.)
11. **Secrets** live in `.env.local` (git-ignored). Never commit them, never print them. The repo has
    been public in the past: never put the Admin PIN in the repo.
12. **Never change `final_quiz.json`'s questions** (wording, options, correct letters).
13. Git: `main` = what's deployed. Feature work on a branch, merge to `main` when all checks pass.
    Sukrit allowed commits, pushes and merges without asking (12 Oct); ask before design changes.
    End commit messages with the attribution line your environment asks for.

---

## 4. The game rules in full

Full text: `docs/SPEC.md` v3.2. Defaults below are the **event** preset; every one can be changed by
environment variables (§13) and per quiz in Admin → Settings.

### 4.1 Lobby
- Host shows the room code (4 consonants, alphabet `BCDFGHJKLMNPQRSTVWXZ`, can't spell words), a QR
  code, the join link, and a wall of every bot + name.
- Join with room code + real name (max 20 chars). An exact duplicate name (any case) is rejected ("add
  your surname initial"). Typing the same name again **rejoins** that seat if its phone is disconnected.
- **Build your bot**: 12 quick-pick colours or any colour from a wheel, 8 heads
  (`box round antenna bolts horns ears dome visor`). Bots may be shared (same colour + head); names must
  be unique. Very dark colours are brightened (lightness clamped to 45–92 %). Bots lock at **Start quiz**.
- Min 2 players to start, max 200 per room.

### 4.2 Round 1 (everyone)
Per question the quizmaster clicks: **Show question** → *read* 8 s (question on Host, "Eyes up" on
phones, no options yet) → *answer* 8 s (options on phones and Host; ends early when everyone connected
who can answer has answered) → *time's up* (holds) → **Reveal answer** → optional **Show results** (bar
chart of picks) → optional **Show leaderboard** (top 10) → **Next question** … → **End round 1**.
- **Scoring:** correct = `round(200 − 100 × elapsed / limit)`, elapsed clamped to [0, limit] (instant
  200, last moment 100, 4 s of 8 s = 150). Wrong or none = 0. Constants `R1_MAX_POINTS = 200`,
  `R1_MIN_POINTS = 100` in `server/config.ts` (`round1Points`). Points are applied at **time's up**.
- **Ties:** lower total answer time ranks higher (a miss counts as the full answer time), then who joined first.
- **Late joiners** play from the next question whose answers haven't opened (joining during a read step
  = they play that one); earlier questions count as missed for the tie-break.
- **Spares:** Round 1 plays `round1Questions` (20); questions after that in the list are spares, used
  only when a question is **voided** (the next question takes the voided one's number).
- **Phones** never show points or rank during Round 1, only CORRECT / WRONG / TOO SLOW (and PARTLY
  RIGHT for multi-correct). The cut is the only time a phone shows its rank.

### 4.3 Multi-correct questions (Round 1 only, SPEC v3.2)
- A question with 2–4 right options. Exactly 1 = normal question. Refused in wild card / Blackout lists
  (editor, imports, server checks, question file, `pickRound`).
- Players are told "Select ALL that apply" (phone) / "SELECT ALL THAT APPLY" (Host) — **never how many
  are right**.
- A tap ticks/unticks (draft, kept on the server: survives refresh). **LOCK IN** (full-width button
  pinned at the bottom, disabled until something is ticked, disabled while paused) submits. First lock-in
  counts. If time runs out without LOCK IN, the server **sends the ticks at the full time**
  ("Time's up. We sent your picks: 1, 3"). Nothing ticked = a miss.
- Early end waits for **lock-ins** (drafts don't count).
- Default answer time **15 s** (`MULTI_ANSWER_MS`), a quiz setting (`multiAnswerSeconds`); a question's
  own time wins.
- **Points:** `S` = the normal speed score at the lock-in; `points = max(0, round(S × (found/total − 0.25 × wrong)))`
  (`multiPoints`, `MULTI_WRONG_PENALTY = 0.25`). Examples: 4 right all ticked instantly 200; 2 of 4
  found 100; 2 right, 1 found + 1 wrong 50; all 4 ticked when 2 are right = 50 % of S; floors at 0.
- Outcome: correct (all right, no wrong) / partial (points > 0) / wrong (0, answered) / missed.
- Bot mood: `right` if points ≥ ½ S, else `wrong`.
- Contract: `participant:select { questionId, optionIds }` (drafts), `participant:answer
  { questionId, optionIds }` (lock); single questions keep `{ questionId, optionId }`.

### 4.4 The cut
Ranked by Round 1 score then lower total time. **Ranks 1–9 are safe (finalists)**; everyone else plays
the wild card round. Fewer than 10 played → everyone is a finalist, no wild card round. Anyone joining
after the cut is **audience**.

### 4.5 Wild card round
- Only wild card players answer (safe finalists watch). 8 s + 8 s like Round 1. **5 planned questions**,
  spares for voids and **sudden death**.
- Winner: most correct; tie → lower total time (wrong/miss = the full time); **exact** tie → up to 3
  sudden-death questions (wrong or none = out, unless everyone left is wrong — then all stay); still tied
  after 3 / out of questions → lowest time, then better Round 1 rank. **Nobody right at all** → the
  best Round 1 rank outside the safe seats takes the seat ("fallback").
- **Reveal wild card** makes the winner the 10th finalist; the rest become audience.

### 4.6 Predictions (optional)
Audience members back one finalist (can change until Start Blackout). Calling the winner is shown at
the end ("You called it!").

### 4.7 Blackout (the chase) — runs on AUTOPILOT
- The quizmaster clicks **Start Blackout** once; every step after that is a server timer until the
  podium. Admin's big button becomes **Pause / Resume**; Skip, +5 s (answer step only), Void, Restart
  question, Restart round, End quiz now, Remove still work.
- Track: each finalist starts `baseGap` steps ahead of the dark plus a head start (Round 1 ranks 1–3:
  +2; ranks 4–9: +1; the wild card: 0). Event `baseGap = 6`.
- Per question: *intro* 6 s (first time) → *read* 5 s (no options) → *answer* **10 s** (options on
  runners' phones; ends early when every runner still running has answered) → *time's up* 1.5 s →
  *reveal* (runners move): **right +3 / +2 / +1** by which third of the answer time it arrived in;
  **wrong −1** (not below 0); none 0; hold 3 s + 0.15 s per runner → *the dark moves* by
  `darkness[q]` steps (event `[1, 2, 2, 3]`, last value repeats); anyone at or behind it is **caught**;
  hold 2.5 s + 0.25 s per step + 1.5 s if anyone was caught → next question.
- Ends when one (or no) runner is left, or questions run out (furthest ahead wins). Winner moment 7 s,
  then the podium by itself.
- Places: still running by position (then lower total time, then Round 1 rank); caught ones by catch
  order (caught later = better; same question → further ahead before the dark moved, lower time, rank).
- Tuning came from `npm run tune-blackout` (20,000 simulated chases): first catch ~Q3–4, decided ~Q10.
  Demo preset: `baseGap 2`, `darkness [1, 2]`.
- Host shows it as a **left-to-right track** under the always-visible question and options: one lane
  per finalist, the dark as a black wall from the left with an alarm-red edge, runners heading to an EXIT.
  Runner phones show only the question + options while answering, otherwise "Eyes on the screen" /
  "YOU'RE OUT".

### 4.8 Podium, results
Final order (Blackout places; or Round 1 / wild card order if ended early with End quiz now). Admin
downloads a **Results CSV** (place, name, result, Round 1 score/rank, wild card correct/time, Blackout
place/position, backed, called it, left-page count).

### 4.9 Fixing mistakes (Admin)
- **Void question**: it doesn't count (Round 1: points taken back, the next question takes its number;
  wild card: next unused question takes its number; Blackout: nobody moves, the dark stays).
- **Restart question**: undo its effects and replay from its read step with fresh ids (and no ticks).
- **Restart round**, **End quiz now**, **Remove participant** (a finalist removed before the first
  Blackout question is replaced by the next best).
- **Pause / Resume** freeze every clock; **+5 s**; **Skip timer**.

---

## 5. Architecture

```
Phones (/play) ─┐
Projector (/host)├─ Socket.IO ──►  Game server (server/, Node, tsx)  ──► Postgres (Supabase), optional
Admin (/admin) ──┘                   one QuizRoom per room, in memory        results + quiz library
        ▲
        └── Next.js website (static pages, Vercel)
```

- **Website** (Next.js App Router, static): three pages, each a client app talking Socket.IO to the
  game server. It finds the server via `NEXT_PUBLIC_SOCKET_URL`, else the same host on port 3001.
- **Game server** (`server/`): HTTP (`/health`, `/api/images` upload, `/images/<id>`) + Socket.IO.
  Rooms live **in memory** (a restart loses running games; every screen then shows "The quiz server
  restarted…", detected via `server:hello { bootId }`).
- **Views, not events:** the server builds three views — `HostView`, a private `ParticipantView` per
  phone, `AdminView` (with the answers) — and pushes each socket its view **only when it changed**
  (JSON compare, `serverNow` excluded). Phones get updates immediately; Host/Admin views at most every
  150 ms between step changes (a step change goes out at once).
- **Clock sync:** every view carries `serverNow`; screens compute `clockOffset = serverNow − Date.now()`
  and count down to `timer.endsAt`. Paused timers carry `remainingMs`.
- **Rooms** are opened by Admin from a library quiz (`admin:openRoom` takes a **frozen copy**); the Host
  signs in with the same PIN and shows the newest open room. A room with no Host and no Admin for 30
  minutes is closed.
- **PIN**: 5 wrong tries per connection, then that connection is refused.

---

## 6. Tech stack

| Part | What | Version (package.json) |
|---|---|---|
| Website | Next.js App Router, React, TypeScript | next ^16.4, react ^19.2, typescript ^5.9 |
| Styling | Tailwind CSS 4 (`@tailwindcss/postcss`) + hand-written classes in `src/app/globals.css` | tailwindcss ^4.1 |
| Realtime | Socket.IO server + client | ^4.8.1 |
| State (screens) | Zustand | ^5.0.8 |
| Animation | `motion` (`motion/react`), `@number-flow/react` (numbers), `canvas-confetti` | motion ^12.38 |
| Other UI | `qrcode.react` (join QR), `read-excel-file` (imports) | |
| Server runtime | Node + `tsx` (TypeScript directly, also used in production) | tsx ^4.23; Node 22+ (Render uses 24) |
| Database | `pg` (Postgres / Supabase); `pg-mem` for tests | pg ^8.23 |
| Tests / browser automation | custom `assert` suites, Playwright (Chromium) | playwright ^1.64 |
| Dev | `concurrently` (web + game together) | |

Fonts: **Special Elite** (typewriter, words) and **VT323** (terminal, numbers), loaded in
`src/app/layout.tsx`; Archivo only for dense Admin tables.

---

## 7. File map (every file that matters)

```
final_quiz.json          THE NIGHT'S QUESTIONS (see §12). Never edit the questions.
.env.example             every environment variable, explained (website / game server / local)
render.yaml              Render blueprint for the game server
next.config.ts, tsconfig.json, postcss.config.mjs, .vercelignore (.env.local kept out of uploads)
AGENTS.md, CLAUDE.md     short rules for AI agents (CLAUDE.md is the most up-to-date short version)
README.md                overview, commands, writing questions, deployment

data/questions.json      old-format questions; only seeds the "Demo quiz" (3 single + 2 multi-correct)
public/finaldesign.html  THE APPROVED DESIGN (all screens, animations). Open at localhost:3000/finaldesign.html
public/questions/        demo question images

docs/SPEC.md             the game rules (v3.2) — authoritative
docs/PROJECT-RULES.md    long handoff: constraints, decisions log (§1.3), architecture, to-do, API (§8), changelog
docs/RUN-SHEET.md        quizmaster's script and emergency moves for the night
docs/DEPLOY.md           Vercel + Render + Supabase setup, env table
docs/LOAD-TEST-RESULTS.md, docs/SERVER-NOTES.md (for the backend teammate), docs/BUILD-PHASES.md (old plan)
docs/AI-HANDOFF.md       this file

src/shared/protocol.ts   THE CONTRACT: phases, views, events, admin actions, limits, messages
src/shared/quiz.ts       quiz library logic shared by Admin and server: checks (questionProblems,
                         quizProblems, rulesProblems), cleanQuiz/cleanQuestion, correctList/isMultiCorrect/
                         packCorrect, imports (importText, importRows/parseCsv, importJson), exports (quizToCsv, TEMPLATE_CSV)

server/index.ts          entry point: env files, preset + env settings, PIN guard, final_quiz.json, start, startup log
server/env.ts            loadEnvFiles(): .env.local then .env (real environment wins)
server/config.ts         presets (event/demo), round1Points, multiPoints, MULTI_* constants, GAME_ENV +
                         applyGameEnv/loadConfig (settings from env), darknessStep, withTimingScale (tests)
server/quiz.ts           QuizRoom: ALL the rules (~2,600 lines), no IO. Views built on demand, cached until the next change
server/rooms.ts          RoomManager: sockets ↔ rooms, PIN, open/close rooms, sending views (diff + throttle), DB saves
server/server.ts         startGameServer(): HTTP (/health, images), Socket.IO handlers, payload validation
server/library.ts        quiz stores (PostgresLibrary / FileLibrary data/library/ / MemoryLibrary), defaultRules,
                         quizToGame (quiz → frozen game config + questions), ensureDemoQuiz
server/finalQuiz.ts      loadFinalQuiz(): reads + validates final_quiz.json, builds "Hermes final quiz"
server/questions.ts      data/questions.json loader (QuizQuestion) + pickRound (which questions each round takes)
server/db.ts             optional Postgres results (rooms, players, game_history) — never blocks the game
server/network.ts        LAN address for the join link
server/simulate.ts       the main test suite (53 checks, fake clock, 100s of simulated games)

src/app/{host,play,admin}/page.tsx, layout.tsx, page.tsx (landing), globals.css (design tokens + classes)
src/components/host/     HostApp (gate → screen, scrims, stage switch, sound, cursor hide), HostGate (PIN),
                         parts (Cast wall, Clock, Panel, Heading, useMoods), sound.ts (Web Audio),
                         useJoinUrl, stages/: LobbyStage, Round1Stages (intro, QuestionStage for every
                         round's questions, Results, Leaderboard, TypeOut), CutStage, WildCardStages,
                         BlackoutScene (one persistent 1920×1080 scene, CSS keyframe beats), PodiumStage
src/components/play/     PlayApp (connect, wake lock, header, Reconnecting/Paused bands, transitions, confetti),
                         JoinScreen, LobbyScreen (BotBuilder + LOCK IN), Round1Screens (answer screens single +
                         multi, results, podium, every simple screen), FinalScreens (wild card, backing,
                         Blackout runner/audience screens), parts (PhoneHeader, Moment, Gap, Banner)
src/components/admin/    AdminApp (layout: phone tabs Game/Controls/People; 2 columns ≥1024 px), SignIn, TopBar,
                         Dock (hint + "or:" chips + big button + autopilot strip + toast), GamePanels
                         (QuestionCard, NextUp, Counts, CutPanel, WildCardPanel, PredictionsPanel,
                         BlackoutPanel, Podium, Finalists), Controls, ParticipantsPanel, parts
                         (Panel, ControlButton, useConfirm two-tap), useShortcuts (Space, P, S)
src/components/admin/library/  AdminHome (quizzes + open rooms), QuizEditor (three lists + Settings, autosave),
                         QuestionForm (one question; checkboxes in Round 1), RulesForm (Settings), ImportPanel
src/components/ui/       Bot (+ botDelay), BotBuilder, Corridor (Host background), TimerRing (Host clock)
src/stores/              adminStore (send(action, stepId) with 600 ms double-tap guard, library calls),
                         hostStore, participantStore (auto-rejoin from sessionStorage, optimistic tap)
src/lib/                 socket.ts (getSocket, server URL, bootId), session.ts, useCountdown, useWakeLock,
                         usePageVisibility, format (vibrate, ordinal), confetti, image (shrink + download),
                         adminLabels (button labels, destructive actions, error texts)

scripts/                 every test / tool (see §14) + deploy.ts
archive/ws-backend-v1/   the first prototype backend (raw ws, port 8080) — reference only, unused
```

---

## 8. The contract (`src/shared/protocol.ts`) — summary

**Phases** (in order): `lobby`, `r1Intro`, `r1Read`, `r1Answer`, `r1TimesUp`, `r1Reveal`, `r1Results`,
`r1Leaderboard`, `cut`, `wcIntro`, `wcRead`, `wcAnswer`, `wcTimesUp`, `wcReveal`, `wcStandings`,
`wcWinner`, `predictions`, `boIntro`, `boRead`, `boAnswer`, `boTimesUp`, `boReveal`, `boDark`,
`boWinner`, `podium`.

**Client → server events:**
| Event | Payload | Ack |
|---|---|---|
| `host:auth` | `{ pin, roomCode? }` | `{ok, roomCode}` / `wrong-pin` / `no-room` |
| `admin:login` | `{ pin }` | ok / wrong-pin |
| `admin:rooms` | — | `OpenRoomSummary[]` or null |
| `admin:openRoom` | `{ quizId }` | `{ok, roomCode}` / not-signed-in / not-found / not-ready (+problems) |
| `admin:closeRoom` | `{ roomCode }` | `{ok}` |
| `library:list/get/create/duplicate/save/delete` | quiz CRUD | `QuizSummary[]` / `Quiz` / `SaveQuizResult` |
| `admin:auth` | `{ roomCode, pin }` | join a room as Admin |
| `admin:command` | `{ stepId, action: AdminAction }` | `CommandResult` (`stale-step`, `not-allowed`, `not-signed-in`, `invalid`) |
| `admin:results` | — | `{ csv, filename }` |
| `participant:join` | `{ roomCode, name, participantId? }` | `JoinResult` (errors: room-not-found, name-taken, name-invalid, quiz-ended, removed, room-full) |
| `participant:bot` | `{ color, head }` | lobby only |
| `participant:answer` | `{ questionId, optionId }` or `{ questionId, optionIds }` (multi LOCK IN) | — |
| `participant:select` | `{ questionId, optionIds }` (multi drafts) | — |
| `participant:back` | `{ finalistId }` | — |
| `participant:visibility` | `{ hidden }` | — (Admin-only "left page" flag) |

HTTP: `POST /api/images` (body = JPEG/PNG/WebP ≤ 2.5 MB, header `x-admin-pin`) → `{ url: "/images/<id>" }`.

**Server → client:** `host:state` (HostView), `participant:state` (ParticipantView), `admin:state`
(AdminView), `room:closed { reason }`, `server:hello { bootId }`.

**AdminAction types:** startQuiz, showQuestion, revealAnswer, showResults, showLeaderboard,
nextQuestion, endRound1, startWildCard, showStandings, revealWildCard, openPredictions, startBlackout,
(advanceDarkness, showWinner — never allowed since autopilot), pause, resume, addTime, skipTimer,
voidQuestion, restartQuestion, restartRound, removeParticipant {participantId}, setRoomCodeVisible
{visible}, setSound {on}, endQuiz.

**Views (key fields):**
- `HostView`: roomCode, joinUrl, roomCodeVisible, soundOn, `settings: QuizSettings`, participants,
  **`cast`** (every bot with its `mood`: idle/thinking/locked/right/wrong/out — screens never work moods
  out), counts, timer, paused, serverNow, nextImage, **`stage`** (keyed by phase; question steps carry
  `question: McqQuestion` with `options` from the answer step, `multi`; reveals add
  `correctText/correctIndex/correctIndexes/voided`; cut standings; `wildCard: WildCardState`;
  `blackout: BlackoutState` with runners (position, from, delta after reveal, gap, alive, place,
  headStart), dark, darkFrom, caughtThisQuestion; podium entries).
- `ParticipantView`: roomCode, me (+ status playing/finalist/wildcard/audience/removed), timer, paused,
  serverNow, **`screen`** keyed by kind: lobby, r1Intro, nextQuestion, eyesUp, answer (options; `multi
  {selectedIds, locked}`; Blackout `text` + `chosenId`), lockedIn (`choiceNumber`, `choiceNumbers`,
  `sentAtTimeUp`), timesUp, result (`outcome` correct/partial/wrong/missed, `correctText` after reveal,
  wild card `tally`, `multi` breakdown + mood), voided, cut (rank), safeWatch, wcStatus, wcWinner,
  audience, backFinalist, runnerStatus (alive, gap, place, nextUp), blackoutWatch, podium, removed.
- `AdminView`: phase, **stepId**, stepLabel, **primary** (the big button: action + label), optional
  ("or:" chips), hint, **allowed**, timer, paused, question (**with the answer**, `correctNumbers`,
  `multi`, per-option counts after reveal), nextQuestion (preview with answers), counts (+ answered /
  expected / ticking), participants (score, rank, wild card, blackout, connected, pageHidden,
  leftPageCount, backing), finalists, wildCard (full standings), blackout, cut, autopilot (step, nextInMs,
  nextLabel), darkPreview (who the dark would catch — Admin only), backing, podium, quizTitle.
- Library: `Quiz { id, title, rules: QuizRules, round1[], wildcard[], blackout[], updatedAt }`,
  `LibraryQuestion { id, text, options[4], correct: number | number[], image, readSeconds, openSeconds }`,
  `QuizRules { round1Questions, round1ReadSeconds, round1AnswerSeconds, multiAnswerSeconds, safe,
  wildCardQuestions, blackoutReadSeconds, blackoutAnswerSeconds }`.
- Limits (`QUIZ_LIMITS`): title 80, question 300, option 140 chars, 200 questions/list, image 2.5 MB,
  safe 2–20, read 1–60 s, answer 3–120 s. `ADD_TIME_MS = 5000`. `NAME_MAX_LENGTH = 20`.

---

## 9. Server internals

### 9.1 `server/quiz.ts` (QuizRoom)
- Constructor: picks each round's questions once (`pickRound`: tagged for the round, then untagged
  unused; only the demo preset reuses). Round 1 takes its spares too (`r1Planned` = planned count,
  `r1Number` = planned questions started; a void gives the number back). Wild card takes planned +
  sudden-death max. Blackout takes everything it can.
- **`Run`** = one question being played (any round): opaque `id`, `optionIds`, `hostOrder` (the one
  shuffle), `players`, `correct: Set<number>`, `multi`, `answers` (first answer/lock-in: optionIndex,
  elapsedMs, picks, auto), `drafts` (multi ticks), `limitMs` (incl. +5 s), `applied` (Round 1 points per
  person, for void), `scored`, `voided`, `before` (wild card / Blackout snapshot, restored by void/restart).
- Flow methods: `command()` (stale-step check, `allowedActions()`), `nextQuestion`, `beginQuestion`,
  `openAnswers`, `timesUp` (sends multi drafts, scores Round 1), `reveal` (wild card tally / Blackout
  moves), `cut`, `startWildCard`, `scoreWildCard`, `decideWildCard`, `revealWildCard`, `startBlackout`,
  `nextBlackoutQuestion`, `moveRunners`, `advanceDarkness`, `afterDark`, `winnerMoment`, `finish`,
  `voidQuestion`, `restartQuestion`, `restartRound`, `remove`, `endQuizNow`.
- Timers: `go(phase, ms?, onEnd?)` — every step change bumps `stepId` and clears pause;
  `pause/resume/addTime/endTimerNow`. `endAnswerIfEveryoneAnswered` (connected players who can answer).
- Moods: `botMood(p)`. Views: `hostView()`, `participantView(id)`, `adminView()`, `resultsCsv()`,
  `snapshot()` (for db.ts). Derived data cached in `this.cache` until `changed()`.
- `primaryAndHint()` decides Admin's big button, the "or:" chips and the hint line for every phase.

### 9.2 `server/rooms.ts` (RoomManager)
Map of rooms; per room: host/admin/participant sockets, `lastSent` (per-socket JSON for diffing),
screen throttle, DB save timer (2 s). `openRoom` uses `quizToGame` (+ `withTimingScale` in tests).
`join` handles rejoin; `detach` on disconnect marks the participant disconnected. `sweep` closes
abandoned rooms. `closeAll` on shutdown.

### 9.3 `server/server.ts`
`startGameServer(options)`: library (default memory), `ensureDemoQuiz`, **`loadFinalQuiz`** if
`finalQuizFile` (throws → server doesn't start), HTTP routes, CORS (`CORS_ORIGIN`), Socket.IO with
`maxHttpBufferSize` 1 MB, ping 10 s / timeout 15 s. Every payload is sanitised (`str()`, `optionIdList()`,
`parseAction()`) before it reaches a room. Library calls need `admin:login` on that socket.

### 9.4 `server/library.ts`
`defaultRules(config)` = a new quiz's rules from the preset + env. `quizToGame(quiz, base)` = the frozen
game config (the quiz's rules over the preset; Blackout tuning and autopilot holds always from the
preset; the wild card uses Round 1's timings) and the questions tagged 1/2/3. `ensureDemoQuiz` builds
the "Demo quiz" from `data/questions.json` (rebuilt when outdated or the preset changes; its default
times refresh on every start). Stores: `PostgresLibrary` (tables `quizzes` jsonb, `quiz_images` base64)
when `DATABASE_URL` is set, else `FileLibrary` (`data/library/`, git-ignored), `MemoryLibrary` for tests.

### 9.5 `server/finalQuiz.ts`
`loadFinalQuiz(file, rules, minBlackout)`: checks ids unique, round ∈ {"1","wild card","blackout"},
`spare` boolean, text ≤ 300, options exactly A–D, non-empty, ≤ 140, all different, `correct` = 1–4
distinct letters (2+ only in Round 1), image path exists or null, read/answer seconds null or in range,
the `counts` block matches, then `quizProblems` (incl. Blackout minimum). Throws **one** error listing
every problem. Builds quiz id `final`, title "Hermes final quiz", spares at the bottom,
`round1Questions`/`wildCardQuestions` = non-spare counts, times from `rules` (preset + env). Saved to
the library on every start (so edit the file, not that quiz in Admin; changes to its Settings in Admin
last until the next server start).

### 9.6 `server/config.ts`
Presets: **event** (20 Round 1, 9 safe, 5 wild card + 3 sudden death, 8 s + 8 s, Blackout 5 s + 10 s,
min 12 Blackout questions (warn below 15), baseGap 6, darkness [1,2,2,3], min 2 / max 200 players);
**demo** (3 Round 1, 3 safe, 3 wild card, same timings, min 8 Blackout, baseGap 2, darkness [1,2]).
Holds: intro 6000, timesUp 1500, reveal 3000 + 150/runner, dark 2500 + 250/step + 1500 if caught,
void 3000, winner 7000 ms. `GAME_ENV` + `applyGameEnv` + `loadConfig(name, env)` + `gameEnvInUse`.

### 9.7 `server/db.ts`
Optional. Ports the teammate's schema (`rooms`, `players`, `game_history`), additive columns only.
`rooms.room_code` = code + creation time. Writes are queued; a DB failure is logged and never stops the
quiz. `DATABASE_URL=off` (or unset) disables it.

---

## 10. Frontend internals

- **Host** (`/host`): `HostGate` asks for the PIN; `HostApp` renders the stage for the current phase
  (AnimatePresence keyed by `stageKey` so the read and answer steps are one screen and the question
  glides), the `Corridor` background with a scrim per phase (none in Blackout), the `Cast` of bots
  (≤12 named row; 13+ a wall of 2–3 rows), sound (`sound.ts`, Web Audio, unlocked by one click; plays
  only if `view.soundOn` and not muted locally), cursor hide, mute/full-screen buttons on mouse move,
  next-image preload, waits for fonts (3 s cap). Everything sized in `rem`, scaled by
  `html:has(.host-root)` (the root element needs class `host-root`); at 1920 px, 1 % of width ≈ 1.2 rem.
  `BlackoutScene`: one persistent 1920×1080 stage scaled to the screen; every beat is a CSS keyframe
  (`bo-*` in globals.css, each defined twice `-a/-b` so a new step restarts it without remounting),
  timed inside the server's holds; `[data-paused]` freezes them; a remount uses negative delays from the
  timer so a refreshed Host lands mid-beat.
- **Phone** (`/play`): `PlayApp` connects, keeps the screen awake, reports page visibility, shows the
  header (round name, "Q3 of 20 · 5s", mint timer bar), RECONNECTING / PAUSED bands, screen transitions
  keyed by `screenKey`, confetti (safe at the cut, winning, calling it). Auto-rejoin from sessionStorage
  after a refresh. Answer buttons numbered 1–4 in amber in the Host's order; single = first tap locks
  (optimistic, disabled while paused); multi = ticks + LOCK IN. `viewportFit: cover` + safe-area padding.
  Phone bot moods follow the phone's own screen (only the Host uses `cast`).
- **Admin** (`/admin`): sign in (room code optional, PIN); home = quizzes + open rooms; room view =
  TopBar (step, timer, Live/Reconnecting, room code, PAUSED band), Dock (hint, "or:" chips, the big
  button — main path; disabled "ANSWERING… 5" during timers; in Blackout the AUTOPILOT strip and PAUSE /
  alarm-red RESUME), GamePanels, Controls (pause/+5/skip, void/restart, host screen toggles, end round,
  results CSV, end quiz, leave room), People (search, filters, remove). Shortcuts: Space = big button,
  P = pause, S = skip (Blackout). Destructive buttons need two taps (cancel after 3 s). `adminStore.send`
  adds the stepId, ignores repeats within 600 ms; a Pause refused as stale is resent once.
- **Quiz editor**: three lists (Round 1, Wild card, Blackout) + Settings; autosaves 1.5 s after a change.
  QuestionForm: in Round 1 the answer numbers are checkboxes (2+ ticked = multi-correct, tag
  "Multi-correct: N right"; new questions start unticked); elsewhere single choice. Optional picture
  (shrunk in the browser, uploaded over HTTP) and own timers. Import: pasted text, CSV/Excel, JSON.

---

## 11. Design system ("Server Corridor, Lights Low", approved 11 Oct, no glow since 14 Oct)

- Reference: `public/finaldesign.html` (open at http://localhost:3000/finaldesign.html). Build every
  screen to match it; don't redesign. Anything it doesn't show: extend in the same language.
- **No glow:** no text-shadow halos, no blurred or coloured-spread box-shadows, no drop-shadow/blur
  filters, no radial blooms, no pulsing glows. Allowed: flat fills, 1–2 px solid borders, colour and
  opacity, zero-blur offset shadows (the clock's `4px 4px 0` mint), dark scrims, the vignette.
  `npm run check-glow` (`scripts/no-glow.ts`) fails on any glow in `src/` or `finaldesign.html`.
- **Colours** (tokens in `globals.css`): void `#05080a` (background), rack `#091013`, panel `#0b1114`,
  deep `#132027`, line `#1e3036`, **mint `#6cf0b0`** (the room's light: outlines, LEDs, primary
  actions), mint-soft `#bfe9d6`, ghost `#e7fff4` (text), bright `#f1fff8`, **amber `#ffb627`** (only
  for answer numbers 1–4, counts and distances), alarm `#d6334d`, wrong `#ff4d5e`, clock `#fffbf0`,
  fog `#7d9690`. The old "marigold" palette is gone — never bring it back.
- **Type:** typewriter (Special Elite, `font-type`) for words; terminal digits (VT323, `font-term`) for
  numbers.
- **Classes** to reuse: `host-q`, `host-opts`, `host-opt`, `opt-num`, `host-count`, `host-hint`,
  `host-banner`, `phone-bg`, `phone-opt`, `phone-go`, `phone-result`, `tick-box`, `phone-lock-bar`,
  `clock`, `bot`, `corridor-*`, `bo-*`.
- **Components:** `Bot` (+ `botDelay(id)` so a wall of bots doesn't blink in sync), `BotBuilder`,
  `Corridor`, `TimerRing`.
- **Motion:** `motion/react`, `@number-flow/react` for scores/percentages (live counters are plain
  numbers), `canvas-confetti` via `src/lib/confetti.ts`. Respect reduced motion
  (`MotionConfig reducedMotion="user"`).

---

## 12. Questions

### 12.1 `final_quiz.json` (the night)
```jsonc
{
  "_format": "…explains the format…",
  "counts": { "round1": {"played":20,"spares":2,"total":22}, "wildCard": {"played":5,"spares":3,"total":8},
              "blackout": {"minimum":12,"total":18} },
  "questions": [
    { "id": "r1-01", "round": "1", "spare": false, "text": "What does LLM stand for?", "image": null,
      "options": { "A": "Linear Logic Machine", "B": "Large Language Model", "C": "…", "D": "…" },
      "correct": ["B"], "readSeconds": null, "answerSeconds": null }
  ]
}
```
- `round`: `"1"`, `"wild card"`, `"blackout"`. `correct`: list of letters; 2+ only in Round 1
  (r1-08, r1-15, r1-18 are multi-correct). `spare: true` = backup, at the bottom of its round, played
  only after a skip. `image`: path under `/public` or null (all null now). Null times = the defaults.
- Topic: Hermes Agent (Nous Research, MIT licence, `hermes doctor`, skills in `~/.hermes/skills/`,
  SKILL.md, USER.md 1,375 / MEMORY.md 2,200 char caps, Telegram via @BotFather, Gemini primary / NVIDIA
  NIM fallback for the labs…) plus general tech (LLM, API, GPU, CPU, RAM, tokens, hallucination).
- On every server start it's validated (server refuses to start on any problem) and saved as quiz id
  `final`, "Hermes final quiz".

### 12.2 Other formats
- `data/questions.json` (old format: `round` 1/2/3/null, `options` array of 4, `correct` index or list
  of indexes): only seeds the Demo quiz.
- Admin imports: pasted text (blank line between questions, `*` marks right answers, `Answer: B` or
  `Answer: A, C`, `# Wild card` / `# Blackout` headings), CSV/Excel (header
  `question, A, B, C, D, correct, round, read seconds, answer seconds`; correct `B` or `"A,C"`; round
  `1` / `wild card` / `blackout`), JSON (exported quiz, the questions.json shape, or a plain array).
- Writing guidance for question authors: 4 different answers, ≤ ~40 chars (phone buttons), no "all/none
  of the above" (options are shuffled), never say "pick two", Blackout questions short (5 s to read).

---

## 13. Environment variables and settings

Every variable is explained in `.env.example`. Locally the game server reads `.env.local`, then `.env`
(`server/env.ts`); anything already in the real environment wins (so `$env:DATABASE_URL="off"` works).

| Where | Variable | Notes |
|---|---|---|
| Vercel (website) | `NEXT_PUBLIC_SOCKET_URL` | the Render address. Built into the pages: redeploy after changing. Locally unset (same host :3001). |
| Render (game server) | `GAME_PRESET` | `event` (or `demo`) |
| | `ADMIN_PIN` | required with `event` (1234 refused unless `ALLOW_DEFAULT_PIN=1`, local rehearsal only) |
| | `PUBLIC_WEB_URL` | the Vercel address (join link + QR) |
| | `CORS_ORIGIN` | the Vercel address (comma-separated list allowed) |
| | `NODE_VERSION` | `24` |
| | `DATABASE_URL` | optional; Supabase Session pooler string; `off` = disabled |
| | `PORT` | set by Render (locally `GAME_PORT`, default 3001; `WEB_PORT` 3000 only for printed links) |
| | in-game settings | `ROUND1_READ_SECONDS` (8), `ROUND1_ANSWER_SECONDS` (8), `MULTI_ANSWER_SECONDS` (15), `BLACKOUT_READ_SECONDS` (5), `BLACKOUT_ANSWER_SECONDS` (10), `ROUND1_QUESTIONS` (20), `SAFE_SEATS` (9), `WILDCARD_QUESTIONS` (5), `WILDCARD_SUDDEN_DEATH_MAX` (3), `BLACKOUT_MIN_QUESTIONS` (12), `MIN_PARTICIPANTS` (2), `MAX_PARTICIPANTS` (200) |
| Laptop only | `RENDER_API_KEY`, `RENDER_SERVICE_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | for `npm run deploy` |
| Scripts | `ADMIN_PIN` (test scripts), `GAME_URL` (bots) | |

**Precedence:** preset → environment (`applyGameEnv`, validated; a bad value stops the server and names
it; the startup log prints the settings in use) → each quiz's own Settings in Admin → +5 s during play.
"Hermes final quiz" and the Demo quiz take the default times on every server start; quizzes made in
Admin keep their own. Screens never hard-code a time or count (they read `view.settings`, Admin reads the
server's `blackoutMin`). The local `.env.local` currently sets the five time variables to the default
values (8, 8, 15, 5, 10).

---

## 14. Commands and tests

Run from the project folder in PowerShell. Install once: `npm install` (and `npx playwright install chromium`
for browser scripts).

| Command | What |
|---|---|
| `npm run dev` | website :3000 + game server :3001 (demo preset, watch mode). Use `$env:DATABASE_URL="off"; npm run dev` so tests don't write to Supabase. |
| `npm run dev:event` | same with the event preset |
| `npm run build`, `npm start` | production build; then website + game server (no watch) |
| `npm run preview` | production website + watched game server |
| `npm run start:game` | game server only (Render's start command) |
| **`npm run typecheck`** | `tsc --noEmit` — must pass |
| **`npm run simulate`** | `server/simulate.ts`: 53 checks with a fake clock (every rule, edge case, leak scans, multi-correct worked examples, final_quiz.json validation, spares, env settings, 50 × 100-player games) — must pass |
| **`npm run smoke`** | a whole game over real sockets (own server, sped-up timers), incl. a multi-correct question, reconnects, two Admins — must pass |
| **`npm run check-glow`** | no glow anywhere — must pass |
| `npm run check-questions [-- --preset event]` | checks data/questions.json and local library quizzes |
| `npm run bot-load-test [-- --bots 150 --speed 0.25 --seed 7]` | needs nothing running: own server in a child process, 100 bots, full game, independent score checks, CPU/memory/latency (~11 min real time) |
| `npm run bots -- --room ABCD --count 80 [--accuracy 0.4-0.85] [--slow] [--pin 1234]` | fake phones against a running server |
| `npm run phone-fit` | (with dev) the longest answers at 320/360/375 px |
| `npm run multi-shots` | (with dev) multi-correct end to end from Admin, 6 tabs + 30 bots, screenshots |
| `npm run play-shots`, `host-shots`, `admin-run`, `blackout-shots`, `drills`, `rehearsal`, `washout` | Playwright tours/drills with screenshots in `screenshots/` (git-ignored); see CLAUDE.md for options |
| `npm run tune-blackout` | simulates 20,000 chases per candidate, prints the best baseGap / darkness |
| `npm run db-check` | a game against in-memory Postgres, checks the saved rows |
| `npm run deploy` | from a clean, pushed `main`: Render deploy, wait for /health, then Vercel |

**Latest results (15 Oct):** simulate 53/53, smoke pass, build pass, check-glow pass. Load tests
(real timings, laptop): 100 bots ×2 and 150 bots — 0 missing deliveries, every score/tally/position
matched the independent calculation (≤ 1–2 points transit), 0 of 624 late answers accepted, 105
reconnects all kept name and score, no errors; server CPU avg ~1 %, peaks 15–55 %; memory 85 MB at
100 bots, 216 MB peak at 150; question delivery p95 2 ms, max 5 ms. phone-fit all pass.

---

## 15. Deployment

### 15.1 Services
| What | Where |
|---|---|
| Website | Vercel, https://hermes-quiz-nine.vercel.app (project `hermes-quiz`, Sukrit's account) |
| Game server | Render, https://hermes-quiz-game.onrender.com (`/health` → ok), service `hermes-quiz-game`, free plan (sleeps when idle; wake it ~10 min before), Singapore |
| Database | Supabase project `etwobyrwvtrhmgolzctq` (Tokyo, Session pooler); tables rooms, players, game_history, quizzes, quiz_images |
| Repo | https://github.com/csikjsce/jackbox_2.0 (moved from `Leleouch14/jackbox_2.0` on 14 Oct) |

### 15.2 Deploy
`npm run deploy` on `main` (committed, pushed, clean tree; move untracked files aside — Vercel uploads the
folder). Neither service redeploys on push by itself.

### 15.3 The current blocker
Render can't fetch `csikjsce/jackbox_2.0` (GitHub app access). See §2. The script in
`scripts/deploy.ts` stops at the first failure, so Vercel isn't deployed either (correct: don't split
them).

### 15.4 Laptop fallback for the night
```powershell
npm install
npm run build
$env:GAME_PRESET="event"; $env:ADMIN_PIN="choose-a-pin"; $env:DATABASE_URL="off"; npm start
```
Admin http://localhost:3000/admin → PIN → **Open room** on "Hermes final quiz"; projector
http://localhost:3000/host (same PIN, F11, click once for sound); phones `http://<laptop Wi-Fi IP>:3000/play`
(printed by the server; also the QR). Same Wi-Fi for everyone; allow Node.js through Windows Firewall.
If the hall Wi-Fi isolates clients, use a phone hotspot. Stop any running `npm run dev` first (ports).
Skip a question / play a spare: Admin → Controls → **Void question** (two taps) → **Next question**.
Results: Admin → Results CSV.

---

## 16. The night (summary; full script in `docs/RUN-SHEET.md`)

45 minutes before: laptop + HDMI (Duplicate display), `/host` full screen, sound check, Admin on the
quizmaster's phone + a backup Admin device, join tests on Wi-Fi and mobile data, remove test players.
Flow: Start quiz → Round 1 (Show question / Reveal / Next) → End round 1 → Start wild card → … → Reveal
wild card → (Open predictions) → Start Blackout (autopilot to the podium) → Results CSV. Emergencies:
Pause (P), Void, Restart question, Remove, refresh any screen (everything rejoins and catches up).

---

## 17. Workflow notes

- Branches: `main` (deployed / deploy target), `quiz-prep` (15 Oct prep, = main), `frontend`,
  `backend` (older). Merge into `main` only with every check green.
- The owner's laptop has two untracked personal note files in the root (`phase2.txt`,
  `multi-correct.txt`) — leave them out of commits.
- `next dev` appends a Next.js block to `AGENTS.md`; that's expected, keep it committed.
- Editing anything under `server/` while `npm run dev` runs restarts the game server (tsx watch) and
  **closes every room** — never do that during a game.
- Screenshots/test output go to `screenshots/` (git-ignored).

---

## 18. Known issues, risks, open decisions

- **Live site outdated / Render access** (§2, §15.3). Fallback: laptop (§15.4).
- **Hall Wi-Fi untested** (client isolation, captive portal). Fallback: hotspot or mobile data (if deployed).
- **Per-phone shuffle declined** (rule 4): owner may revisit; it would need a Host redesign.
- **Memory at 150 players** rose to 216 MB in one run (flat at 100). Fine on a laptop and under Render's
  512 MB; watch it if deployed.
- **Older browser scripts** (`admin-run`, `drills`, `rehearsal`) likely fail at the Demo quiz's
  multi-correct question 2 until updated.
- `npm run check-questions -- --preset event` fails on `data/questions.json` (it only has demo
  questions) — expected; the night uses `final_quiz.json`.
- Teammate pushed two empty commits ("updated questions in json format") on 14 Oct — no files; if they
  meant to upload questions, it never arrived.
- After the event: revoke the Render/Vercel keys in `.env.local`, reset the Supabase password.

---

## 19. Recipes

- **Change a rule:** `protocol.ts` (if the view/contract changes) → `server/quiz.ts` → screens →
  `server/simulate.ts` test → `npm run simulate`, `npm run smoke` → SPEC + PROJECT-RULES changelog.
- **Add a game setting from env:** add it to `GAME_ENV` and `applyGameEnv` in `server/config.ts`; if a
  quiz should be able to change it, add it to `QuizRules` (`protocol.ts`), `rulesProblems`
  (`src/shared/quiz.ts`), `defaultRules` + `quizToGame` (`server/library.ts`), `RulesForm.tsx`; document
  it in `.env.example`, README, DEPLOY, PROJECT-RULES.
- **Change a time on the night:** Admin → the quiz → Settings before opening the room; or the env var +
  restart (before any room is open).
- **Fix a question:** edit `final_quiz.json` only with the owner's explicit approval (wording/answers
  are frozen), restart the server; it re-validates.
- **New phone/Host screen:** add the `ParticipantScreen` kind / `HostStage` phase in `protocol.ts`, build
  it in `quiz.ts`, render it in `PlayApp`/`Round1Screens`/`FinalScreens` or `HostApp`/`stages/`, reuse the
  existing classes and `Moment`/`Panel` parts, keep it glow-free, screenshot it.

---

## 20. Glossary

Host = projector screen. Participant/phone = a player's `/play`. Admin = quizmaster's `/admin`. Room =
one live game (4-letter code). Run = one question being played. Read step / answer step / time's up /
reveal = the phases of a question. The cut = end of Round 1 (top 9 safe). Finalist = safe player or the
wild card winner (10 total). Wild card = the round for the 10th seat. Sudden death = tie-breaker
questions in the wild card round. Audience = joined after the cut or lost the wild card. Backing /
predictions = audience picks a finalist. Blackout = the final chase; runner = finalist in it; the dark =
the darkness that catches runners; gap = steps ahead of the dark; autopilot = Blackout running itself.
Void = cancel a question. Spare = backup question used after a void. Multi-correct = a Round 1
question with 2–4 right answers. Draft = a player's ticks before LOCK IN. Preset = event/demo defaults.
Cast = the bots on the Host with their moods. Mood = idle / thinking / locked / right / wrong / out.
