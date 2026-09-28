# One Minute Civilization

This app has been stripped back to a clean, minimal base so it can be
rebuilt as a different game. There is currently no gameplay: the app
serves a single placeholder screen ("New game coming soon").

## Current state

- No game UI, client-side game logic, or game-specific API routes.
- No database tables.
- The platform scaffold is intact: bridge script tag, JWT auth
  middleware, dev-console forwarder, and graceful shutdown handling.

## Stack

Node.js / Express server, static HTML + Tailwind CSS frontend, per-app
Postgres database (currently unused). See `CLAUDE.md` for platform
conventions this app runs under.
