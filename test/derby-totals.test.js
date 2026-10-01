const test = require('node:test');
const assert = require('node:assert');
const { derbyIdFor, yesterdayDerbyId, nailTotals } = require('../derby-totals');

test('yesterday is the previous UTC day, across month and year ends', () => {
  assert.strictEqual(yesterdayDerbyId(new Date('2026-10-01T00:00:00Z')), 'daily-2026-09-30');
  assert.strictEqual(yesterdayDerbyId(new Date('2026-10-01T23:59:59Z')), 'daily-2026-09-30');
  assert.strictEqual(yesterdayDerbyId(new Date('2027-01-01T05:00:00Z')), 'daily-2026-12-31');
  assert.strictEqual(derbyIdFor(new Date('2026-09-28T12:00:00Z')), 'daily-2026-09-28');
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
      await nailTotals(pool, ['ut1wallet', 'user:7'], 'daily-2026-09-30', 'staging-demo'),
      { lifetimeTotal: 600, yesterdayTotal: 150 }
    );
    assert.deepStrictEqual(
      await nailTotals(pool, ['user:7'], 'daily-2026-09-29', 'staging-demo'),
      { lifetimeTotal: 350, yesterdayTotal: 350 }
    );
    assert.deepStrictEqual(
      await nailTotals(pool, ['user:404'], 'daily-2026-09-30', 'staging-demo'),
      { lifetimeTotal: 0, yesterdayTotal: 0 }
    );
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
