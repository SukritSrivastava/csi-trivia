# Hermes Quiz: spec (v3.2)

**v3.2 (14 Oct 2026, late night): what changed.**
- **Multi-correct questions in Round 1.** A Round 1 question can have **2, 3 or all 4** right
  options. Players tick any number of options, then press **LOCK IN**; the server gives partial
  credit (`S × (found / total − 0.25 × wrong)`, never below 0), with **15 s** to answer. Players are
  told "Select ALL that apply", never how many are right. A question with exactly one right option
  plays exactly as before. The wild card and Blackout never have multi-correct questions. See
  [Multi-correct questions](#multi-correct-questions-round-1-only).

**v3.1 (14 Oct 2026, night): what changed.**
- **Round 1 scoring is 200 → 100:** correct = `round(200 − 100 × elapsed / limit)` (an instant
  answer scores 200, one at the last moment 100); wrong or none = 0.
- **Blackout runs on autopilot.** The quizmaster clicks **Start Blackout** once; the server runs
  every question (5 s read, **10 s to answer**), the reveal, the dark and the winner moment by
  itself, then shows the podium. No fixed question count: it plays every Blackout question until
  one runner is left. The quizmaster keeps Pause / Resume, Skip, +5 s, Void, Restart question,
  Restart round, End quiz now and Remove.
- **No glow:** light is flat and crisp (see Look).

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

The quizmaster drives Round 1 and the wild card round from Admin. Nothing moves to the next step on
its own there, except the timers that run once the quizmaster starts a question: after **Show
question**, the **8s read** then the **8s answer**. When a timer ends, the room holds and waits for
the quizmaster's next click.

**Blackout runs on autopilot** (v3.1): after **Start Blackout** every step starts by itself, each
held long enough for the Host animation, until the podium. The quizmaster can still pause it or fix
a mistake (see Admin controls).

An answer step ends early when everyone who can answer it has answered.

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
| Answer | automatic after the read | the 4 options numbered 1–4, 8s countdown, "38 / 64 answered" | the same 4 options in the same order (1–4); first tap locks (multi-correct: tick, then LOCK IN; 15s) |
| Time's up | automatic (8s over, or everyone answered) | "Time's up" | "Locked in" or "Time's up" |
| Reveal | **Reveal answer** (click) | the correct answer (multi-correct: every right one) | right / wrong (multi-correct: also "partly right"; no points, no rank) |
| Results | **Show results** (click, optional) | bar chart: how many picked each option | unchanged |
| Leaderboard | **Show leaderboard** (click, optional) | top 10 so far | unchanged |
| Next | **Next question** (click) | the next question's read step | "Eyes up" |

- **Scoring (v3.1):** correct = `round(200 − 100 × elapsed / limit)`, elapsed clamped to
  [0, limit]: an instant answer scores **200**, one at the last moment **100**, linear in between
  (4 s into 8 s = 150). Wrong or no answer = 0. Up to 4000 over 20 questions. The two numbers live
  in one place: `R1_MAX_POINTS` / `R1_MIN_POINTS` in `server/config.ts`.
- **Ties:** lower total answer time ranks higher (a miss counts as the full answer time).
- **Late joiners** play from the next question whose answers haven't opened yet (joining during a
  read step = they play that question); earlier questions count as missed for the tie-break.
- **End round 1** is allowed from any reveal onward (cut Round 1 short if the night runs late).
- Default: **20 questions** at the event, the 3 demo questions in the demo preset (the Demo quiz
  plays a single-answer question, a multi-correct one, then a single-answer one).

### Multi-correct questions (Round 1 only)

A Round 1 question with **2 or more right options** (2, 3 or all 4) is multi-correct. Exactly one
right option is a normal question and behaves exactly as above.

- **Where:** the Round 1 list only. The quiz editor, the imports, the server's checks (a quiz with
  one can't open a room), `data/questions.json` and `npm run check-questions` refuse a multi-correct
  question in the Wild card or Blackout list.
- **What players are told:** "Select ALL that apply" (phone) and "SELECT ALL THAT APPLY" (Host),
  from the answer step. **Never how many are right.** The read step looks like any other.
- **Answering:** a tap ticks or unticks an option (a mint square on the right; haptic on every tap).
  **LOCK IN** (a full-width button pinned to the bottom of the phone, disabled until something is
  ticked) sends the ticks. The first lock-in counts; later taps and lock-ins are ignored.
- **Drafts:** the server keeps each player's ticks as they change, so a refresh or reconnect brings
  them back. If the answer time ends before LOCK IN, the server sends the ticked options for them,
  **at the full time** ("Time's up. We sent your picks: 1, 3"). Nothing ticked = no answer.
- **Early end:** the answer step ends early when everyone who can answer has **locked in** (ticks
  without a lock-in don't count).
- **Timing:** **15 s** to answer (`MULTI_ANSWER_MS`), unless the question has its own answer time;
  the read time is unchanged. +5 s, Skip, Pause, Void and Restart question work as for any question
  (Void drops it; Restart takes its points back and plays it again with fresh ids and no ticks).
- **Scoring** (`multiPoints` in `server/config.ts`, constants beside it):
  - `S` = the question's normal speed score at the **lock-in**: `round(200 − 100 × elapsed / limit)`,
    elapsed clamped to [0, limit], limit = that question's answer time (with any +5 s).
  - `total` = right options, `found` = right options ticked, `wrong` = wrong options ticked.
  - **points = max(0, round(S × (found / total − 0.25 × wrong)))**, rounded once at the end
    (`MULTI_WRONG_PENALTY` = 0.25). Never below 0.

  | Right options | Ticked | When | Points |
  |---|---|---|---|
  | 4 | all 4 | instantly | 200 |
  | 4 | 2 right | instantly | 100 |
  | 2 | 1 right | instantly | 100 |
  | 2 | 1 right + 1 wrong | instantly | 50 |
  | 4 | all 4 | at the last moment | 100 |
  | 2 | all 4 (2 right + 2 wrong) | instantly | 100 (50% of S) |
  | 2 | both right | halfway (S = 150) | 150 |
  | 2 | 1 right + 1 wrong | halfway (S = 150) | 38 (37.5 rounded) |
  | 3 | 2 right | instantly | 133 |
  | 2 | 2 wrong only | any time | 0 |
  | 3 | 1 right + 2 wrong | any time | 0 (floored) |
  | any | nothing (no lock-in, no ticks) | — | 0, a miss |

  (One right option can't be multi-correct: that's a single-answer question.)
- **Ties** (unchanged): lower total answer time ranks higher. A multi-correct answer's time is the
  lock-in time, or the full time when the server sent the ticks at time's up; a miss counts as the
  full time. An answer worth 0 points still counts as answered (for "answered" and the early end).
- **After the reveal**, per player: **correct** (every right option, no wrong one), **partly
  right** (some points, not perfect), **wrong** (answered, 0 points) or **missed** (no answer). The
  cut, the leaderboard and the ranking use the points exactly as before.
- **Bot mood** (server): **right** if the points are at least half of `S` (what a perfect answer at
  that moment would have scored), else **wrong**; a miss keeps Round 1's miss mood.
- **Who sees what:**
  - Phone: answer = the 4 options with the amber numbers and a tick square, "Select ALL that
    apply", LOCK IN; after LOCK IN the ticks freeze, the rest dim to 40%, the bot's eyes shut,
    "Locked in: 1, 3". Result: CORRECT, PARTLY RIGHT ("You got 2 of 3 right", "1 wrong pick"), WRONG
    or TOO SLOW, always with "The right answers: 1 and 3. {text}; {text}". No points, no rank.
  - Host: SELECT ALL THAT APPLY under the question from the answer step, "38 / 64 locked in"; at the
    reveal every right option is lit with a mint check, the others dim; the results chart counts
    every tick and marks every right option; the leaderboard is unchanged.
  - Admin: the question card marks every right option, a "Multi-correct: N right" tag, pick counts
    after the reveal, "locked in 41 / 64 · N ticking"; Next up lists every right answer.
- **Contract:** `participant:select { questionId, optionIds }` (drafts) and `participant:answer
  { questionId, optionIds }` (LOCK IN); single-answer questions keep `participant:answer { questionId,
  optionId }`. The phone's answer screen carries the player's own ticks (`multi.selectedIds`): their
  own data, not a leak.

### The cut
- Ranked by Round 1 score, then lower total answer time. **Ranks 1–9 are safe: finalists.**
- Everyone else who joined before the cut and isn't removed plays the **wild card round** (status
  `wildcard`). Anyone joining after the cut joins as **audience**.
- **Fewer than 10 played Round 1:** everyone who played is a finalist and the wild card round is
  skipped (Admin's next step becomes Open predictions / Start Blackout).
- Host: the ranked list with the cut line under 9th; the safe bots light up (mood right, mint
  names), the wild card players wait (mood idle: nobody is out yet).
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
- **Autopilot (v3.1).** The quizmaster clicks **Start Blackout** once. The server then runs every
  step by itself; every duration lives in `server/config.ts`:
  0. **Intro**: the runners at their start positions, held **6 s**.
  1. **Read**: **5 s**, the question, no options.
  2. **Answer**: **10 s**, the 4 options numbered 1–4 (the same order on the Host and every
     runner's phone; first tap locks). Ends early once every runner still running has answered.
  3. **Time's up**: held **1.5 s**.
  4. **Reveal**: the correct answer shows and runners move. Correct: **+3** if the answer arrived
     in the first third of the answer time (elapsed < limit / 3, so < 3.33 s of 10 s), **+2** in
     the middle third, **+1** in the last third. Wrong: **−1** (never below step 0). No answer:
     **0** (they stay put). Held **3 s + 0.15 s per runner still running**.
  5. **The dark moves** forward by `DARKNESS_STEPS[question]` (a config list; past its end, its
     last value repeats). Every runner whose position ≤ the dark's new position is **caught**:
     they stay a finalist, `caughtOnQuestion` = this question's number, mood out. Held **2.5 s +
     0.25 s per step the dark moved + 1.5 s if anyone was caught**.
  6. Then the next question's read step starts by itself, or, once it's over, the **winner
     moment** (held **7 s**) and then the **podium**, by itself.
- A runner who steps back onto or behind the dark at the reveal is **not** caught then; catches
  only happen when the dark moves (the drama stays in one beat).
- Every autopilot step gets a new step id, so a stale Pause / Skip / Void sent from a step that
  has already passed is ignored, and a double tap never skips two steps.
- **Catch order** (for places): caught on a later question ranks higher. Caught on the same
  question: the one who was further ahead before the dark moved ranks higher; then lower total
  Blackout answer time (a wrong answer or miss counts as the full answer time); then better
  Round 1 rank.
- **The end** (the winner moment and the podium follow by themselves in every case):
  - after the dark moves, exactly one runner left → they win;
  - every runner still running caught on the same question → the best of them by catch order wins;
  - the questions run out with two or more still running → the one furthest ahead wins; tie →
    lower total Blackout answer time; then better Round 1 rank.
- Questions: the quiz's **Blackout** list, in order (in `data/questions.json`: every question
  tagged `round: 3`, then untagged unused ones). **No fixed count and no spares:** questions keep
  coming until the chase ends; a voided question simply doesn't count and the next one comes. The
  event needs **at least 12** Blackout questions to open a room (the server warns below 15). Demo:
  at least 8 (the demo reuses its few questions).
- Tuning (from `npm run tune-blackout`, 10 s answers): event `BASE_GAP` 6, `DARKNESS_STEPS`
  [1, 2, 2, 3] (3 from then on): the first catch around Q3–4, decided around Q10. Demo `BASE_GAP` 2,
  [1, 2].
- **Moods:** read → idle; answer → thinking (not answered) / locked (answered); time's up →
  locked / idle; reveal → right / wrong (no answer → idle); after the dark moves → caught runners
  out, survivors idle; podium → the winner right.
- **On the projector** (Sukrit, 14 Oct): the question and its options stay on screen at the top
  the whole time, and under them the chase runs **left to right**: every finalist (all 10) has a
  lane and runs right toward the EXIT; the dark is a black wall coming in from the left that
  covers the rack lights as it advances; whoever it reaches is caught.
- **Runner phones show only the question and its options** (Sukrit, 14 Oct): while answering, the
  question text above the 4 numbered options (the tapped one stays locked, even after a refresh);
  every other Blackout step is a plain "Eyes on the screen"; a caught runner sees "You're out"
  with their place. No distances or results on the phone: the chase is on the projector.
- **Audience phones:** who they backed, the runners still running with their distance, "7 still
  running", "{name} got caught".

### Podium
- Arrives **by itself** after Blackout's winner moment. 1st = the Blackout winner; 2nd and 3rd = the next by the end rules and
  catch order; the other finalists below. Removed finalists aren't placed.
- Host: 1st–3rd on the podium, the rest below, confetti, and "38 of 70 called it" (audience
  members who backed the winner, out of those who backed anyone).
- Phones: "You won!", "2nd place", "3rd place", "You finished 7th in Blackout"; audience "You
  called it!" or "Your pick didn't win this time".

## Admin (quizmaster) controls

- One big **primary button** that always does the logical next step: Start quiz · Show question ·
  Reveal answer · Show results · Show leaderboard · Next question · End round 1 · Start wild card
  round · Show standings · Reveal wild card · Open predictions · Start Blackout. During the
  Blackout autopilot it is **Pause / Resume**, with an "AUTOPILOT" strip showing the step and the
  countdown to the next one. Advance the darkness and Show winner are gone (the autopilot does
  them); sending them, or Show question / Reveal answer / Next question, in Blackout is refused.
- In Blackout Admin also sees where the dark goes next and who it would catch (only Admin).
- Always visible: the current step, the timer, the current question **with its correct answer**,
  a preview of the next question, and in Blackout every runner's position and distance.
- **Pause / resume** (in Blackout it freezes whichever step or hold is running, on every screen;
  Resume carries on from the same moment), **+5 seconds** (answer steps; in Blackout only while
  answering), **skip** (ends the current timer or Blackout hold now).
- **Void question** (doesn't count): Round 1 → dropped. Wild card → the next unused question takes
  its number. Blackout (during its read, answer or time's up) → no moves and the dark doesn't move;
  "cancelled" shows for 3 s, then the next question takes its number. If no question is left, the
  chase ends there (furthest ahead wins).
- **Restart question**: undoes that question's points / correct counts / moves and replays it from
  its read step with fresh ids. In Blackout: during its read, answer, time's up or the reveal hold
  (not once the dark has moved).
- **Restart round**: Round 1 → everyone back to 0 at the Round 1 intro (until the cut). Wild card →
  tallies back to 0 (until Reveal wild card). Blackout → positions and the dark back to the start,
  and the autopilot starts again from the intro (until the winner moment).
- **End quiz now**: before the cut → the Round 1 ranking on the podium; during the wild card round
  → the 9 safe finalists by Round 1 rank; during Blackout → runners still running by position,
  then caught ones by catch order.
- **Remove participant**: in the wild card round, removing the leader just takes them out. In
  Blackout a removed runner leaves the chase and isn't placed; if that leaves one runner, the
  winner moment starts straight away. **Before the first Blackout
  question**, removing a finalist gives their seat to the next-best person (the next Round 1 rank
  outside the finalists, or the wild card runner-up if the wild card round happened); backers'
  picks for the removed one are cleared.
- **Hide / show room code** on the Host, **sound on / off**.
- Live list of participants: connected, status, score, wild card tally, Blackout position, and a
  **left-page flag** (switched away from the quiz during a question; quizmaster only).
- **Results CSV**: name, result (winner / 2nd / 3rd / finalist / wildcard / played / audience),
  Round 1 score, Round 1 rank, wild card correct, wild card time (s), Blackout place, Blackout
  final position.
- After any of these the Blackout autopilot carries on by itself; after Pause it waits for Resume.
- Keyboard on a laptop: Space = primary button (Pause / Resume in Blackout), P = pause / resume,
  S = skip (Blackout). Destructive actions (void,
  restart, end quiz, remove) need a second tap. No browser pop-ups.
- PIN protected (`ADMIN_PIN`, default 1234); after 5 wrong PINs the connection is refused.
  Several Admin devices can be signed in at once.

## Edge cases

- **A double tap or two Admin devices** never move a step twice: every command carries the step it
  was sent from; a command from an old step is ignored (Pause and Skip included, so a Pause aimed
  at a Blackout step that has already passed does nothing).
- **Fewer than 10 Round 1 players:** no wild card round (see The cut).
- **Wild card with nobody right:** the fallback above.
- **Sudden death with everyone wrong:** they all stay in for the next one (up to 3).
- **Answers from anyone who can't answer the current question** (a finalist in the wild card
  round, a caught runner, the audience) are ignored by the server.
- **Removing a finalist mid-Blackout** takes them out of the chase; if that leaves one runner, the
  winner moment starts straight away.
- **Podium after End quiz now** uses the order for the round the quiz was in.
- **Multi-correct, time's up with ticks but no LOCK IN:** the server sends the ticks at the full
  time (partial credit is possible). Ticked then unticked everything = no answer.
- **Multi-correct, Void / Restart question:** Void takes the points back (and the time); Restart
  also clears every player's ticks and plays it again with new ids (an old lock-in is ignored).
- **Multi-correct, a removed participant** with ticks: not scored, not waited for (the step can end
  early without them).
- **Multi-correct, a late joiner** (joined after the answers opened): plays from the next question,
  like any late joiner; their taps on this one are ignored.

## Rules that don't change

- Participants and the Host never receive the correct answer before its reveal (only Admin does).
  Question and option ids are opaque random strings, new for every question run. Options are
  shuffled once per question and shown in that same order, numbered 1–4, on the Host and every
  phone. Answer times are measured on the server.
- Disconnects: reopening `/play` rejoins as the same participant (or type the same name).
- Phone screen stays awake during the quiz (Screen Wake Lock).
- Questions: MCQ only, exactly 4 options. One right option, except Round 1's multi-correct
  questions (2–4 right options). Images appear on the Host only, preloaded.

## Look: "Server Corridor, Lights Low" (approved 11 Oct 2026; no glow since 14 Oct)

The approved design, with every animation, is **`public/finaldesign.html`** (open
`http://localhost:3000/finaldesign.html` while `npm run dev` runs). Build every screen to match it.

- **No glow: light is flat and crisp** (Sukrit, 14 Oct). No text-shadow halos, no blurred or
  coloured-spread box-shadows, no drop-shadow / blur halos, no radial blooms around LEDs, lights,
  bots, buttons or text, no pulsing glows. Light is solid fills, 1–2 px solid borders, colour and
  opacity changes. Allowed: hard offset shadows with zero blur (the clock's `4px 4px 0` mint), the
  dark scrims behind text and the vignette, and the alarm's flat colour/opacity flicker. Where an
  older rule says "glow" (names above the cut, the leader, a selected option, the right mood) it
  means a solid mint outline, mint text or a mint fill. `npm run check-glow` enforces it.
Inspired by Jackbox's Murder Trivia 2; themed on the Hermes AI agent running a server room.

- **Background (Host):** a dark server-room corridor in one-point perspective: rack walls with dim,
  hard-edged mint and red LEDs, a flat red alarm flicker, a vignette, and dark pools behind the
  text. `<Corridor />`.
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
