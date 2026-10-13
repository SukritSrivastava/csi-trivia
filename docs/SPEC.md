# Hermes Quiz: spec (v3)

**v3 (14 Oct 2026): three rounds, no buzzer round.** After Round 1 the top 9 are safe; everyone
else plays a **wild card** round for the 10th seat; then the 10 finalists play **Blackout**, a chase
where a darkness swallows the server corridor and the last bot running wins. **Nothing is judged by
the quizmaster any more:** every answer is a phone tap, marked by the server. Removed in v3: the
buzzer round, spoken answers, Correct/Wrong judging, undo mark and the buzzer-round sudden death.

Earlier: v2 (11 Oct) two rounds and the quizmaster drives the flow; v2.1 (11 Oct, evening) the
approved look, bots, and one 1–4 answer order on the Host and every phone; 12 Oct bots may be
shared (any colour, unique names). Anything marked **Default** below is a setting in
`server/config.ts` (presets `event` and `demo`) or in a quiz's own Settings, not a fixed rule.

## The three screens

| Screen | Route | Who sees it | What it does |
|---|---|---|---|
| **Host** | `/host` | everyone, on the projector | shows the quiz; has no game controls |
| **Participant** | `/play` | each player, on their phone | join, build a bot, answer, back a finalist |
| **Admin** | `/admin` | the quizmaster only (PIN) | controls every step of the quiz |

## The event

- Club event (CSI student chapter, KJSCE), Thursday 16 Oct 2026, in person, one hall, projector
  driven by a laptop over HDMI.
- **60–100 participants**, solo, one phone each, after a workshop on the **Hermes AI agent**.
- Phones on a mix of college Wi-Fi and mobile data, so the **game server runs online**. The game
  server in `server/` runs the whole quiz (locally and on Render) against the contract in
  `src/shared/protocol.ts`, and saves results to Supabase.

## Who controls what

The quizmaster drives everything from Admin. Nothing moves to the next step on its own, except the
timers that run once the quizmaster starts a question:

- Round 1 and wild card: after **Show question**, the **8s read** then the **8s answer**.
- Blackout: after **Show question**, the **5s read** then the **8s answer**.

When a timer ends, the room holds and waits for the quizmaster's next click. An answer step also
ends early when everyone who can answer it has answered.

## Flow

```
Lobby → Round 1 (everyone) → The cut (top 9 safe) → Wild card (everyone else) → Wild card revealed
      → Audience backs a finalist (optional) → Blackout (10 finalists) → Podium
```

### Lobby
- Host: room code tiles, QR code, join link, a wall of every bot and name, a live count.
- Participants join with room code + **real name**. An exact duplicate name (ignoring case) is
  rejected ("add your surname initial, like Rahul S").
- **Build your bot:** every participant is a robot. The server gives each joiner a starting bot
  (varied, so the room looks colourful); in the lobby they change its **colour** (12 quick picks or
  any colour from a wheel) and **head (8)**. **Bots can be shared** (decided 12 Oct: with 100 people,
  several may have the same bot; names tell them apart and must be unique). Very dark colours are
  brightened. Bots lock when the quizmaster clicks **Start quiz**.

### Round 1: everyone plays (MCQ)

For each question the quizmaster clicks through:

| Step | Started by | Host shows | Participant phone shows |
|---|---|---|---|
| Read | **Show question** (click) | question (+ image), 8s countdown, no options | "Eyes up", 8s countdown |
| Answer | automatic after the read | the 4 options numbered 1–4, 8s countdown, "38 / 64 answered" | the same 4 options in the same order (1–4); first tap locks |
| Time's up | automatic (8s over, or everyone answered) | "Time's up" | "Locked in" or "Time's up" |
| Reveal | **Reveal answer** (click) | the correct answer | right / wrong (no points, no rank) |
| Results | **Show results** (click, optional) | bar chart: how many picked each option | unchanged |
| Leaderboard | **Show leaderboard** (click, optional) | top 10 so far | unchanged |
| Next | **Next question** (click) | the next question's read step | "Eyes up" |

- **Scoring:** correct = `round(500 + 500 × (1 − elapsed / limit))`; wrong or no answer = 0.
- **Ties:** lower total answer time ranks higher (a miss counts as the full answer time).
- **Late joiners** play from the next question whose answers haven't opened yet (joining during a
  read step = they play that question); earlier questions count as missed for the tie-break.
- **End round 1** is allowed from any reveal onward (cut Round 1 short if the night runs late).
- Default: **20 questions** at the event, the 3 demo questions in the demo preset.

### The cut
- Ranked by Round 1 score, then lower total answer time. **Ranks 1–9 are safe: finalists.**
- Everyone else who joined before the cut and isn't removed plays the **wild card round** (status
  `wildcard`). Anyone joining after the cut joins as **audience**.
- **Fewer than 10 played Round 1:** everyone who played is a finalist and the wild card round is
  skipped (Admin's next step becomes Open predictions / Start Blackout).
- Host: the ranked list with the cut line under 9th; the safe bots glow (mood right), the wild card
  players wait (mood idle: nobody is out yet).
- Phones: "You're through to Blackout" or "You're in the wild card round", with their rank. This is
  the only time a Round 1 rank shows on a phone.
- Default: **9 safe** at the event; **3** in the demo preset (so the wild card round runs with a few tabs).

### Wild card round
- Quizmaster clicks **Start wild card round**, then for each question exactly the Round 1 steps:
  Show question → 8s read → 8s answer → time's up → **Reveal answer** → optional **Show standings**
  → **Next question**. After the last one: **Reveal wild card**.
- Players: every participant with status `wildcard`. The 9 safe finalists don't answer; their
  phones say "You're safe. Watch the wild card fight".
- Phones show right / wrong per question plus their tally ("2 of 3 right"). No points, no rank.
- **Show standings** (optional): the top 10 by correct answers, then total answer time.
- **Winner after the planned questions (Default 5): most correct answers.** Tie → **lower total
  answer time** over those questions, where a wrong answer or a miss counts as the full answer
  time (so only the speed of correct answers matters).
- **Still exactly tied** (same correct count and same total time in ms): **sudden death** among only
  those players. It starts with the next click (the button reads "Next question (sudden death)").
  Wrong or no answer = out of the sudden death, but if everyone remaining is wrong they all stay in.
  At most **3** sudden-death questions. If more than one is left after that, the lowest total time
  over all their wild card questions wins; still tied, the better Round 1 rank wins.
- **Fallback:** if nobody got a single wild card question right, the wild card goes to the
  best-ranked Round 1 participant outside the top 9 (10th place) who isn't removed.
- **Reveal wild card** (click): the winner becomes a finalist (flagged as the wild card); every
  other wild card player becomes audience and their bots power down (mood out).
- Joining during the wild card round = audience.
- Questions: the quiz's **Wild card** list in order (in `data/questions.json`: tagged `round: 2`,
  then untagged ones not used yet). Default **5** at the event, **3** in the demo.

### Predictions (optional)
- **Open predictions**: every audience phone shows the 10 finalists as bots with names; tap one,
  changeable until **Start Blackout**. Host shows the live split. Finalists can't back anyone.

### Blackout (the chase)
- **Story:** the 10 finalists' bots run down the server corridor toward the camera while the rack
  lights die row by row behind them. When the dark reaches a bot, it powers down. The last bot
  standing escapes and wins.
- **Track:** whole steps. The dark starts at step 0. Each runner starts at `BASE_GAP` + a head
  start by Round 1 rank: ranks 1–3 → +2, ranks 4–9 → +1, the wild card → +0.
- **Each question, the quizmaster clicks:**
  1. **Show question** → 5s read (no options) → 8s answer (the 4 options numbered 1–4, the same
     order on the Host and every runner's phone; first tap locks) → time's up (holds; ends early
     when every runner still running has answered).
  2. **Reveal answer**: the correct answer shows and runners move. Correct: **+3** if the answer
     arrived in the first third of the answer time (elapsed < limit / 3), **+2** in the middle
     third, **+1** in the last third. Wrong: **−1** (never below step 0). No answer: **0**.
  3. **Advance the darkness**: the dark moves forward by `DARKNESS_STEPS[question]` (a config
     list). Every runner whose position ≤ the dark's new position is **caught**: they stay a
     finalist, `caughtOnQuestion` = this question's number, mood out.
  4. **Next question**, or **Show winner** once it's over.
- A runner who steps back onto or behind the dark at the reveal is **not** caught then; catches
  only happen at Advance the darkness (the drama stays in one beat).
- **Catch order** (for places): caught on a later question ranks higher. Caught on the same
  question: the one who was further ahead before the dark moved ranks higher; then lower total
  Blackout answer time (a wrong answer or miss counts as the full answer time); then better
  Round 1 rank.
- **The end:**
  - after Advance the darkness, exactly one runner left → they win;
  - every runner still running caught on the same question → the best of them by catch order wins;
  - two or more still running after the last planned question (Default 12) → the one furthest
    ahead wins; tie → lower total Blackout answer time; then better Round 1 rank.
  - **Show winner** is always a click, never automatic.
- Questions: the quiz's **Blackout** list (in `data/questions.json`: tagged `round: 3`, then
  untagged unused ones). Default **12** at the event plus **3 spares**, used only to replace voided
  questions. Demo: 6 questions and 1 spare.
- **Moods:** read → idle; answer → thinking (not answered) / locked (answered); time's up →
  locked / idle; reveal → right / wrong (no answer → idle); after the dark moves → caught runners
  out, survivors idle; podium → the winner right.
- **Runner phones:** Eyes up → the 4 options → Locked in → after the reveal "CORRECT +3" /
  "WRONG −1" / "Too slow: no move" (with "It was …" when wrong or missed) and their distance from
  the dark; after the dark moves "Still running: 2 steps ahead of the dark" or "The darkness got
  you" with their final place.
- **Audience phones:** who they backed, the runners still running with their distance, "7 still
  running".

### Podium
- **Show winner** (click). 1st = the Blackout winner; 2nd and 3rd = the next by the end rules and
  catch order; the other finalists below. Removed finalists aren't placed.
- Host: 1st–3rd on the podium, the rest below, confetti, and "38 of 70 called it" (audience
  members who backed the winner, out of those who backed anyone).
- Phones: "You won!", "2nd place", "3rd place", "You finished 7th in Blackout"; audience "You
  called it!" or "Your pick didn't win this time".

## Admin (quizmaster) controls

- One big **primary button** that always does the logical next step: Start quiz · Show question ·
  Reveal answer · Show results · Show leaderboard · Next question · End round 1 · Start wild card
  round · Show standings · Reveal wild card · Open predictions · Start Blackout · Advance the
  darkness · Show winner.
- Always visible: the current step, the timer, the current question **with its correct answer**,
  a preview of the next question, and in Blackout every runner's position and distance.
- **Pause / resume**, **+5 seconds**, **skip timer**.
- **Void question** (doesn't count): Round 1 → dropped. Wild card → the next unused question takes
  its number. Blackout → no moves and the dark doesn't move; the next spare takes its number. With
  no question left to replace it, the round ends one question early and the hint says
  "No spare questions left".
- **Restart question**: undoes that question's points / correct counts / moves / dark advance /
  catches and replays it from its read step with fresh ids.
- **Restart round**: Round 1 → everyone back to 0 at the Round 1 intro (until the cut). Wild card →
  tallies back to 0 (until Reveal wild card). Blackout → positions and the dark back to the start
  (until Show winner).
- **End quiz now**: before the cut → the Round 1 ranking on the podium; during the wild card round
  → the 9 safe finalists by Round 1 rank; during Blackout → runners still running by position,
  then caught ones by catch order.
- **Remove participant**: in the wild card round, removing the leader just takes them out. In
  Blackout a removed runner leaves the chase and isn't placed. **Before the first Blackout
  question**, removing a finalist gives their seat to the next-best person (the next Round 1 rank
  outside the finalists, or the wild card runner-up if the wild card round happened); backers'
  picks for the removed one are cleared.
- **Hide / show room code** on the Host, **sound on / off**.
- Live list of participants: connected, status, score, wild card tally, Blackout position, and a
  **left-page flag** (switched away from the quiz during a question; quizmaster only).
- **Results CSV**: name, result (winner / 2nd / 3rd / finalist / wildcard / played / audience),
  Round 1 score, Round 1 rank, wild card correct, wild card time (s), Blackout place, Blackout
  final position.
- Keyboard on a laptop: Space = primary button, P = pause / resume. Destructive actions (void,
  restart, end quiz, remove) need a second tap. No browser pop-ups.
- PIN protected (`ADMIN_PIN`, default 1234); after 5 wrong PINs the connection is refused.
  Several Admin devices can be signed in at once.

## Edge cases

- **A double tap or two Admin devices** never move a step twice (and never move the dark twice):
  every command carries the step it was sent from; a command from an old step is ignored.
- **Fewer than 10 Round 1 players:** no wild card round (see The cut).
- **Wild card with nobody right:** the fallback above.
- **Sudden death with everyone wrong:** they all stay in for the next one (up to 3).
- **Answers from anyone who can't answer the current question** (a finalist in the wild card
  round, a caught runner, the audience) are ignored by the server.
- **Removing a finalist mid-Blackout** takes them out of the chase; if that leaves one runner, the
  quizmaster can Show winner after the next Advance the darkness or straight away from the reveal.
- **Podium after End quiz now** uses the order for the round the quiz was in.

## Rules that don't change

- Participants and the Host never receive the correct answer before its reveal (only Admin does).
  Question and option ids are opaque random strings, new for every question run. Options are
  shuffled once per question and shown in that same order, numbered 1–4, on the Host and every
  phone. Answer times are measured on the server.
- Disconnects: reopening `/play` rejoins as the same participant (or type the same name).
- Phone screen stays awake during the quiz (Screen Wake Lock).
- Questions: MCQ only, exactly 4 options. Images appear on the Host only, preloaded.

## Look: "Server Corridor, Lights Low" (approved 11 Oct 2026)

The approved design, with every animation, is **`public/finaldesign.html`** (open
`http://localhost:3000/finaldesign.html` while `npm run dev` runs). Build every screen to match it.
Inspired by Jackbox's Murder Trivia 2; themed on the Hermes AI agent running a server room.

- **Background (Host):** a dark server-room corridor in one-point perspective: rack walls with dim
  mint and red LEDs, a red alarm pulse, a vignette, and dark pools behind the text. `<Corridor />`.
  Blackout uses the same corridor: the bots run toward the camera as the rack lights die behind them.
- **Layout (Host question screens):** question on the left, tilted; answers on the right with big
  amber numbers 1–4; the clock bottom-left with "38 / 64 answered"; the cast of bots across the top;
  `hermes://quiz` bottom-right. Read step: the question in the centre with the hint under it.
- **Type:** typewriter (Special Elite) for words; terminal digits (VT323) for numbers. Archivo only
  for dense Admin tables.
- **Colour:** void `#05080A`, mint `#6CF0B0`, amber `#FFB627` (answer numbers, counts, distances: the
  only warm colour), alarm red `#D6334D`, wrong `#FF4D5E`. Tokens in `src/app/globals.css`.
- **Bots:** idle, thinking, locked, right, wrong, out (powered down), decided by the server. `<Bot />`.
- **Timer:** a clock face with a red wedge for time used. `<TimerRing />`.
- **Phone:** dark teal gradient, typewriter type, mint-outlined answer buttons, solid mint action
  button, the participant's own bot on result screens.
- Animation with `motion`, numbers with `@number-flow/react`, confetti with `canvas-confetti`.
  Respect reduced motion. Host sound effects with a mute (sound is the first thing to cut if time runs out).
