# Project notes for Claude

Jackbox-style party game: TV at `/host`, phones at `/play`, Socket.IO game server in `server/`.

## Rules of this codebase

- The server is the source of truth. Screens send actions and render the view they receive;
  they never compute game state themselves.
- Every event and view type lives in `src/shared/protocol.ts`. Change the contract there first,
  then follow the TypeScript errors.
- `server/game.ts` must stay free of socket code so `npm run simulate` can test it.
  After changing game rules, run `npm run simulate`.
- TV (`/host`) sizes everything in `rem`; `html:has(.host-root)` scales rem with screen width.
  Phone screens use normal Tailwind sizes.
- Colours and shared classes (`plate`, `press`, `type-wide`) are in `src/app/globals.css`.
  Pink (`side-a`) and teal (`side-b`) always mean the left and right answer, on TV and phone.
- Keep phone screens to one task each: type, pick, or wait.

## Commands

- `npm run dev` starts Next.js (3000) and the game server (3001).
- `npm run simulate` plays fake games against the rules.
- `npm run typecheck` checks types across server and frontend.
