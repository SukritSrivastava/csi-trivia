## What this changes

<!-- One or two sentences. Which screen or part of the server? -->

## Checklist

- [ ] Branch: `frontend` (screens, `src/`) or `backend` (`server/`), merging into `main`
- [ ] `npm run typecheck`, `npm run build`, `npm run simulate`, `npm run smoke` all pass
- [ ] Touched `server/db.ts`? `npm run db-check` passes
- [ ] Changed the contract (`src/shared/protocol.ts`)? Updated `server/` and section 8 of `docs/PROJECT-RULES.md`, and told the other side
- [ ] Changed how a screen looks? Sukrit approved it (the design in `public/finaldesign.html` is final)
- [ ] No answers leak to phones or the Host before the reveal
- [ ] No secrets committed (`.env.local` stays local)

## How I tested it

<!-- e.g. npm run dev + npm run bots -- --room ABCD --count 20, played a full game -->
