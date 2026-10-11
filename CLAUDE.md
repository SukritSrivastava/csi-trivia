# Project notes for Claude

**Read `PROJECT-RULES.md` first: it is the full handoff (constraints, architecture, stack, to-do,
skills, agents, plugins, API). This file is the short version.**

Hermes Quiz: a live MCQ quiz for 60–100 people. Rules: `docs/SPEC.md` (v2.1). Build plan:
`docs/BUILD-PHASES.md` (v4, 5 phases; phase 1, design foundation and phase 2 (Admin) done).

Screen names, used everywhere: **Host** (`/host`, projector, no game controls), **Participant**
(`/play`, phones), **Admin** (`/admin`, quizmaster, PIN). Flow: lobby → Round 1 (everyone, 8s
read + 8s answer) → top 6 cut → predictions → buzzer round (6 finalists) → podium.

## Rules of this codebase

- Branches: `main` = the whole app, what's deployed. `frontend` (screens, `src/`) and `backend`
  (`mock-server/`, `db.ts`, `backend/`) branch off `main` and merge back when all checks pass. Sukrit
  (12 Oct) allowed commits, pushes and merges without asking; ask only before changing the approved design.
- The server is the source of truth. Screens send actions and render the view they receive;
  they never compute game state.
- Every event and view type lives in `src/shared/protocol.ts`. Change the contract there first,
  implement it in `mock-server/`, then follow the TypeScript errors. A teammate builds the real
  server in `server/` against it.
- `mock-server/quiz.ts` has all the rules and no socket code. After changing rules run
  `npm run simulate` and `npm run smoke`.
- The quizmaster drives the flow. Timers only for Round 1 read/answer and Round 2 read/buzz
  window/answer countdown; when one ends, the room holds. The spoken-answer countdown never marks.
- Admin commands carry `stepId`; the server ignores a command from a stale step (except the
  step-independent ones listed in `STEP_INDEPENDENT_ACTIONS`).
- Phones and the Host never receive the correct answer before the reveal (simulate and smoke
  check this). Options are shuffled once per question; in Round 1 the Host (from the answer step)
  and every phone show the same order, numbered 1–4. Option and question ids are opaque.
- Questions live in `data/questions.json` (MCQ, 4 options, `correct` = index, `round` 1/2/null).
- Look: **"Server Corridor, Lights Low"**, approved and final. Match `public/finaldesign.html`
  exactly (open it at http://localhost:3000/finaldesign.html); don't redesign it. Tokens and classes
  are in `src/app/globals.css` (`host-q`, `host-opts`, `opt-num`, `host-count`, `phone-opt`,
  `phone-go`, `clock`, `bot`, `corridor-*`). Components: `Bot` + `botDelay`, `BotBuilder`,
  `Corridor`, `TimerRing` in `src/components/ui/`. The old marigold tokens (`plate`, `press`,
  `bg-paper`, `bg-marigold`…) are unused leftovers (the temporary pages are restyled); delete in Phase 5. `Avatar.tsx` is the old
  initials circle: use `Bot` instead. The Host sizes everything in `rem` (scaled by
  `html:has(.host-root)`, so the Host root element needs the `host-root` class); at 1920 px,
  1% of the screen width is about 1.2rem.
- Bots: `ParticipantTag` has `color` + `head`. The server assigns a free bot on join; phones change
  it in the lobby with `participant:bot` (`BotPicker` on the lobby screen says what's taken).
  `HostView.cast` gives every bot's `mood` for the current step; screens never work moods out
  themselves. Give each bot `delay={botDelay(id)}` so a wall of them doesn't blink in sync.
- Animation: `motion` (`motion/react`), `@number-flow/react` for numbers, `canvas-confetti` via
  `src/lib/confetti.ts`. Respect reduced motion (`MotionConfig reducedMotion="user"`).
- The user is on Windows (PowerShell). No bash-only commands in scripts or docs.

## What later phases build on

- `AdminView.primary` (the big button: action + label), `.hint`, `.allowed`, `.stepLabel`,
  `.question` (with the answer), `.nextQuestion`, `.round2`, `.finalists`, `.canUndo`, `.lastMark`,
  `.podium` (final order, same as the Host podium) are computed by the server. The Admin UI just renders them.
- Admin UI (phase 2): `src/components/admin/` (`AdminApp` layout: phone tabs Game/Controls/People,
  two columns from 1024 px; `Dock` = hint + primary button; `GamePanels`; `Controls`;
  `ParticipantsPanel`; `parts.tsx` = `Panel`, `ControlButton`, `useConfirm` (two taps, cancels after 3 s);
  `useShortcuts`). Buttons send the stepId of the view they were drawn from.
- `src/stores/adminStore.ts` `send(action, stepId?)`: adds the stepId, ignores a repeat of the same command
  within 600 ms (and any big/judge button within 600 ms of another one), tracks `pending` and `lastResult`. Labels: `src/lib/adminLabels.ts`
  (`ACTION_LABELS`, `DESTRUCTIVE_ACTIONS`, `COMMAND_ERROR_TEXT`).
- `src/stores/participantStore.ts`: auto-rejoin from sessionStorage, optimistic `tapped` (answer)
  and `buzzedOn`. `src/stores/hostStore.ts`: creates/resumes the room.
- Phones: `useWakeLock`, `usePageVisibility` (reports hidden/shown; Admin-only flag), `vibrate`
  in `src/lib/format.ts`. Countdown: `useCountdown(timer, clockOffset)`; `TimerRing` for the Host.
- `src/components/temp/` holds the phase 1 test pages. `/admin` is replaced (TempAdmin deleted);
  replace `/play` (phase 3), `/host` (phase 4), then delete the folder.
- `src/css.d.ts` only lets TypeScript accept `import "./globals.css"`.

## Commands

- `npm run dev` (demo preset) / `npm run dev:event`: Next.js on 3000 + mock server on 3001.
- `npm run bots -- --room ABCD --count 80`: fake participants for scale tests.
- `npm run simulate`, `npm run smoke`, `npm run typecheck`, `npm run build`: all must pass.
- Deploy: website on Vercel, game server on Render (`render.yaml`, `npm run start:game`, uses `PORT`),
  results in Supabase. Step by step: `docs/DEPLOY.md`. `tsx` and `pg` are runtime dependencies.
- `npm run db-check`: plays a game with the results database on (in-memory Postgres) and checks the rows.
- The backend is `mock-server/` (decided 12 Oct). `DATABASE_URL` (Supabase) turns on `mock-server/db.ts`,
  which saves to the teammate's `backend/db.js` tables (additive columns only). `quiz.ts` stays I/O-free:
  it calls `room.recorder` (`QuizRecorder`) and exposes `snapshot()`.
- `npm run admin-run [-- --bots 80 --out screenshots/x]` (with `npm run dev` running): Playwright drives a
  whole game from Admin (3 devices), 41 checks, screenshots in `screenshots/` (git-ignored).
- `next dev` appends a Next.js block to `AGENTS.md`; that's expected, keep it committed.
