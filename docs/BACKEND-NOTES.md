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
| `participant:answer { questionId, optionId }` | first tap in the Round 1 answer step | First tap wins; later ones and stale `questionId`s are ignored. No ack: the phone shows the tap at once and the next view confirms it. |
| `participant:buzz { questionId }` | BUZZ in the buzzer round | Only counts while buzzers are open, for a finalist in play who isn't locked out. First buzz wins the turn. |
| `participant:back { finalistId }` | audience, predictions step | Can change until the buzzer round starts. |
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
exactly one step, and stops one answer being marked twice. Exceptions (they do the same thing
however often they arrive): `STEP_INDEPENDENT_ACTIONS` = pause, resume, removeParticipant,
setRoomCodeVisible, setSound, endQuiz.

`AdminView.primary` is the big button (action + label), `allowed` is every action the server will
accept now, and `hint` is the line under the button. The Admin UI only renders these.

## What the server must enforce

1. **No answer leaks.** Neither a `ParticipantView` nor the `HostView` may contain the correct
   answer (or anything that gives it away) before the reveal. Only `AdminView` has it. Option ids
   are opaque random strings, new for each question run; question ids too.
2. **One order per question.** The 4 options are shuffled once per question run. In Round 1 the
   Host (from the answer step) and every phone show that same order, numbered 1–4. In the buzzer
   round the Host shows A–D in that order.
3. **Server-side timing.** Every timer runs on the server. Answer speed is measured on the server
   when the answer arrives, never taken from a phone. Views carry `serverNow` so phones with wrong
   clocks still count down correctly (`Timer.endsAt`, `remainingMs` while paused).
4. **The quizmaster drives.** Timers run only in the Round 1 read and answer steps and the buzzer
   read, buzz-window and spoken-answer countdown. When one ends the room holds and waits for a
   click. The Round 1 answer step ends early when every connected player has answered. The
   spoken-answer countdown never marks anything by itself.
5. **Lockouts.** A finalist marked wrong is locked out for the rest of that question; buzzers reopen
   for the others (`reopenSeconds`). If nobody in play is left, the question goes to the reveal.
   In sudden death only the tied finalists are in play.
6. **Undo.** `undoMark` reverts the last Correct/Wrong on the current question: the point, the
   lockout and the winner, and goes back to judging the same buzz (`canUndo`, `lastMark`).
   `voidQuestion` cancels a question with no points either way; `restartQuestion` replays it from
   its read step with new ids; `restartRound` puts the round's scores back to 0.
7. **Reconnects.** A participant who drops keeps their seat, score and bot. They rejoin with the
   saved `participantId` (or by typing the same name while the old socket is gone) and get the
   current view straight away. A Host or Admin that reconnects re-authenticates and gets the
   current view. Rooms live in memory: if the server restarts, every room is gone, `bootId`
   changes, and the screens say "The quiz server restarted, so the quiz has to start again."
8. **Bots.** On join the server assigns a bot (colour + head). Phones change it with
   `participant:bot` in the lobby only. Bots may be shared; names must be unique in a room
   (case-insensitive), so the second "Rahul" is told to add a surname initial.
9. **Moods come from the server.** `HostView.cast[i].mood` says what every bot's eyes are doing.
   Screens never work it out. `server/quiz.ts` `botMood()`:
   - lobby, Round 1 intro, read steps: `idle`
   - Round 1 answer step: `locked` if answered, else `thinking`; time's up: `locked` or `idle`
   - after the reveal: `right` or `wrong` (a miss is `wrong`); voided question: `idle`
   - from the cut on: everyone outside the final is `out`
   - buzzer round: `thinking` while buzzers are open, `locked` for whoever buzzed, `wrong` once
     locked out, `right` for a correct answer; not in play (sudden death): `idle`
   - podium: the winner `right`, the other finalists `idle`, the rest `out`
   - removed: `out`. `locked` never says whether the answer was right, so the cast can't leak it.
10. **Only send what changed.** With 100 phones, views are cached per step and sent only to sockets
    whose view actually changed (`simulate` times this: about 0.5 ms for a full refresh of 100 phones).

## Checking your work

```powershell
npm run typecheck; npm run simulate; npm run smoke; npm run db-check
```

With `$env:DATABASE_URL="off"; npm run dev` running: `npm run drills` (reconnects, restarts,
two Admins), `npm run play-shots`, `npm run admin-run`, and `npm run bots -- --room ABCD --count 100`
for load.
