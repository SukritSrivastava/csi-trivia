# Hermes Quiz: spec (v2)

v2 (11 Oct 2026): two rounds instead of five, a **6-player buzzer round** instead of a 2-player
duel, and the **quizmaster controls the whole flow** from the Admin screen. Anything below
marked **Default** is a setting in `mock-server/config.ts`, not a fixed rule.

## The three screens

| Screen | Route | Who sees it | What it does |
|---|---|---|---|
| **Host** | `/host` | everyone, on the projector | shows the quiz; has no game controls |
| **Participant** | `/play` | each player, on their phone | join, answer, buzz, back a finalist |
| **Admin** | `/admin` | the quizmaster only (PIN) | controls every step of the quiz |

## The event

- Club event, in person, one hall, projector driven by a laptop over HDMI.
- **60–100 participants**, solo, one phone each, after a workshop on the **Hermes AI agent**.
- Phones on a mix of college Wi-Fi and mobile data, so the **game server runs online**.
- Event is within a week. A teammate builds the real server in `server/` against
  `src/shared/protocol.ts`; `mock-server/` runs the whole quiz for local testing.

## Who controls what

The quizmaster drives everything from Admin. Nothing moves to the next step on its own, with
two exceptions that run on timers once the quizmaster starts them:

- Round 1: after **Show question**, the **8s read** then the **8s answer** run by themselves.
- Round 2: after **Show question**, the **read**, the **buzz window** and the **answer countdown**
  run by themselves. Judging Correct / Wrong is always a click.

When a timer ends, the screen holds and waits for the quizmaster's next click.

## Flow

```
Lobby → Round 1 (everyone) → Top 6 revealed → Audience backs a finalist → Round 2 (buzzer, 6) → Podium
```

### Lobby
- Host: room code tiles, QR code, join link, a wall of every name, a live player count.
- Participants join with room code + **real name**. An exact duplicate name is rejected
  ("add your surname initial, like Rahul S").
- Quizmaster clicks **Start quiz**.

### Round 1: everyone plays (MCQ)

For each question, the quizmaster clicks through these steps:

| Step | Started by | Host shows | Participant phone shows |
|---|---|---|---|
| Read | **Show question** (click) | question (+ image), 8s countdown, no options | "Eyes up", 8s countdown |
| Answer | automatic after the 8s read | question, 8s countdown, "38 / 64 answered" | 4 options, shuffled per phone; first tap locks |
| Time's up | automatic (8s over, or everyone answered) | "Time's up" | "Locked in" or "Time's up" |
| Reveal | **Reveal answer** (click) | the correct answer | right / wrong (no points, no rank) |
| Results | **Show results** (click) | bar chart: how many picked each option | unchanged |
| Leaderboard | **Show leaderboard** (click) | top 10 so far | unchanged |
| Next | **Next question** (click) | next question's read step | "Eyes up" |

- Results and Leaderboard are optional: **Next question** works from the reveal onward.
- After the last question: **End round 1**.
- **Questions in round 1:** every question in `data/questions.json` tagged round 1 or untagged.
  Default demo: the 3 demo questions.
- **Scoring:** correct = 500 to 1000 points, faster is more. Wrong or no answer = 0.
- **Ties:** lower total answer time ranks higher (a missed question counts as the full 8s).
- **Late joiners:** can join during Round 1 and play from the next question with 0 points.
  After Round 1 they join as audience.

### Top 6 revealed
- Host: the full ranked list with a **cut line under 6th**. Names above glow, names below fade.
- Phones: "You're in the top 6!" or "You're out" plus their rank (the only time a rank is shown).
- Default: **6 finalists** at the event, 3 in the demo preset (so the cut shows with 4 test tabs).
- Everyone outside the top 6 becomes **audience**.

### Audience backs a finalist
- Quizmaster clicks **Open predictions**. Every audience phone shows the 6 finalists; they tap one
  (can change until the buzzer round starts). Host shows the live split, e.g. "31% backing Riya".

### Round 2: 6-player buzzer round

Quizmaster clicks **Start buzzer round**, then for each question:

1. **Show question** (click). Host shows the question **and its 4 options (A–D)** so the room can
   play along. Default **5s read**: buzzers are locked.
2. **Buzzers open** automatically. Default **15s** window. All 6 finalists see a big BUZZ button.
3. **First buzz wins the turn.** Everyone else is locked out while that finalist answers.
   Host shows who buzzed. Default **10s countdown** while they **say the answer out loud**.
4. The quizmaster marks **Correct** or **Wrong** (the timer running out does NOT mark it; it waits).
   - **Correct:** +1 point. The answer is revealed.
   - **Wrong:** that finalist is **locked out for this question**, no points lost. Buzzers
     **reopen for the others** (default 10s window).
5. If everyone is locked out, or nobody buzzes in time, the answer is revealed and nobody scores.
6. **Show scores** (optional click), then **Next question**.

- Default: **10 questions** at the event (3 in the demo). Most points after the last one wins.
- **Tie for 1st after the last question:** sudden death. Only the tied finalists can buzz;
  first correct answer wins. Repeat until someone wins.
- Questions come from those tagged round 2 first, then untagged ones (the demo reuses its 3).
- Audience phones show the live scores of all 6 and who they backed.

### Podium
- Quizmaster clicks **Show winner** after the last question (or the tiebreak).
- Host: 1st, 2nd and 3rd on a podium, the other finalists below, confetti, and
  "38 of 70 audience members called it".
- Phones: "You won!", "2nd place", "3rd place", "You finished 5th in the final",
  or for the audience "You called it!" / "Your pick didn't win this time".

## Admin (quizmaster) controls

- One big **primary button** that always does the logical next step, with the step's name on it.
- Always visible: the current step, the timer, the current question **with its correct answer**,
  and a preview of the next question.
- **Pause / resume** any timer, **+5 seconds**, **skip timer**.
- **Void question** (cancel it: nobody gains or loses points), **restart question**, **restart round**.
- **Correct / Wrong** buttons in Round 2, and **Undo last mark** (reverts the point and lockout).
- **Remove participant**, **hide / show room code** on Host, **sound on / off** on Host,
  **end quiz now** (straight to podium).
- Live list of participants: connected, status, score, and a **left-page flag** (switched away from
  the quiz during a question; shown to the quizmaster only).
- **Results CSV** download (name, result, round 1 score and rank, buzzer points).
- Keyboard shortcuts on a laptop: Space = primary button, C = Correct, W = Wrong, P = pause/resume,
  U = undo last mark. Destructive actions (restart round, end quiz, remove) need a second tap to confirm.
  No browser pop-up dialogs.
- Protected by a PIN (`ADMIN_PIN`, default 1234). Several Admin devices can be signed in at once.

## Rules that don't change

- Participants never receive the correct answer before the reveal. Option ids are opaque.
  Options are shuffled per phone. Answer times are measured on the server.
- Disconnects: reopening `/play` rejoins as the same participant with the same score
  (or type the same name if the phone dropped).
- Phone screen stays awake during the quiz (Screen Wake Lock).
- Questions: MCQ only, 4 options, in `data/questions.json`. Images go in `public/questions/`
  and appear on Host only. The Host preloads the next question's image.

## Look

- Marigold game-show look from the prototype: marigold `#FFB627`, ink `#1B1340`, paper `#FFFBF0`
  cards with hard offset shadows, pink `#FF3D7F` and teal `#00A6A6` accents, Archivo with the
  wide width for headlines. Club logo can go in a corner later.
- Host text readable from the back of the hall.
- Animation with `motion`, numbers with `@number-flow/react`, confetti with `canvas-confetti`.
  Respect reduced motion. Host sound effects with a mute (build phase 4).
