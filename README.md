# Hermes Quiz

A live elimination quiz for 60–100 players. Questions run on the projector,
everyone answers on their phone, and each round cuts the field until two
finalists meet in a buzzer duel. Rules: [docs/SPEC.md](docs/SPEC.md).

## Run it locally

Needs **Node.js 20.9+**.

```powershell
npm install
npm run dev
```

`npm run dev` starts the website (port 3000) and the **mock game server** (port 3001)
with the short **demo** preset (3 rounds of the 3 demo questions, then the duel).

| Screen | Address | Who uses it |
|---|---|---|
| Projector | http://localhost:3000/host | the laptop on the projector |
| Phones | shown on the projector (e.g. http://192.168.1.5:3000/play) | players, same Wi-Fi |
| Organiser | http://localhost:3000/admin (PIN **1234**) | starts the quiz, pauses, judges the duel |

Testing alone: open `/play` in a few browser tabs (each tab is its own player),
then start from `/admin`. Windows Firewall may ask about Node.js the first time;
allow it on private networks so phones can connect.

To run the full event format instead: `$env:GAME_PRESET="event"; npm run dev`

## Questions

All questions live in [data/questions.json](data/questions.json): MCQ only, 4 options,
`correct` is the index (0–3) of the right one. Images go in `public/questions/`.
Options are shuffled per phone automatically.

## How it fits together

```
 phones ──actions──▶ game server ──views──▶ projector
   ▲                      │
   └──── private view ────┘     organiser ──controls──▶ game server
```

- The **server owns the game**: timers, scoring, cuts, shuffling, the duel.
  Screens send actions and draw the view they get back.
- [src/shared/protocol.ts](src/shared/protocol.ts) is the contract: every event and view.
- `mock-server/` runs the whole quiz so the frontend works on its own.
  `server/` is where the real backend goes.

## Folder map

```
data/questions.json           the questions
mock-server/                  mock game server (config.ts has the round presets)
server/                       real backend (teammate)
src/shared/protocol.ts        the contract
src/app/                      pages: / (home), /play, /host, /admin
src/components/play/          phone screens
src/components/host/          projector screens (placeholders until phase 2)
src/components/admin/         organiser page (basic until phase 3)
src/stores/                   Zustand stores: socket events in, state out
src/lib/                      socket, countdown, wake lock, confetti, helpers
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | website + mock game server, demo preset |
| `npm run simulate` | plays full fake quizzes (4 to 100 players) and checks every rule |
| `npm run typecheck` | TypeScript across the whole project |
| `npm run build` | production build of the website |
