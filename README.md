# Hermes Quiz!

A live multiple-choice quiz for 60–100 people in one hall, run by the CSI student chapter at
KJSCE after the Hermes AI agent workshop. Questions go up on the **projector**, everyone answers
on their **phone**, the top 9 plus a **wild card** winner race the dark in **Blackout**, and a **quizmaster** runs every step
from an admin panel.

| | Live |
|---|---|
| Projector (Host) | https://hermes-quiz-nine.vercel.app/host |
| Quizmaster (Admin) | https://hermes-quiz-nine.vercel.app/admin (PIN: ask Sukrit) |
| Phones (Participant) | https://hermes-quiz-nine.vercel.app/play (or scan the QR on the Host) |
| Game server | https://hermes-quiz-game.onrender.com ([`/health`](https://hermes-quiz-game.onrender.com/health) says `ok`) |

**Status (14 Oct 2026):** the rules changed to **three rounds** ([`docs/SPEC.md`](docs/SPEC.md) v3):
Round 1 → the cut (top 9 safe) → a **wild card** round for the 10th seat → **Blackout**, a chase where
the dark catches the slow. The engine, contract, server and tests for it are done; the screens work
for the new flow and get their final polish next. The live site still runs the earlier buzzer-round
version until the new one is pushed. Still to do: the real Hermes questions (Admin → Quizzes, see
[Writing questions](#writing-questions)) and a run-through in the hall
([`docs/RUN-SHEET.md`](docs/RUN-SHEET.md)).

---

## How it works

```
 Projector  /host ─┐
 Phones     /play ─┼──►  Website (Next.js)  ──Socket.IO──►  Game server (server/)  ──►  Supabase
 Quizmaster /admin─┘     on Vercel                          on Render                   results
```

- **The game server owns the game:** timers, scores, the cut, the wild card, Blackout's moves and catches. Screens only send
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
| `npm run bot-load-test` | a whole quiz (final_quiz.json) with 100 bot phones against its own server; checks every score, reports CPU, memory, latency (`-- --bots 150`) |
| `npm run phone-fit` | the night's longest answers on 320–375 px phones: nothing clipped (needs `npm run dev`) |
| `npm run multi-shots` | multi-correct questions from Admin only: 6 phone tabs + 30 bots, every case, Host / phone / Admin screenshots (needs `npm run dev`) |
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
- three lists: **Round 1** (everyone), **Wild card** (everyone outside the top 9) and **Blackout**
  (the 10 finalists), each played top to bottom;
  extra Round 1 and wild card questions at the end are spares; Blackout plays its whole list until
  one runner is left;
- every question has exactly 4 answers (shuffled on screen), an optional picture (projector only)
  and optional own timers; a **Round 1** question may have **2–4 right answers** (tick them in the
  editor): players tick all that apply and press LOCK IN, with partial credit and 15 s to answer
  ([`docs/SPEC.md`](docs/SPEC.md) "Multi-correct questions");
- **Settings** per quiz: how many questions each round plays, finalists, and every timer;
- add questions one by one, or **Import many**: paste text, a spreadsheet (CSV or Excel, template
  inside), or JSON. Settings → Download gives the quiz back as CSV or JSON.

Then **Open room** on a quiz. The room plays a frozen copy, so editing the quiz later never changes a
game in progress. The projector (`/host`) asks for the same PIN and shows the newest open room.

**The night's questions** are [`final_quiz.json`](final_quiz.json) (its `_format` field explains the
format). The game server checks it on every start, refuses to start if anything is wrong (listing every
problem), and saves it to the library as **"Hermes final quiz"**: edit the file, not that quiz.

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
      "id": "hermes-blackout-01",
      "round": 3,
      "text": "Which file tells an agent which tools it may use?",
      "image": "/questions/tools-diagram.png",
      "options": ["The tool manifest", "The README", "The lock file", "The .gitignore"],
      "correct": 0
    }
  ]
}
```

- `id`: unique, any text. `round`: `1` (Round 1), `2` (wild card round), `3` (Blackout) or `null`
  (any round that needs one). Blackout is played fast (5 s to read, 10 s to answer) and runs on
  autopilot, so keep its questions short.
- `options`: exactly 4, all different, short enough for a phone button (under ~40 characters).
  They're shuffled on screen, so put the right one anywhere; `correct` is its index (0–3).
  A Round 1 question with several right answers: `"round": 1, "correct": [0, 2]` (in a spreadsheet:
  `"A,C"`; pasted text: a `*` on each right answer). The wild card and Blackout take one right answer only.
- `image` (optional, projector only): upload it in Admin's question form, or (for this file) put it in
  `public/questions/` and redeploy. It sits on a **dark card**, so
  use pictures with a light or solid background: dark lines on a transparent background vanish.
- How many: the event plays **20 Round 1**, **5 wild card** (+3 for sudden death) and Blackout until
  one runner is left: **at least 12 Blackout questions, 15+ to be safe**. About **50** in all.
- **Blackout plays the round-3 questions in file order** (then untagged ones nobody used), one
  after another on autopilot, until one runner is left. Put the easiest first: the first few
  decide who survives the early dark.

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
| `ADMIN_PIN` | Render | the quizmaster's PIN (Admin and the projector). Never in the repo: it's public. **Required with `GAME_PRESET=event`**: the server refuses to start on the default `1234` (set `ALLOW_DEFAULT_PIN=1` only for a local rehearsal). |
| `GAME_PRESET` | Render | `event` for the night (20 Round 1, top 9 safe, 5 wild card, Blackout on autopilot with at least 12 questions) or `demo`. New quizzes start with these settings; each quiz's own Settings win. The Blackout tuning and holds always come from the preset. |
| `DATABASE_URL` | Render | Supabase **Session pooler** connection string. Unset or `off` = nothing saved (the quiz still runs). |
| `NODE_VERSION` | Render | `24`. |
| `PORT` | Render sets it | the game server listens on it (`GAME_PORT` locally, default 3001). |
| `ROUND1_READ_SECONDS`, `ROUND1_ANSWER_SECONDS`, `MULTI_ANSWER_SECONDS`, `BLACKOUT_READ_SECONDS`, `BLACKOUT_ANSWER_SECONDS` | Render (optional; locally `.env.local`) | the default read and answer times (event: 8, 8, 15, 5, 10). |
| `ROUND1_QUESTIONS`, `SAFE_SEATS`, `WILDCARD_QUESTIONS`, `WILDCARD_SUDDEN_DEATH_MAX`, `BLACKOUT_MIN_QUESTIONS`, `MIN_PARTICIPANTS`, `MAX_PARTICIPANTS` | Render (optional) | the default counts (event: 20, 9, 5, 3, 12, 2, 200). |

**In-game settings** (the last two rows) override the preset and are the defaults every quiz starts
with. Admin → a quiz → Settings still changes them for that quiz (including the multi-correct answer
time), and +5 s works during play. "Hermes final quiz" and the Demo quiz take the default times again on
every server start; quizzes made in Admin keep their own. A bad value stops the game server at start,
naming it; the startup log lists the settings in use. Every variable is explained in [`.env.example`](.env.example).

**CORS:** the game server only accepts connections from `CORS_ORIGIN`. If phones show "Can't
reach the quiz", check it matches the website's address exactly (`https://…`, no trailing slash).

**Deploy, in PowerShell terms** (only after Sukrit says "push"; full detail in [`docs/DEPLOY.md`](docs/DEPLOY.md)):

```powershell
git checkout main; git merge frontend; git push     # Render and Vercel deploy from main
npm run deploy                                      # redeploys both (keys in .env.local), then checks /health
```

1. Render (game server): New → Blueprint → this repo (`render.yaml`: `npm ci`, `npm run start:game`,
   health check `/health`). Set `ADMIN_PIN`, `PUBLIC_WEB_URL`, `CORS_ORIGIN`, optionally `DATABASE_URL`
   and the in-game settings.
2. Vercel (website): import the repo, set `NEXT_PUBLIC_SOCKET_URL` to the Render address, deploy.
3. Back on Render: `PUBLIC_WEB_URL` and `CORS_ORIGIN` = the Vercel address (no trailing slash), so the
   QR code is right and the phones may connect.
4. Check: `/health` says ok; `/admin` signs in; a phone joins by the QR.

**Wake the free server before the event.** Render's free plan sleeps after 15 minutes without
traffic, and the first visit then takes about a minute. **10 minutes before doors open** (and
again 30 minutes before, to be safe): open https://hermes-quiz-game.onrender.com/health until it
says `ok`, then open `/admin` and `/host`. Their open connections keep it awake for the whole quiz.

**If it restarts mid-quiz** (a redeploy, a crash): rooms live in memory, so the quiz is lost. Every
screen says "The quiz server restarted, so the quiz has to start again"; open the quiz again in
Admin and everyone rejoins with the new code. Never redeploy on the day. (Render's paid Starter
plan never sleeps, if you'd rather not depend on waking it.)

## Docs

| | |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | the game rules, step by step |
| [`docs/RUN-SHEET.md`](docs/RUN-SHEET.md) | the quizmaster's checklist and script for the night, and emergency moves |
| [`docs/SERVER-NOTES.md`](docs/SERVER-NOTES.md) | for the server teammate: running and deploying it, every event and view, the stepId rule, the Blackout autopilot loop, what the server must enforce |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | what's live where, and how to update or redo the deployment |
| [`docs/PROJECT-RULES.md`](docs/PROJECT-RULES.md) | the full handoff: constraints, architecture, API, to-do |
| [`docs/BUILD-PHASES.md`](docs/BUILD-PHASES.md) | the 5 build phases |
| [`public/finaldesign.html`](public/finaldesign.html) | the approved design ("Server Corridor, Lights Low") |
