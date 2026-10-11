# Archive

Code that is **not used** by the live quiz, kept for reference and credit.

## `ws-backend-v1/`: the first backend prototype (Lelouch)

A raw-WebSocket (`ws`) server on port 8080 with one round of questions, where the Host
moves the quiz forward. It was written before the rules settled (two rounds, Admin with a PIN,
a 6-player buzzer round, bots, reconnects), so the frontend never ran on it.

What lives on from it: **its database design.** `db.js` defined the Supabase tables `rooms`,
`players` and `game_history`; the live game server saves into exactly those tables
(see [`server/db.ts`](../server/db.ts), which only adds a few columns).

Why it was archived instead of finished: [`docs/PROJECT-RULES.md`](../docs/PROJECT-RULES.md),
section 8.9. Its git history is intact (`git log --follow archive/ws-backend-v1/server.js`).

Don't deploy or run it against the Supabase database: it doesn't follow the contract in
`src/shared/protocol.ts`.
