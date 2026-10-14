# AGENTS.md: Hermes Quiz

**Read `docs/PROJECT-RULES.md` first, all of it.** It is the full AI handoff: constraints,
architecture, tech stack, to-do list, skills, agent roles, plugins and the frontend↔backend API.
Then read `docs/SPEC.md` (game rules, **v3.1 since 14 Oct night: Round 1 (200→100) → wild card →
Blackout on autopilot; no glow**),
`src/shared/protocol.ts` (the contract) and `public/finaldesign.html` (the approved design).

## Must-follow rules (details in docs/PROJECT-RULES.md §1)
1. Branches: `main` (whole app, deployed), `frontend` and `backend` off it; merge into `main` only with all checks green. Never change the approved design without asking Sukrit.
2. The server is the source of truth. Screens never compute game state, scores, timers or bot moods.
3. Never send the correct answer to phones or the Host before the reveal.
4. Contract first: change `src/shared/protocol.ts`, then `server/`, then the screens, then docs/PROJECT-RULES.md §8.
5. Every Admin command carries `stepId`; stale steps are ignored.
6. The look is approved and final: match `public/finaldesign.html`; use `src/app/globals.css` tokens and `src/components/ui/` components. No new colours or fonts. **No glow** (14 Oct): flat fills, 1–2 px borders, colour and opacity changes; no text-shadow halos, blurred shadows, drop-shadow/blur or radial blooms.
7. Answers in every round: one order on the Host and every phone, numbered 1–4. Every answer is marked by the server (no judging).
8. Windows PowerShell only (no bash-only commands).
9. `npm run typecheck`, `npm run build`, `npm run simulate`, `npm run smoke` and `npm run check-glow` must pass.
10. Do the next unfinished phase (v5 plan, 14 Oct: all three phases done: engine, rules update + Admin + phones, Host + sound + event-proofing); report and update docs/PROJECT-RULES.md §4 when done. Never `git push` unless Sukrit says "push".

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
