const test = require('node:test');
const assert = require('node:assert');
const { snailStandings } = require('../snail-standings');

// The same ids server.js passes in, in the Race Card's roster order.
const SNAIL_IDS = ['cycle_o', 'drea', 'evan', 'lucas', 'scradio', 'snait'];

// Runs the real query against Postgres when TEST_DATABASE_URL is set, in a
// throwaway schema so it never touches app data.
const DB_URL = process.env.TEST_DATABASE_URL;

test('standings count every player, exclude the demo derby and unresolved races, and break ties in roster order', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const { Pool } = require('pg');
  const schema = 'snail_standings_test_' + process.pid;
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    // Bare table: only the columns the standings query reads.
    await pool.query(`
      CREATE TABLE derby_races (
        derby_id TEXT NOT NULL,
        player_key TEXT NOT NULL,
        race_number SMALLINT NOT NULL,
        winner_snail TEXT,
        resolved_at TIMESTAMPTZ,
        PRIMARY KEY (derby_id, player_key, race_number)
      )`);
    const race = (derby, key, n, winner, resolved) => pool.query(
      `INSERT INTO derby_races (derby_id, player_key, race_number, winner_snail, resolved_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)`,
      [derby, key, n, winner, resolved]
    );
    // Cycle_o has three wins: a wallet player, a legacy 'user:<id>' player
    // whose races still count, and a zero-$NAIL resolved race (a loss is
    // resolved too and its winner still wins).
    await race('daily-2026-09-28', 'ut1wallet', 1, 'cycle_o', true);
    await race('daily-2026-09-29', 'user:7', 1, 'cycle_o', true);
    await race('daily-2026-09-30', 'ut1other', 1, 'cycle_o', true);
    // A tie on one win: Drea and Evan. Drea is earlier in the roster, so the
    // tie must keep her ahead of Evan.
    await race('daily-2026-09-29', 'ut1other', 1, 'evan', true);
    await race('daily-2026-09-30', 'user:7', 2, 'drea', true);
    // Lucas, Scradio and Snait never win and are still listed, in roster
    // order.
    // The staging demo derby never counts, however many races it holds.
    await race('staging-demo', 'ut1wallet', 1, 'snait', true);
    await race('staging-demo', 'ut1wallet', 2, 'snait', true);
    // An unresolved race has no winner yet and counts for nothing.
    await race('daily-2026-09-30', 'ut1wallet', 2, 'drea', false);

    assert.deepStrictEqual(
      await snailStandings(pool, SNAIL_IDS, 'staging-demo'),
      [
        { id: 'cycle_o', wins: 3 },
        { id: 'drea', wins: 1 },
        { id: 'evan', wins: 1 },
        { id: 'lucas', wins: 0 },
        { id: 'scradio', wins: 0 },
        { id: 'snait', wins: 0 },
      ]
    );
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});

test('standings are zero-filled and in roster order on an empty derby_races', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const { Pool } = require('pg');
  const schema = 'snail_standings_empty_' + process.pid;
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`
      CREATE TABLE derby_races (
        derby_id TEXT NOT NULL,
        player_key TEXT NOT NULL,
        race_number SMALLINT NOT NULL,
        winner_snail TEXT,
        resolved_at TIMESTAMPTZ,
        PRIMARY KEY (derby_id, player_key, race_number)
      )`);
    assert.deepStrictEqual(await snailStandings(pool, SNAIL_IDS, 'staging-demo'), [
      { id: 'cycle_o', wins: 0 },
      { id: 'drea', wins: 0 },
      { id: 'evan', wins: 0 },
      { id: 'lucas', wins: 0 },
      { id: 'scradio', wins: 0 },
      { id: 'snait', wins: 0 },
    ]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
