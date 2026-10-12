# Frontend build: 5 phases (v4)

v4 (11 Oct 2026, evening): rewritten for the approved design, **"Server Corridor, Lights Low"**
(`public/finaldesign.html`), bots with reacting eyes, and one 1–4 answer order on the Host and
every phone. Rules: docs/SPEC.md (v2.1).

Paste these into Claude Code in VS Code, opened in the JacKboX folder, one at a time, in order.
Only paste the next prompt after you've tested and approved the current phase.

Phase 1 (engine, contract, game server, tests) is already built, and the design foundation was
added from a Claude chat without being able to run `npm install` there. So the new Prompt 1 checks
and finishes that foundation instead of rebuilding Phase 1.

| Phase | Builds | You test it by |
|---|---|---|
| 1 | Design foundation check: clean-up, git, tests for bots and the 1–4 order | seeing bots react on the temporary pages |
| 2 | Admin screen (quizmaster control panel) in the corridor look | running a whole quiz from your phone |
| 3 | Participant screens (phones): bot builder, answers, buzzer | playing on your own phone |
| 4 | Host screens (projector): corridor, cast of bots, motion and sound | watching a game with 80 bots on a big screen |
| 5 | Failure drills, scale test, design QA, docs, run sheet | a full rehearsal |

---

## Prompt 1: Design foundation check

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event, after a workshop on the Hermes AI agent. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2.1) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- THE LOOK IS APPROVED AND FINAL: "Server Corridor, Lights Low". public/finaldesign.html is the reference (open http://localhost:3000/finaldesign.html). Match its layout, fonts, colours, spacing and animations exactly; don't redesign anything. Build with what's already there: the tokens and classes in src/app/globals.css (host-q, host-opts, host-opt, opt-num, host-count, host-hint, host-banner, host-watermark, host-name, phone-bg, phone-opt, phone-go, phone-result, clock, bot, corridor-*) and the components in src/components/ui/ (Bot + botDelay, BotBuilder, Corridor, TimerRing). Typewriter (font-type) for words, terminal digits (font-term) for numbers, amber only for answer numbers and counts. No new colours or fonts. If a screen needs something the design doesn't show, extend it in the same visual language and list it under "Design extensions" in your report.
- Bots: every participant is a robot (ParticipantTag.color + .head). Their eyes come from the server (HostView.cast[i].mood); screens never work moods out themselves. Give each bot delay={botDelay(id)}.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/. When you screenshot a screen, put it next to the matching part of public/finaldesign.html and fix any difference.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 1 OF 5: DESIGN FOUNDATION CHECK
Goal: the approved design system, bots and the 1–4 answer order are in the code, tested and building, so phases 2–4 only have to draw screens. Phase 1's engine is already built; don't rebuild it. These were added from a Claude chat that couldn't run npm, so trust nothing until it passes:
- src/shared/protocol.ts: PARTICIPANT_COLORS (12 bot colours), BOT_HEADS, BotHead, BotMood, BotLook, BotPicker, CastMember; ParticipantTag.head; HostView.cast; the lobby screen's botPicker; the "participant:bot" event with BotResult and BOT_ERROR_MESSAGES; Round1Question.options (null in the read step, then the 4 options numbered 1–4); phones get options in the Host's order; the phone's result screen carries correctText.
- server/quiz.ts: freeBot, botPicker, botMood, setBot, one answer order; server/server.ts: the participant:bot handler; server/simulate.ts: a new bots check.
- src/app/globals.css (the whole design system), src/app/layout.tsx (Special Elite, VT323, Archivo), src/app/page.tsx (new home page), src/components/ui/Bot.tsx, BotBuilder.tsx, Corridor.tsx, TimerRing.tsx (now the clock), src/stores/participantStore.ts (setBot), the temporary pages (bots on /host and /play), public/finaldesign.html, docs/SPEC.md, CLAUDE.md, README.md.

1. Git
- If this folder isn't a git repo yet: read .git-setup/setup.ps1 if it exists and tell me what it does before running it. Otherwise git init, add https://github.com/Leleouch14/jackbox_2.0.git as origin, and create and switch to a branch called frontend. Commit the current state as "Design foundation (from Claude chat)" before changing anything.

2. Clean up leftovers that break the typecheck (old v1 screens that reference types that no longer exist). Delete: src/components/host/HostApp.tsx, HostTopBar.tsx, LobbyStage.tsx, PlaceholderStages.tsx (keep useJoinUrl.ts, the temporary Host page uses it); the whole src/components/play/ folder; src/components/admin/AdminApp.tsx; src/stores/playerStore.ts; src/lib/usePageAway.ts; src/components/ui/Avatar.tsx. Then remove anything in src/lib/session.ts that only those files used.

3. Make it build and pass
- npm install, then npm run typecheck, npm run build, npm run simulate and npm run smoke. Fix whatever fails. Check that Tailwind picks up every token in globals.css (bg-void, text-ghost, border-mint, text-amber, font-type, font-term, aria-pressed: variants used in BotBuilder).

4. Tests for the new rules
- scripts/smoke.ts, over real Socket.IO: a participant changes their bot in the lobby (ok); another tries the same colour while colours are still free ("taken"); a change after Start quiz ("too-late"); HostView.cast moods: all idle in the lobby, thinking then locked during an answer step, right and wrong after the reveal, out for those cut after Round 1; Round1Question.options is null during the read step and, during the answer step, equals every phone's option texts in order.
- scripts/bots.ts: each bot picks a random free bot from its botPicker in the lobby before the quiz starts, and retries once if it gets "taken".
- Add any missing cases to server/simulate.ts.

5. See it
- npm run dev. Open the home page, /finaldesign.html, and a demo game with 1 /host tab, 1 /admin tab and 3 /play tabs plus 20 bots. Check: every phone can build its bot and taken colours grey out on the others live; the temporary Host page's cast strip shows the eyes changing through a question (thinking, locked, right or wrong) and the cut (out).
- Playwright screenshots of the home page at 1440×900 and 390×844, and of public/finaldesign.html. Confirm Special Elite and VT323 actually load (not a fallback font) and that the corridor, bots and clock look the same as in finaldesign.html.
- Report and wait for my approval.
```

---

## Prompt 2: Admin screen

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event, after a workshop on the Hermes AI agent. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2.1) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- THE LOOK IS APPROVED AND FINAL: "Server Corridor, Lights Low". public/finaldesign.html is the reference (open http://localhost:3000/finaldesign.html). Match its layout, fonts, colours, spacing and animations exactly; don't redesign anything. Build with what's already there: the tokens and classes in src/app/globals.css (host-q, host-opts, host-opt, opt-num, host-count, host-hint, host-banner, host-watermark, host-name, phone-bg, phone-opt, phone-go, phone-result, clock, bot, corridor-*) and the components in src/components/ui/ (Bot + botDelay, BotBuilder, Corridor, TimerRing). Typewriter (font-type) for words, terminal digits (font-term) for numbers, amber only for answer numbers and counts. No new colours or fonts. If a screen needs something the design doesn't show, extend it in the same visual language and list it under "Design extensions" in your report.
- Bots: every participant is a robot (ParticipantTag.color + .head). Their eyes come from the server (HostView.cast[i].mood); screens never work moods out themselves. Give each bot delay={botDelay(id)}.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/. When you screenshot a screen, put it next to the matching part of public/finaldesign.html and fix any difference.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 2 OF 5: THE ADMIN SCREEN (the quizmaster's control panel)
Goal: the quizmaster can run the whole quiz from a phone held in one hand in a dark hall, or from a laptop, without ever wondering what the next click will do. This is the most important screen on the day. It replaces the temporary /admin page from Phase 1. Build it on AdminView from src/shared/protocol.ts; if the contract is missing something Admin needs, add it there, implement it in the game server (server/) and tell me.

1. Sign in: room code (prefilled from /admin?code=ABCD) and PIN. Stays signed in after a refresh. Clear errors.
2. Layout, phone first (390×844 and 360×740), with a two-column layout on a laptop:
   - Top: the current step in plain words (e.g. "Round 1, question 3 of 20: answering"), the timer, an unmissable PAUSED state, and connection status.
   - Middle: the current question with its 4 options numbered 1–4 exactly as the Host and phones show them, the correct one highlighted; a small preview of the next question; live counts: joined, answered (e.g. 41 / 64), buzzed.
   - Bottom, always in the same place and within thumb reach: the big primary button, labelled with exactly what it will do ("Show question", "Reveal answer", "Show results", "Show leaderboard", "Next question", "End round 1", "Open predictions", "Start buzzer round", "Start sudden death", "Show winner").
3. Round 2 judging: when a finalist buzzes, a judge panel takes over the middle: their bot (big, mood "locked") and name, the correct answer, the answer countdown, and two huge buttons, Correct and Wrong. "Undo last mark" stays visible until the next step. Show the 6 finalists as bots with their points; locked-out ones show the "wrong" mood.
4. Secondary controls, one tap away and never next to the primary button: pause/resume, +5s, skip timer, void question, restart question, restart round, show/hide room code on Host, sound on/off on Host, end quiz now, results CSV download. Destructive ones (void, restart round, end quiz, remove participant) need a second tap to confirm, shown inline and cancelling itself after 3 seconds. No browser alert or confirm dialogs.
5. Participants panel: search by name; filter (all, playing, audience, finalists, left page, offline); each row shows the person's small bot, connected dot, status, score, left-page count, and remove (with confirm). Must stay fast with 100 names (don't animate 100 bots at once: render the list's bots in mood "idle" with animations paused when off-screen, or with reduced motion).
6. Keyboard shortcuts on a laptop: Space = primary button, C = Correct, W = Wrong, P = pause/resume, U = undo last mark, all ignored while typing in an input. Show them in a small help line on wide screens.
7. Safety: disable the primary button while a command is in flight and ignore a second tap within 600 ms; send the stepId with every command; several Admin devices stay in sync; reconnect without losing your place.
8. Look, in the approved design's language:
   - Background: plain void (no corridor: Admin has to be scanned fast). A faint vignette is fine.
   - Panels: panel colour with a 1px line border and soft rounded corners. Text in ghost and mint-soft; labels in typewriter; every number (timer, counts, scores, question numbers) in terminal digits; counts in amber.
   - Primary button: the phone-go style (solid mint, void text, terminal font), full width, at least 64 px tall. PAUSED: an alarm-red band with the corridor alarm pulse.
   - Correct = solid mint; Wrong = wrong-red outline that fills on press. Secondary controls use the phone-opt outline style. Destructive ones in wrong-red.
   - Archivo (font-sans) is allowed only for the dense participants table if the typewriter gets hard to scan; say if you used it.
   - High contrast, big targets (main actions at least 56 px tall), nothing below 14 px.

Verify
- Demo preset with 30 bots (npm run bots) and the temporary Host page: run a full game from Admin only. Include a pause, +5s, a void, a restart question, a wrong buzz then a correct one, an undo, a remove, and go all the way to the podium. Repeat some steps with two Admin tabs open at once, and with fast double taps.
- Part of the event preset with 80 bots, to check the participants panel at scale.
- Playwright screenshots of Admin at 390×844, 360×740 and 1440×900 in each major state: lobby, round 1 answering, reveal, end of round 1, predictions, buzzers open, judging, podium. Review them like a demanding product designer against public/finaldesign.html and fix what's off.
- typecheck, build, simulate and smoke pass. Then report and wait for my approval.
```

---

## Prompt 3: Participant screens

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event, after a workshop on the Hermes AI agent. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2.1) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- THE LOOK IS APPROVED AND FINAL: "Server Corridor, Lights Low". public/finaldesign.html is the reference (open http://localhost:3000/finaldesign.html). Match its layout, fonts, colours, spacing and animations exactly; don't redesign anything. Build with what's already there: the tokens and classes in src/app/globals.css (host-q, host-opts, host-opt, opt-num, host-count, host-hint, host-banner, host-watermark, host-name, phone-bg, phone-opt, phone-go, phone-result, clock, bot, corridor-*) and the components in src/components/ui/ (Bot + botDelay, BotBuilder, Corridor, TimerRing). Typewriter (font-type) for words, terminal digits (font-term) for numbers, amber only for answer numbers and counts. No new colours or fonts. If a screen needs something the design doesn't show, extend it in the same visual language and list it under "Design extensions" in your report.
- Bots: every participant is a robot (ParticipantTag.color + .head). Their eyes come from the server (HostView.cast[i].mood); screens never work moods out themselves. Give each bot delay={botDelay(id)}.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/. When you screenshot a screen, put it next to the matching part of public/finaldesign.html and fix any difference.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 3 OF 5: THE PARTICIPANT SCREENS (the phone)
Goal: anyone in the hall can join in 20 seconds, build their bot, and always knows exactly what to do, on any phone, on bad Wi-Fi. This replaces the temporary /play page from Phase 1. Build it on ParticipantView from src/shared/protocol.ts. The four phones in public/finaldesign.html ("Build your bot", answering, CORRECT, WRONG) are the exact reference; every other phone screen uses the same parts.

1. Look, everywhere on the phone: the phone-bg gradient (panel to deep), typewriter for words, terminal digits for numbers and big result words, a small header with "Q1 of 3 · 5s" style text and a thin mint timer bar, the participant's own bot wherever it helps. No corridor on phones.
2. Join: room code (prefilled from the QR link /play?code=ABCD) and real name. Big inputs (at least 16 px so iPhone doesn't zoom), mint outline on focus, a solid mint "JOIN" (phone-go). Clear errors in wrong-red (wrong code; duplicate name, so add a surname initial; quiz ended; removed). Remembers the last name typed.
3. Lobby = "Build your bot": exactly the finaldesign.html builder (use BotBuilder): big preview bot, 12 colour swatches plus the colour wheel (any colour; nothing is ever taken, bots may be shared, since 12 Oct), 8 heads, and a "LOCK IN" button that collapses the builder into "You're in" with their bot idle and the joined count. They can reopen it until the quiz starts. Show BOT_ERROR_MESSAGES inline if a pick is refused. When the quizmaster starts the quiz, the builder closes by itself.
4. Every other state, each with short, clear copy:
   - round 1 intro; eyes up (read countdown; their bot idle, looking up);
   - answer: the 4 options as phone-opt buttons in the SAME order as the projector, each with its number 1–4 in amber terminal digits on the left (the server sends them in the Host's order). The first tap locks: the tapped one fills mint (aria-pressed), the rest dim;
   - locked in (their bot with eyes shut, "Locked in: …"); time's up;
   - result: CORRECT (bot mood right, mint phone-result) or WRONG (bot mood wrong, red phone-result, "It was {correctText}") or missed ("It was …" too). No points, no rank;
   - end of round 1: in the top 6 (bot right, confetti) or out (bot out, powered down), with their rank (the only time a rank shows);
   - audience backing: the 6 finalists as bots with names; tapping one marks it (mint outline); can change until the buzzer round starts;
   - finalist buzzer: locked during the read (dim BUZZ, bot idle); a huge round BUZZ button while open (solid mint, terminal font, at least 60% of the screen width); "You buzzed! Say your answer out loud" (bot locked); "Riya buzzed" (their bot + name); "Locked out this question" (bot wrong); correct or wrong result;
   - audience view of the buzzer round (the 6 finalists as bots with live points in amber, who buzzed, who you backed);
   - podium result (You won! with bot right and confetti / 2nd place / 3rd place / you finished Nth in the final / You called it! / your pick didn't win); removed; quiz ended.
5. Feel: a short transition between screens (motion), instant pressed states, haptics on Android for answer and buzz (navigator.vibrate, only after the person has tapped), confetti for making the top 6 and for winning, the timer bar in the header. Respect reduced motion.
6. Reliability: screen wake lock during the quiz (re-acquired when the page becomes visible again); auto-rejoin after a refresh or a locked phone; "Reconnecting…" and "Paused by the quizmaster" banners (alarm-red band); report page hidden/shown during a question (never shown to the participant).
7. Sizes: works at 360×640, 375×667 (iPhone SE), 390×844 and 430×932, in iPhone Safari and Android Chrome. Nothing cut off, no horizontal scroll, safe areas respected, long options wrap inside their button.

Verify
- A full demo game with 4 real Participant tabs, Admin, the temporary Host page and 20 bots: joining, building bots (including a "taken" clash between two tabs), every round 1 state, the cut (both making it and being out), backing, the whole buzzer round as a finalist (buzzing first, buzzing second, wrong then locked out, correct) and as audience, and the podium.
- Refresh a Participant mid-question and mid-buzzer-round: it must come back to the same place with the same score and bot.
- Playwright screenshots of every state at 375×667 and 390×844, with the four reference phones from public/finaldesign.html beside them. Review them like a demanding product designer and fix what's off.
- Tell me the LAN address so I can open /play on my own phone, and exactly what to try.
- typecheck, build, simulate and smoke pass. Then report and wait for my approval.
```

---

## Prompt 4: Host screens, motion and sound

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event, after a workshop on the Hermes AI agent. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2.1) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- THE LOOK IS APPROVED AND FINAL: "Server Corridor, Lights Low". public/finaldesign.html is the reference (open http://localhost:3000/finaldesign.html). Match its layout, fonts, colours, spacing and animations exactly; don't redesign anything. Build with what's already there: the tokens and classes in src/app/globals.css (host-q, host-opts, host-opt, opt-num, host-count, host-hint, host-banner, host-watermark, host-name, phone-bg, phone-opt, phone-go, phone-result, clock, bot, corridor-*) and the components in src/components/ui/ (Bot + botDelay, BotBuilder, Corridor, TimerRing). Typewriter (font-type) for words, terminal digits (font-term) for numbers, amber only for answer numbers and counts. No new colours or fonts. If a screen needs something the design doesn't show, extend it in the same visual language and list it under "Design extensions" in your report.
- Bots: every participant is a robot (ParticipantTag.color + .head). Their eyes come from the server (HostView.cast[i].mood); screens never work moods out themselves. Give each bot delay={botDelay(id)}.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/. When you screenshot a screen, put it next to the matching part of public/finaldesign.html and fix any difference.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 4 OF 5: THE HOST SCREENS (the projector), MOTION AND SOUND
Goal: the projector is the show. It must read from the back row of a hall and feel like Murder Trivia in a haunted server room, with one orchestrated moment per screen rather than animation everywhere. This replaces the temporary /host page from Phase 1. Build it on HostView from src/shared/protocol.ts, sized in rem so it scales with screen width (the root element has the host-root class; at 1920 px, 1% of the width ≈ 1.2rem). Nothing important smaller than about 2rem at 1080p. It must look right in full screen at 1920×1080 and at 1366×768.

The two projector frames in public/finaldesign.html (the answer step and the read step) are the exact reference: the same positions, sizes, tilts, fonts, colours, scrims and animations. Every other Host screen is built from the same parts: <Corridor /> behind everything (scrim "split" for the answer step, "center" for single blocks, "full" for lists), the cast of bots across the top, typewriter words, terminal digits, amber numbers, the clock timer bottom-left, hermes://quiz bottom-right.

1. The cast (every screen from the lobby to the podium): HostView.cast across the top, each bot's eyes driven by its mood. Up to 12 people: one row of bots with names under them, exactly as in finaldesign.html. 13 or more: a dense wall of smaller bots without names, 2 or 3 rows across the top that never cover the question; still every bot's own mood, so the whole room can watch its eyes dart, shut, hop and shake at once. Keep it smooth with 100 bots on a mid-range laptop (CSS animations only, staggered with botDelay, no layout animation on the wall).
2. Lobby: the corridor (scrim "center"); the room code as 4 big terminal-digit tiles with mint outlines; the QR code (to /play?code=…) on a clock-paper card with a mint offset shadow; the short join link in typewriter; the big live player count in terminal digits; new joiners' bots pop into a wall with their names (fits 100 without overflowing). The room code and QR disappear when Admin hides them. A clear "Click to enable sound" (browsers block audio until a click).
3. Round 1 intro: everyone plays, the top 6 go to the buzzer round, 8s to read, 8s to answer, in the same typewriter/terminal style.
4. Question: the read step exactly as the second frame in finaldesign.html (question centred, tilted, hint under it, clock bottom-left, no options; image if any, beside the question on a dark card); the answer step exactly as the first frame (question left, tilted; the 4 options from Round1Question.options right, numbered 1–4 in amber with the staggered tilt; clock bottom-left with "38 / 64 answered" beside it); the time's-up hold.
5. Reveal: exactly the "Reveal answer" state in finaldesign.html: the wrong options dim to 30%, the correct number turns mint, a terminal banner "> answer: …" and the cast hops and shakes. Results: a bar chart of how many picked each option in the same style (thin mint bars, amber counts, numbers 1–4), correct one highlighted. Leaderboard: the top 10 as rows with their bots, rows sliding into their new positions and scores animating.
6. End of round 1: the full ranked list with each bot, a dramatic cut line under 6th (an alarm-red line with the alarm pulse); bots below the line power down (mood out) one after another; the 6 above glow.
7. Predictions: the 6 finalists as big bots with a live backing split (amber percentages).
8. Buzzer round: the 6 finalists as big bots with live points; the question with its A–D options; a "buzzers open" state (corridor alarm faster, bots thinking); a big flash of whoever buzzed (their bot large, mood locked, name in terminal digits); the answer countdown on the clock; locked-out finalists show "wrong"; the correct or wrong reveal; a scoreboard between questions; the sudden-death state.
9. Podium: 1st, 2nd and 3rd bots on server-rack plinths (the winner hops), the other finalists below, confetti in the bots' colours, and "38 of 70 called it".
10. Motion: motion for transitions and layout animations, @number-flow/react for numbers; respect prefers-reduced-motion (bots then sit still in their mood's pose).
11. Sound: retro terminal beeps that fit the server room: a tick in the last 3 seconds, reveal, buzz, correct, wrong, the cut (a power-down), and win. Generated with Web Audio is fine, small. Both the mute button on Host and the sound toggle in Admin work.
12. Preload the next question's image. Hide the mouse cursor after a few seconds without movement. Keep a small full-screen button in the same style.

Verify
- A full demo game with 80 bots, 2 Participant tabs and Admin. Then the event preset for at least 3 questions with 100 bots.
- Playwright screenshots of every Host state at 1920×1080 and 1366×768. Put the answer and read steps side by side with the frames in public/finaldesign.html and fix every difference. Review the rest like a demanding art director (hierarchy, readability from far away, alignment, colour, motion). Show me the screenshots.
- typecheck, build, simulate and smoke pass. Then report and wait for my approval.
```

---

## Prompt 5: Event-proofing and handover

```
You're a senior frontend engineer with 20 years of experience building realtime, game-show style web apps.

GROUND RULES (apply to every phase)
- Project: Hermes Quiz, a Jackbox-style live MCQ quiz for 60–100 people at a club event, after a workshop on the Hermes AI agent. Questions on a projector, answers on phones, and a quizmaster running everything from an admin panel.
- docs/SPEC.md (v2.1) is the source of truth for every rule. Read it fully, plus CLAUDE.md, docs/BUILD-PHASES.md and the existing code, before changing anything.
- Screen names, used everywhere (code, copy, docs): Host (/host) = the projector screen everyone sees, with no game controls. Participant (/play) = each player's phone. Admin (/admin) = the quizmaster's control panel, PIN protected.
- THE LOOK IS APPROVED AND FINAL: "Server Corridor, Lights Low". public/finaldesign.html is the reference (open http://localhost:3000/finaldesign.html). Match its layout, fonts, colours, spacing and animations exactly; don't redesign anything. Build with what's already there: the tokens and classes in src/app/globals.css (host-q, host-opts, host-opt, opt-num, host-count, host-hint, host-banner, host-watermark, host-name, phone-bg, phone-opt, phone-go, phone-result, clock, bot, corridor-*) and the components in src/components/ui/ (Bot + botDelay, BotBuilder, Corridor, TimerRing). Typewriter (font-type) for words, terminal digits (font-term) for numbers, amber only for answer numbers and counts. No new colours or fonts. If a screen needs something the design doesn't show, extend it in the same visual language and list it under "Design extensions" in your report.
- Bots: every participant is a robot (ParticipantTag.color + .head). Their eyes come from the server (HostView.cast[i].mood); screens never work moods out themselves. Give each bot delay={botDelay(id)}.
- NEVER run git push. Commit locally on the frontend branch only. I'll say "push" when I want it pushed.
- Run everything on a local server and give me the exact URLs to test. At the end of the phase, stop and wait for my approval.
- Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Socket.IO 4, Zustand, motion, @number-flow/react, canvas-confetti. Install anything else you genuinely need, at current stable versions.
- Questions: only the 3 demo MCQs in data/questions.json for now.
- I'm on Windows (PowerShell).
- For screenshots and browser tests use Playwright (run "npx playwright install chromium" the first time). Keep test and helper scripts in scripts/. When you screenshot a screen, put it next to the matching part of public/finaldesign.html and fix any difference.
- Don't break earlier work: npm run typecheck, npm run build, npm run simulate and npm run smoke must all pass at the end of every phase.
- Before coding, post a short plan (files you'll add or change, and risks), then carry on without waiting. If a rule is genuinely ambiguous and hard to undo, ask me; otherwise pick the sensible option and list it under "Assumptions" in your report.
- At the end: update CLAUDE.md with anything later phases need, commit with a message starting "Phase N:", and report what you built, how you verified it, the URLs, a checklist for me, your assumptions and anything left undone.

PHASE 5 OF 5: EVENT-PROOFING AND HANDOVER
Goal: nothing surprising happens on the day, the projector looks like the approved design in a real hall, and my backend teammate and the quizmaster have everything they need.

1. Failure drills on all three screens: refresh mid-question; lock a phone for 30 seconds; cut Wi-Fi for 10 seconds; reload the Host tab and the Admin tab mid-game; two Admin devices at once; slow network (DevTools Slow 4G) on Participant; two phones racing for the same bot colour; restart the game server (show a clear "The quiz server restarted, so the quiz has to start again" in the design's style instead of a broken screen). Every case recovers or explains itself.
2. Scale: event preset, 100 bots plus 4 real tabs, the whole quiz from lobby to podium. Watch for dropped events, slow views, Host jank (100 animated bots on the cast wall, the lobby wall, the cut), and memory growth. Measure the Host's frame rate during the answer step and the reveal with 100 bots. Fix what you find and put the numbers in your report.
3. Design QA against public/finaldesign.html: every Host, phone and Admin screen side by side with the reference; fonts really loaded (Special Elite, VT323) with no fallback flash on the projector; a projector washout check (screenshots at reduced contrast and +30% brightness: the question, answers, numbers and clock must still read, the scrims must still separate text from the corridor); colour contrast; the same words for the same thing on every screen.
4. Accessibility and polish: focus states (mint outline), screen-reader labels (bots have names where no name is printed), reduced motion (bots still show their mood pose), no leftover debug output or temporary code from Phase 1 (delete src/components/temp/ and the legacy marigold tokens and classes in globals.css once nothing uses them).
5. Questions: npm run check-questions validates data/questions.json (4 options each, valid correct index, image files exist, no duplicate ids, enough questions for the chosen preset) and prints a summary. Add a short "Writing questions" section to README.md with a template I can copy for the real Hermes questions. Question images must read on the dark Host (show them on a dark card; warn in check-questions about images with transparent backgrounds and dark lines).
6. Deployment notes in README.md: the frontend on Vercel, the game server on Render (or similar), every env var (NEXT_PUBLIC_SOCKET_URL, PUBLIC_WEB_URL, CORS_ORIGIN, ADMIN_PIN, GAME_PRESET), CORS, and how to wake a sleeping free server before the event. Don't deploy anything.
7. docs/BACKEND-NOTES.md for my backend teammate: every event and view in protocol.ts, who sends it and when, the stepId rule, and everything the server must enforce (no answer leaks, one 1–4 answer order per question, server-side timing, lockouts, undo, reconnects, bot uniqueness and participant:bot, computing HostView.cast moods). Point to server/ as the working reference.
8. docs/RUN-SHEET.md for the quizmaster: a setup checklist (laptop, HDMI, display mode, full screen, projector brightness and hall lights, sound, Wi-Fi and mobile data check, Admin on a phone), what to say and click at each step (including "build your bot" in the lobby), and emergency moves (pause, void, undo a wrong mark, remove someone, a phone that can't join, the projector tab got refreshed).
9. Full rehearsal with the event preset: Host at 1920×1080, Admin at phone size, 4 Participant tabs and 100 bots, lobby to podium, with at least one void, one undo and one participant refresh. typecheck, build, simulate, smoke and check-questions must all pass.
10. Report: what changed, the numbers from the scale test, the URLs, a final checklist for a real run-through in the hall, and anything left open. Then wait. Still don't push until I say "push".
```
