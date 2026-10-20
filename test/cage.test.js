const test = require('node:test');
const assert = require('node:assert');
const {
  CARE_COSTS,
  SHELL_IDS,
  HAT_IDS,
  NICKNAME_MAX,
  cleanNickname,
  validValue,
  readCage,
  applyCage,
} = require('../cage');

test('care costs, shell and hat lists, and the nickname limit', () => {
  assert.deepStrictEqual(CARE_COSTS, { feed: 25, clean: 25 });
  assert.deepStrictEqual(SHELL_IDS, ['own', 'violet', 'amber', 'emerald', 'rose']);
  assert.deepStrictEqual(HAT_IDS, ['none', 'top_hat', 'crown', 'bow', 'cap', 'flower']);
  assert.strictEqual(NICKNAME_MAX, 20);
});

test('cleanNickname trims, collapses spaces and resets on empty', () => {
  assert.strictEqual(cleanNickname(' Shelly '), 'Shelly');
  assert.strictEqual(cleanNickname('A   B'), 'A B');
  assert.strictEqual(cleanNickname(''), null);
  assert.strictEqual(cleanNickname('   '), null);
  assert.strictEqual(cleanNickname(null), null);
  assert.strictEqual(cleanNickname(undefined), null);
  assert.strictEqual(cleanNickname("O'Brien.X-1_"), "O'Brien.X-1_");
});

test('cleanNickname rejects names that are too long or carry markup', () => {
  assert.throws(() => cleanNickname('a'.repeat(21)), /bad nickname/);
  assert.strictEqual(cleanNickname('a'.repeat(20)), 'a'.repeat(20));
  assert.throws(() => cleanNickname('<b>Shelly</b>'), /bad nickname/);
  assert.throws(() => cleanNickname('🐌'), /bad nickname/);
  assert.throws(() => cleanNickname({}), /bad nickname/);
});

test('validValue accepts only the listed shell and hat ids', () => {
  SHELL_IDS.forEach(id => assert.ok(validValue('shell', id), 'shell ' + id));
  HAT_IDS.forEach(id => assert.ok(validValue('hat', id), 'hat ' + id));
  assert.strictEqual(validValue('shell', 'pink'), false);
  assert.strictEqual(validValue('shell', ''), false);
  assert.strictEqual(validValue('hat', 'beret'), false);
  assert.strictEqual(validValue('feed', null), false);
  assert.strictEqual(validValue('name', 'Shelly'), false);
});

// Runs the real queries against Postgres when TEST_DATABASE_URL is set, in
// a throwaway schema so it never touches app data.
const DB_URL = process.env.TEST_DATABASE_URL;

test('cage events settle balance, daily care and current look', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const { Pool } = require('pg');
  const schema = 'cage_test_' + process.pid;
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  const IDS = ['cycle_o', 'drea', 'evan'];
  const TODAY = '2026-10-17T00:00:00Z';
  const A = '42'; // platform user id of the player
  const B = '43';
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`
      CREATE TABLE cage_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        snail_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('name', 'shell', 'hat', 'feed', 'clean')),
        value TEXT,
        nail_spent INTEGER NOT NULL DEFAULT 0 CHECK (nail_spent >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    // applyCage takes an advisory XACT lock, so each call runs in a
    // transaction of its own, as the server route does.
    const apply = async (userId, snailId, kind, value, earned) => {
      await pool.query('BEGIN');
      try {
        const r = await applyCage(pool, userId, snailId, kind, value,
          earned == null ? 100 : earned, TODAY);
        await pool.query('COMMIT');
        return r;
      } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        throw err;
      }
    };
    const rows = () => pool.query('SELECT COUNT(*)::int AS n FROM cage_events').then(r => r.rows[0].n);

    // A fresh cage: nothing spent, every snail back to its own look.
    let cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.balance, 100);
    assert.strictEqual(cage.spent, 0);
    for (const s of cage.snails) {
      assert.deepStrictEqual(
        [s.nickname, s.shell, s.hat, s.fedToday, s.cleanToday],
        [null, 'own', 'none', false, false]
      );
    }

    // Feed lowers the balance by 25.
    assert.deepStrictEqual(await apply(A, 'drea', 'feed'), {});
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.balance, 75);
    assert.strictEqual(cage.snails[1].fedToday, true);

    // A second feed the same day is refused and spends nothing more.
    assert.deepStrictEqual(await apply(A, 'drea', 'feed'), { error: 'already_done' });
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.balance, 75);

    // The next day it is allowed again.
    await pool.query(
      `UPDATE cage_events SET created_at = created_at - interval '1 day'
        WHERE user_id = $1 AND kind = 'feed'`,
      [A]
    );
    assert.deepStrictEqual(await apply(A, 'drea', 'feed'), {});
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.balance, 50);
    assert.strictEqual(cage.snails[1].fedToday, true);

    // Not enough $NAIL: refused, and no row written.
    const before = await rows();
    assert.deepStrictEqual(await apply(A, 'evan', 'clean', null, 10), { error: 'not_enough' });
    assert.strictEqual(await rows(), before);

    // The latest shell wins, and a same-value write adds no row.
    await apply(A, 'drea', 'shell', 'violet');
    await apply(A, 'drea', 'shell', 'amber');
    const afterShells = await rows();
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.snails[1].shell, 'amber');
    assert.strictEqual(cage.balance, 50); // shells and hats are free
    assert.deepStrictEqual(await apply(A, 'drea', 'shell', 'amber'), {});
    assert.strictEqual(await rows(), afterShells);

    // Hats: default none, then crown.
    await apply(A, 'drea', 'hat', 'crown');
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.snails[1].hat, 'crown');

    // A name is set, then reset to the real one with an empty value.
    await apply(A, 'drea', 'name', 'Shelly');
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.snails[1].nickname, 'Shelly');
    await apply(A, 'drea', 'name', '');
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.snails[1].nickname, null);

    // Another user's rows never show, and their balance is their own.
    await apply(B, 'drea', 'shell', 'rose');
    cage = await readCage(pool, A, IDS, 100, TODAY);
    assert.strictEqual(cage.snails[1].shell, 'amber');
    const cageB = await readCage(pool, B, IDS, 100, TODAY);
    assert.strictEqual(cageB.snails[1].shell, 'rose');
    assert.strictEqual(cageB.balance, 100);
    assert.strictEqual(cageB.snails[1].fedToday, false);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
