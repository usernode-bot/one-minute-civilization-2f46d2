# One Minute Civilization

A very simple multiplayer game: a group steers one shared civilization
together. Each year, the settlement faces a **Current Event**, the
group has **60 seconds** to make **one collective decision**, and the
outcome of that choice becomes next year's starting point.

The full loop:

**Event → 60 seconds → One decision → Collective outcome → Consequence → Next year**

## Current state

This first version is a **static UI shell** only:

- The dashboard (Year, Population, Food, Wealth, Happiness, Nature)
  shows placeholder numbers.
- The Current Event section and its four choice buttons are inert —
  no decision logic, timer, or outcome yet.
- The History section shows a few placeholder past years.

Not implemented yet: multiplayer, authentication-driven game state,
database persistence of the civilization, the 60-second timer, random
events, and the decision/outcome loop itself. Those come next, one
mechanic at a time.

## Stack

Node.js / Express server, static HTML + Tailwind CSS frontend, per-app
Postgres database (unused so far). See `CLAUDE.md` for platform
conventions this app runs under.
