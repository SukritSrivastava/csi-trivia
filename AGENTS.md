# AGENTS.md: Hermes Quiz

**Read `PROJECT-RULES.md` first, all of it.** It is the full AI handoff: constraints,
architecture, tech stack, to-do list, skills, agent roles, plugins and the frontend↔backend API.
Then read `docs/SPEC.md` (game rules), `src/shared/protocol.ts` (the contract) and
`public/finaldesign.html` (the approved design).

## Must-follow rules (details in PROJECT-RULES.md §1)
1. Never `git push` unless Sukrit says "push". Commit locally on the `frontend` branch only.
2. The server is the source of truth. Screens never compute game state, scores, timers or bot moods.
3. Never send the correct answer to phones or the Host before the reveal.
4. Contract first: change `src/shared/protocol.ts`, then `mock-server/`, then the screens, then PROJECT-RULES.md §8.
5. Every Admin command carries `stepId`; stale steps are ignored.
6. The look is approved and final: match `public/finaldesign.html`; use `src/app/globals.css` tokens and `src/components/ui/` components. No new colours or fonts.
7. Round 1 answers: one order on the Host and every phone, numbered 1–4.
8. Windows PowerShell only (no bash-only commands).
9. `npm run typecheck`, `npm run build`, `npm run simulate`, `npm run smoke` must pass.
10. Do the next unfinished phase in `docs/BUILD-PHASES.md`; report and update PROJECT-RULES.md §4 when done.
