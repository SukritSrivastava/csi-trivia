# Frontend build: 3 phases

Paste these into Claude Code in VS Code, opened in the `JacKboX` folder, one at a time.
Only paste the next prompt after you've tested and approved the current phase.

---

## Prompt 1: Foundation and the phone controller

```
You're a senior frontend engineer with 20 years of experience in realtime and game-show UIs. We're building the frontend of a Jackbox-style live MCQ quiz for 60–100 players. Read docs/SPEC.md first: it's the source of truth for the rules. CLAUDE.md has the codebase rules.

This is Phase 1 of 3: the foundation and the phone controller.

Ground rules for every phase:
- NEVER git push. Commit locally only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test before calling a phase done. Stop at the end of the phase and wait for my approval.
- Keep the current look: the marigold game-show style from the prototype (colours and shared classes are in src/app/globals.css).
- Questions: only 3 demo MCQs for now, in one JSON file so I can swap in the real ones later.
- Install any packages you need. Suggested: motion (animations), @number-flow/react (animated scores), canvas-confetti, howler (sound). Use current stable versions.

Tasks:
1. Git: this folder isn't a repo yet. Run git init, add https://github.com/Leleouch14/jackbox_2.0.git as origin (it's empty), create a branch called frontend, and commit the current prototype as the starting point. Don't push.
2. Rewrite src/shared/protocol.ts for the quiz in SPEC.md: lobby, read time, answering, reveal, chart, top 10, end-of-round cut, audience prediction, duel, podium, and the admin events. Every phone gets its own view. The correct answer is never in a phone's view before the reveal. Options are shuffled per player. My backend teammate builds the real server against this file, so comment it clearly.
3. Build a mock game server in mock-server/ (separate from server/, which belongs to my teammate) that runs the whole game from that protocol, so I can test the frontend alone. Put round settings (questions per round, cut sizes, timers) in one config file with two presets: "event" (exactly as SPEC.md) and "demo" (3 rounds using the 3 demo questions, cuts that work with 4–6 test players, then the duel). npm run dev should start the site and the mock server using the demo preset.
4. Remove the old comedy-game screens and logic that no longer apply.
5. Build every phone screen (/play): join (room code + real name; a duplicate name asks for a surname initial), lobby, get ready (read time), answer (4 big option buttons, shuffled, first tap locks), locked in, right/wrong, round result ("You made it" / "You're out" + rank), audience (back a finalist before the duel), and the end screen. Mobile-first, big tap targets, safe with the keyboard open, works on iPhone Safari and Android Chrome, screen wake lock on, auto-rejoin after a refresh.
6. Leave simple placeholder projector screens for now (Phase 2 builds them properly), just enough to run a full game.
7. Run npm run typecheck and npm run build, fix every error, start the dev server, and play a full demo game with 4 browser tabs as players. Then give me the URLs (laptop, and phone on the same Wi-Fi) and what to check. Wait for my approval.
```

---

## Prompt 2: Projector screens and motion

```
Phase 2 of 3: the projector screens and motion. Same ground rules as Phase 1: never push, run locally, give me URLs, stop and wait for approval. Read docs/SPEC.md and the current src/shared/protocol.ts first.

Build every /host (projector) screen in the marigold game-show style, readable from the back of a hall (big type, high contrast, nothing important smaller than about 2rem on a 1080p projector):
1. Lobby: big room code tiles, QR code, join link, a wall of name tags that fits 100 names without overflowing, and a big live player counter.
2. Round intro: round number, how many go through, time per question.
3. Question: 4 seconds of read time (question + image, no options on the projector), then the answer phase with a countdown ring and a live "38 / 64 answered" counter. Preload the next question's image.
4. Reveal sequence: correct answer, then an animated bar chart of how many picked each option (correct one highlighted), then the round's top 10 with rows animating into their new positions.
5. End of round: the full ranked list with a red cut line. Names above it glow, names below fade, with a short dramatic reveal.
6. Before the duel: the audience prediction split (e.g. "62% backing Riya"), updating live.
7. One consistent motion language across every screen (Motion; layout animations for leaderboards; animated numbers for scores), respecting prefers-reduced-motion. Add sound effects (tick, reveal, cut, win) with a mute button, started after the host's first click.
8. Write a bot script (scripts/bots.ts) that joins N fake players (default 80) to the mock server and answers randomly, so we can see the lobby wall and leaderboards at full scale.
9. Typecheck, build, then run a full demo game with 80 bots + 2 real tabs. Screenshot every projector screen, review them yourself, and fix anything that looks off. Then give me the URLs and wait for approval.
```

---

## Prompt 3: Duel, organiser page and hardening

```
Phase 3 of 3: the final duel, the organiser page, and making it event-proof. Same ground rules: never push, run locally, give me URLs, wait for approval. Read docs/SPEC.md and src/shared/protocol.ts first.

1. Duel on the projector: the two finalists face off, first to 3 points. Show the question with 4 options (so the crowd plays along), the 15s buzz timer, who buzzed, the 10s answer timer, the death-zone state and the score. Make it the most dramatic screen of the night.
2. Duel on phones: finalists get one huge buzzer button; everyone else sees who's backing whom and a live duel view.
3. Winner: a podium with the winner and runner-up, confetti, and how many audience members called it.
4. Organiser page (/admin, PIN protected, phone-friendly): start quiz, pause/resume, skip or void a question, remove a player, restart the current round, duel Correct / Wrong buttons, a list of players flagged for leaving the page mid-question, and a results CSV download.
5. Phones report when the quiz page is hidden during a question. This is a flag for the organiser only, never shown to players.
6. Hardening: reconnect after a refresh or a locked phone, an offline banner, server-unreachable states, a room that has already ended, slow networks (test with DevTools throttling), small phones (iPhone SE size), accessibility (focus states, contrast, screen-reader labels), and reduced motion.
7. Update README.md with how to run it, and add docs/BACKEND-NOTES.md listing every event and view in protocol.ts for my backend teammate.
8. Full rehearsal: projector tab + organiser in a phone-sized window + 4 player tabs + 80 bots, one complete demo game from lobby to podium. Typecheck and build must pass. Give me the URLs and a checklist to test with my own phone, then wait. Still don't push until I say "push".
```
