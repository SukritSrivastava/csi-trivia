# Project notes for Claude

**Read `docs/PROJECT-RULES.md` first: it is the full handoff (constraints, architecture, stack, to-do,
skills, agents, plugins, API). This file is the short version.**

Hermes Quiz: a live MCQ quiz for 60–100 people (event: Thu 16 Oct 2026). Rules: **`docs/SPEC.md` v3.1
(14 Oct night: three rounds; Round 1 scores 200→100; Blackout on autopilot; no glow)**. Build plan: v5,
three phases (pasted in chat 14 Oct; Phase 1 the engine and Phase 2 rules update + Admin + phones are
done; Phase 3 is the Host). `docs/BUILD-PHASES.md` holds the earlier v4 plan (done).
Quizmaster: `docs/RUN-SHEET.md`. Backend teammate: `docs/BACKEND-NOTES.md`.

Screen names, used everywhere: **Host** (`/host`, projector, no game controls), **Participant**
(`/play`, phones), **Admin** (`/admin`, quizmaster, PIN). Flow: lobby → Round 1 (everyone, 8s
read + 8s answer, correct = 200 down to 100 by speed) → the cut (top 9 safe) → wild card round
(everyone else, 5 questions, most right wins the 10th seat) → predictions → **Blackout** (10 runners,
**autopilot**: one Start Blackout click, then 5s read + 10s answer, runners move +3/+2/+1 by speed,
wrong −1, the dark moves and catches, question after question until one is left, then the winner
moment and the podium by themselves) → podium. Every answer is a tap marked by the server.

## Rules of this codebase

- Branches: `main` = the whole app, what's deployed. `frontend` (screens, `src/`) and `backend`
  (`server/`: game rules, sockets, database) branch off `main` and merge back when all checks pass. Sukrit
  (12 Oct) allowed commits, pushes and merges without asking; ask only before changing the approved design.
- The server is the source of truth. Screens send actions and render the view they receive;
  they never compute game state.
- Every event and view type lives in `src/shared/protocol.ts`. Change the contract there first,
  implement it in `server/` (the game server, which is the deployed backend), then follow the
  TypeScript errors. `archive/ws-backend-v1/` is the first prototype backend, kept for reference only.
- `server/quiz.ts` has all the rules and no socket code. After changing rules run
  `npm run simulate` and `npm run smoke`.
- The quizmaster drives Round 1 and the wild card. Timers only for the read and answer steps (8s +
  8s); when one ends, the room holds (an answer step also ends early when everyone who can answer
  has). **Blackout runs on autopilot** (`server/quiz.ts` `nextBlackoutQuestion` → … → `afterDark` →
  `winnerMoment`): every step and hold is a timer (`config.blackout.holds`), so Pause/Skip/+5s work on
  it; Admin's big button is Pause/Resume. `pause` and `skipTimer` carry the stepId like everything else.
- Admin commands carry `stepId`; the server ignores a command from a stale step (except the
  step-independent ones listed in `STEP_INDEPENDENT_ACTIONS`).
- Phones and the Host never receive the correct answer before the reveal (simulate and smoke
  check this, in all three rounds). Options are shuffled once per question; in every round the Host
  (from the answer step) and every phone show the same order, numbered 1–4. Ids are opaque.
- Questions: quizzes in the Admin library have three lists (Round 1, Wild card, Blackout).
  `data/questions.json` (MCQ, 4 options, `correct` = index, `round` 1/2/3/null) only seeds the Demo quiz.
  `server/questions.ts` `pickRound`: tagged for the round, then untagged unused; only the demo preset reuses.
- Look: **"Server Corridor, Lights Low"**, approved and final, **with no glow** (14 Oct: no text-shadow
  halos, blurred box-shadows, drop-shadow/blur, radial blooms; flat fills, 1–2 px borders, colour and
  opacity; zero-blur offsets, scrims and the vignette are fine). `npm run check-glow` enforces it. Match `public/finaldesign.html`
  exactly (open it at http://localhost:3000/finaldesign.html); don't redesign it. Tokens and classes
  are in `src/app/globals.css` (`host-q`, `host-opts`, `opt-num`, `host-count`, `phone-opt`,
  `phone-go`, `clock`, `bot`, `corridor-*`). Components: `Bot` + `botDelay`, `BotBuilder`,
  `Corridor`, `TimerRing` in `src/components/ui/`. The old marigold tokens and classes are gone
  (Phase 5); never bring them back. The Host sizes everything in `rem` (scaled by
  `html:has(.host-root)`, so the Host root element needs the `host-root` class); at 1920 px,
  1% of the screen width is about 1.2rem.
- Bots: `ParticipantTag` has `color` + `head`. The server assigns a free bot on join; phones change
  it in the lobby with `participant:bot`: any colour (12 quick picks + a colour wheel in `BotBuilder`), any head, and bots may be shared (100 people); names stay unique. The server stores `normalizeBotColor(colour)` (dark colours brightened).
  `HostView.cast` gives every bot's `mood` for the current step; screens never work moods out
  themselves. Give each bot `delay={botDelay(id)}` so a wall of them doesn't blink in sync.
- Animation: `motion` (`motion/react`), `@number-flow/react` for numbers, `canvas-confetti` via
  `src/lib/confetti.ts`. Respect reduced motion (`MotionConfig reducedMotion="user"`).
- The user is on Windows (PowerShell). No bash-only commands in scripts or docs.

## What later phases build on

- `AdminView.primary` (the big button: action + label), `.hint`, `.allowed`, `.stepLabel`,
  `.question` (with the answer, numbered 1–4), `.nextQuestion`, `.finalists`, `.wildCard` (full
  standings), `.blackout` (runners, the dark), `.podium` are computed by the server. The Admin UI just renders them.
- v3 engine (14 Oct): `server/quiz.ts` has one `Run` per question (any round); wild card tallies and
  Blackout moves apply at **Reveal answer**; `advanceDarkness` moves the dark and catches; void and
  restart restore a per-question snapshot. Blackout tuning (`baseGap`, `darkness`, head starts) lives
  in `server/config.ts`, from `npm run tune-blackout`. The phone tally field is `right` (not
  `correct`), so the leak scans stay strict.
- Admin UI (phase 2): `src/components/admin/` (`AdminApp` layout: phone tabs Game/Controls/People,
  two columns from 1024 px; `Dock` = hint + primary button; `GamePanels`; `Controls`;
  `ParticipantsPanel`; `parts.tsx` = `Panel`, `ControlButton`, `useConfirm` (two taps, cancels after 3 s);
  `useShortcuts`: Space = big button, P = pause). `GamePanels`: `QuestionCard`, `Counts`,
  `WildCardPanel`, `BlackoutPanel`, `Podium`, `Finalists`. Buttons send the stepId of the view they were drawn from.
- Quiz library (12 Oct): quizzes are made in Admin and saved by the server (`server/library.ts`:
  Supabase tables `quizzes`/`quiz_images`, or `data/library/` without a database). Shared rules,
  imports (text/CSV/Excel rows/JSON) and exports: `src/shared/quiz.ts`. Admin UI:
  `src/components/admin/library/` (`AdminHome`, `QuizEditor`, `QuestionForm`, `RulesForm`, `ImportPanel`).
  Rooms are opened by Admin (`admin:openRoom`, a frozen copy of the quiz); the Host signs in with the
  same PIN (`host:auth`, `HostGate`) and shows the newest open room. Question images are uploaded over
  HTTP to the game server; show them with `assetUrl(path)` from `src/lib/socket.ts`.
  `data/questions.json` only seeds the "Demo quiz" when the library is empty.
- `src/stores/adminStore.ts` `send(action, stepId?)`: adds the stepId, ignores a repeat of the same command
  within 600 ms (and any big/judge button within 600 ms of another one), tracks `pending` and `lastResult`. Labels: `src/lib/adminLabels.ts`
  (`ACTION_LABELS`, `DESTRUCTIVE_ACTIONS`, `COMMAND_ERROR_TEXT`).
- `src/stores/participantStore.ts`: auto-rejoin from sessionStorage, optimistic `tapped` (answer). `src/stores/hostStore.ts`: creates/resumes the room.
- Phones: `useWakeLock`, `usePageVisibility` (reports hidden/shown; Admin-only flag), `vibrate`
  in `src/lib/format.ts`. Countdown: `useCountdown(timer, clockOffset)`; `TimerRing` for the Host.
- Host (phase 4): `src/components/host/HostApp.tsx` (gate → screen; corridor scrim per phase, faster
  alarm during Blackout's answer step and the dark; stage switch with AnimatePresence keyed by `stageKey` so the read and
  answer steps are one screen and the question glides; sound; cursor hide; mute/full-screen buttons
  shown on mouse move; next-image preload). `parts.tsx`: `Cast` (≤12 named row; 13+ wall, 2–3 rows
  sized by count), `Clock`, `Panel`, `Heading`, `contentTop(castCount)`, `useMoods(view)` (moods only
  from `HostView.cast`). `stages/`: Lobby, Round1Stages (intro, `QuestionStage` for every round's
  questions, Results, Leaderboard, `TypeOut` banner), CutStage, WildCardStages (intro, standings,
  winner, predictions), BlackoutStages (a plain lane track: intro, reveal with moves, the dark;
  Phase 2 turns it into the bots running toward the camera), PodiumStage. `sound.ts`: Web Audio beeps, unlocked by a click; plays only if
  `view.soundOn` and the Host's own mute is off. Live counters are plain numbers (NumberFlow only for
  scores/percentages, which change once). `npm run host-shots` screenshots every Host state.
- Phones (phase 3): `src/components/play/` (`PlayApp`: connect, wake lock, page visibility, header with
  "Q1 of 3 · 5s" + mint timer bar, Reconnecting/Paused bands, screen transition keyed by `screenKey`,
  confetti for the cut/winning/calling it; `JoinScreen`; `LobbyScreen` (BotBuilder + LOCK IN → "You're in",
  remembered per tab); `Round1Screens` (answer buttons numbered 1–4 in the Host's order, podium, every
  `Moment` screen); `FinalScreens` (backing, safe/wild card status, the wild card result, a runner's
  move and status, the audience's view of the chase); `parts.tsx`). Phone bot moods follow the phone's own screen state (only the Host uses `HostView.cast`).
  `/play` sets `viewportFit: "cover"` and pads with the safe-area insets. `src/components/temp/` is gone.
- Event-proofing (phase 5): every connection gets `server:hello { bootId }`; `src/lib/socket.ts`
  remembers it per tab (`serverRestarted()`), so after a game-server restart every screen says
  `SERVER_RESTARTED_MESSAGE` (Host: `hostStore.restarted` → HostGate panel). Coming back online forces a
  reconnect (no stale view after a Wi-Fi blip); phones show RECONNECTING… on the browser's `offline`
  event. The Host renders nothing until Special Elite and VT323 have loaded (`useFontsReady`, 3 s cap).
  Out-mood visor bots grey their eye band. Buzzer questions show their image on the Host.
- `src/css.d.ts` only lets TypeScript accept `import "./globals.css"`.

## Commands

- `npm run dev` (demo preset) / `npm run dev:event`: Next.js on 3000 + game server on 3001.
  `.env.local` has the real Supabase `DATABASE_URL`: for local tests run `$env:DATABASE_URL="off"; npm run dev`
  so nothing is written to the live database (the server's env wins over `.env.local`).
- `npm run bots -- --room ABCD --count 80 [--accuracy 0.4-0.85] [--slow] [--pin 1234]`: fake participants
  for scale tests; they answer in every round (the PIN lets them know the right answer, for --accuracy).
- `npm run tune-blackout`: simulates 20,000 chases per candidate (10 s answers, answer times in seconds,
  up to 15 questions) and prints the best BASE_GAP / DARKNESS_STEPS.
- `npm run check-glow`: fails on any glow in `src/` or `public/finaldesign.html` (`scripts/no-glow.ts`).
- `npm run simulate`, `npm run smoke`, `npm run typecheck`, `npm run build`, `npm run check-glow`: all must pass.
- Deploy: website on Vercel, game server on Render (`render.yaml`, `npm run start:game`, uses `PORT`),
  results in Supabase. Step by step: `docs/DEPLOY.md`. `tsx` and `pg` are runtime dependencies.
- Live: https://hermes-quiz-nine.vercel.app (Vercel) + https://hermes-quiz-game.onrender.com (Render) + Supabase.
  `npm run deploy` (on a pushed `main`) redeploys both; keys in `.env.local`. Neither auto-deploys on push yet.
- `npm run db-check`: plays a game with the results database on (in-memory Postgres) and checks the rows.
- The backend is `server/` (decided 12 Oct). `DATABASE_URL` (Supabase) turns on `server/db.ts`,
  which saves to the teammate's tables (from `archive/ws-backend-v1/db.js`) (additive columns only). `quiz.ts` stays I/O-free:
  it calls `room.recorder` (`QuizRecorder`) and exposes `snapshot()`.
- `npm run host-shots [-- --bots 94 --out screenshots/host-100]` (with `npm run dev`, database off): plays a game and
  screenshots every Host state at 1920×1080 and 1366×768, enables sound, reports fps and page errors.
- `npm run admin-run [-- --bots 80 --out screenshots/x]` (with `npm run dev` running): Playwright drives a
  whole game from Admin (3 devices), 68 checks, screenshots in `screenshots/` (git-ignored).
- `npm run play-shots [-- --bots 20 --out screenshots/play]` (with `npm run dev`, database off): 5 phone tabs
  (360–430 wide) play a whole three-round game with checks (name clash, shared bot, refresh mid-question
  and mid-Blackout, removal, a late joiner, a tab winning the wild card, a wrong move back, a catch) and
  screenshot every phone state; `compare.png` = design | app.
- `npm run drills` (against `npm run dev` or `npm run preview`): failure drills on all three screens,
  including a game-server restart (it touches `server/index.ts`, so `tsx watch` must be running).
- `npm run rehearsal -- --gpu` (against `npm run build; npm run preview` with `GAME_PRESET=event`, database
  off): 100 bots + 4 phone tabs + Host 1920 + Admin at phone size, lobby to podium (wild card, Blackout)
  with a void, a restart question and a refresh; prints Host fps, memory and Admin→view latency.
- `npm run check-questions [-- --preset event]`, `npm run washout [-- --in screenshots/host]` (washout
  views + contrast table). `npm run preview` = production build + a watched game server.
- `next dev` appends a Next.js block to `AGENTS.md`; that's expected, keep it committed.
