# Run sheet: the night of the quiz

For the quizmaster. Three screens: the **projector** (`/host`, everyone watches it), your **Admin**
(`/admin`, on your phone; nobody else sees it), and everyone's **phones** (`/play`).

Live addresses: https://hermes-quiz-nine.vercel.app/host · /admin · /play. The PIN is the same for
Admin and the projector (ask Sukrit; it's not written anywhere public).

---

## 1. Setup checklist (start 45 minutes before)

**Wake the game server (it sleeps on the free plan)**
- [ ] Open https://hermes-quiz-game.onrender.com/health. Wait until it says `ok` (up to a minute).

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
- [ ] Open `/admin` on your phone, enter the PIN.
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
happens. On a laptop: Space = big button, P = Pause. Nothing is judged by hand: every answer is a
tap on a phone and the server marks it (rules: `docs/SPEC.md` v3).

| Step | Say | Tap |
|---|---|---|
| **Lobby** | "Scan the QR code or go to the address on screen, and type the room code. Use your real name, it goes on the projector. Then **build your bot**: pick a colour and a head, and press LOCK IN. Two people with the same name: add your surname initial." | wait. Admin shows how many joined. Hide the room code (Controls) once everyone's in, if latecomers are a problem. |
| **Start** | "Round 1. Everyone plays. You'll see each question up here first, then the answers appear on your phone. Faster right answers score more. The top 9 are safe for the final; everyone else gets a wild card shot." | **Start quiz** |
| **Question** | (read it out) "Eyes up." | **Show question**. 8 s to read, then 8 s to answer on phones. The numbers 1–4 on the projector match the phones. |
| **Time's up** | "Time!" | wait for the clock (or **Skip timer**) |
| **Reveal** | "The answer is…" | **Reveal answer**. Phones say CORRECT or WRONG. |
| Results, leaderboard | (optional) "Here's how you voted… and the top 10." | **Show results**, **Show leaderboard**, or skip straight to **Next question** |
| **The cut** | "That's Round 1. The top 9 are safe: you're in Blackout. Everyone else: you're in the wild card round, and one of you takes the last seat." | **End round 1** |
| **Wild card** | "Wild card round: five questions, only those below the line answer. Most right answers wins the last seat; a tie goes to the faster. Safe players, sit back and watch." | **Start wild card round**, then **Show question** |
| Wild card questions | (read it out) "Eyes up." | Same as Round 1: **Show question** → (timers) → **Reveal answer** → (optional) **Show standings** → **Next question** |
| Exact tie | "Dead heat! Sudden death: first one right takes it." | **Next question (sudden death)**: the button says so by itself |
| **Reveal wild card** | "And the last seat goes to…" | **Reveal wild card**. The projector shows the winner; the rest power down. |
| **Predictions** | "Audience: on your phone, back the finalist you think will escape. If they win, you called it." | **Open predictions**, give it 20–30 s (optional) |
| **Blackout** | "Blackout. The lights are dying behind our 10 finalists. Right answers move you forward, faster moves you further; wrong ones move you back. Each question the dark moves on, and if it reaches you, you power down. Last bot running escapes." | **Start Blackout**, then **Show question** |
| Each Blackout question | (read it out) "Eyes up." Then after the reveal: "Let's see who moved." Then: "Here comes the dark…" | **Show question** → (5 s read, 8 s answer) → **Reveal answer** (runners move) → **Advance the darkness** (anyone it reaches is caught) → **Next question** |
| **Podium** | "Our last bot running is…" Then: "(N) of you called it." | **Show winner** (it never shows by itself). Admin shows the final order to read out. Controls → **Results CSV** for the prizes. |

---

## 3. Emergency moves

| Problem | Do this |
|---|---|
| **Need a moment** (noise, a question about the rules) | Controls → **Pause** (or P). Every clock freezes; phones and the projector say PAUSED. **Resume** when ready. |
| **A question is wrong or confusing** | Controls → **Void question** (tap twice). It doesn't count: no points, no tally, in Blackout nobody moves and the dark stays; the next question takes its number. Phones say CANCELLED. **Restart question** replays it from the start instead (in Blackout it also undoes the dark and any catches). |
| **You pressed Advance the darkness too early** | Controls → **Restart question** (tap twice): the moves, the dark and the catches are undone and the question plays again. |
| **Someone is being silly / wrong name** | People tab → find them → **Remove** (tap twice). They can't rejoin; their bot powers down. A finalist removed before the first Blackout question is replaced by the next best (the wild card runner-up). |
| **A phone can't join** | Check the 4-letter code. "Name taken": add a surname initial. On Wi-Fi with a login page: switch to mobile data. Still stuck: type the address by hand (it's under the QR). People can join until Round 1 ends (they play from the next question); after that they join as audience and can back a finalist. |
| **A phone froze or was locked** | Nothing to do: when they open it again it rejoins and catches up. If not, refresh the page; they keep their score and bot. |
| **The projector tab got refreshed or closed** | Open `/host` again. It signs back in by itself (or enter the PIN) and shows the room exactly where it was. Press F11, click once for sound. |
| **Your Admin phone died** | Open `/admin` on the laptop or another phone, enter the PIN, pick the open room. Nothing is lost. Two Admins at once is safe: a double press only moves one step. |
| **"The quiz server restarted, so the quiz has to start again"** | The game server restarted (rare; never redeploy on the day). The current game is lost. Admin → the quiz → **Open room**, everyone rejoins with the new code. |
| **The projector says "Reconnecting to the game server…"** | Check the laptop's internet. It reconnects by itself and comes back to the same step. |
