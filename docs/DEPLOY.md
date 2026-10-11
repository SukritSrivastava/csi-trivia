# Deploying Hermes Quiz

## Live now (deployed 12 Oct 2026)

| What | Where | Notes |
|---|---|---|
| Website (Vercel) | https://hermes-quiz-nine.vercel.app | project `hermes-quiz` on Sukrit's Vercel account. Host `/host`, Admin `/admin`, phones `/play` |
| Game server (Render) | https://hermes-quiz-game.onrender.com (`/health` → `ok`) | service `hermes-quiz-game`, free plan, Singapore, branch `main`, event preset |
| Results (Supabase) | project `etwobyrwvtrhmgolzctq`, Tokyo, Session pooler | tables `rooms`, `players`, `game_history`, row-level security on |

Settings already in place: Render has `GAME_PRESET=event`, `ADMIN_PIN` (ask Sukrit; it's not in the
repo, which is public), `DATABASE_URL`, `PUBLIC_WEB_URL` and `CORS_ORIGIN` (both the Vercel address), `NODE_VERSION=24`.
Vercel has `NEXT_PUBLIC_SOCKET_URL=https://hermes-quiz-game.onrender.com`.

**Updating it: `npm run deploy`** (on `main`, committed and pushed). It starts a Render deploy of the
game server, waits until it's live and `/health` says ok, then builds and deploys the website to Vercel.
Neither service redeploys on its own from a push yet: that needs Render's and Vercel's GitHub apps
installed on the repo owner's account (`Leleouch14`). The script needs these in `.env.local`
(git-ignored; already set on Sukrit's laptop, template in `.env.example`): `RENDER_API_KEY`,
`RENDER_SERVICE_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Options: `--skip-render`,
`--skip-vercel`. `.vercelignore` keeps `.env.local` out of the upload.
- Verified live 12 Oct: `npm run admin-run -- --web https://hermes-quiz-nine.vercel.app --game https://hermes-quiz-game.onrender.com`
  (set `ADMIN_PIN` first) passed all 41 checks, and the results landed in Supabase.

The rest of this file is how it was set up, for doing it again from scratch.

Three services, each doing one job:

```
Phones / Projector / Admin  ──►  Website (Next.js)          on Vercel
                                     │ Socket.IO
                                     ▼
                              Game server (server/)    on Render  ──►  Results database   on Supabase
                                                            DATABASE_URL     (rooms, players, game_history)
```

- The **website** only shows screens. It needs one setting: where the game server is.
- The **game server** runs the quiz (all rules, timers, scores) and saves results to Supabase.
- **Supabase** only stores results. If it's down, the quiz still runs; Admin's Results CSV still works.

Do the steps in this order. It takes about 20 minutes.

---

## 1. Supabase: get the connection string

1. Open the project (or create one at supabase.com; keep the database password).
2. Click **Connect** (top bar) → **Session pooler** (not "Direct connection": that one is IPv6 only and
   Render can't reach it). Copy the string:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
3. Put the real password in place of `[YOUR-PASSWORD]` (no brackets). If the password has `@ # / ?`
   or spaces, reset it to letters and numbers (Project Settings → Database → Reset password).
4. Keep this string private: it's the key to the database. Never commit it.

The game server creates the tables itself on first start (the backend teammate's `rooms`, `players`,
`game_history`, with a few extra columns). After the first run, lock them (SQL Editor):

```sql
alter table rooms enable row level security;
alter table players enable row level security;
alter table game_history enable row level security;
```

(The game server logs in as the database owner, so this doesn't affect it; it stops anyone with the
project's public API key from reading or changing results.)

**Optional, test locally first:** put `DATABASE_URL=<the string>` in `.env.local`, run `npm run dev`,
check the game server prints `Results database: on`, play one question, and look in Supabase →
Table Editor.

## 2. Render: the game server

1. render.com → sign in with GitHub → **New** → **Blueprint** → pick `Leleouch14/jackbox_2.0`.
   Render reads `render.yaml` (branch `main`, `npm ci`, `npm run start:game`, health check `/health`,
   `GAME_PRESET=event`).
2. It asks for the secret values:
   | Key | Value |
   |---|---|
   | `ADMIN_PIN` | the quizmaster PIN (longer than 1234) |
   | `DATABASE_URL` | the Supabase string from step 1 |
   | `PUBLIC_WEB_URL` | leave blank for now (step 4) |
   | `CORS_ORIGIN` | leave blank for now (step 4) |
3. **Apply**. When it's live, note its address, e.g. `https://hermes-quiz-game.onrender.com`.
   Open `<that address>/health`: it should say `ok`. The log should say `Results database: on`.

(Without the Blueprint: New → Web Service, same repo, branch `main`, Build `npm ci`, Start
`npm run start:game`, add the env vars above plus `GAME_PRESET=event`. Don't set a port: Render's
`PORT` is used automatically.)

## 3. Vercel: the website

1. vercel.com → **Add New** → **Project** → import `Leleouch14/jackbox_2.0`. It detects Next.js.
2. Production branch: `main` (the default).
3. Environment variable (before the first deploy; it's built into the pages):
   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SOCKET_URL` | the Render address from step 2, e.g. `https://hermes-quiz-game.onrender.com` (no port, no trailing slash) |
4. **Deploy**. Note the address, e.g. `https://hermes-quiz.vercel.app`.
   If you change `NEXT_PUBLIC_SOCKET_URL` later, **redeploy** (it's baked in at build time).

## 4. Back to Render: tell it the website's address

Render → the service → **Environment**:

| Key | Value |
|---|---|
| `PUBLIC_WEB_URL` | the Vercel address, e.g. `https://hermes-quiz.vercel.app` (the join link and QR code use it) |
| `CORS_ORIGIN` | the same Vercel address (only that site may connect) |

Save; Render restarts the server.

## 5. Check it end to end

1. `https://<vercel>/host` on the laptop: a room code and a QR code pointing to `https://<vercel>/play?code=…`.
2. `https://<vercel>/admin?code=…` on your phone, sign in with the PIN.
3. Join from 2–3 phones on mobile data (not just Wi-Fi), play one question to the reveal.
4. Supabase → Table Editor: a new row in `rooms` (e.g. `KJSC-2026-10-14T13:05`, time in UTC), the
   players with scores, and one `game_history` row per answer.
5. For a load test from a laptop: `npm run bots -- --room KJSC --count 80 --url https://<render>`.

## On the day

- **Wake the server 10 minutes before:** free Render servers sleep after 15 minutes without use and
  take up to a minute to wake. Open `https://<render>/health` and wait for `ok`.
- A **server restart ends the quiz** (the game lives in memory; Supabase keeps what was saved).
  Don't redeploy during the event.
- Results: Admin → Controls → **Results CSV** at the end, plus everything in Supabase.

## If something's wrong

| What you see | Likely cause |
|---|---|
| Host stuck on "Connecting…" | `NEXT_PUBLIC_SOCKET_URL` wrong or not redeployed after setting it; Render asleep (open `/health`) |
| Works on the laptop, not on phones | `CORS_ORIGIN` doesn't match the exact Vercel address (https, no trailing slash) |
| QR / join link shows a 192.168… address | `PUBLIC_WEB_URL` not set on Render |
| Render log: `[db] couldn't create tables: password authentication failed` | wrong password in `DATABASE_URL` |
| Render log: `ENOTFOUND` / timeout to `db.xxxx.supabase.co` | the Direct connection string: use **Session pooler** |
| Render log: `Results database: off` | `DATABASE_URL` not set on Render |
