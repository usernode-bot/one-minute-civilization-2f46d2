const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { LEADERBOARD_SIZE, POLL_MS } = require('./leaderboard-config');
const {
  RACES_PER_DERBY,
  NAIL_TIERS,
  LOSS_POINTS,
  SPD_MIN,
  SPD_MAX,
  nailForOdds,
} = require('./nail-config');
const { yesterdayDerbyId, nailTotals, claimRaces } = require('./derby-totals');

const app = express();
const DRAIN_MS = 3000;
let shuttingDown = false;
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Gates seed DATA only, never a feature or code path.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// The derby the staging demo reads behind ?demo=1. Never a real day.
const DEMO_DERBY_ID = 'staging-demo';

// The six snails, in the Race Card's order. The page's SNAILS ids must match.
const SNAIL_IDS = ['cycle_o', 'drea', 'evan', 'lucas', 'scradio', 'snait'];

// The derby day is a UTC date, computed here and never taken from a client.
function todayDerby() {
  const date = new Date().toISOString().slice(0, 10);
  return { derbyId: 'daily-' + date, date };
}

// Who is playing. The linked HomeRoom wallet is the player; with no wallet
// linked, the platform user id stands in. There is no player table.
function playerKey(req) {
  return req.user.usernode_pubkey || 'user:' + req.user.id;
}

// Every key this player may have raced under: the wallet, and the platform
// user id they played as before linking one. Totals across days read all of
// them so linking a wallet never hides earlier races.
function playerKeys(req) {
  const keys = ['user:' + req.user.id];
  if (req.user.usernode_pubkey) keys.unshift(req.user.usernode_pubkey);
  return keys;
}

// The platform user id as stored on derby_races.user_id.
function userIdOf(req) {
  return String(req.user.id);
}

// The player's lifetime and yesterday's $NAIL, from their stored races.
function totalsFor(db, req) {
  return nailTotals(db, playerKeys(req), userIdOf(req), yesterdayDerbyId(new Date()), DEMO_DERBY_ID);
}

// One race's field: a speed gene per snail and fair odds with no house.
// A snail's chance is spd / sum(spd), so its odds are sum / spd, kept in
// integer tenths (9.3x is 93).
function makeSlate() {
  const spds = SNAIL_IDS.map(() => crypto.randomInt(SPD_MIN, SPD_MAX + 1));
  const sum = spds.reduce((a, b) => a + b, 0);
  return SNAIL_IDS.map((id, i) => ({
    id,
    spd: spds[i],
    oddsTenths: Math.round((sum * 10) / spds[i]),
  }));
}

// Draw the winner weighted by speed. Integers only, drawn at run time and
// never stored ahead of the pick.
function drawWinner(snails) {
  const sum = snails.reduce((a, s) => a + s.spd, 0);
  let roll = crypto.randomInt(sum);
  for (const s of snails) {
    if (roll < s.spd) return s.id;
    roll -= s.spd;
  }
  return snails[snails.length - 1].id;
}

function formatOdds(tenths) {
  return (tenths / 10).toFixed(1) + '\u00d7';
}

// The rules the page's "How it works" guide shows, straight from
// nail-config so the page never repeats them. Each tier is an odds range
// (`from` / `to` are null at the open ends) and its winning-pick reward.
function rulesView() {
  let prev = null;
  return {
    spdMin: SPD_MIN,
    spdMax: SPD_MAX,
    lossPoints: LOSS_POINTS,
    nailTiers: NAIL_TIERS.map(t => {
      const tier = {
        from: prev === null ? null : formatOdds(prev + 1),
        to: Number.isFinite(t.maxOddsTenths) ? formatOdds(t.maxOddsTenths) : null,
        points: t.points,
      };
      prev = t.maxOddsTenths;
      return tier;
    }),
  };
}

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

function ensureDerby(db, derbyId, date) {
  return db.query(
    `INSERT INTO daily_derbies (derby_id, derby_date) VALUES ($1, $2)
     ON CONFLICT (derby_id) DO NOTHING`,
    [derbyId, date]
  );
}

function raceView(r) {
  return {
    raceNumber: r.race_number,
    snails: r.snails.map(s => ({
      id: s.id,
      spd: s.spd,
      odds: formatOdds(s.oddsTenths),
      nail: nailForOdds(s.oddsTenths),
    })),
    result: r.resolved_at
      ? {
          pick: r.picked_snail,
          winner: r.winner_snail,
          won: r.picked_snail === r.winner_snail,
          nail: r.nail_awarded,
        }
      : null,
  };
}

// Today's slate for the signed-in player. The eight races are created on
// first read (safe under concurrent tabs) and read back; unresolved races
// have no winner yet, so nothing here can leak one.
app.get('/api/derby', async (req, res) => {
  try {
    const { derbyId, date } = todayDerby();
    const key = playerKey(req);
    await ensureDerby(pool, derbyId, date);
    for (let n = 1; n <= RACES_PER_DERBY; n++) {
      await pool.query(
        `INSERT INTO derby_races (derby_id, player_key, race_number, snails, user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (derby_id, player_key, race_number) DO NOTHING`,
        [derbyId, key, n, JSON.stringify(makeSlate()), userIdOf(req)]
      );
    }
    // Races stored before user ids were recorded become this player's for
    // good, so a later wallet change cannot hide them from the totals.
    await claimRaces(pool, playerKeys(req), userIdOf(req));
    const { rows } = await pool.query(
      `SELECT * FROM derby_races WHERE derby_id = $1 AND player_key = $2
        ORDER BY race_number`,
      [derbyId, key]
    );
    const totals = await totalsFor(pool, req);
    const current = rows.find(r => !r.resolved_at);
    res.json({
      derbyId,
      date,
      racesPerDerby: RACES_PER_DERBY,
      total: rows.reduce((a, r) => a + (r.nail_awarded || 0), 0),
      lifetimeTotal: totals.lifetimeTotal,
      yesterdayTotal: totals.yesterdayTotal,
      currentRace: current ? current.race_number : null,
      races: rows.map(raceView),
      rules: rulesView(),
    });
  } catch (err) {
    console.warn('derby query failed: ' + err.message);
    res.status(500).json({ error: 'Races unavailable' });
  }
});

// Pick and run one race in a single request. The server draws the winner,
// awards $NAIL by the pick's displayed odds and writes the player's running
// total to today's leaderboard. A resolved race is never run again: a
// repeat returns the stored result and awards nothing.
app.post('/api/derby/races/:n/run', async (req, res) => {
  const n = Number(req.params.n);
  const { derbyId, snailId } = req.body || {};
  const today = todayDerby();
  if (derbyId !== today.derbyId) {
    return res.status(409).json({ error: 'new_day' });
  }
  if (!Number.isInteger(n) || n < 1 || n > RACES_PER_DERBY) {
    return res.status(400).json({ error: 'bad_race' });
  }
  if (!SNAIL_IDS.includes(snailId)) {
    return res.status(400).json({ error: 'bad_snail' });
  }
  const key = playerKey(req);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM derby_races WHERE derby_id = $1 AND player_key = $2
        ORDER BY race_number FOR UPDATE`,
      [derbyId, key]
    );
    const race = rows.find(r => r.race_number === n);
    if (!race) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'no_slate' });
    }
    const sumOf = list => list.reduce((a, r) => a + (r.nail_awarded || 0), 0);
    if (race.resolved_at) {
      await client.query('ROLLBACK');
      const next = rows.find(r => !r.resolved_at);
      const totals = await totalsFor(pool, req);
      return res.json({
        raceNumber: n,
        pick: race.picked_snail,
        winner: race.winner_snail,
        won: race.picked_snail === race.winner_snail,
        nail: race.nail_awarded,
        total: sumOf(rows),
        lifetimeTotal: totals.lifetimeTotal,
        yesterdayTotal: totals.yesterdayTotal,
        nextRace: next ? next.race_number : null,
        alreadyResolved: true,
      });
    }
    const current = rows.find(r => !r.resolved_at);
    if (current.race_number !== n) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'out_of_order', currentRace: current.race_number });
    }
    const winner = drawWinner(race.snails);
    const picked = race.snails.find(s => s.id === snailId);
    const nail = winner === snailId ? nailForOdds(picked.oddsTenths) : LOSS_POINTS;
    const upd = await client.query(
      `UPDATE derby_races
          SET picked_snail = $4, winner_snail = $5, nail_awarded = $6,
              resolved_at = now()
        WHERE derby_id = $1 AND player_key = $2 AND race_number = $3
          AND resolved_at IS NULL`,
      [derbyId, key, n, snailId, winner, nail]
    );
    if (upd.rowCount !== 1) throw new Error('race already resolved');
    race.nail_awarded = nail;
    race.resolved_at = new Date();
    const total = sumOf(rows);
    // The totals that carry across days are summed from the player's stored
    // races, read inside this transaction so they include the race above.
    const totals = await totalsFor(client, req);
    // Only a linked HomeRoom wallet goes on the board. The timestamps move
    // only when the total changes, so a 0 $NAIL race never costs a tied
    // player their place: first to reach a total ranks higher.
    if (req.user.usernode_pubkey) {
      await client.query(
        `INSERT INTO leaderboard_entries
           (derby_id, wallet_address, total_points, submitted_at,
            verification_status, verified_at)
         VALUES ($1, $2, $3, now(), 'verified', now())
         ON CONFLICT (derby_id, wallet_address) DO UPDATE
           SET total_points = EXCLUDED.total_points,
               submitted_at = CASE
                 WHEN leaderboard_entries.total_points = EXCLUDED.total_points
                   THEN leaderboard_entries.submitted_at
                 ELSE EXCLUDED.submitted_at END,
               verification_status = 'verified',
               verified_at = CASE
                 WHEN leaderboard_entries.total_points = EXCLUDED.total_points
                   AND leaderboard_entries.verified_at IS NOT NULL
                   THEN leaderboard_entries.verified_at
                 ELSE EXCLUDED.verified_at END`,
        [derbyId, req.user.usernode_pubkey, total]
      );
    }
    await client.query('COMMIT');
    const next = rows.find(r => !r.resolved_at);
    res.json({
      raceNumber: n,
      pick: snailId,
      winner,
      won: winner === snailId,
      nail,
      total,
      lifetimeTotal: totals.lifetimeTotal,
      yesterdayTotal: totals.yesterdayTotal,
      nextRace: next ? next.race_number : null,
      alreadyResolved: false,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn('race run failed: ' + err.message);
    res.status(500).json({ error: 'Race failed' });
  } finally {
    if (client) client.release();
  }
});

// Today's Daily Derby Leaderboard of $NAIL. The derby day is a UTC date and
// each day is its own derby, so scores never mix between days. Only
// verified entries are listed; rank is computed here on read, never stored.
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { derbyId: todayId, date } = todayDerby();
    let derbyId = todayId;
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
    if (derbyId !== DEMO_DERBY_ID) await ensureDerby(pool, derbyId, derbyDate);
    // Wallet players only: legacy 'user:<id>' rows are never listed.
    const { rows } = await pool.query(
      `SELECT wallet_address, total_points, submitted_at
         FROM leaderboard_entries
        WHERE derby_id = $1 AND verification_status = 'verified'
          AND wallet_address NOT LIKE 'user:%'
        ORDER BY total_points DESC, verified_at ASC, wallet_address ASC
        LIMIT $2`,
      [derbyId, LEADERBOARD_SIZE]
    );
    // The viewer's own rank, over the same filter and order, so it shows
    // even outside the top list.
    const wallet = req.user.usernode_pubkey || null;
    let you = { hasWallet: false, rank: null, totalPoints: null };
    if (wallet) {
      const mine = await pool.query(
        `SELECT rank, total_points FROM (
           SELECT wallet_address, total_points,
                  ROW_NUMBER() OVER (
                    ORDER BY total_points DESC, verified_at ASC, wallet_address ASC
                  ) AS rank
             FROM leaderboard_entries
            WHERE derby_id = $1 AND verification_status = 'verified'
              AND wallet_address NOT LIKE 'user:%'
         ) ranked
         WHERE wallet_address = $2`,
        [derbyId, wallet]
      );
      you = mine.rows.length
        ? { hasWallet: true, rank: Number(mine.rows[0].rank), totalPoints: mine.rows[0].total_points }
        : { hasWallet: true, rank: null, totalPoints: 0 };
    }
    res.json({
      derbyId,
      date: derbyDate,
      pollMs: POLL_MS,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        walletAddress: r.wallet_address,
        totalPoints: r.total_points,
        submittedAt: r.submitted_at,
        verificationStatus: 'verified',
        isYou: !!wallet && r.wallet_address === wallet,
      })),
      you,
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

// `index: false`: without it express.static serves public/index.html
// straight off GET / (and any other directory-style path), before the
// catch-all below ever runs. That silently defeats the redirect just
// below it for exactly the request a pasted share link makes — the
// visitor lands on this bare, unauthenticated app subdomain instead of
// being sent through the platform's chromeless view. Every other static
// file (CSS/JS/images) is unaffected: this only turns off the implicit
// index-file lookup for a directory request.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
  // wallet_address is the player's HomeRoom wallet. Older rows may hold
  // 'user:<platform id>'; they are never listed. username is no longer
  // written or shown and is kept only to avoid a destructive migration.
  await pool.query(
    'ALTER TABLE leaderboard_entries ADD COLUMN IF NOT EXISTS username TEXT'
  );
  await pool.query(`
    CREATE INDEX IF NOT EXISTS leaderboard_entries_rank_idx
      ON leaderboard_entries
      (derby_id, verification_status, total_points DESC, verified_at ASC)`);
  // One row per race per player per derby. The primary key plus the
  // resolved_at IS NULL guard on update is what stops a race being replayed.
  // snails is the race's field: [{ id, spd, oddsTenths }] in roster order.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS derby_races (
      derby_id TEXT NOT NULL REFERENCES daily_derbies(derby_id),
      player_key TEXT NOT NULL,
      race_number SMALLINT NOT NULL CHECK (race_number BETWEEN 1 AND 8),
      snails JSONB NOT NULL,
      picked_snail TEXT,
      winner_snail TEXT,
      nail_awarded INTEGER,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (derby_id, player_key, race_number),
      CHECK (
        (picked_snail IS NULL AND winner_snail IS NULL
          AND nail_awarded IS NULL AND resolved_at IS NULL)
        OR (picked_snail IS NOT NULL AND winner_snail IS NOT NULL
          AND nail_awarded IS NOT NULL AND resolved_at IS NOT NULL)
      )
    )`);
  // Totals across days (lifetime, yesterday) are summed per player from
  // derby_races, so they need an index that leads with player_key.
  await pool.query(
    'CREATE INDEX IF NOT EXISTS derby_races_player_idx ON derby_races (player_key, derby_id)'
  );
  // The platform user id who ran the race. player_key is the wallet linked
  // at the time, so without this a wallet change would orphan past races.
  // Older rows are stamped here (no-wallet keys) or on the player's next
  // visit (wallet keys, see claimRaces).
  await pool.query('ALTER TABLE derby_races ADD COLUMN IF NOT EXISTS user_id TEXT');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS derby_races_user_idx ON derby_races (user_id)'
  );
  await pool.query(
    `UPDATE derby_races SET user_id = substring(player_key FROM 6)
      WHERE user_id IS NULL AND player_key LIKE 'user:%'`
  );
  // No longer read or written: it missed races run before it existed and
  // races run before a wallet was linked. Lifetime $NAIL is now summed from
  // derby_races. Kept only to avoid a destructive migration.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_lifetime_points (
      player_key TEXT PRIMARY KEY,
      total_points INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

// Staging only: a fixed demo derby read behind ?demo=1. Twelve fake
// ut1-style wallets, never the visitor, so the top-10 cut shows. Two share
// 1100 $NAIL to show the tiebreak (first to reach it ranks higher). The
// pending and rejected rows carry the highest points on purpose, so a broken
// filter is obvious at a glance. Races are never seeded: the race flow
// starts empty on staging exactly as in production.
async function seedStaging() {
  await pool.query(
    `INSERT INTO daily_derbies (derby_id, derby_date) VALUES ($1, '2026-09-28')
     ON CONFLICT (derby_id) DO NOTHING`,
    [DEMO_DERBY_ID]
  );
  // The board is wallet-only now: drop the old no-wallet demo player.
  await pool.query(
    `DELETE FROM leaderboard_entries
      WHERE derby_id = $1 AND wallet_address LIKE 'user:%'`,
    [DEMO_DERBY_ID]
  );
  const wallet = n => 'ut1stagingdemosnail' + String(n).padStart(21, '0');
  const rows = [
    [wallet(1), 1650, '03:22', 'verified'],
    [wallet(2), 1400, '04:11', 'verified'],
    [wallet(3), 1250, '05:43', 'verified'],
    [wallet(4), 1100, '06:18', 'verified'],
    [wallet(5), 1100, '06:40', 'verified'],
    [wallet(6), 950, '07:02', 'verified'],
    [wallet(7), 850, '07:15', 'verified'],
    [wallet(8), 750, '07:30', 'verified'],
    [wallet(9), 700, '07:48', 'verified'],
    [wallet(10), 600, '08:05', 'verified'],
    [wallet(11), 450, '08:20', 'verified'],
    [wallet(12), 250, '08:40', 'verified'],
    [wallet(13), 9999, '08:15', 'pending'],
    [wallet(14), 8888, '08:30', 'rejected'],
  ];
  // DO UPDATE, not DO NOTHING: these fixed demo rows replace older demo
  // values already sitting in a staging database.
  for (const [key, points, time, status] of rows) {
    const at = '2026-09-28T' + time + ':00Z';
    await pool.query(
      `INSERT INTO leaderboard_entries
         (derby_id, wallet_address, username, total_points, submitted_at,
          verification_status, verified_at)
       VALUES ($1, $2, NULL, $3, $4, $5,
               CASE WHEN $5 = 'verified' THEN $4::timestamptz + interval '1 minute' END)
       ON CONFLICT (derby_id, wallet_address) DO UPDATE
         SET username = NULL,
             total_points = EXCLUDED.total_points,
             submitted_at = EXCLUDED.submitted_at,
             verification_status = EXCLUDED.verification_status,
             verified_at = EXCLUDED.verified_at`,
      [DEMO_DERBY_ID, key, points, at, status]
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
