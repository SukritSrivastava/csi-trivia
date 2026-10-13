# Backend notes

For whoever works on the game server. The contract is [`src/shared/protocol.ts`](../src/shared/protocol.ts)
(every type is commented); the working reference that implements all of it is [`server/`](../server):

| File | What it does |
|---|---|
| `server/quiz.ts` | every game rule, one `Quiz` per room. No sockets, no I/O: it takes a `Clock` and calls `room.recorder` to save results. |
| `server/rooms.ts` | rooms, the PIN, who is who on each socket, sending each socket its own view |
| `server/server.ts` | HTTP (`/health`, image upload and serving) and Socket.IO; checks every payload before it reaches a room |
| `server/library.ts` | saved quizzes (Supabase tables `quizzes`, `quiz_images`, or `data/library/` without a database) |
| `server/db.ts` | results to Supabase (`rooms`, `players`, `game_history`) |
| `server/config.ts` | the `demo` and `event` presets |

The rules of the game are [`docs/SPEC.md`](SPEC.md). To change the contract: edit `protocol.ts`
first, implement it in `server/`, then follow the TypeScript errors into the screens. After any
rule change run `npm run simulate` and `npm run smoke` (both check the rules and that no answer leaks).

## The three screens

| Screen | Route | Receives | Sends |
|---|---|---|---|
| Host (projector) | `/host` | `host:state` → `HostView` | `host:auth` only. No game controls. |
| Participant (phone) | `/play` | `participant:state` → `ParticipantView` (its own, private) | `participant:*` |
| Admin (quizmaster) | `/admin` | `admin:state` → `AdminView` (with the answers) | `admin:*`, `library:*` |

Every socket also gets `server:hello` `{ bootId }` when it connects, and `room:closed` `{ reason }`
when its room is closed.

## Events, who sends them and when

### Host
| Event | When | Reply |
|---|---|---|
| `host:auth { pin, roomCode? }` | on load, after the PIN screen, and again after every reconnect | `{ ok, roomCode }`, or `wrong-pin`, or `no-room` (nothing open yet: the Host asks again every 3 s). Without `roomCode`, or if that room is gone, it attaches to the newest open room. |

### Participant
| Event | When | Notes |
|---|---|---|
| `participant:join { roomCode, name, participantId? }` | the JOIN button; after every reconnect or refresh with the saved `participantId` | Errors: `room-not-found`, `name-taken`, `name-invalid`, `quiz-ended`, `removed`, `room-full`. Typing the same name again also rejoins if that person's phone is disconnected. |
| `participant:bot { color, head }` | lobby only, each change in "Build your bot" | Any `#rrggbb` (stored as `normalizeBotColor`, so very dark colours are brightened) and any of `BOT_HEADS`. Several people may share a bot; only names are unique. Errors: `invalid`, `too-late` (quiz started). |
| `participant:answer { questionId, optionId }` | first tap in any round's answer step | First tap wins; later ones and stale `questionId`s are ignored, and so are answers from anyone who can't answer this question (a safe finalist in the wild card round, a caught runner, the audience). No ack: the phone shows the tap at once and the next view confirms it. |
| `participant:back { finalistId }` | audience, predictions step | Can change until Start Blackout. |
| `participant:visibility { hidden }` | the phone's page was hidden or shown | Shown to Admin only (`pageHidden`, `leftPageCount`). |

### Admin
| Event | When |
|---|---|
| `admin:login { pin }` | sign in (library, open rooms). 5 wrong PINs and the socket is refused. |
| `admin:rooms` · `admin:openRoom { quizId }` · `admin:closeRoom { roomCode }` | Admin's home screen. `openRoom` plays a frozen copy of the quiz and signs the socket into the room. |
| `admin:auth { roomCode, pin }` | re-enter a room (after a refresh, or a second device). |
| `admin:command { stepId, action }` | every button. `action` is an `AdminAction`; reply `{ ok }` or `{ ok: false, reason }` (`stale-step`, `not-allowed`, `not-signed-in`, `invalid`). |
| `admin:results` | the results CSV (for prizes). |
| `library:list/get/create/duplicate/save/delete` | the quiz library. Images are uploaded over HTTP: `POST /api/images` with header `x-admin-pin`. |

## The stepId rule

`AdminView.stepId` changes every time the step changes. Admin sends back the `stepId` of the view
its button was drawn from. If the step has moved on, the server does nothing and replies
`stale-step`. That's what makes a double tap, or two Admin devices pressing Next together, move
exactly one step, and never moves the dark twice (`advanceDarkness`) or reveals the wild card twice. Exceptions (they do the same thing
however often they arrive): `STEP_INDEPENDENT_ACTIONS` = pause, resume, removeParticipant,
setRoomCodeVisible, setSound, endQuiz.

`AdminView.primary` is the big button (action + label), `allowed` is every action the server will
accept now, and `hint` is the line under the button. The Admin UI only renders these.

## What the server must enforce

1. **No answer leaks.** Neither a `ParticipantView` nor the `HostView` may contain the correct
   answer (or anything that gives it away) before the reveal. Only `AdminView` has it. Option ids
   are opaque random strings, new for each question run; question ids too.
2. **One order per question.** The 4 options are shuffled once per question run. In every round
   the Host (from the answer step) and every phone show that same order, numbered 1–4.
3. **Server-side timing.** Every timer runs on the server. Answer speed is measured on the server
   when the answer arrives, never taken from a phone. Views carry `serverNow` so phones with wrong
   clocks still count down correctly (`Timer.endsAt`, `remainingMs` while paused).
4. **The quizmaster drives; the server marks.** Timers run only in the read and answer steps
   (Round 1 and wild card 8 s + 8 s, Blackout 5 s + 8 s). When one ends the room holds and waits
   for a click. An answer step ends early when everyone connected who can answer has answered.
   Nothing is judged by hand: Round 1 points, wild card tallies and Blackout moves are all computed
   from the taps (docs/SPEC.md v3.1). Round 1: correct = round(200 − 100 × elapsed / limit).
5. **The wild card.** Only `wildcard` players answer. Most right after the planned questions wins;
   tie → lower total time (wrong / miss = the full time); exact tie → sudden death among only the
   tied (all wrong → all stay), at most 3, then total time, then Round 1 rank; nobody right → the
   best Round 1 rank outside the safe seats. Tallies apply at Reveal answer.
6. **Blackout (autopilot, v3.1).** One click (`startBlackout`); then every step is a timer that
   starts the next: intro 6 s → read 5 s → answer 10 s → time's up 1.5 s → reveal (3 s + 0.15 s per
   runner) → the dark (2.5 s + 0.25 s per step + 1.5 s if caught) → next question … → `boWinner`
   7 s → podium (holds in `config.blackout.holds`). Runners start at `baseGap` + head start (ranks
   1–3 +2, 4–9 +1, wild card 0). At the reveal: right +3/+2/+1 by third of the answer time, wrong −1
   (not below 0), none 0; nobody is caught. When the dark moves: `darkness[q]` (last value repeats);
   position ≤ dark → caught. Catch order: later catch ranks higher; same question → further ahead
   before the dark, lower total time, better Round 1 rank. Over when one (or none) is left or the
   questions run out (furthest ahead wins). No fixed count: it plays every Blackout question.
   `advanceDarkness` / `showWinner` and Show/Reveal/Next are `not-allowed` in Blackout; `pause` and
   `skipTimer` are step-bound (send the stepId on screen).
7. **Fixing mistakes.** `voidQuestion`: the question doesn't count (Round 1 dropped; wild card and
   Blackout: the next question takes its number, no moves, the dark stays). `restartQuestion`:
   undoes everything the question did (points, tallies, moves, the dark, catches) and replays it with
   new ids. `restartRound` resets the round. The server keeps a snapshot per question for this.
8. **Reconnects.** A participant who drops keeps their seat, score and bot. They rejoin with the
   saved `participantId` (or by typing the same name while the old socket is gone) and get the
   current view straight away. A Host or Admin that reconnects re-authenticates and gets the
   current view. Rooms live in memory: if the server restarts, every room is gone, `bootId`
   changes, and the screens say "The quiz server restarted, so the quiz has to start again."
9. **Bots.** On join the server assigns a bot (colour + head). Phones change it with
   `participant:bot` in the lobby only. Bots may be shared; names must be unique in a room
   (case-insensitive), so the second "Rahul" is told to add a surname initial.
10. **Moods come from the server.** `HostView.cast[i].mood` says what every bot's eyes are doing.
   Screens never work it out. `server/quiz.ts` `botMood()`:
   - lobby, intros, read steps: `idle`
   - answer step: `locked` if answered, else `thinking`; time's up: `locked` or `idle`
   - after the reveal: `right` or `wrong` (Round 1 and wild card: a miss is `wrong`; Blackout: no
     answer is `idle`); voided question: `idle`
   - the cut: safe `right`, wild card players `idle`; wild card revealed: the winner `right`, the rest `out`
   - Blackout, after the dark moves: caught runners `out`, survivors `idle`
   - podium: the winner `right`, the others `idle`
   - removed: `out`. `locked` never says whether the answer was right, so the cast can't leak it.
11. **Only send what changed.** With 100 phones, views are cached per step and sent only to sockets
    whose view actually changed (`simulate` times this: about 0.5 ms for a full refresh of 100 phones).

## Checking your work

```powershell
npm run typecheck; npm run simulate; npm run smoke; npm run db-check
```

With `$env:DATABASE_URL="off"; npm run dev` running: `npm run drills` (reconnects, restarts,
two Admins), `npm run play-shots`, `npm run admin-run`, and `npm run bots -- --room ABCD --count 100`
for load.
