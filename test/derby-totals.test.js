const test = require('node:test');
const assert = require('node:assert');
const { derbyIdFor, yesterdayDerbyId, nailTotals, raceHistory, groupHistory, claimRaces } = require('../derby-totals');

test('yesterday is the previous UTC day, across month and year ends', () => {
  assert.strictEqual(yesterdayDerbyId(new Date('2026-10-01T00:00:00Z')), 'daily-2026-09-30');
  assert.strictEqual(yesterdayDerbyId(new Date('2026-10-01T23:59:59Z')), 'daily-2026-09-30');
  assert.strictEqual(yesterdayDerbyId(new Date('2027-01-01T05:00:00Z')), 'daily-2026-12-31');
  assert.strictEqual(derbyIdFor(new Date('2026-09-28T12:00:00Z')), 'daily-2026-09-28');
});

test('groupHistory groups by day newest first, races by number, and sums each day', () => {
  const rows = [
    { derby_id: 'daily-2026-10-03', race_number: 2, picked_snail: 'lucas', winner_snail: 'evan', nail_awarded: 0 },
    { derby_id: 'daily-2026-10-04', race_number: 1, picked_snail: 'drea', winner_snail: 'drea', nail_awarded: 12 },
    { derby_id: 'daily-2026-10-03', race_number: 1, picked_snail: 'drea', winner_snail: 'drea', nail_awarded: 30 },
  ];
  assert.deepStrictEqual(groupHistory(rows), [
    {
      derbyId: 'daily-2026-10-04', date: '2026-10-04', total: 12,
      races: [{ raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 12 }],
    },
    {
      derbyId: 'daily-2026-10-03', date: '2026-10-03', total: 30,
      races: [
        { raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 30 },
        { raceNumber: 2, pick: 'lucas', winner: 'evan', won: false, nail: 0 },
      ],
    },
  ]);
  assert.deepStrictEqual(groupHistory([]), []);
});

// Runs the real query against Postgres when TEST_DATABASE_URL is set, in a
// throwaway schema so it never touches app data.
const DB_URL = process.env.TEST_DATABASE_URL;

test('totals sum every past day and every key the player raced under', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const { Pool } = require('pg');
  const schema = 'derby_totals_test_' + process.pid;
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`
      CREATE TABLE derby_races (
        derby_id TEXT NOT NULL,
        player_key TEXT NOT NULL,
        race_number SMALLINT NOT NULL,
        snails JSONB NOT NULL,
        picked_snail TEXT,
        winner_snail TEXT,
        nail_awarded INTEGER,
        resolved_at TIMESTAMPTZ,
        user_id TEXT,
        PRIMARY KEY (derby_id, player_key, race_number)
      )`);
    const race = (derby, key, n, nail) => pool.query(
      `INSERT INTO derby_races
         (derby_id, player_key, race_number, snails, picked_snail, winner_snail, nail_awarded, resolved_at)
       VALUES ($1, $2, $3, '[]', $5, $5, $4, CASE WHEN $4::int IS NULL THEN NULL ELSE now() END)`,
      [derby, key, n, nail, nail === null ? null : 'drea']
    );
    // Before the wallet was linked, two days ago.
    await race('daily-2026-09-29', 'user:7', 1, 100);
    await race('daily-2026-09-29', 'user:7', 2, 250);
    // Yesterday, as the wallet, plus an unrun race that counts for nothing.
    await race('daily-2026-09-30', 'ut1wallet', 1, 150);
    await race('daily-2026-09-30', 'ut1wallet', 2, 0);
    await race('daily-2026-09-30', 'ut1wallet', 3, null);
    // Today.
    await race('daily-2026-10-01', 'ut1wallet', 1, 100);
    // Someone else, and the staging demo derby: neither counts.
    await race('daily-2026-09-30', 'ut1other', 1, 250);
    await race('staging-demo', 'ut1wallet', 1, 999);

    assert.deepStrictEqual(
      await nailTotals(pool, ['ut1wallet', 'user:7'], '7', 'daily-2026-09-30', 'staging-demo'),
      { lifetimeTotal: 600, yesterdayTotal: 150 }
    );
    assert.deepStrictEqual(
      await nailTotals(pool, ['user:7'], '7', 'daily-2026-09-29', 'staging-demo'),
      { lifetimeTotal: 350, yesterdayTotal: 350 }
    );
    assert.deepStrictEqual(
      await nailTotals(pool, ['user:404'], '404', 'daily-2026-09-30', 'staging-demo'),
      { lifetimeTotal: 0, yesterdayTotal: 0 }
    );

    // The player claims their races, then links a different wallet and
    // races today under it: every earlier day still counts.
    await claimRaces(pool, ['ut1wallet', 'user:7'], '7');
    await pool.query(
      `INSERT INTO derby_races
         (derby_id, player_key, race_number, snails, picked_snail, winner_snail, nail_awarded, resolved_at, user_id)
       VALUES ('daily-2026-10-02', 'ut1newwallet', 1, '[]', 'drea', 'drea', 50, now(), '7')`
    );
    assert.deepStrictEqual(
      await nailTotals(pool, ['ut1newwallet', 'user:7'], '7', 'daily-2026-10-01', 'staging-demo'),
      { lifetimeTotal: 650, yesterdayTotal: 100 }
    );
    // Claiming never takes another player's races.
    assert.deepStrictEqual(
      await nailTotals(pool, ['ut1other'], '8', 'daily-2026-09-30', 'staging-demo'),
      { lifetimeTotal: 250, yesterdayTotal: 250 }
    );
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});

test('raceHistory reads the player\'s resolved races in the 7-day window', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const { Pool } = require('pg');
  const schema = 'derby_history_test_' + process.pid;
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`
      CREATE TABLE derby_races (
        derby_id TEXT NOT NULL,
        player_key TEXT NOT NULL,
        race_number SMALLINT NOT NULL,
        snails JSONB NOT NULL,
        picked_snail TEXT,
        winner_snail TEXT,
        nail_awarded INTEGER,
        resolved_at TIMESTAMPTZ,
        user_id TEXT,
        PRIMARY KEY (derby_id, player_key, race_number)
      )`);
    const race = (derby, key, n, pick, winner, nail, userId) => pool.query(
      `INSERT INTO derby_races
         (derby_id, player_key, race_number, snails, picked_snail, winner_snail, nail_awarded, resolved_at, user_id)
       VALUES ($1, $2, $3, '[]', $4, $5, $6,
               CASE WHEN $6::int IS NULL THEN NULL ELSE now() END, $7)`,
      [derby, key, n, pick, winner, nail, userId]
    );

    // The window runs from Oct 1 (inclusive) to Oct 8 (exclusive, today).
    await race('daily-2026-10-01', 'user:7', 1, 'drea', 'drea', 30, null);
    await race('daily-2026-10-03', 'ut1wallet', 1, 'drea', 'drea', 30, '7');
    await race('daily-2026-10-03', 'ut1wallet', 2, 'lucas', 'evan', 0, '7');
    await race('daily-2026-10-03', 'ut1wallet', 3, null, null, null, '7');
    // Raced under a wallet the player no longer has linked; user_id finds it.
    await race('daily-2026-10-04', 'ut1oldwallet', 1, 'snait', 'evan', 0, '7');
    // Each of these is left out: before the cutoff, another player, the
    // staging demo derby, and today.
    await race('daily-2026-09-30', 'ut1wallet', 1, 'drea', 'drea', 99, '7');
    await race('daily-2026-10-05', 'ut1other', 1, 'drea', 'drea', 88, '8');
    await race('staging-demo', 'ut1wallet', 1, 'drea', 'drea', 999, '7');
    await race('daily-2026-10-08', 'ut1wallet', 1, 'drea', 'drea', 50, '7');

    assert.deepStrictEqual(
      await raceHistory(pool, ['ut1wallet', 'user:7'], '7',
        'daily-2026-10-01', 'daily-2026-10-08', 'staging-demo'),
      [
        {
          derbyId: 'daily-2026-10-04', date: '2026-10-04', total: 0,
          races: [{ raceNumber: 1, pick: 'snait', winner: 'evan', won: false, nail: 0 }],
        },
        {
          derbyId: 'daily-2026-10-03', date: '2026-10-03', total: 30,
          races: [
            { raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 30 },
            { raceNumber: 2, pick: 'lucas', winner: 'evan', won: false, nail: 0 },
          ],
        },
        {
          derbyId: 'daily-2026-10-01', date: '2026-10-01', total: 30,
          races: [{ raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 30 }],
        },
      ]
    );
    // Another player sees only their own day.
    assert.deepStrictEqual(
      await raceHistory(pool, ['ut1other'], '8',
        'daily-2026-10-01', 'daily-2026-10-08', 'staging-demo'),
      [{
        derbyId: 'daily-2026-10-05', date: '2026-10-05', total: 88,
        races: [{ raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 88 }],
      }]
    );
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
