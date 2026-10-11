# Roomful (working title)

A Jackbox-style party game. One screen everyone can see (laptop or TV) runs the
show, and every player uses their phone's browser as the controller. No app to
install.

## Run it

You need **Node.js 20.9 or newer** (`node -v` to check).

```powershell
npm install
npm run dev
```

That starts two things together:

| What | Where | Job |
|---|---|---|
| Website (Next.js) | port 3000 | the TV screen and the phone controller |
| Game server (Socket.IO) | port 3001 | holds every room and runs the rules |

Then:

1. On the laptop, open **http://localhost:3000/host**. A room code appears.
2. On phones on the **same Wi-Fi**, open the address shown on the TV (or scan the QR code).
3. The first player to join is the VIP and presses Start once 3+ players are in.

The first time, Windows Firewall may ask about Node.js. Allow it on **private
networks**, or phones won't be able to connect.

**Testing alone?** Open `http://localhost:3000/play` in three normal browser tabs and
join with different names (each tab is its own player). The **Skip** button on
the TV ends any timer early.

## How it works

```
 phones ──actions──▶ game server ──views──▶ TV
   ▲                     │
   └──── private view ───┘
```

- The **server owns the game**. Screens never decide anything. A phone sends an
  action ("I voted for this answer"), the server updates the room, then sends every
  screen a fresh view.
- Every phone gets **its own view**, so players can see things nobody else can (their
  own prompts, for example).
- `src/shared/protocol.ts` is the contract: every event and every view shape. Both
  sides import it, so if you change a type, TypeScript shows everything that needs updating.

## Folder map

```
server/
  index.ts       Socket.IO server: wires events to the room manager
  rooms.ts       which socket belongs to which room and player; sends views
  game.ts        the rules: phases, prompts, voting, scoring (no sockets here)
  prompts.ts     the prompt bank. Add more!
  simulate.ts    plays whole fake games to check the rules (npm run simulate)
src/
  shared/protocol.ts    the contract between server and screens
  app/                  pages: / (home), /host (TV), /play (phone)
  components/host/      one component per TV phase: Lobby, Intro, Answer, Vote, Reveal, Scores, End
  components/play/      phone screens: JoinForm, Lobby, Answer, Vote, Wait, End
  components/ui/        Avatar, TimerRing
  stores/               Zustand stores: socket events in, state out
  lib/                  socket connection, countdown, wake lock, session storage
```

## The game (v1)

1. **Round 1:** everyone gets two prompts. Each prompt goes to two players, and
   everyone else votes for the funnier answer. 100 points per vote, plus a bonus for
   a clean sweep.
2. **Round 2:** same thing, double points.
3. **Final round:** everyone answers one prompt and everyone votes. Triple points.

Late joiners (or anyone past 8 players) join the **audience** and their votes count too.

## Already handled

- Refresh or lock your phone and you rejoin automatically as the same player. You can
  also rejoin by typing the same name.
- The phone screen stays awake during a game (Screen Wake Lock).
- If the TV refreshes, it picks the same room back up.
- The VIP passes to the next player if they leave the lobby.
- Room codes use consonants only, so they can't spell rude words.
- Extra time, audience and hide-code settings in the lobby.

## Ideas for next

- Sound and music on the TV (Howler.js), after the host clicks once.
- A second game mode reusing the same three phone inputs: text, buttons, drawing.
- A drawing canvas component for the phone.
- Family-friendly prompt filter.
- Deploy: website on Vercel, game server on Render or Railway. Set
  `NEXT_PUBLIC_SOCKET_URL`, `PUBLIC_WEB_URL` and `CORS_ORIGIN` (see `.env.example`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | website + game server with hot reload |
| `npm run simulate` | plays fake games and checks the rules hold |
| `npm run typecheck` | TypeScript check across the whole project |
| `npm run build` | production build of the website |
