const test = require('node:test');
const assert = require('node:assert');
const maps = require('../public/arena/maps.js');
const physics = require('../public/arena/physics.js');
const collision = require('../public/arena/collision.js');
const ai = require('../public/arena/ai.js');
const race = require('../public/arena/race.js');

const R = maps.SNAIL_R;
const tracks = maps.MAPS.map((m) => maps.getTrack(m.id));

function segsIntersect(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

test('there are five maps with distinct ids, layouts and lengths', () => {
  assert.strictEqual(maps.MAPS.length, 5);
  assert.strictEqual(new Set(maps.MAPS.map((m) => m.id)).size, 5);
  const lens = tracks.map((t) => Math.round(t.L));
  assert.strictEqual(new Set(lens).size, 5, 'lengths differ: ' + lens);
  const widths = new Set(maps.MAPS.map((m) => m.width));
  assert.ok(widths.size >= 4, 'track widths vary');
  for (const m of maps.MAPS) {
    assert.ok(m.name && m.description && m.difficultyLabel);
    assert.ok(m.theme.boundary && m.theme.decor.length);
  }
});

for (const tr of tracks) {
  test(`${tr.id}: circuit is closed, evenly sampled and does not cross itself`, () => {
    const first = tr.pts[0], last = tr.pts[tr.n - 1];
    assert.ok(Math.hypot(first.x - last.x, first.y - last.y) < tr.step * 1.5, 'last sample meets the first');
    for (let i = 0; i < tr.n; i++) {
      const a = tr.pts[i], b = tr.pts[(i + 1) % tr.n];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(d > tr.step * 0.5 && d < tr.step * 1.6, `sample ${i} spacing ${d}`);
    }
    for (let i = 0; i < tr.n; i++) {
      for (let j = i + 3; j < tr.n; j++) {
        if (i === 0 && j >= tr.n - 3) continue;
        assert.ok(!segsIntersect(tr.pts[i], tr.pts[(i + 1) % tr.n], tr.pts[j], tr.pts[(j + 1) % tr.n]), `crossing ${i}/${j}`);
      }
    }
  });

  test(`${tr.id}: separate stretches never overlap, so no section is disconnected or ambiguous`, () => {
    for (let i = 0; i < tr.n; i++) {
      for (let j = i + 1; j < tr.n; j++) {
        const arc = Math.min((j - i) * tr.step, tr.L - (j - i) * tr.step);
        if (arc < 600) continue;
        const d = Math.hypot(tr.pts[i].x - tr.pts[j].x, tr.pts[i].y - tr.pts[j].y);
        assert.ok(d > tr.halfW[i] + tr.halfW[j] + 28, `${i} and ${j} are ${d.toFixed(0)} apart`);
      }
    }
  });

  test(`${tr.id}: every turn is wider than the track, and the track fits a snail`, () => {
    for (let i = 0; i < tr.n; i++) {
      const k = Math.abs(tr.curv[i]);
      if (k > 1e-6) assert.ok(1 / k > tr.halfW[i] * 1.15, `radius ${(1 / k).toFixed(0)} vs half width ${tr.halfW[i].toFixed(0)} at ${i}`);
      assert.ok(tr.halfW[i] * 2 >= R * 2 * 2.6, 'wide enough for two snails abreast');
    }
  });

  test(`${tr.id}: obstacles and patches sit on the track and leave a way through`, () => {
    for (const o of tr.obstacles) {
      assert.ok(Math.abs(o.off) + o.r <= o.hw - 2, 'obstacle inside the walls');
      const gapRight = o.hw - (o.off + o.r), gapLeft = o.off - o.r + o.hw;
      assert.ok(Math.max(gapRight, gapLeft) >= R * 2 + 24, `gap ${Math.max(gapRight, gapLeft)} around ${o.kind}`);
    }
    for (let i = 0; i < tr.obstacles.length; i++) {
      for (let j = i + 1; j < tr.obstacles.length; j++) {
        const arc = Math.abs(tr.obstacles[i].s - tr.obstacles[j].s);
        assert.ok(arc > 120 || arc > tr.L - 120, 'obstacles are not stacked into a wall');
      }
    }
    for (const p of tr.patches) {
      const loc = maps.locate(tr, p.x, p.y, -1);
      assert.ok(loc.dist < loc.hw, 'patch centre on the track');
      assert.ok(maps.terrainAt(tr, p.x, p.y).kind === p.kind);
    }
    assert.ok(tr.patches.some((p) => p.speed < 1) , 'has slowing terrain');
  });

  test(`${tr.id}: checkpoints are ordered and the start grid is on the track behind the line`, () => {
    assert.strictEqual(tr.checkpoints.length, maps.CHECKPOINTS);
    for (let i = 1; i < tr.checkpoints.length; i++) assert.ok(tr.checkpoints[i].s > tr.checkpoints[i - 1].s);
    assert.strictEqual(tr.start.s, 0);
    for (let slot = 0; slot < 6; slot++) {
      const g = maps.gridSlot(tr, slot);
      const loc = maps.locate(tr, g.x, g.y, -1);
      assert.ok(Math.abs(loc.off) < loc.hw - R, `slot ${slot} inside walls`);
      assert.ok(g.progress < 0);
      for (let o = 0; o < tr.obstacles.length; o++) assert.ok(Math.hypot(g.x - tr.obstacles[o].x, g.y - tr.obstacles[o].y) > R + tr.obstacles[o].r + 10);
    }
  });

  test(`${tr.id}: AI opponents finish 3 laps on every difficulty, none stuck`, () => {
    for (const level of ['easy', 'normal', 'hard']) {
      const rc = race.createRace({ track: tr, laps: 3, difficulty: level, playerId: null, seed: 3 });
      let t = 0, wallBad = 0;
      while (rc.finishOrder.length < rc.racers.length && t < 400) {
        race.step(rc, 1 / 30, null);
        t += 1 / 30;
        for (const r of rc.racers) {
          const loc = maps.locate(tr, r.body.x, r.body.y, -1);
          if (Math.abs(loc.off) > loc.hw + 1) wallBad++;
        }
      }
      assert.strictEqual(rc.finishOrder.length, 6, `${tr.id}/${level}: only ${rc.finishOrder.length} finished by ${t.toFixed(0)}s`);
      assert.strictEqual(wallBad, 0, 'no snail left the track');
      assert.ok(rc.finishOrder[0].finishTime > 8, 'finishing is not instant');
    }
  });

  test(`${tr.id}: random steering never leaves the track or passes through obstacles`, () => {
    const rc = race.createRace({ track: tr, laps: 1, difficulty: 'normal', playerId: 'evan', seed: 1 });
    const rnd = maps.rng(99);
    let ang = 0, boost = false;
    for (let f = 0; f < 60 * 40; f++) {
      if (f % 20 === 0) { ang = rnd() * Math.PI * 2; boost = rnd() < 0.5; }
      race.step(rc, 1 / 60, { dx: Math.cos(ang), dy: Math.sin(ang), mag: 1, boost, brake: false });
      const b = rc.racers[rc.playerIndex].body;
      const loc = maps.locate(tr, b.x, b.y, -1);
      assert.ok(Math.abs(loc.off) <= loc.hw + 1, `frame ${f}: off ${loc.off} hw ${loc.hw}`);
      for (const o of tr.obstacles) assert.ok(Math.hypot(b.x - o.x, b.y - o.y) >= o.r + b.r - 3, 'inside an obstacle');
    }
  });
}

test('a player who drives the centreline finishes the race and wins results are ordered', () => {
  const tr = maps.getTrack('meadow');
  const rc = race.createRace({ track: tr, laps: 2, difficulty: 'easy', playerId: 'drea', seed: 5 });
  const pl = rc.racers[rc.playerIndex];
  const drv = ai.createDriver(tr, 'hard', 1);
  let t = 0;
  while (rc.phase !== 'finished' && t < 300) {
    const inp = ai.drive(tr, drv, pl, 1 / 60, rc.t);
    race.step(rc, 1 / 60, inp);
    t += 1 / 60;
  }
  assert.strictEqual(rc.phase, 'finished');
  const res = race.results(rc);
  assert.strictEqual(res.filter((r) => r.isPlayer).length, 1);
  assert.ok(res[0].finished);
  assert.deepStrictEqual(res.map((r) => r.place), [1, 2, 3, 4, 5, 6]);
});

test('lap and checkpoint counting follows the track order and ignores going backwards', () => {
  const tr = maps.getTrack('desert');
  const rc = race.createRace({ track: tr, laps: 2, difficulty: 'normal', playerId: 'evan', seed: 2 });
  const pl = rc.racers[rc.playerIndex];
  pl.isPlayer = true;
  const events = [];
  const put = (s) => {
    const p = maps.pointAt(tr, s);
    pl.body.x = p.x; pl.body.y = p.y; pl.body.vx = 0; pl.body.vy = 0;
    race.step(rc, 1 / 60, { dx: 0, dy: 0, mag: 0 });
    events.push(...race.drainEvents(rc).filter((e) => e.racer === pl));
  };
  // skip the countdown
  while (rc.phase === 'countdown') race.step(rc, 1 / 60, null);
  assert.strictEqual(pl.cpPassed, -1);
  const span = tr.cpSpan;
  for (let k = 0; k <= 8; k += 0.25) put(k * span - 0.0 + 1);
  const cps = events.filter((e) => e.type === 'checkpoint').map((e) => e.n);
  assert.deepStrictEqual(cps, [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(events.filter((e) => e.type === 'lap').length, 1, 'first lap counted once at the line');
  assert.strictEqual(pl.lapsDone, 1);
  // driving backwards over the line does not undo or double count
  const before = pl.max;
  for (let k = 8; k >= 7; k -= 0.25) put(k * span);
  for (let k = 7; k <= 8.5; k += 0.25) put(k * span + 1);
  assert.strictEqual(pl.lapsDone, 1);
  assert.ok(pl.max >= before);
  assert.strictEqual(pl.finished, false);
  // finish the second lap
  for (let k = 8.5; k <= 16.2; k += 0.25) put(k * span + 1);
  assert.strictEqual(pl.finished, true);
  assert.strictEqual(pl.lapsDone, 2);
  assert.strictEqual(rc.phase, 'finished');
});

test('the countdown holds everyone on the grid, then releases them', () => {
  const tr = maps.getTrack('forest');
  const rc = race.createRace({ track: tr, laps: 1, difficulty: 'normal', playerId: 'lucas', seed: 4 });
  const x0 = rc.racers.map((r) => r.body.x);
  const counts = [];
  for (let i = 0; i < 60 * 2.5; i++) { race.step(rc, 1 / 60, { dx: 1, dy: 0, mag: 1 }); counts.push(...race.drainEvents(rc).filter((e) => e.type === 'count').map((e) => e.n)); }
  assert.strictEqual(rc.phase, 'countdown');
  rc.racers.forEach((r, i) => assert.strictEqual(r.body.x, x0[i]));
  for (let i = 0; i < 60 * 1.5; i++) { race.step(rc, 1 / 60, null); counts.push(...race.drainEvents(rc).filter((e) => e.type === 'count').map((e) => e.n)); }
  assert.deepStrictEqual(counts, [3, 2, 1]);
  assert.strictEqual(rc.phase, 'racing');
  assert.ok(rc.racers.some((r, i) => r.body.x !== x0[i]));
});

test('physics: acceleration, top speed, boost, brake and terrain modifiers', () => {
  const run = (terrain, input, secs, mk) => {
    const b = physics.createBody(0, 0, 0, {});
    if (mk) mk(b);
    for (let i = 0; i < secs * 120; i++) physics.stepBody(b, input, terrain, 1 / 120);
    return b;
  };
  const road = { speed: 1, grip: 1, accel: 1 }, sand = { speed: 0.6, grip: 0.9, accel: 0.8 }, ice = { speed: 1, grip: 0.16, accel: 1 };
  const fwd = { dx: 1, dy: 0, mag: 1 };
  const early = run(road, fwd, 0.3);
  assert.ok(Math.hypot(early.vx, early.vy) < physics.CONFIG.maxSpeed * 0.6, 'accelerates, not instant');
  const top = run(road, fwd, 4);
  assert.ok(Math.abs(Math.hypot(top.vx, top.vy) - physics.CONFIG.maxSpeed) < 3);
  const slow = run(sand, fwd, 4);
  assert.ok(Math.hypot(slow.vx, slow.vy) < Math.hypot(top.vx, top.vy) * 0.7, 'sand slows');
  const fast = run(road, { ...fwd, boost: true }, 1.5);
  assert.ok(Math.hypot(fast.vx, fast.vy) > physics.CONFIG.maxSpeed * 1.2, 'boost is faster');
  const half = run(road, { dx: 1, dy: 0, mag: 0.5 }, 4);
  assert.ok(Math.abs(Math.hypot(half.vx, half.vy) - physics.CONFIG.maxSpeed * 0.5) < 5, 'analog intensity scales speed');
  const braked = run(road, { dx: 1, dy: 0, mag: 1, brake: true }, 0.4, (b) => { b.vx = 250; });
  assert.ok(Math.hypot(braked.vx, braked.vy) < 5, 'brake stops quickly');
  // no instant reversal at speed: heading turns at a bounded rate
  const turn = run(road, { dx: -1, dy: 0, mag: 1 }, 0.1, (b) => { b.vx = 250; });
  assert.ok(Math.abs(physics.angDiff(0, turn.heading)) < 0.5, 'turns gradually');
  assert.ok(turn.vx > 100, 'momentum carries on');
  // ice: steer 90 degrees at speed, velocity direction lags the heading
  const slide = run(ice, { dx: 0, dy: 1, mag: 1 }, 0.5, (b) => { b.vx = 250; });
  const grip = run(road, { dx: 0, dy: 1, mag: 1 }, 0.5, (b) => { b.vx = 250; });
  assert.ok(slide.vx > grip.vx + 60, 'slippery ground slides on');
  assert.ok(Math.abs(physics.angDiff(Math.atan2(slide.vy, slide.vx), slide.heading)) > 0.2, 'drift: heading and velocity disagree');
});

test('collisions: walls push out and bounce, snails separate, nothing stays embedded', () => {
  const tr = maps.getTrack('meadow');
  const p = maps.pointAt(tr, 600);
  const b = physics.createBody(p.x + p.nx * (p.hw + 30), p.y + p.ny * (p.hw + 30), 0, {});
  b.vx = p.nx * 200; b.vy = p.ny * 200;
  const loc = maps.locate(tr, b.x, b.y, -1);
  const im = collision.collideWalls(tr, b, loc);
  assert.ok(im > 100, 'reports the impact');
  assert.ok(Math.abs(maps.locate(tr, b.x, b.y, -1).off) <= p.hw - b.r + 0.5, 'back inside');
  assert.ok(b.vx * p.nx + b.vy * p.ny < 0, 'bounced away from the wall');
  const a1 = { x: 0, y: 0, vx: 100, vy: 0, r: 16 }, a2 = { x: 10, y: 0, vx: -100, vy: 0, r: 16 };
  assert.ok(collision.collideBodies(a1, a2) > 0);
  assert.ok(Math.hypot(a1.x - a2.x, a1.y - a2.y) >= 32 - 0.001);
});

test('a snail pressed into a wall can always drive away (no permanent sticking)', () => {
  for (const tr of tracks) {
    const rc = race.createRace({ track: tr, laps: 1, difficulty: 'normal', playerId: 'snait', seed: 8 });
    while (rc.phase === 'countdown') race.step(rc, 1 / 60, null);
    const pl = rc.racers[rc.playerIndex], p = maps.pointAt(tr, 300);
    pl.body.x = p.x + p.nx * (p.hw - 10); pl.body.y = p.y + p.ny * (p.hw - 10);
    for (let i = 0; i < 120; i++) race.step(rc, 1 / 60, { dx: p.nx, dy: p.ny, mag: 1 });
    const start = { x: pl.body.x, y: pl.body.y };
    for (let i = 0; i < 90; i++) race.step(rc, 1 / 60, { dx: -p.nx, dy: -p.ny, mag: 1 });
    assert.ok(Math.hypot(pl.body.x - start.x, pl.body.y - start.y) > 40, tr.id + ' still stuck');
  }
});
