# One Minute Civilization

A very simple multiplayer game: a group steers one shared civilization
together. Each year, the settlement faces a **Current Event**, the
group has **60 seconds** to make **one collective decision**, and the
outcome of that choice becomes next year's starting point.

The full loop:

**Event → 60 seconds → One decision → Collective outcome → Consequence → Next year**

## Current state

The **World State** is now real: a single centralized, in-memory object
on the server (`worldState` in `server.js`) holds Year, Population, Food,
Wealth, Happiness and Nature. The dashboard fetches it from
`GET /api/world-state` and polls it every few seconds, so it always
reflects the server's current numbers rather than hardcoded placeholders.
Any future game logic mutates that same object through the single
`updateWorldState(partialChanges)` function — no other code path is
allowed to change it.

The Current Event section and its four choice buttons are still inert —
no decision logic, timer, or outcome yet. The History section shows a
few placeholder past years.

Not implemented yet: multiplayer, authentication-driven game state,
persistent (database-backed) world state, the 60-second timer, random
events, and the decision/outcome loop itself. Those come next, one
mechanic at a time.

## Stack

Node.js / Express server, static HTML + Tailwind CSS frontend, per-app
Postgres database (not yet used for game state — the World State is
in-memory for now). See `CLAUDE.md` for platform conventions this app
runs under.
