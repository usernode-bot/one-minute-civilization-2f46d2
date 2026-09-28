# Snail Derby

Six snails. Eight races. Pick your winners, earn $NAIL points, and discover
what your choices say about you.

The Daily Derby is free: 8 races, 6 snails. Pick a snail, watch the race,
earn $NAIL points, and climb the leaderboard. $NAIL is an internal game
points unit only.

## Current state (app shell)

- A single mobile-first page: header with the signed-in user's Homeroom
  wallet address (truncated, or "No wallet linked"), the intro, and a
  **Daily Derby** card with a static "Race 1 of 8 · Your score: 0 pts"
  placeholder.
- `GET /api/me` returns `{ username, wallet }` for the authenticated user
  (`wallet` is `req.user.usernode_pubkey`, or null).
- No race logic, odds, randomness, scoring or leaderboard yet.
- No database tables yet.

## Stack

Node.js / Express server, static HTML + precompiled Tailwind CSS frontend,
per-app Postgres database (currently unused). Auth is the platform's iframe
token injection. See `CLAUDE.md` for the platform conventions this app runs
under.
