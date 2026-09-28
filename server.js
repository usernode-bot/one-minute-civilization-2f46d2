const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const {
  DAILY_PRIZES_HR,
  LEADERBOARD_SIZE,
  POLL_MS,
} = require('./leaderboard-config');

const app = express();
const DRAIN_MS = 3000;
let shuttingDown = false;
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Gates seed DATA only, never a feature or code path.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// The derby the staging demo reads behind ?demo=1. Never a real day.
const DEMO_DERBY_ID = 'staging-demo';

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
const PUBLIC_API_PATHS = new Set(['/health']);

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

app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  res.json({ status: 'ok' });
});

// The signed-in user's identity for the header. `usernode_pubkey` is the
// linked Homeroom wallet address, or null when none is linked.
app.get('/api/me', (req, res) => {
  res.json({
    username: req.user.username || null,
    wallet: req.user.usernode_pubkey || null,
  });
});

// Today's Daily Derby Leaderboard. The derby day is a UTC date and each day
// is its own derby, so scores never mix between days. Only verified entries
// are listed; rank and reward are computed here on read, never stored.
app.get('/api/leaderboard', async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    let derbyId = 'daily-' + date;
    let derbyDate = date;
    if (IS_STAGING && req.query.demo === '1') {
      const demo = await pool.query(
        `SELECT to_char(derby_date, 'YYYY-MM-DD') AS date
           FROM daily_derbies WHERE derby_id = $1`,
        [DEMO_DERBY_ID]
      );
      if (demo.rows.length) {
        derbyId = DEMO_DERBY_ID;
        derbyDate = demo.rows[0].date;
      }
    }
    if (derbyId !== DEMO_DERBY_ID) {
      await pool.query(
        `INSERT INTO daily_derbies (derby_id, derby_date) VALUES ($1, $2)
         ON CONFLICT (derby_id) DO NOTHING`,
        [derbyId, derbyDate]
      );
    }
    const { rows } = await pool.query(
      `SELECT wallet_address, total_points, submitted_at
         FROM leaderboard_entries
        WHERE derby_id = $1 AND verification_status = 'verified'
        ORDER BY total_points DESC, verified_at ASC, wallet_address ASC
        LIMIT $2`,
      [derbyId, LEADERBOARD_SIZE]
    );
    const me = req.user.usernode_pubkey || null;
    res.json({
      derbyId,
      date: derbyDate,
      pollMs: POLL_MS,
      prizesHr: DAILY_PRIZES_HR,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        walletAddress: r.wallet_address,
        totalPoints: r.total_points,
        submittedAt: r.submitted_at,
        reward: i < DAILY_PRIZES_HR.length ? DAILY_PRIZES_HR[i] : null,
        verificationStatus: 'verified',
        isYou: !!me && r.wallet_address === me,
      })),
    });
  } catch (err) {
    console.warn('leaderboard query failed: ' + err.message);
    res.status(500).json({ error: 'Leaderboard unavailable' });
  }
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


// Schema, applied idempotently on every boot. Both tables are public: the
// leaderboard is meant to be seen and holds only wallet addresses and points.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_derbies (
      derby_id TEXT PRIMARY KEY,
      derby_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS daily_derbies_date_idx ON daily_derbies (derby_date)'
  );
  // One entry per HomeRoom wallet per derby. The wallet address IS the
  // player; there is no separate player table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leaderboard_entries (
      derby_id TEXT NOT NULL REFERENCES daily_derbies(derby_id),
      wallet_address TEXT NOT NULL,
      total_points INTEGER NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'rejected')),
      verified_at TIMESTAMPTZ,
      PRIMARY KEY (derby_id, wallet_address),
      CHECK (verification_status <> 'verified' OR verified_at IS NOT NULL)
    )`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS leaderboard_entries_rank_idx
      ON leaderboard_entries
      (derby_id, verification_status, total_points DESC, verified_at ASC)`);
}

// Staging only: a fixed demo derby read behind ?demo=1. Fake ut1-style
// wallets, never the visitor. The pending and rejected rows carry the
// highest points on purpose, so a broken filter is obvious at a glance.
async function seedStaging() {
  await pool.query(
    `INSERT INTO daily_derbies (derby_id, derby_date) VALUES ($1, '2026-09-28')
     ON CONFLICT (derby_id) DO NOTHING`,
    [DEMO_DERBY_ID]
  );
  const wallet = n => 'ut1stagingdemosnail' + String(n).padStart(21, '0');
  const rows = [
    [1, 2431, '03:22', 'verified'],
    [2, 2298, '04:11', 'verified'],
    [3, 2187, '05:43', 'verified'],
    [4, 2051, '06:18', 'verified'],
    [5, 2051, '06:40', 'verified'],
    [6, 1987, '07:02', 'verified'],
    [7, 9999, '08:15', 'pending'],
    [8, 8888, '08:30', 'rejected'],
  ];
  for (const [n, points, time, status] of rows) {
    const at = '2026-09-28T' + time + ':00Z';
    await pool.query(
      `INSERT INTO leaderboard_entries
         (derby_id, wallet_address, total_points, submitted_at,
          verification_status, verified_at)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $5 = 'verified' THEN $4::timestamptz + interval '1 minute' END)
       ON CONFLICT (derby_id, wallet_address) DO NOTHING`,
      [DEMO_DERBY_ID, wallet(n), points, at, status]
    );
  }
}

async function start() {
  // A missing database (a plain local run) should not take the page down:
  // log it and serve, and the leaderboard shows its unavailable state.
  try {
    await migrate();
    if (IS_STAGING) await seedStaging();
  } catch (err) {
    console.warn('[db] migration failed: ' + err.message);
  }

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
