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

**Status (13 Oct 2026):** all five build phases are done: the game engine, Admin (with the quiz
library), the phones, the projector, and event-proofing (failure drills, a 100-player rehearsal,
handover docs). What's left is the real Hermes questions (Admin → Quizzes, see
[Writing questions](#writing-questions)) and a run-through in the hall
([`docs/RUN-SHEET.md`](docs/RUN-SHEET.md)).

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

That starts the website on port 3000 and the game server on port 3001. Your `.env.local` may point at the real Supabase; to keep tests out of it, start with `$env:DATABASE_URL="off"; npm run dev`.

| Open | For |
|---|---|
| http://localhost:3000/admin | the quizmaster: PIN **1234** (local default), then a quiz → **Open room** |
| http://localhost:3000/host | the projector: the same PIN; shows the newest open room |
| http://localhost:3000/play | a phone; open a few tabs, each is a player |

Fill the room with fake players from a second terminal: `npm run bots -- --room ABCD --count 20`.
To save results locally too, put `DATABASE_URL=...` in `.env.local` (see [`.env.example`](.env.example)).

## What's where

```
src/                    the website (Next.js 16, React 19, Tailwind 4, Zustand)
  app/                  pages: /host, /play, /admin, globals.css (the design system)
  components/admin/     the Admin screen and the quiz library
  components/host/      the projector (HostApp, stages/, sound)
  components/play/      the phones
  components/ui/        Bot, Corridor, TimerRing, BotBuilder (the approved look)
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
| `npm run host-shots` | screenshots every projector state at 1920×1080 and 1366×768 (needs `npm run dev`) |
| `npm run play-shots` | 4 phone tabs play a whole quiz; screenshots every phone state next to the design |
| `npm run drills` | failure drills: refresh, Wi-Fi cut, locked phone, Slow 4G, two Admins, server restart |
| `npm run rehearsal -- --gpu` | the full event rehearsal: 100 bots, 4 phones, Host fps and memory (needs `npm run preview`) |
| `npm run check-questions` | checks `data/questions.json` and local quizzes before the event (`-- --preset event`) |
| `npm run washout` | shows Host screenshots as a washed-out projector would, plus colour contrast |
| `npm run preview` | the production build (`npm run build` first) with a game server that restarts on file changes |
| `npm run deploy` | puts `main` live on Render and Vercel (keys in `.env.local`) |

For the tests against a running server, start it with the results database off:
`$env:DATABASE_URL="off"; npm run dev` (or `npm run preview`).

## Quizzes and questions

Quizzes are made in **Admin → Quizzes** (PIN first) and saved in Supabase:
- two lists: **Round 1** (everyone) and **Buzzer round** (finalists), each played top to bottom;
  extra questions at the end are spares;
- every question has exactly 4 answers (shuffled on screen), an optional picture (projector only)
  and optional own timers;
- **Settings** per quiz: how many questions each round plays, finalists, and every timer;
- add questions one by one, or **Import many**: paste text, a spreadsheet (CSV or Excel, template
  inside), or JSON. Settings → Download gives the quiz back as CSV or JSON.

Then **Open room** on a quiz. The room plays a frozen copy, so editing the quiz later never changes a
game in progress. The projector (`/host`) asks for the same PIN and shows the newest open room.

[`data/questions.json`](data/questions.json) only seeds a "Demo quiz" when the library is empty.
Running locally without Supabase, quizzes are kept in `data/library/` (git-ignored).

## Writing questions

Real questions go in through **Admin → Quizzes** (one at a time, or **Import many**). If you'd
rather write them in a file first, use this shape and import it as JSON, or put it in
`data/questions.json` (that file only seeds the Demo quiz when the library is empty):

```json
{
  "questions": [
    {
      "id": "hermes-01",
      "round": 1,
      "text": "What does Hermes do when it needs fresh information?",
      "image": null,
      "options": ["Calls a search tool", "Guesses", "Asks the projector", "Restarts itself"],
      "correct": 0
    },
    {
      "id": "hermes-buzz-01",
      "round": 2,
      "text": "Which file tells an agent which tools it may use?",
      "image": "/questions/tools-diagram.png",
      "options": ["The tool manifest", "The README", "The lock file", "The .gitignore"],
      "correct": 0
    }
  ]
}
```

- `id`: unique, any text. `round`: `1` (everyone), `2` (buzzer round, read out loud by the
  finalists, so keep answers short and sayable) or `null` (either).
- `options`: exactly 4, all different, short enough for a phone button (under ~40 characters).
  They're shuffled on screen, so put the right one anywhere; `correct` is its index (0–3).
- `image` (optional, projector only): upload it in Admin's question form, or (for this file) put it in
  `public/questions/` and redeploy. It sits on a **dark card**, so
  use pictures with a light or solid background: dark lines on a transparent background vanish.
- How many: the event plays every Round 1 question (aim for 10–15) and **10 buzzer questions**.
  Add 3 spare buzzer questions for a voided question or sudden death.

Then run **`npm run check-questions -- --preset event`**: it checks 4 options, valid `correct`,
duplicate ids, missing images, images that won't read on the dark card, and whether there are
enough questions for the event, and prints a summary.

## Deployment

Three services: the **website** on Vercel (static pages), the **game server** on Render (or any
Node host that keeps a process running and allows WebSockets), and **results** in Supabase.
Step by step, from scratch: [`docs/DEPLOY.md`](docs/DEPLOY.md). Don't deploy from a branch other than `main`.

| Variable | Where | What |
|---|---|---|
| `NEXT_PUBLIC_SOCKET_URL` | Vercel (build time) | the game server's address, e.g. `https://hermes-quiz-game.onrender.com`. Without it, screens look for port 3001 on the same computer (fine on a laptop, wrong when deployed). Redeploy the website after changing it. |
| `PUBLIC_WEB_URL` | Render | the website's address, e.g. `https://hermes-quiz-nine.vercel.app`. The QR code and join link on the projector point at `<this>/play`. |
| `CORS_ORIGIN` | Render | which websites may connect, comma-separated: the Vercel address (add a custom domain here too). Unset = any site may connect. |
| `ADMIN_PIN` | Render | the quizmaster's PIN (Admin and the projector). Never in the repo: it's public. Default `1234` is for laptops only. |
| `GAME_PRESET` | Render | `event` for the night (all Round 1 questions, top 6, 10 buzzer questions) or `demo`. New quizzes start with these settings; each quiz's own Settings win. |
| `DATABASE_URL` | Render | Supabase **Session pooler** connection string. Unset or `off` = nothing saved (the quiz still runs). |
| `PORT` | Render sets it | the game server listens on it (`GAME_PORT` locally, default 3001). |

**CORS:** the game server only accepts connections from `CORS_ORIGIN`. If phones show "Can't
reach the quiz", check it matches the website's address exactly (`https://…`, no trailing slash).

**Wake the free server before the event.** Render's free plan sleeps after 15 minutes without
traffic, and the first visit then takes about a minute. 30 minutes before doors open: open
https://hermes-quiz-game.onrender.com/health until it says `ok`, then open `/admin` and `/host`.
Their open connections keep it awake for the whole quiz. Never redeploy on the day: a restart
closes every open room. (Render's paid Starter plan never sleeps, if you'd rather not depend on this.)

## Docs

| | |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | the game rules, step by step |
| [`docs/RUN-SHEET.md`](docs/RUN-SHEET.md) | the quizmaster's checklist and script for the night, and emergency moves |
| [`docs/BACKEND-NOTES.md`](docs/BACKEND-NOTES.md) | every event and view, who sends what, and what the server must enforce |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | what's live where, and how to update or redo the deployment |
| [`docs/PROJECT-RULES.md`](docs/PROJECT-RULES.md) | the full handoff: constraints, architecture, API, to-do |
| [`docs/BUILD-PHASES.md`](docs/BUILD-PHASES.md) | the 5 build phases |
| [`public/finaldesign.html`](public/finaldesign.html) | the approved design ("Server Corridor, Lights Low") |
