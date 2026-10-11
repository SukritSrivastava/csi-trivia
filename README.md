# Hermes Quiz

A live MCQ quiz for 60–100 people at a club event. Questions go up on the
projector, everyone answers on their phone, the fastest 6 make a buzzer-round
final, and a quizmaster runs every step from an admin panel.
Rules: [docs/SPEC.md](docs/SPEC.md). Build plan: [docs/BUILD-PHASES.md](docs/BUILD-PHASES.md).
**AI handoff (read first): [PROJECT-RULES.md](PROJECT-RULES.md).**

> **Status: build phase 1 of 5, plus the design foundation.** The game engine,
> contract and tests are done, and the approved look ("Server Corridor, Lights
> Low") is in the design system. `/host`, `/play` and `/admin` are still plain
> temporary test pages (now with bots); the real screens arrive in phases 2–4.
>
> **The design:** open [public/finaldesign.html](public/finaldesign.html), or
> http://localhost:3000/finaldesign.html while `npm run dev` runs.

## Run it locally

Needs **Node.js 20.9+**. In PowerShell, in this folder:

```powershell
npm install
npm run dev
```

`npm run dev` starts the website (port 3000) and the **mock game server**
(port 3001) with the short **demo** preset. The terminal prints the links.

| Screen | Address | Who uses it |
|---|---|---|
| **Host** | http://localhost:3000/host | the projector everyone sees (no game controls) |
| **Admin** | http://localhost:3000/admin (PIN **1234**) | the quizmaster: runs every step |
| **Participant** | shown on the Host, e.g. http://192.168.1.5:3000/play | each person's phone, same Wi-Fi |

**Testing alone:** open `/host`, then `/admin` (room code from the Host, PIN 1234),
then `/play` in two or three more tabs (each tab is its own participant). Fill
the room with fake participants from a second terminal:

```powershell
npm run bots -- --room ABCD --count 20
```

Windows Firewall may ask about Node.js the first time; allow it on private
networks so phones can connect.

## Presets

All timings and counts live in [mock-server/config.ts](mock-server/config.ts).

| Preset | Round 1 | Finalists | Buzzer questions | Start with |
|---|---|---|---|---|
| **demo** (default) | the 3 demo questions | top 3 | 3 | `npm run dev` |
| **event** | every Round 1 question | top 6 | 10 | `npm run dev:event` |

Both use the event timings: 8s read + 8s answer in Round 1; 5s read, 15s buzz
window, 10s to answer and a 10s reopen window in the buzzer round. You can also
set `GAME_PRESET=event` (see [.env.example](.env.example)).

## Questions

All questions live in [data/questions.json](data/questions.json): MCQ only, exactly 4
options, `correct` is the index (0–3) of the right one, `round` is `1`, `2` or `null`
(either). Images go in `public/questions/` and show on the Host only. Options are
shuffled once per question automatically (the Host and every phone show the same
order, numbered 1–4). The server checks the file when it starts and
lists every problem it finds.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | website + mock game server, demo preset |
| `npm run dev:event` | the same with the full event preset |
| `npm run bots -- --room ABCD --count 80` | fake participants join a running quiz (options in [scripts/bots.ts](scripts/bots.ts)) |
| `npm run simulate` | plays full quizzes (4 to 100 participants) and every edge case with a fake clock, checks every rule (~2s) |
| `npm run smoke` | starts its own server and plays a whole demo quiz over real Socket.IO: Host, 2 Admins, 4 phones (~8s) |
| `npm run typecheck` | TypeScript across the whole project |
| `npm run build` | production build of the website |

`typecheck`, `build`, `simulate` and `smoke` must all pass before every commit.

## How it fits together

```
 phones ──answer / buzz / back──▶ game server ──views──▶ Host (projector)
   ▲                                  │  ▲
   └──── each phone's own view ───────┘  └── commands ── Admin (quizmaster)
```

- The **server owns the game**: timers, scoring, the cut, shuffling, buzzers.
  Screens send actions and draw the view they get back.
- The **quizmaster drives the flow**. Timers only run for Round 1's read and
  answer, and the buzzer round's read, buzz window and answer countdown. When a
  timer ends, everything holds for the next click.
- Every Admin command carries the step it was sent from (`stepId`), so a double
  tap or a second Admin device can never skip two steps.
- [src/shared/protocol.ts](src/shared/protocol.ts) is the contract: every event and view,
  commented for the backend teammate.
- `mock-server/` runs the whole quiz so the frontend works on its own.
  `server/` is where the real backend goes.

## Folder map

```
data/questions.json          the questions
docs/                        SPEC (rules) and BUILD-PHASES (the 5 build prompts)
mock-server/config.ts        presets: every timing and count
mock-server/quiz.ts          all the rules, no socket code
mock-server/rooms.ts         Socket.IO glue: roles, PIN, sending views
mock-server/server.ts        starts a server (used by dev and smoke)
mock-server/simulate.ts      npm run simulate
scripts/                     smoke test and bots
server/                      real backend (teammate)
src/shared/protocol.ts       the contract
src/app/                     pages: / (home), /host, /play, /admin
src/components/ui/           Bot, BotBuilder, Corridor, TimerRing (the approved design)
src/components/temp/         phase 1 temporary test pages (replaced in phases 2–4)
public/finaldesign.html      the approved design, with every animation
src/stores/                  Zustand stores: socket events in, state out
src/lib/                     socket, session, countdown, wake lock, labels, helpers
```
