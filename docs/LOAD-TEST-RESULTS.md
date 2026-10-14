# Load test results (15 Oct 2026, branch quiz-prep)

`npm run bot-load-test`: its own game server (event preset, `final_quiz.json`) in a separate process, bots
over Socket.IO exactly like phones, Admin clicking the big button, Round 1 question 5 skipped so a spare
plays. Bots answer at random times, some right, some wrong, ~7% never, ~7% after time's up, 15% double
taps, random ticks on multi-correct questions (15% never lock in), ~10% drop and rejoin in each round.
Every bot's Round 1 score, wild card tally and Blackout position is recomputed in the script from what it
sent and when. Real timings, one laptop (server and bots on the same machine).

| Run | Bots | Length | Deliveries (missing) | Round 1 scores exact (rest) | Late answers taken | Rejoins kept name + score | Server CPU avg / peak | Server memory (RSS) | Delivery median / p95 / max |
|---|---|---|---|---|---|---|---|---|---|
| seed 11 | 100 | 11.1 min | 2612 (0) | 95 (≤ 1 pt off: transit) | 0 of 195 | 30 / 30 | 0.9% / 34% | 81 → 85 MB | 0 / 2 / 5 ms |
| seed 22 | 100 | 11.4 min | 2618 (0) | 90 (≤ 2 pts off) | 0 of 175 | 30 / 30 | 1.1% / 15% | 82 → 85 MB | 1 / 2 / 5 ms |
| seed 33 | 150 | 12.1 min | 3928 (0) | 144 (≤ 1 pt off) | 0 of 254 | 45 / 45 | 1.4% / 55% | 102 → 216 MB | 1 / 2 / 5 ms |

All checks passed in every run: every bot got every question it could answer and every round change,
wild card tallies and Blackout positions matched, one winner, double taps counted once, no server errors.

`npm run phone-fit`: the 7 questions with the longest answers (up to 39 characters, plus a
multi-correct one) at 320×568, 360×640 and 375×667: no clipped text, no sideways scroll, LOCK IN in reach.

Not measured here: real phones on the hall Wi-Fi (latency there is the network's, not the server's),
and the hosted server on Render's free plan (512 MB; the 150-bot run peaked at 217 MB).
