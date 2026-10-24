const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_LEVEL,
  XP_PER_TRAIN,
  TRAIN_SESSIONS_PER_DAY,
  RACERS,
  RACE_XP,
  TRACKS,
  xpToNext,
  levelProgress,
  speedMultiplier,
  boostMultiplier,
  energyCapacity,
  xpForPlace,
  trackFor,
  validateRace,
  readTraining,
  applyTraining,
  applyRace,
  rulesView,
} = require('../training');

test('the XP curve starts small and widens, until the last level', () => {
  assert.strictEqual(MAX_LEVEL, 10);
  assert.strictEqual(xpToNext(1), 20);
  assert.strictEqual(xpToNext(2), 30);
  assert.strictEqual(xpToNext(9), 100);
  assert.strictEqual(xpToNext(MAX_LEVEL), 0);
  for (let l = 1; l < MAX_LEVEL - 1; l++) {
    assert.ok(xpToNext(l + 1) > xpToNext(l), `level ${l} -> ${l + 1}`);
  }
});

test('levelProgress walks the cumulative XP, and caps at the last level', () => {
  assert.deepStrictEqual(levelProgress(0), { level: 1, into: 0, need: 20, maxed: false });
  assert.deepStrictEqual(levelProgress(19), { level: 1, into: 19, need: 20, maxed: false });
  assert.deepStrictEqual(levelProgress(20), { level: 2, into: 0, need: 30, maxed: false });
  assert.deepStrictEqual(levelProgress(55), { level: 3, into: 5, need: 40, maxed: false });
  let total = 0;
  for (let l = 1; l < MAX_LEVEL; l++) total += xpToNext(l);
  assert.deepStrictEqual(levelProgress(total), { level: MAX_LEVEL, into: 0, need: 0, maxed: true });
  assert.deepStrictEqual(levelProgress(total + 5000), { level: MAX_LEVEL, into: 0, need: 0, maxed: true });
  assert.deepStrictEqual(levelProgress(-5), { level: 1, into: 0, need: 20, maxed: false });
});

test('every level is faster, boosts harder and carries more tank', () => {
  assert.strictEqual(speedMultiplier(1), 1);
  assert.strictEqual(boostMultiplier(1), 1.6);
  assert.strictEqual(energyCapacity(1), 1);
  for (let l = 1; l < MAX_LEVEL; l++) {
    assert.ok(speedMultiplier(l + 1) > speedMultiplier(l), `speed ${l}`);
    assert.ok(boostMultiplier(l + 1) > boostMultiplier(l), `boost ${l}`);
    assert.ok(energyCapacity(l + 1) > energyCapacity(l), `energy ${l}`);
  }
  // Out-of-range levels clamp instead of inventing speed.
  assert.strictEqual(speedMultiplier(0), speedMultiplier(1));
  assert.strictEqual(speedMultiplier(99), speedMultiplier(MAX_LEVEL));
});

test('every finishing place pays XP, and only the places that exist do', () => {
  assert.strictEqual(RACE_XP.length, RACERS);
  for (let p = 1; p <= RACERS; p++) assert.ok(xpForPlace(p) > 0, `place ${p}`);
  assert.ok(xpForPlace(1) > xpForPlace(2));
  assert.ok(xpForPlace(2) > xpForPlace(3));
  assert.strictEqual(xpForPlace(0), 0);
  assert.strictEqual(xpForPlace(RACERS + 1), 0);
});

test('the three short tracks are distinct and get faster', () => {
  assert.strictEqual(TRACKS.length, 3);
  assert.strictEqual(new Set(TRACKS.map(t => t.id)).size, 3);
  for (const tr of TRACKS) {
    assert.ok(tr.name && tr.metres > 0 && tr.baseSeconds > 0);
    assert.ok(tr.pace > 0 && tr.rx > 0 && tr.ry > 0);
    assert.ok(/^#[0-9a-f]{6}$/i.test(tr.accent), `${tr.id} accent`);
    assert.strictEqual(trackFor(tr.id), tr);
  }
  assert.deepStrictEqual(TRACKS.map(t => t.pace), [0.72, 0.92, 1.08]);
  assert.ok(TRACKS[2].baseSeconds > TRACKS[0].baseSeconds);
  assert.strictEqual(trackFor('moon'), null);
});

test('a reported race must be a real track, place and time', () => {
  const tr = TRACKS[0];
  assert.deepStrictEqual(validateRace(tr.id, 1, Math.round(tr.baseSeconds * 1000)), {
    ok: true, track: tr, place: 1, timeMs: 15000,
  });
  assert.strictEqual(validateRace('moon', 1, 12000).error, 'bad_track');
  assert.strictEqual(validateRace(tr.id, 0, 12000).error, 'bad_place');
  assert.strictEqual(validateRace(tr.id, RACERS + 1, 12000).error, 'bad_place');
  assert.strictEqual(validateRace(tr.id, 1.5, 12000).error, 'bad_place');
  // Faster than twice the track's baseline cannot happen in this game.
  assert.strictEqual(validateRace(tr.id, 1, Math.round(tr.baseSeconds * 1000 / 2.5)).error, 'bad_time');
  assert.strictEqual(validateRace(tr.id, 1, 5 * 60 * 1000 + 1).error, 'bad_time');
  assert.strictEqual(validateRace(tr.id, 1, 12000.5).error, 'bad_time');
});

test('the rules view carries the boost rule the page runs on', () => {
  const r = rulesView();
  assert.strictEqual(r.sessionsPerDay, TRAIN_SESSIONS_PER_DAY);
  assert.strictEqual(r.xpPerTrain, XP_PER_TRAIN);
  assert.strictEqual(r.maxLevel, MAX_LEVEL);
  assert.strictEqual(r.racers, RACERS);
  assert.ok(r.boostDrain > 0 && r.energyRegen > 0);
  assert.ok(r.windMult < 1 && r.windMs > 0);
});

// Runs the real queries against Postgres when TEST_DATABASE_URL is set, in a
// throwaway schema so it never touches app data.
const DB_URL = process.env.TEST_DATABASE_URL;

test('training sessions, XP, races and best times settle in the database', { skip: !DB_URL && 'TEST_DATABASE_URL not set' }, async () => {
  const { Pool } = require('pg');
  const schema = 'training_test_' + process.pid;
  const pool = new Pool({ connectionString: DB_URL, max: 1 });
  const IDS = ['cycle_o', 'drea', 'evan'];
  const TODAY = '2026-10-17T00:00:00Z';
  const A = '42';
  const B = '43';
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`
      CREATE TABLE snail_training (
        user_id TEXT NOT NULL,
        snail_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
        races INTEGER NOT NULL DEFAULT 0 CHECK (races >= 0),
        wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
        bests JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, snail_id)
      )`);
    await pool.query(`
      CREATE TABLE training_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        snail_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(
      'CREATE INDEX training_sessions_day_idx ON training_sessions (user_id, snail_id, created_at)'
    );

    // Each call runs in its own transaction, as the server routes do (both
    // take the advisory lock for the transaction).
    const run = async (fn) => {
      await pool.query('BEGIN');
      try {
        const out = await fn();
        await pool.query('COMMIT');
        return out;
      } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        throw err;
      }
    };
    const read = () => readTraining(pool, A, IDS, TODAY);

    // A fresh player: every snail is level 1 with all three sessions left.
    let view = await read();
    assert.strictEqual(view.snails.length, 3);
    for (const s of view.snails) {
      assert.deepStrictEqual(
        [s.level, s.xp, s.races, s.wins, s.sessionsLeft],
        [1, 0, 0, 0, TRAIN_SESSIONS_PER_DAY]
      );
      assert.deepStrictEqual(s.bests, {});
    }

    // Three sessions a day, each +10 XP, then the fourth is refused.
    for (let i = 1; i <= TRAIN_SESSIONS_PER_DAY; i++) {
      assert.deepStrictEqual(await run(() => applyTraining(pool, A, 'drea', TODAY)), {});
      view = await read();
      const drea = view.snails.find(s => s.id === 'drea');
      assert.strictEqual(drea.xp, XP_PER_TRAIN * i);
      assert.strictEqual(drea.sessionsLeft, TRAIN_SESSIONS_PER_DAY - i);
    }
    assert.deepStrictEqual(await run(() => applyTraining(pool, A, 'drea', TODAY)), { error: 'no_sessions' });
    view = await read();
    assert.strictEqual(view.snails.find(s => s.id === 'drea').xp, XP_PER_TRAIN * TRAIN_SESSIONS_PER_DAY);
    assert.strictEqual(view.snails.find(s => s.id === 'drea').level, 2);

    // Another snail has its own sessions, and another player's are separate.
    assert.strictEqual(view.snails.find(s => s.id === 'evan').sessionsLeft, TRAIN_SESSIONS_PER_DAY);
    const bView = await readTraining(pool, B, IDS, TODAY);
    assert.strictEqual(bView.snails.find(s => s.id === 'drea').xp, 0);

    // Yesterday's sessions do not count against today.
    await pool.query(
      `UPDATE training_sessions SET created_at = $1::timestamptz - interval '1 day'`,
      [TODAY]
    );
    view = await read();
    assert.strictEqual(view.snails.find(s => s.id === 'drea').sessionsLeft, TRAIN_SESSIONS_PER_DAY);

    // A win pays its XP, counts a race and a win, and sets the best time.
    const tr = TRACKS[0];
    const first = await run(() => applyRace(pool, A, 'drea', tr.id, 1, 12000));
    assert.strictEqual(first.xpEarned, RACE_XP[0]);
    assert.strictEqual(first.newBest, true);
    view = await read();
    let drea = view.snails.find(s => s.id === 'drea');
    assert.strictEqual(drea.races, 1);
    assert.strictEqual(drea.wins, 1);
    assert.strictEqual(drea.bests[tr.id], 12000);

    // A slower run adds a race but keeps the best and does not add a win.
    const second = await run(() => applyRace(pool, A, 'drea', tr.id, 3, 13500));
    assert.strictEqual(second.newBest, false);
    assert.strictEqual(second.xpEarned, RACE_XP[2]);
    view = await read();
    drea = view.snails.find(s => s.id === 'drea');
    assert.strictEqual(drea.races, 2);
    assert.strictEqual(drea.wins, 1);
    assert.strictEqual(drea.bests[tr.id], 12000);

    // A faster run takes the best time.
    const third = await run(() => applyRace(pool, A, 'drea', tr.id, 2, 11000));
    assert.strictEqual(third.newBest, true);
    view = await read();
    assert.strictEqual(view.snails.find(s => s.id === 'drea').bests[tr.id], 11000);

    // Best times are per track, so another track starts its own.
    const other = TRACKS[1];
    await run(() => applyRace(pool, A, 'drea', other.id, 4, 14000));
    view = await read();
    drea = view.snails.find(s => s.id === 'drea');
    assert.strictEqual(drea.bests[tr.id], 11000);
    assert.strictEqual(drea.bests[other.id], 14000);
    assert.strictEqual(drea.races, 4);
    assert.strictEqual(drea.wins, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
