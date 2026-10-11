# Hermes Quiz

A live multiple-choice quiz for 60–100 people in one hall, run by the CSI student chapter at
KJSCE after the Hermes AI agent workshop. Questions go up on the **projector**, everyone answers
on their **phone**, the top 6 play a **buzzer-round final**, and a **quizmaster** runs every step
from an admin panel.

| | Live |
|---|---|
| Projector (Host) | https://hermes-quiz-nine.vercel.app/host |
| Quizmaster (Admin) | https://hermes-quiz-nine.vercel.app/admin (PIN: ask Sukrit) |
| Phones (Participant) | https://hermes-quiz-nine.vercel.app/play (or scan the QR on the Host) |
| Game server | https://hermes-quiz-game.onrender.com ([`/health`](https://hermes-quiz-game.onrender.com/health) says `ok`) |

**Status (12 Oct 2026):** the game engine, the Admin screen and the deployment are done. The phone
and projector screens are still simple test pages in the final colours; they're next
(build phases 3 and 4). The quiz still uses 3 demo questions.

---

## How it works

```
 Projector  /host ─┐
 Phones     /play ─┼──►  Website (Next.js)  ──Socket.IO──►  Game server (server/)  ──►  Supabase
 Quizmaster /admin─┘     on Vercel                          on Render                   results
```

- **The game server owns the game:** timers, scores, the cut, the buzzers. Screens only send
  actions ("tapped option 2", "Reveal answer") and draw what the server sends back.
- **The quizmaster drives it:** nothing moves on by itself except the short read/answer timers.
- **The contract** between screens and server is one file:
  [`src/shared/protocol.ts`](src/shared/protocol.ts) (every event and view, commented).
- **Supabase** stores results (rooms, players, every answer). If it's down, the quiz still runs.

The rules of the game: [`docs/SPEC.md`](docs/SPEC.md).

## Run it on your laptop

Needs **Node.js 20.9+**. In a terminal (PowerShell is fine) in this folder:

```powershell
npm install
npm run dev
```

That starts the website on port 3000 and the game server on port 3001 (short **demo** quiz).

| Open | For |
|---|---|
| http://localhost:3000/host | the projector: creates a room and shows its code |
| http://localhost:3000/admin | the quizmaster: room code + PIN **1234** (local default) |
| http://localhost:3000/play | a phone; open a few tabs, each is a player |

Fill the room with fake players from a second terminal: `npm run bots -- --room ABCD --count 20`.
To save results locally too, put `DATABASE_URL=...` in `.env.local` (see [`.env.example`](.env.example)).

## What's where

```
src/                    the website (Next.js 16, React 19, Tailwind 4, Zustand)
  app/                  pages: /host, /play, /admin, globals.css (the design system)
  components/admin/     the Admin screen
  components/ui/        Bot, Corridor, TimerRing, BotBuilder (the approved look)
  components/temp/      temporary /host and /play pages (replaced in phases 3–4)
  shared/protocol.ts    THE CONTRACT between screens and server
  stores/, lib/         socket connection and state per screen, helpers
server/                 the game server (Node + Socket.IO), what runs on Render
  quiz.ts               every game rule (no network code)
  rooms.ts, server.ts   sockets, PIN, sending views
  db.ts                 saving results to Supabase
  config.ts             timings and counts (demo / event presets)
data/questions.json     the questions
scripts/                tests, fake players, deploy
docs/                   rules, deployment, the full handoff
public/finaldesign.html the approved design (open it in a browser)
archive/                the first backend prototype, not used (see archive/README.md)
```

## Working on it

**Branches:** `main` is the whole app and what's live. Work on **`frontend`** (screens, `src/`) or
**`backend`** (`server/`), then merge into `main` with a pull request once these all pass:

```powershell
npm run typecheck; npm run build; npm run simulate; npm run smoke
```

Ground rules (details in [`docs/PROJECT-RULES.md`](docs/PROJECT-RULES.md)):
- **Contract first.** Changing what screens and server send each other? Edit
  `src/shared/protocol.ts`, implement it in `server/`, then fix the TypeScript errors.
- **No answer leaks.** Phones and the projector never get the correct answer before the reveal
  (`simulate` and `smoke` check this).
- **The look is final.** Match `public/finaldesign.html`; ask Sukrit before changing how anything looks.
- **Never commit secrets.** Passwords and keys go in `.env.local`, which git ignores.

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:event` | website + game server, demo / full event quiz |
| `npm run bots -- --room ABCD --count 80` | fake players join a running quiz (`--url` for the live server) |
| `npm run simulate` | plays full quizzes with a fake clock and checks every rule (~2 s) |
| `npm run smoke` | a whole quiz over real sockets: Host, 2 Admins, 4 phones (~8 s) |
| `npm run db-check` | a quiz with saving on (in-memory database), checks the saved rows |
| `npm run admin-run` | a real browser runs a whole quiz from Admin, with screenshots (needs `npm run dev`) |
| `npm run deploy` | puts `main` live on Render and Vercel (keys in `.env.local`) |

## Questions

All in [`data/questions.json`](data/questions.json): exactly 4 options each, `correct` is the index
(0–3) of the right one, `round` is `1`, `2` or `null` (either round). Images go in
`public/questions/` and only show on the projector. The server checks the file when it starts.

## Docs

| | |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | the game rules, step by step |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | what's live where, and how to update or redo the deployment |
| [`docs/PROJECT-RULES.md`](docs/PROJECT-RULES.md) | the full handoff: constraints, architecture, API, to-do |
| [`docs/BUILD-PHASES.md`](docs/BUILD-PHASES.md) | the 5 build phases |
| [`public/finaldesign.html`](public/finaldesign.html) | the approved design ("Server Corridor, Lights Low") |
