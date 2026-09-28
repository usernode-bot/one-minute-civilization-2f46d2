const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
// `/api/world-state` holds no per-user data - it's the one shared
// civilization every visitor watches - so it's public rather than gated,
// matching this step's "no authentication yet" scope.
// `/api/decision` submits the group's single collective choice for the
// round. Like `/api/world-state` it carries no per-user data - it's one
// shared civilization's decision, not anything scoped to a person - and
// this app has no auth flow wired up yet, so gating it would make it
// uncallable rather than safer. Revisit once real multiplayer/auth lands.
const PUBLIC_API_PATHS = new Set(['/health', '/api/world-state', '/api/decision']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// The World State: one centralized, in-memory object that represents the
// current civilization. Every screen and every future game mechanic
// (decisions, event outcomes, etc.) reads and writes through this single
// object rather than keeping its own copy of these numbers.
const worldState = {
  year: 1,
  population: 100,
  food: 100,
  wealth: 100,
  happiness: 100,
  nature: 100,
  // Tracks whether the group has already made its one decision for the
  // current round, and (once made) which stat deltas it applied - carried
  // here, not just applied to the totals above, so the client can render
  // the "Effects: ..." summary for anyone loading or polling this state,
  // not just the caller who made the decision. There is no year-advance
  // mechanic yet, so today this stays set once made until the process
  // restarts; a future year-advance feature should reset it back to nulls
  // when a new round starts.
  decision: {
    choiceId: null,
    madeAt: null,
    effects: null,
  },
};

// The one path by which any World State field may change. Decision
// resolution and future event logic should call this instead of writing
// to `worldState` directly, so there is always a single, auditable place
// mutations happen.
function updateWorldState(partialChanges) {
  const allowedKeys = new Set(Object.keys(worldState));
  for (const key of Object.keys(partialChanges || {})) {
    if (!allowedKeys.has(key)) {
      throw new Error(`updateWorldState: unknown world state field "${key}"`);
    }
  }
  Object.assign(worldState, partialChanges);
  return worldState;
}

// Demonstrates the mutation path this app's future game logic will use.
// A no-op today (nothing here changes yet) - it just proves the single
// mutation path works before any real decision or event calls it.
updateWorldState({});

// The four choices for the current round's Current Event, and their
// effects. This is the single source of truth for what each choice does -
// tweak an entry here to change the game balance, nothing else to touch.
const CHOICES = {
  produce_food: { label: 'Produce Food', effects: { food: 15, happiness: 2, nature: -3 } },
  gather_wood: { label: 'Gather Wood', effects: { wealth: 5, nature: -5, happiness: 1 } },
  research: { label: 'Research', effects: { wealth: 3, happiness: 3, food: -2 } },
  build_housing: { label: 'Build Housing', effects: { population: 5, happiness: 5, wealth: -5, nature: -2 } },
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/world-state', (_req, res) => res.json(worldState));

app.post('/api/decision', (req, res) => {
  const choiceId = req.body && req.body.choice;
  const choice = CHOICES[choiceId];
  if (!choice) {
    return res.status(400).json({ error: 'Unknown choice' });
  }
  if (worldState.decision.choiceId) {
    return res.status(409).json({ error: 'A decision has already been made this round', worldState });
  }

  const partialChanges = {};
  for (const [field, delta] of Object.entries(choice.effects)) {
    partialChanges[field] = worldState[field] + delta;
  }
  // Carried on `decision` (not just applied to totals) so GET
  // /api/world-state can render the "You chose X / Effects: ..." summary
  // for anyone loading or polling the shared state, not just the caller
  // who made the decision.
  partialChanges.decision = { choiceId, madeAt: new Date().toISOString(), effects: choice.effects };
  updateWorldState(partialChanges);

  res.json(worldState);
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/one-minute-civilization-2f46d2/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/one-minute-civilization-2f46d2/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const DRAIN_MS = 3000;
let shuttingDown = false;

async function start() {
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
    try {
      await pool.end();
    } catch (err) {
      console.error('[shutdown] pool.end failed', err.message);
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });
