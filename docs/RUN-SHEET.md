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
happens. On a laptop: Space = big button, C = Correct, W = Wrong, U = Undo, P = Pause.

| Step | Say | Tap |
|---|---|---|
| **Lobby** | "Scan the QR code or go to the address on screen, and type the room code. Use your real name, it goes on the projector. Then **build your bot**: pick a colour and a head, and press LOCK IN. Two people with the same name: add your surname initial." | wait. Admin shows how many joined. Hide the room code (Controls) once everyone's in, if latecomers are a problem. |
| **Start** | "Round 1. Everyone plays. You'll see each question up here first, then the answers appear on your phone. Faster right answers score more. Top 6 go through." | **Start quiz** |
| **Question** | (read it out) "Eyes up." | **Show question**. 8 s to read, then 8 s to answer on phones. The numbers 1–4 on the projector match the phones. |
| **Time's up** | "Time!" | wait for the clock (or **Skip timer**) |
| **Reveal** | "The answer is…" | **Reveal answer**. Phones say CORRECT or WRONG. |
| Results, leaderboard | (optional) "Here's how you voted… and the top 10." | **Show results**, **Show leaderboard**, or skip straight to **Next question** |
| **The cut** | "That's Round 1. The top 6 go to the final. Everyone else: your bots are powering down, but stay with us." | **End round 1** |
| **Predictions** | "Audience: on your phone, back the finalist you think will win. If they win, you called it." | **Open predictions**, give it 20–30 s |
| **Buzzer round** | "Finalists: the question and the four options go up, buzzers unlock after 5 seconds. First to buzz says the answer out loud. Right is a point; wrong locks you out for that question." | **Start buzzer round**, then **Show question** |
| A buzz | "(Name)!" Listen to the answer. | **Correct** or **Wrong**. Wrong reopens the buzzers for the others. |
| Between questions | (optional) "Scores so far." | **Show scores** or **Next question** |
| **Tie for first** | "We have a tie. Sudden death: only (names) can buzz, first right answer wins." | **Start sudden death** |
| **Podium** | "And the winner is…" Then: "(N) of you called it." | **Show winner**. Admin shows the final order to read out. Controls → **Results CSV** for the prizes. |

---

## 3. Emergency moves

| Problem | Do this |
|---|---|
| **Need a moment** (noise, a question about the rules) | Controls → **Pause** (or P). Every clock freezes; phones and the projector say PAUSED. **Resume** when ready. |
| **A question is wrong or confusing** | Controls → **Void question** (tap twice). Nobody gains or loses points; phones say CANCELLED. Then **Next question**. **Restart question** replays it from the start instead. |
| **You tapped Correct/Wrong by mistake** | **Undo last mark** (or U) straight away, then mark it again. |
| **Someone is being silly / wrong name** | People tab → find them → **Remove** (tap twice). They can't rejoin; their bot powers down. |
| **A phone can't join** | Check the 4-letter code. "Name taken": add a surname initial. On Wi-Fi with a login page: switch to mobile data. Still stuck: type the address by hand (it's under the QR). People can join until Round 1 ends (they play from the next question); after that they join as audience. |
| **A phone froze or was locked** | Nothing to do: when they open it again it rejoins and catches up. If not, refresh the page; they keep their score and bot. |
| **The projector tab got refreshed or closed** | Open `/host` again. It signs back in by itself (or enter the PIN) and shows the room exactly where it was. Press F11, click once for sound. |
| **Your Admin phone died** | Open `/admin` on the laptop or another phone, enter the PIN, pick the open room. Nothing is lost. Two Admins at once is safe: a double press only moves one step. |
| **"The quiz server restarted, so the quiz has to start again"** | The game server restarted (rare; never redeploy on the day). The current game is lost. Admin → the quiz → **Open room**, everyone rejoins with the new code. |
| **The projector says "Reconnecting to the game server…"** | Check the laptop's internet. It reconnects by itself and comes back to the same step. |
