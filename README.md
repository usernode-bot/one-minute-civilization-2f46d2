# Snail Derby

Six snails, one shared pot, no house. When a race starts, each snail's
speed gene is fixed by a future block hash and shown to everyone, and that
is the form players bet on.

## Current state (app shell)

- A single mobile-first page: header with the signed-in user's Homeroom
  wallet address (truncated, or "No wallet linked"), the intro, and a
  **Daily Derby** card with a static "Race 1 of 8 · Your score: 0 pts"
  placeholder.
- `GET /api/me` returns `{ username, wallet }` for the authenticated user
  (`wallet` is `req.user.usernode_pubkey`, or null).
- No race logic, odds, randomness, scoring, leaderboard or faucet yet.
- No database tables yet.

## Stack

Node.js / Express server, static HTML + precompiled Tailwind CSS frontend,
per-app Postgres database (currently unused). Auth is the platform's iframe
token injection. See `CLAUDE.md` for the platform conventions this app runs
under.
