# Hermes Quiz: frontend spec

Decisions from the requirements Q&A (11 Oct 2026). Lines marked **Assumed** were not
asked directly; change them if they're wrong.

## The event

- Club event, in person, one hall, projector driven by a laptop over HDMI.
- **60–100 players**, solo, one phone each, after a workshop on the **Hermes AI agent**.
- Phones on a mix of college Wi-Fi and mobile data, so the **game server runs online**
  (Render or similar), not on the laptop.
- Runs **automatically on timers**. An organiser page has emergency controls and judges the duel.
- Event is **within a week**. A teammate builds the backend against `src/shared/protocol.ts`.

## Game flow

Elimination format. **Every round starts at 0**; only that round's score decides who advances.

| Stage | Players | Advance | Questions | Time per question | Wrong answer |
|---|---|---|---|---|---|
| Round 1 | everyone (60–100) | top 30 | 10 | 20s | 0 points |
| Round 2 | 30 | top 15 | 8 | 20s | 0 points |
| Round 3 | 15 | top 10 | 6 | 15s | 0 points |
| Round 4 | 10 | top 5 | 5 | 15s | **−250** (Assumed amount) |
| Round 5 | 5 | top 2 | 5 | 12s | **−250** (Assumed amount) |
| Final duel | 2 | winner | first to 3 points | 15s to buzz, 10s to answer | see Duel |

- Questions get harder each round. No points multiplier (scores reset each round, so it wouldn't matter).
- **Assumed:** a round score can't go below 0.
- **Tie at the cut line:** whoever has the lower total answer time that round goes through.
- **Time check:** about 35 minutes of game time, roughly 45 with hosting talk. For closer to 60, add questions to Round 1.

## One question, step by step

1. **Read (4s):** projector shows the question (plus image if any). Phones show "Get ready".
2. **Answer (timer):** phones show the 4 options, **shuffled differently on every phone**.
   The projector shows the question, the timer, and an "answered" counter. The first tap locks in.
   The question ends early once every active player has answered.
3. **Correct answer (~3s):** projector shows the correct option text.
   Phones show **right or wrong only** (no points, no rank).
4. **Chart (~4s):** projector shows how many people picked each option, with the correct one highlighted.
5. **Top 10 (~5s):** projector shows the round's top 10 after every question.

## Scoring

- Correct: up to **1000 points**, more for faster answers (speed bonus).
- Wrong or no answer: 0 points (−250 in Rounds 4 and 5).

## End of round

- Projector: the **full ranked list with a red cut line**. Names above it glow, names below fade.
- Phones show each player's round rank and **"You made it"** or **"You're out"**.
  This is the only time phones show a rank.
- Knocked-out players become **audience**.

## Final duel

- Question shown on the projector. Both finalists have a **buzzer** on their phone (15s to buzz).
- The first to buzz has **10s to say the answer out loud**. The organiser marks it on the judge page.
  - **Correct:** +1 point. First to 3 points wins.
  - **Wrong:** they're in the **death zone**. The other finalist gets 10s to answer.
    If they're right, **they win the whole duel**. If they're also wrong, move on to the next question.
- Nobody buzzes in 15s: reveal the answer, then the next question.
- **Assumed:** duel questions show 4 options on the projector so the crowd can play along,
  and the finalist says the option out loud.
- **Assumed:** 9 duel questions are prepared; if they run out, the next correct buzz wins.

## Audience (knocked-out players)

- Before the duel, each audience member **backs one finalist** on their phone.
- Projector shows the split, e.g. "62% backing Riya". After the duel: "38 people called it".
- Late joiners: can still join **Round 1** with 0 points while it's running.
  After Round 1 they join as audience.

## Joining

- QR code + room code on the projector. Players enter their **real name** only.
- Duplicate name: the phone asks them to add a surname initial ("Rahul S").
- Lobby on the projector: a **wall of name tags** plus a big player counter.
- Disconnects: reopening the page rejoins as the same player with the same score.

## Organiser page (`/admin`, PIN protected, phone-friendly)

- Start quiz, **pause / resume**, **skip or void a question** (no points awarded),
  **remove a player**, **restart the current round**.
- **Duel judge:** two big buttons, Correct and Wrong.
- **Page-leave flags:** a list of players who left the quiz page while a question was open.
  Shown to the organiser only; nothing is shown to players.
- **Assumed:** a results CSV download (names, round reached, scores) for prizes.

## Questions

- MCQ only (4 options, one correct), mostly text with some images. Images appear **on the projector only**.
- Claude writes them from the **workshop slides**, getting harder each round.
- Needed: 10 + 8 + 6 + 5 + 5 = 34, plus 9 duel questions, plus 6 spares for voids, so **about 50 questions**.
- The projector preloads the next question's image so it appears instantly.

## Look and sound

- **Keep the prototype's game-show look** (approved): marigold `#FFB627` background,
  ink `#1B1340` text and outlines, paper `#FFFBF0` cards with hard offset shadows,
  pink `#FF3D7F` and teal `#00A6A6` accents, Archivo font with the wide width for headlines.
  The club logo can be added in a corner when it arrives.
- Projector text must be readable from the back of the hall.
- **Assumed:** sound effects and music on the projector laptop, with a mute button.

## Still needed from the team

- [ ] Workshop slides or notes (to write the questions)
- [ ] Club logo and colours
- [ ] Event date and hall (to test the hall's Wi-Fi and mobile signal beforehand)
- [ ] Backend teammate's name, so the protocol handoff is clear

## Build order (one week)

1. Rewrite `src/shared/protocol.ts` for the quiz, plus a **mock server**, so the frontend and backend can be built in parallel.
2. Phone: join, get ready, options, locked in, right/wrong, round result, audience pick, duel buzzer.
3. Projector: lobby wall, question + image, answer, chart, top 10, cut line.
4. Duel screens + organiser page.
5. Branding, questions, sound.
6. Load test with 100 simulated phones, then a real-phone test in the hall.
7. Buffer and rehearsal.
