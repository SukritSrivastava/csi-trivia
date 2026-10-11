# Frontend build: 5 phases (v3)

v3 (11 Oct 2026): five phases for the v2 rules (2 rounds, 6-player buzzer round, quizmaster
controls everything from Admin). Rules: docs/SPEC.md (v2).

Paste these into Claude Code in VS Code, opened in the JacKboX folder, one at a time, in order.
Only paste the next prompt after you've tested and approved the current phase.

| Phase | Builds | You test it by |
|---|---|---|
| 1 | Setup, the contract (protocol.ts), the mock game server, tests, bots | clicking through a game on plain temporary pages |
| 2 | Admin screen (quizmaster control panel) | running a whole quiz from your phone |
| 3 | Participant screens (phones) | playing on your own phone |
| 4 | Host screens (projector), motion and sound | watching a game with 80 bots on a big screen |
| 5 | Failure drills, scale test, docs, run sheet | a full rehearsal |

---

## Prompt 1: Foundation

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Keep the look: the marigold game-show style (tokens and shared classes in src/app/globals.css).
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 1 OF 5: FOUNDATION (setup, the contract, the mock game server)
Goal: a rock-solid game engine and contract that every later phase, and my backend teammate, build on. No visual work in this phase.

1. Setup
- Check node -v is 20.9 or newer. If git isn't installed, tell me to run "winget install Git.Git" and stop.
- If this folder isn't a git repo yet: git init, add https://github.com/Leleouch14/jackbox_2.0.git as origin, create and switch to a branch called frontend, and commit the current state as "Starting point" before changing anything.
- Delete these leftover files from the old comedy prototype if they still exist: server/game.ts, server/index.ts, server/prompts.ts, server/rooms.ts, server/simulate.ts, server/network.ts, src/components/host/AnswerStage.tsx, EndStage.tsx, IntroStage.tsx, PromptHeader.tsx, RevealStage.tsx, ScoresStage.tsx, VoteStage.tsx, and src/components/play/AnswerScreen.tsx, EndScreen.tsx, LobbyScreen.tsx, VoteScreen.tsx, WaitScreen.tsx.
- Run npm install.

2. The contract: rewrite src/shared/protocol.ts for SPEC v2. My backend teammate builds the real server against it, so comment every type and event. It must include:
- Every phase and step of the flow: lobby; round 1 read, answer, time's up, reveal, results, leaderboard; end of round 1 with the cut; predictions; buzzer round read, buzzers open, answering, reveal, scores; sudden death; podium.
- HostView: join URL, room code shown or hidden, sound on or off, the lobby name list, counts, timer, paused, the next image to preload, and the current stage.
- ParticipantView: each phone's own private screen. Never the correct answer before the reveal; option ids opaque; options shuffled per phone.
- AdminView: the current step and its plain-words label; a stepId; the primary action (label + command) computed by the server; which other actions are allowed right now; timer; paused; the current question WITH its correct answer; a preview of the next question; live counts (joined, answered, buzzed); the participant list (connected, status, score, left-page count); round 2 state (finalists, points, who buzzed, who's locked out, whether the last mark can be undone); room-code visibility; sound state.
- Events: Host create and resume. Participant join (with rejoin), answer, buzz, back a finalist, page hidden or shown. Admin sign-in with room code + PIN, and every admin command in SPEC: next step, pause, resume, +5s, skip timer, void question, restart question, restart round, correct, wrong, undo last mark, remove participant, show or hide room code, sound on or off, end quiz now, results CSV.
- Every admin command carries the stepId it was issued from, and the server ignores commands for a stale step. This stops a double tap, or two Admin devices, from skipping two steps.

3. The mock game server (mock-server/), rewritten around Admin commands
- quiz.ts: the whole state machine, no socket code, injectable clock. Timers only for: round 1 read then answer (the answer step ends early once every connected participant still in the round has answered); round 2 read, buzz window, answer countdown and reopen window. When a timer ends the game holds for the quizmaster. The spoken-answer countdown never marks anything by itself.
- config.ts with two presets. "event": all round-1 questions, read 8s, answer 8s, 6 finalists, 10 buzzer questions, buzzer read 5s, buzz window 15s, answer countdown 10s, reopen window 10s. "demo": the 3 demo questions in round 1, 3 finalists (so the cut shows with 4 test tabs), 3 buzzer questions, same timings. Every timing and count lives here. The GAME_PRESET env var picks one; npm run dev uses demo.
- questions.ts: loads and validates data/questions.json (round 1, round 2 or untagged; exactly 4 options; correct index 0–3) with clear error messages.
- rooms.ts and index.ts: the Socket.IO glue; several Admin devices per room; only send a view to a socket when it changed (100 phones); ADMIN_PIN env var (default 1234); print the Host, Admin and Participant URLs on start.
- Scoring, ranking, ties, late joiners, the cut, predictions, buzzer rules, sudden death, podium places and the results CSV exactly as in SPEC.md.

4. Tests and tools
- mock-server/simulate.ts (npm run simulate), with a fake clock, checks: a full event game with 80 participants; a full demo game with 4; speed scoring (instant about 1000, last moment about 500, wrong 0); the cut to 6 with a tie broken by answer time; late joiners; buzzer wrong, lockout, reopen, correct; everyone wrong; nobody buzzes; a tie for 1st going to sudden death; undo last mark; pause/resume, +5s, skip, void, restart question, restart round, remove participant, end quiz now; a stale stepId being ignored; and that no Participant view ever contains the correct answer before the reveal.
- scripts/smoke.ts (npm run smoke): starts its own mock server on a spare port so it runs standalone, then over real Socket.IO creates a room as Host, signs in as Admin, joins 4 participants, plays the whole demo game through Admin commands, and checks the key views along the way, including one participant reconnecting mid-question.
- scripts/bots.ts (npm run bots -- --room ABCD --count 80): joins N fake participants to a running server; they answer at random speeds, buzz at random and back a random finalist. Later phases use it to test at full scale.

5. Keep the app building
- The real screens come in Phases 2–4. For now, replace /host, /play and /admin with minimal temporary pages that connect and show the current step plus the raw view (pretty-printed), with plain buttons for every Participant and Admin action, so a whole game can be clicked through by hand.
- Keep the reusable pieces (socket, session storage, wake lock, confetti, format helpers, Avatar, TimerRing, globals.css, next.config.ts). Delete screen components that no longer fit; git history keeps them.
- Update README.md: how to run, the three screens, the presets, every npm script. Only change docs/SPEC.md if you find a real gap, and tell me what you changed.

6. Verify, then report
- typecheck, build, simulate and smoke all pass.
- npm run dev, then click through one full demo game on the temporary pages with 1 Host tab, 1 Admin tab and 2 Participant tabs, plus 20 bots from npm run bots.
- Report the URLs and a short list of things for me to try, then wait for my approval.
```

---

## Prompt 2: Admin screen

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Keep the look: the marigold game-show style (tokens and shared classes in src/app/globals.css).
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 2 OF 5: THE ADMIN SCREEN (the quizmaster's control panel)
Goal: the quizmaster can run the whole quiz from a phone held in one hand in a dark hall, or from a laptop, without ever wondering what the next click will do. This is the most important screen on the day. It replaces the temporary /admin page from Phase 1. Build it on AdminView from src/shared/protocol.ts; if the contract is missing something Admin needs, add it there, implement it in the mock server and tell me.

1. Sign in: room code (prefilled from /admin?code=ABCD) and PIN. Stays signed in after a refresh. Clear errors.
2. Layout, phone first (390×844 and 360×740), with a two-column layout on a laptop:
   - Top: the current step in plain words (e.g. "Round 1, question 3 of 20: answering"), the timer, an unmissable PAUSED state, and connection status.
   - Middle: the current question with its correct answer highlighted, a small preview of the next question, and live counts: joined, answered (e.g. 41 / 64), buzzed.
   - Bottom, always in the same place and within thumb reach: the big primary button, labelled with exactly what it will do ("Show question", "Reveal answer", "Show results", "Show leaderboard", "Next question", "End round 1", "Open predictions", "Start buzzer round", "Start sudden death", "Show winner").
3. Round 2 judging: when a finalist buzzes, a judge panel takes over the middle: their name and colour, the correct answer, the answer countdown, and two huge buttons, Correct and Wrong. "Undo last mark" stays visible until the next step. Show the 6 finalists with their points and who's locked out.
4. Secondary controls, one tap away and never next to the primary button: pause/resume, +5s, skip timer, void question, restart question, restart round, show/hide room code on Host, sound on/off on Host, end quiz now, results CSV download. Destructive ones (void, restart round, end quiz, remove participant) need a second tap to confirm, shown inline and cancelling itself after 3 seconds. No browser alert or confirm dialogs.
5. Participants panel: search by name; filter (all, playing, audience, finalists, left page, offline); connected dot, status, score, left-page count, and remove (with confirm). Must stay fast with 100 names.
6. Keyboard shortcuts on a laptop: Space = primary button, C = Correct, W = Wrong, P = pause/resume, U = undo last mark, all ignored while typing in an input. Show them in a small help line on wide screens.
7. Safety: disable the primary button while a command is in flight and ignore a second tap within 600 ms; send the stepId with every command; several Admin devices stay in sync; reconnect without losing your place.
8. Look: dark ink background, marigold primary button, paper cards, high contrast, big targets (main actions at least 56 px tall), no tiny text. Same visual language as the rest of the app.

Verify
- Demo preset with 30 bots (npm run bots) and the temporary Host page: run a full game from Admin only. Include a pause, +5s, a void, a restart question, a wrong buzz then a correct one, an undo, a remove, and go all the way to the podium. Repeat some steps with two Admin tabs open at once, and with fast double taps.
- Part of the event preset with 80 bots, to check the participants panel at scale.
- Playwright screenshots of Admin at 390×844, 360×740 and 1440×900 in each major state: lobby, round 1 answering, reveal, end of round 1, predictions, buzzers open, judging, podium. Review them like a demanding product designer and fix what's off.
- typecheck, build, simulate and smoke pass. Then report and wait for my approval.
```

---

## Prompt 3: Participant screens

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Keep the look: the marigold game-show style (tokens and shared classes in src/app/globals.css).
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 3 OF 5: THE PARTICIPANT SCREENS (the phone)
Goal: anyone in the hall can join in 20 seconds and always knows exactly what to do, on any phone, on bad Wi-Fi. This replaces the temporary /play page from Phase 1. Build it on ParticipantView from src/shared/protocol.ts, and reuse the earlier phone screens from git history where they fit.

1. Join: room code (prefilled from the QR link /play?code=ABCD) and real name. Big inputs, works with the keyboard open, clear errors (wrong code; duplicate name, so add a surname initial; quiz ended; removed). Remembers the last name typed.
2. Every state, each with short, clear copy:
   - lobby ("You're in", your colour tag, how many have joined); round 1 intro; eyes up (read countdown);
   - answer (4 big buttons, a colour per position, shuffled per phone; the first tap locks and shows as locked instantly); locked in; time's up; right or wrong (no points);
   - end of round 1: in the top 6, or out, with their rank (the only time a rank shows);
   - audience backing (the 6 finalists; can change until the buzzer round starts);
   - finalist buzzer: locked during the read; a huge BUZZ button while open; "You buzzed! Say your answer out loud"; "Riya buzzed"; "Locked out this question"; correct or wrong result;
   - audience view of the buzzer round (live scores of the 6, who buzzed, who you backed);
   - podium result (You won! / 2nd place / 3rd place / you finished Nth in the final / You called it! / your pick didn't win); removed; quiz ended.
3. Feel: a short transition between screens (motion), instant pressed states, haptics on Android for answer and buzz (navigator.vibrate, only after the person has tapped), confetti for making the top 6 and for winning, and a timer bar in the header. Respect reduced motion.
4. Reliability: screen wake lock during the quiz (re-acquired when the page becomes visible again); auto-rejoin after a refresh or a locked phone; "Reconnecting…" and "Paused by the quizmaster" banners; report page hidden/shown during a question (never shown to the participant).
5. Sizes: works at 360×640, 375×667 (iPhone SE), 390×844 and 430×932, in iPhone Safari and Android Chrome. Nothing cut off, no horizontal scroll, safe areas respected, inputs at least 16 px so iPhone doesn't zoom in.

Verify
- A full demo game with 4 real Participant tabs, Admin, the temporary Host page and 20 bots: joining, every round 1 state, the cut (both making it and being out), backing, the whole buzzer round as a finalist (buzzing first, buzzing second, wrong then locked out, correct) and as audience, and the podium.
- Refresh a Participant mid-question and mid-buzzer-round: it must come back to the same place with the same score.
- Playwright screenshots of every state at 375×667 and 390×844. Review them like a demanding product designer and fix what's off.
- Tell me the LAN address so I can open /play on my own phone, and exactly what to try.
- typecheck, build, simulate and smoke pass. Then report and wait for my approval.
```

---

## Prompt 4: Host screens, motion and sound

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Keep the look: the marigold game-show style (tokens and shared classes in src/app/globals.css).
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 4 OF 5: THE HOST SCREENS (the projector), MOTION AND SOUND
Goal: the projector is the show. It must read from the back row of a hall and feel like a TV game show, with one orchestrated moment per screen rather than animation everywhere. This replaces the temporary /host page from Phase 1. Build it on HostView from src/shared/protocol.ts, sized in rem so it scales with screen width. Nothing important smaller than about 2rem at 1080p. It must look right in full screen at 1920×1080 and at 1366×768.

1. Lobby: big room-code tiles, QR code (to /play?code=…), a short join link, a wall of name tags that fits 100 names without overflowing or becoming unreadable (new names pop in), and a big live player count. The room code disappears when Admin hides it.
2. Round 1 intro: everyone plays, the top 6 go to the buzzer round, 8s to read, 8s to answer.
3. Question: the read step (question large, image if any, countdown ring, no options); the answer step (countdown, live "38 / 64 answered"); the time's-up hold.
4. Reveal: the correct answer, big. Results: an animated bar chart of how many picked each option, correct one highlighted. Leaderboard: the top 10 with rows sliding into their new positions and animated scores.
5. End of round 1: the full ranked list with the cut line under 6th and a short dramatic reveal; names above glow, names below fade.
6. Predictions: the 6 finalists with a live backing split.
7. Buzzer round: the 6 finalists as tiles with live points; the question with A–D options; a "buzzers open" state; a big flash with the name and colour of whoever buzzed; the answer countdown; locked-out finalists greyed out for that question; the correct or wrong reveal; a scoreboard between questions; the sudden-death state.
8. Podium: 1st, 2nd and 3rd, the other finalists below, confetti, and "38 of 70 called it".
9. Motion: motion for transitions and layout animations, @number-flow/react for numbers; respect prefers-reduced-motion; keep it smooth with 100 names on a mid-range laptop (stagger, and don't animate 100 layout elements at once).
10. Sound: a tick in the last 3 seconds, reveal, buzz, correct, wrong, cut and win. Royalty-free or generated (Web Audio is fine), small files. Both the mute button on Host and the sound toggle in Admin work. Browsers block audio until a click, so the Host lobby shows a clear "Click to enable sound".
11. Preload the next question's image. Hide the mouse cursor after a few seconds without movement. Keep the full-screen button.

Verify
- A full demo game with 80 bots, 2 Participant tabs and Admin. Then the event preset for at least 3 questions with 100 bots.
- Playwright screenshots of every Host state at 1920×1080 and 1366×768. Review them like a demanding art director (hierarchy, readability from far away, alignment, colour, motion) and fix what's off. Show me the screenshots.
- typecheck, build, simulate and smoke pass. Then report and wait for my approval.
```

---

## Prompt 5: Event-proofing and handover

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Keep the look: the marigold game-show style (tokens and shared classes in src/app/globals.css).
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 5 OF 5: EVENT-PROOFING AND HANDOVER
Goal: nothing surprising happens on the day, and my backend teammate and the quizmaster have everything they need.

1. Failure drills on all three screens: refresh mid-question; lock a phone for 30 seconds; cut Wi-Fi for 10 seconds; reload the Host tab and the Admin tab mid-game; two Admin devices at once; slow network (DevTools Slow 4G) on Participant; restart the mock server (show a clear "The quiz server restarted, so the quiz has to start again" instead of a broken screen). Every case recovers or explains itself.
2. Scale: event preset, 100 bots plus 4 real tabs, the whole quiz from lobby to podium. Watch for dropped events, slow views, Host jank and memory growth. Fix what you find and put the numbers in your report.
3. Accessibility and polish: focus states, colour contrast, screen-reader labels, reduced motion, the same words for the same thing on every screen, no leftover debug output or temporary code from Phase 1.
4. Questions: npm run check-questions validates data/questions.json (4 options each, valid correct index, image files exist, no duplicate ids, enough questions for the chosen preset) and prints a summary. Add a short "Writing questions" section to README.md with a template I can copy for the real Hermes questions.
5. Deployment notes in README.md: the frontend on Vercel, the game server on Render (or similar), every env var (NEXT_PUBLIC_SOCKET_URL, PUBLIC_WEB_URL, CORS_ORIGIN, ADMIN_PIN, GAME_PRESET), CORS, and how to wake a sleeping free server before the event. Don't deploy anything.
6. docs/BACKEND-NOTES.md for my backend teammate: every event and view in protocol.ts, who sends it and when, the stepId rule, and everything the server must enforce (no answer leaks, per-phone shuffling, server-side timing, lockouts, undo, reconnects). Point to mock-server/ as the working reference.
7. docs/RUN-SHEET.md for the quizmaster: a setup checklist (laptop, HDMI, display mode, full screen, sound, Wi-Fi and mobile data check, Admin on a phone), what to say and click at each step, and emergency moves (pause, void, undo a wrong mark, remove someone, a phone that can't join, the projector tab got refreshed).
8. Full rehearsal with the event preset: Host at 1920×1080, Admin at phone size, 4 Participant tabs and 100 bots, lobby to podium, with at least one void, one undo and one participant refresh. typecheck, build, simulate, smoke and check-questions must all pass.
9. Report: what changed, the numbers from the scale test, the URLs, a final checklist for a real run-through in the hall, and anything left open. Then wait. Still don't push until I say "push".
```
