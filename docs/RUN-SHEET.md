# Run sheet: the night of the quiz

For the quizmaster. Three screens: the **projector** (`/host`, everyone watches it), your **Admin**
(`/admin`, on your phone; nobody else sees it), and everyone's **phones** (`/play`).

Live addresses: https://hermes-quiz-nine.vercel.app/host · /admin · /play. The PIN is the same for
Admin and the projector (ask Sukrit; it's not written anywhere public).

**The questions** are `final_quiz.json` in the project folder. The game server checks it every time it
starts (it refuses to start, listing every problem, if anything is wrong) and puts it in Admin's quiz
list as **"Hermes final quiz"** (Round 1: 20 + 2 spares, wild card: 5 + 3 spares, Blackout: 18). To
change a question, edit the file and restart the game server; don't edit that quiz in Admin (the file
replaces it on the next start).

### Starting it on the laptop (if you're not using the live site)

The laptop and every phone on the **same Wi-Fi**. In PowerShell, in the project folder:

```powershell
npm install                     # once
npm run build                   # once, after any change to the code
$env:GAME_PRESET="event"; $env:ADMIN_PIN="choose-a-pin"; $env:DATABASE_URL="off"; npm start
```

- The game server prints the addresses: **Admin** `http://localhost:3000/admin`, **projector**
  `http://localhost:3000/host`, **phones** `http://<laptop's Wi-Fi address>:3000/play` (also as a QR
  code on the projector). If Windows asks whether Node.js may use the network, choose **Allow** on
  private networks; phones can't connect otherwise.
- `DATABASE_URL="off"` keeps everything on the laptop (download the results as CSV from Admin at the
  end). Leave it out to also save results to Supabase (needs internet).
- `npm run bot-load-test` (another PowerShell window, before doors open, ~15 minutes) plays a whole
  quiz with 100 fake phones against its own server and checks the scores: a last confidence check.

---

## 1. Setup checklist (start 45 minutes before)

**Bring:** the laptop **and its charger**, an HDMI cable (and a USB-C/HDMI adapter if the laptop needs
one), your phone and its charger, a second phone for the backup Admin and the Wi-Fi test.

**Wake the game server (it sleeps on the free plan)**
- [ ] Open https://hermes-quiz-game.onrender.com/health. Wait until it says `ok` (up to a minute).
- [ ] Open it again **10 minutes before doors open**. Once `/admin` and `/host` are open, they keep it awake.

**Laptop and projector**
- [ ] Laptop on charge, sleep and screensaver off, notifications off (Focus / Do not disturb).
- [ ] HDMI in. Display mode **Duplicate** (Windows: Win + P → Duplicate), so you see what the hall sees.
- [ ] Chrome or Edge, one window. Open `/host`, enter the PIN, click **SHOW QUIZ**.
- [ ] Full screen: move the mouse and click the full-screen button (bottom right), or press F11.
      The cursor and buttons hide after 3 seconds.
- [ ] Browser zoom 100% (Ctrl + 0).
- [ ] Projector brightness up, keystone straight. Dim the hall lights at the front so the dark
      screen reads; keep enough light on the audience to see their phones.
- [ ] Check from the back row: the question text and the 1–4 answers must be readable.

**Sound**
- [ ] Laptop audio to the hall speakers (or the projector). Volume about 60%.
- [ ] On the projector, click **once** anywhere (or on the sound chip): browsers only play sound after a click.
- [ ] Admin → Controls → Sound on/off is the room switch; the projector's own mute button is the local one.

**Your Admin (on your phone)**
- [ ] Open `/admin` on your phone, enter the PIN (a long one, set on Render; never 1234).
- [ ] **Backup Admin:** sign in on a second phone too (or the laptop in a separate window that is
      *not* on the projector). Two Admins at once is safe: a double press only ever moves one step.
- [ ] Phone on charge or above 60%, auto-lock set to "Never" for the evening, brightness up.
- [ ] Find the quiz → **Open room**. The projector shows the room by itself within a few seconds.
- [ ] Keep the laptop's Admin tab closed or in another window: never on the projector (Admin shows the answers).

**Network**
- [ ] Join from your own phone on the hall **Wi-Fi**: scan the QR, type a name, you should land on "Build your bot".
- [ ] Join from a second phone on **mobile data** (Wi-Fi off). Both must work. If the Wi-Fi has a
      login page or blocks it, tell people to use mobile data.
- [ ] Remove your test players in Admin → People (Remove, tap again).

---

## 2. Running it: what to say, what to tap

The big button at the bottom of Admin always says what it does next. The line above it says what
happens. Optional steps are small "or: …" chips just above it. On a laptop: Space = big button,
P = Pause, S = Skip (Blackout). Nothing is judged by hand: every answer is a tap on a phone and the
server marks it (rules: `docs/SPEC.md` v3.1).

**How long:** about **30–35 minutes** from Start quiz to the podium, plus the lobby (5–10 minutes
while people join and build bots). Round 1 ≈ 10 min (20 questions × ~24 s plus a little talking),
the cut and the wild card round ≈ 4 min, predictions ≈ 1 min, Blackout ≈ 4–5 min (runs itself,
about 10 questions), podium and prizes ≈ 3 min. Budget **45 minutes** for the slot.

| Step | Say | Tap |
|---|---|---|
| **Lobby** | "Scan the QR code or go to the address on screen, and type the room code. Use your real name, it goes on the projector. Then **build your bot**: pick a colour and a head, and press LOCK IN. Two people with the same name: add your surname initial." | wait. Admin shows how many joined. Hide the room code (Controls) once everyone's in, if latecomers are a problem. |
| **Start** | "Round 1. Everyone plays. You'll see each question up here first, then the answers appear on your phone. Answer fast: up to 200 points a question. The top 9 go to Blackout; everyone else gets a wild card shot." | **Start quiz** |
| **Question** | (read it out) "Eyes up." | **Show question**. 8 s to read, then 8 s to answer on phones. The numbers 1–4 on the projector match the phones. |
| **Time's up** | "Time!" | wait for the clock (or **Skip timer**) |
| **Reveal** | "The answer is…" | **Reveal answer**. Phones say CORRECT or WRONG. |
| **A multi-correct question** (Admin's question card says **Multi-correct: N right**; the projector says SELECT ALL THAT APPLY) | "This one has more than one right answer. Tick every one you think is right, then press LOCK IN. Wrong ticks cost you." Never say how many are right. | Same clicks. It's **15 s** to answer (not 8). Admin's count reads "**locked in** 41 / 64 · 6 ticking": ticking = ticked but not locked in yet; when the time runs out their ticks are sent for them. At the reveal every right option lights up; phones say CORRECT, **PARTLY RIGHT** or WRONG. |
| Results, leaderboard | (optional) "Here's how you voted… and the top 10." | The small chips above the big button: **or: Show results**, **or: Show leaderboard**. The big button is always **Next question**. |
| **The cut** | "That's Round 1. The top 9 are safe: you're in Blackout. Everyone else: you're in the wild card round, and one of you takes the last seat." | **End round 1** |
| **Wild card** | "Wild card round: five questions, only those below the line answer. Most right answers wins the last seat; a tie goes to the faster. Safe players, sit back and watch." | **Start wild card round**, then **Show question** |
| Wild card questions | (read it out) "Eyes up." | Same as Round 1: **Show question** → (timers) → **Reveal answer** → (optional chip) **or: Show standings** → **Next question** |
| Exact tie | "Dead heat! Sudden death: first one right takes it." | **Next question (sudden death)**: the button says so by itself |
| **Reveal wild card** | "And the last seat goes to…" | **Reveal wild card**. The projector shows the winner; the rest power down. |
| **Predictions** | "Audience: on your phone, back the finalist you think will escape. If they win, you called it." | The chip **or: Open predictions**, give it 20–30 s (optional; the big button is Start Blackout) |
| **Blackout** | "Blackout. The lights are dying behind our 10 finalists. Right answers move you forward, faster moves you further; wrong ones move you back. Each question the dark moves on, and if it reaches you, you power down. Last bot running escapes." | **Start Blackout**. That's the last click: Blackout runs on **autopilot** from here to the podium. |
| Each Blackout question (automatic, ~23 s) | **Read (5 s):** read the question out. **Answer (10 s):** "Ten seconds, runners!" **Reveal:** "Let's see who moved… a dash for (name)!" **The dark:** "Here comes the dark…" then, if someone's caught, "(name) is out!" or "Everyone survives!" Admin's autopilot strip shows the step and what's next ("RUNNERS MOVE · 3 → next: the dark moves"), and a red line shows who the dark will catch (only you see it: build the tension). | Nothing to click. The big button is **PAUSE** (tap it if you need to talk; **RESUME**, red, carries on from the same moment). |
| **Winner** (automatic) | "The lights are coming back on… (name) escapes!" | Nothing: the winner moment holds 7 s, then the podium shows by itself. |
| **Podium** | "Our last bot running is…" Then: "(N) of you called it." | Admin shows the final order to read out. The big button is **Download results** (CSV) for the prizes. |

---

## 3. Emergency moves

| Problem | Do this |
|---|---|
| **Need a moment** (noise, a question about the rules) | Controls → **Pause** (or P). Every clock freezes; phones and the projector say PAUSED. **Resume** when ready. |
| **Skip a question (play a spare instead)** | **Void question** (Controls, tap twice) any time from when it goes up until you press Next. Then press the big button (**Next question**): the next question takes the skipped one's number, so Round 1 still plays 20 and the wild card still 5. The spares (Round 1: 2, wild card: 3) come in only this way (the wild card also uses them for sudden death); Admin's step line says "(spare)" when one is up. |
| **A question is wrong or confusing** | Controls → **Void question** (tap twice). It doesn't count: no points, no tally, in Blackout nobody moves and the dark stays; the next question takes its number. Phones say CANCELLED. **Restart question** replays it from the start instead (in Blackout it also undoes the dark and any catches). |
| **A Blackout question is wrong or confusing** | Under the runners: **Void question** (tap twice) while it's being read or answered: nobody moves, the dark stays, the next question comes by itself. **Restart question** (until the dark moves) replays it. |
| **A Blackout wait feels too long** (the room is ready) | **Skip** under the runners (or S on a laptop) ends the current wait now; the autopilot carries on. |
| **Pause mid-Blackout** | The big button (**PAUSE**). The projector freezes mid-animation and says PAUSED; **RESUME** carries on from the same moment. |
| **Someone is being silly / wrong name** | People tab → find them → **Remove** (tap twice). They can't rejoin; their bot powers down. A finalist removed before the first Blackout question is replaced by the next best (the wild card runner-up). |
| **A phone can't join** | Check the 4-letter code. "Name taken": add a surname initial. On Wi-Fi with a login page: switch to mobile data. Still stuck: type the address by hand (it's under the QR). People can join until Round 1 ends (they play from the next question); after that they join as audience and can back a finalist. |
| **A phone froze or was locked** | Nothing to do: when they open it again it rejoins and catches up. If not, refresh the page; they keep their score and bot. |
| **The projector tab got refreshed or closed** | Open `/host` again. It signs back in by itself (or enter the PIN) and shows the room exactly where it was (in Blackout: the current step, animation already in place). Press F11, click once for sound. |
| **A player refreshed their phone** | Nothing to do: it rejoins as the same player, same bot, same score (a runner keeps their place in the chase). |
| **Your Admin phone died** | Open `/admin` on the backup phone or the laptop, enter the PIN, pick the open room. Nothing is lost. **In Blackout the chase keeps running on its own** (the server drives it); just pick it up from the backup. Two Admins at once is safe: a double press only moves one step. |
| **"The quiz server restarted, so the quiz has to start again"** | The game server restarted (rare; never redeploy on the day). The current game is lost. Admin → the quiz → **Open room**, everyone rejoins with the new code. |
| **The projector says "Reconnecting to the game server…"** | Check the laptop's internet. It reconnects by itself and comes back to the same step. |
