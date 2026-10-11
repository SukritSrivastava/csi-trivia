# Project notes for Claude

Hermes Quiz: a live elimination MCQ quiz. Projector at `/host`, phones at `/play`,
organiser at `/admin`. Rules are in `docs/SPEC.md`; build plan in `docs/BUILD-PHASES.md`.

## Rules of this codebase

- NEVER `git push` unless the user explicitly says "push". Commit locally only.
- The server is the source of truth. Screens send actions and render the view they receive;
  they never compute game state.
- Every event and view type lives in `src/shared/protocol.ts`. Change the contract there first,
  then follow the TypeScript errors. A teammate builds the real server in `server/` against it.
- `mock-server/` implements the whole protocol for local testing. `mock-server/quiz.ts` has no
  socket code; after changing rules, run `npm run simulate`.
- Phones must never receive the correct answer before the reveal, and options are shuffled per phone.
- Questions live in `data/questions.json` (MCQ, 4 options, `correct` = index).
- Look: marigold game-show style. Tokens and shared classes (`plate`, `press`, `type-wide`) are in
  `src/app/globals.css`. Projector sizes everything in `rem` (scaled by `html:has(.host-root)`).
- Animation: `motion` (`motion/react`), `@number-flow/react` for numbers, `canvas-confetti` via
  `src/lib/confetti.ts`. Respect reduced motion (`MotionConfig reducedMotion="user"`).

## Commands

- `npm run dev` starts Next.js (3000) and the mock server (3001), demo preset.
- `npm run simulate` plays full fake quizzes against the rules.
- `npm run typecheck`, `npm run build`.
