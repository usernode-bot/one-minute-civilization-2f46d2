const test = require('node:test');
const assert = require('node:assert');
const {
  derbyIdFor,
  yesterdayDerbyId,
  nailTotals,
  raceHistory,
  groupHistory,
  claimRaces,
} = require('../derby-totals');

const row = (derby, n, pick, winner, nail) => ({
  derby_id: derby,
  race_number: n,
  picked_snail: pick,
  winner_snail: winner,
  nail_awarded: nail,
});

test('groupHistory groups races by day, newest first, and sums each day', () => {
  const days = groupHistory([
    row('daily-2026-10-17', 2, 'evan', 'evan', 15),
    row('daily-2026-10-19', 3, 'snait', 'snait', 29),
    row('daily-2026-10-17', 1, 'cycle_o', 'drea', 0),
    row('daily-2026-10-19', 1, 'drea', 'drea', 12),
  ]);
  assert.deepStrictEqual(days.map(d => d.derbyId), ['daily-2026-10-19', 'daily-2026-10-17']);
  assert.deepStrictEqual(days.map(d => d.date), ['2026-10-19', '2026-10-17']);
  assert.deepStrictEqual(days.map(d => d.total), [41, 15]);
  // Races come back in race-number order, whatever order the rows arrived in.
  assert.deepStrictEqual(days[0].races.map(r => r.raceNumber), [1, 3]);
  assert.deepStrictEqual(days[1].races.map(r => r.raceNumber), [1, 2]);
  // won is the pick being the winner, and the miss names the real winner.
  assert.deepStrictEqual(days[0].races[0], { raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 12 });
  assert.deepStrictEqual(days[1].races[0], { raceNumber: 1, pick: 'cycle_o', winner: 'drea', won: false, nail: 0 });
  assert.strictEqual(groupHistory([]).length, 0);
});

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

// The same real-database test for the read-only history query: it must return
// the player's finished races from the seven-day window and nothing else.
test('raceHistory returns only the player\'s resolved races inside the window', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
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
         (derby_id, player_key, race_number, snails, picked_snail, winner_snail,
          nail_awarded, resolved_at, user_id)
       VALUES ($1, $2, $3, '[]', $4, $5, $6,
               CASE WHEN $4::text IS NULL THEN NULL ELSE now() END, $7)`,
      [derby, key, n, pick, winner, nail, userId || null]
    );
    // In the window: yesterday as the wallet, two days ago before linking.
    await race('daily-2026-10-19', 'ut1wallet', 1, 'drea', 'drea', 12);
    await race('daily-2026-10-19', 'ut1wallet', 2, 'lucas', 'evan', 0);
    await race('daily-2026-10-17', 'user:7', 1, 'snait', 'snait', 29, '7');
    // Another wallet's race stamped with this player's user id.
    await race('daily-2026-10-17', 'ut1oldwallet', 2, 'evan', 'evan', 15, '7');
    // Unresolved, today, older than the window, the demo derby and someone
    // else's race: none of these belong in the history.
    await race('daily-2026-10-19', 'ut1wallet', 3, null, null, null);
    await race('daily-2026-10-20', 'ut1wallet', 1, 'drea', 'drea', 50);
    await race('daily-2026-10-12', 'ut1wallet', 1, 'drea', 'drea', 99);
    await race('staging-demo', 'ut1wallet', 1, 'drea', 'drea', 999);
    await race('daily-2026-10-19', 'ut1other', 1, 'drea', 'drea', 250);

    assert.deepStrictEqual(
      await raceHistory(pool, ['ut1wallet', 'user:7'], '7', 'daily-2026-10-13', 'daily-2026-10-20', 'staging-demo'),
      [
        {
          derbyId: 'daily-2026-10-19',
          date: '2026-10-19',
          total: 12,
          races: [
            { raceNumber: 1, pick: 'drea', winner: 'drea', won: true, nail: 12 },
            { raceNumber: 2, pick: 'lucas', winner: 'evan', won: false, nail: 0 },
          ],
        },
        {
          derbyId: 'daily-2026-10-17',
          date: '2026-10-17',
          total: 44,
          races: [
            { raceNumber: 1, pick: 'snait', winner: 'snait', won: true, nail: 29 },
            { raceNumber: 2, pick: 'evan', winner: 'evan', won: true, nail: 15 },
          ],
        },
      ]
    );
    // A player whose only races are outside the window gets nothing.
    assert.deepStrictEqual(
      await raceHistory(pool, ['ut1stranger'], '404', 'daily-2026-10-13', 'daily-2026-10-20', 'staging-demo'),
      []
    );
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
