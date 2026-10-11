# Project notes for Claude

Hermes Quiz: a live MCQ quiz for 60–100 people. Rules: `docs/SPEC.md` (v2). Build plan:
`docs/BUILD-PHASES.md` (5 phases; phase 1 done).

Screen names, used everywhere: **Host** (`/host`, projector, no game controls), **Participant**
(`/play`, phones), **Admin** (`/admin`, quizmaster, PIN). Flow: lobby → Round 1 (everyone, 8s
read + 8s answer) → top 6 cut → predictions → buzzer round (6 finalists) → podium.

## Rules of this codebase

- NEVER `git push` unless the user explicitly says "push". Commit locally on `frontend` only.
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
  check this). Options are shuffled per phone; option and question ids are opaque.
- Questions live in `data/questions.json` (MCQ, 4 options, `correct` = index, `round` 1/2/null).
- Look: marigold game-show style. Tokens and shared classes (`plate`, `press`, `type-wide`) are in
  `src/app/globals.css`. The Host sizes everything in `rem` (scaled by `html:has(.host-root)`, so
  the Host root element needs the `host-root` class).
- Animation: `motion` (`motion/react`), `@number-flow/react` for numbers, `canvas-confetti` via
  `src/lib/confetti.ts`. Respect reduced motion (`MotionConfig reducedMotion="user"`).
- The user is on Windows (PowerShell). No bash-only commands in scripts or docs.

## What later phases build on

- `AdminView.primary` (the big button: action + label), `.hint`, `.allowed`, `.stepLabel`,
  `.question` (with the answer), `.nextQuestion`, `.round2`, `.finalists`, `.canUndo`, `.lastMark`
  are computed by the server. The Admin UI just renders them.
- `src/stores/adminStore.ts` `send(action)`: adds the stepId, ignores a repeat of the same command
  within 600 ms, tracks `pending` and `lastResult`. Labels: `src/lib/adminLabels.ts`
  (`ACTION_LABELS`, `DESTRUCTIVE_ACTIONS`, `COMMAND_ERROR_TEXT`).
- `src/stores/participantStore.ts`: auto-rejoin from sessionStorage, optimistic `tapped` (answer)
  and `buzzedOn`. `src/stores/hostStore.ts`: creates/resumes the room.
- Phones: `useWakeLock`, `usePageVisibility` (reports hidden/shown; Admin-only flag), `vibrate`
  in `src/lib/format.ts`. Countdown: `useCountdown(timer, clockOffset)`; `TimerRing` for the Host.
- `src/components/temp/` holds the phase 1 test pages. Replace `/admin` (phase 2), `/play`
  (phase 3), `/host` (phase 4), then delete the folder.
- `src/css.d.ts` only lets TypeScript accept `import "./globals.css"`.

## Commands

- `npm run dev` (demo preset) / `npm run dev:event`: Next.js on 3000 + mock server on 3001.
- `npm run bots -- --room ABCD --count 80`: fake participants for scale tests.
- `npm run simulate`, `npm run smoke`, `npm run typecheck`, `npm run build`: all must pass.
