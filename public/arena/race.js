// Race state: grid, countdown, fixed-step simulation, laps, checkpoints,
// standings and finish detection. Pure and DOM-free so it runs under Node.
(function (root, factory) {
  var node = typeof module !== 'undefined' && module.exports;
  var deps = node
    ? { maps: require('./maps.js'), physics: require('./physics.js'), collision: require('./collision.js'), ai: require('./ai.js') }
    : { maps: root.SnailArena.maps, physics: root.SnailArena.physics, collision: root.SnailArena.collision, ai: root.SnailArena.ai };
  var api = factory(deps);
  if (node) module.exports = api;
  else { root.SnailArena = root.SnailArena || {}; root.SnailArena.race = api; }
})(this, function (d) {
  var maps = d.maps, physics = d.physics, collision = d.collision, ai = d.ai;
  var H = 1 / 120;            // fixed simulation step, seconds
  var COUNTDOWN = 3;          // seconds of 3, 2, 1 before the start
  var GO_FLASH = 0.7;

  // Same six snails as the Daily Derby. Arena stats differ by a couple of
  // percent only, so the pick is about looks and the race is about driving.
  var SNAILS = [
    { id: 'cycle_o', name: 'Cyrcle_0', color: '#84cc16', shell: '#a3e635', pattern: 'solid', stats: { speed: 1.0, accel: 1.0 } },
    { id: 'drea', name: 'Drea', color: '#ec4899', shell: '#f9a8d4', pattern: 'dotted', stats: { speed: 0.99, accel: 1.04 } },
    { id: 'evan', name: 'Evan', color: '#14b8a6', shell: '#5eead4', pattern: 'striped', stats: { speed: 1.01, accel: 0.97 } },
    { id: 'lucas', name: 'Lucas', color: '#f97316', shell: '#fdba74', pattern: 'double', stats: { speed: 1.0, accel: 1.02 } },
    { id: 'scradio', name: 'Scraido', color: '#94a3b8', shell: '#cbd5e1', pattern: 'checkered', stats: { speed: 0.99, accel: 1.0 } },
    { id: 'snait', name: 'Snait', color: '#0ea5e9', shell: '#7dd3fc', pattern: 'dashed', stats: { speed: 1.01, accel: 0.98 } }
  ];

  // opts: { track, laps, difficulty, playerId (snail id or null for AI only), seed }
  function createRace(opts) {
    var track = opts.track, laps = Math.max(1, opts.laps || 2);
    var race = {
      track: track, laps: laps, difficulty: opts.difficulty || 'normal',
      phase: 'countdown', t: 0, clock: 0, countdown: COUNTDOWN + GO_FLASH, lastCount: 4,
      racers: [], events: [], finishOrder: [], acc: 0, playerIndex: -1, playerFinished: false
    };
    var order = SNAILS.slice();
    // the player's snail starts on the second row; the rest fill the grid in a fixed order
    var slots = [0, 1, 2, 3, 4, 5];
    var playerSlot = 2;
    var others = order.filter(function (s) { return s.id !== opts.playerId; });
    var ordered = [];
    for (var i = 0; i < 6; i++) ordered[i] = null;
    if (opts.playerId) {
      ordered[playerSlot] = order.filter(function (s) { return s.id === opts.playerId; })[0];
    }
    for (i = 0; i < 6; i++) if (!ordered[i]) ordered[i] = others.shift();
    ordered.forEach(function (sn, slot) {
      var g = maps.gridSlot(track, slots[slot]);
      var body = physics.createBody(g.x, g.y, g.heading, sn.stats);
      var isPlayer = !!opts.playerId && sn.id === opts.playerId;
      var r = {
        snail: sn, slot: slot, isPlayer: isPlayer, body: body, loc: null,
        prevS: 0, total: g.progress, max: g.progress, cpPassed: -1, lapsDone: 0,
        finished: false, finishTime: null, place: null, bumpCd: 0, lapTimes: [], lapStart: 0,
        driver: ai.createDriver(track, race.difficulty, (opts.seed || 7) * 31 + slot * 17 + 3),
        input: { dx: 0, dy: 0, mag: 0, boost: false, brake: false }
      };
      r.loc = maps.locate(track, body.x, body.y, -1);
      r.prevS = r.loc.s;
      if (isPlayer) race.playerIndex = race.racers.length;
      race.racers.push(r);
    });
    race.standings = race.racers.slice();
    return race;
  }

  function pushEvent(race, ev) { race.events.push(ev); }

  function updateProgress(race, r) {
    var tr = race.track;
    var loc = maps.locate(tr, r.body.x, r.body.y, r.loc.idx, 14);
    r.loc = loc;
    var delta = loc.s - r.prevS;
    if (delta > tr.L / 2) delta -= tr.L; else if (delta < -tr.L / 2) delta += tr.L;
    r.prevS = loc.s;
    r.total += delta;
    if (r.total > r.max) r.max = r.total;
    var cp = Math.floor(r.max / tr.cpSpan);
    while (r.cpPassed < cp) {
      r.cpPassed++;
      var n = r.cpPassed, perLap = maps.CHECKPOINTS;
      if (n > 0 && n % perLap === 0) {
        r.lapsDone = n / perLap;
        r.lapTimes.push(race.t - r.lapStart); r.lapStart = race.t;
        pushEvent(race, { type: r.lapsDone >= race.laps ? 'finishline' : 'lap', racer: r, lap: r.lapsDone });
      } else if (n > 0) {
        pushEvent(race, { type: 'checkpoint', racer: r, n: n % perLap, total: perLap });
      }
    }
    if (!r.finished && r.max >= race.laps * tr.L) {
      r.finished = true;
      // interpolate back to the exact crossing so close finishes order correctly
      var over = (r.max - race.laps * tr.L) / Math.max(30, Math.hypot(r.body.vx, r.body.vy));
      r.finishTime = Math.max(0, race.t - over);
      race.finishOrder.push(r);
      r.place = race.finishOrder.length;
      pushEvent(race, { type: 'finish', racer: r, place: r.place });
    }
  }

  function simStep(race, playerInput) {
    var tr = race.track, racers = race.racers, i, j;
    var racing = race.phase !== 'countdown';
    if (racing) race.t += H;
    for (i = 0; i < racers.length; i++) {
      var r = racers[i], inp;
      if (!racing) inp = { dx: 0, dy: 0, mag: 0, boost: false, brake: false };
      else if (r.isPlayer && !r.finished) inp = playerInput || r.input;
      else inp = ai.drive(tr, r.driver, r, H, race.t);
      r.input = inp;
      var terr = maps.terrainAt(tr, r.body.x, r.body.y);
      if (racing) {
        if (terr.kind === 'boost' && (!r.body.terrain || r.body.terrain.kind !== 'boost')) {
          pushEvent(race, { type: 'boostpad', racer: r });
        }
        physics.stepBody(r.body, inp, terr, H);
        r.body.terrain = terr;
      }
      if (r.bumpCd > 0) r.bumpCd -= H;
    }
    for (i = 0; i < racers.length; i++) {
      var a = racers[i], b = a.body, impact = 0, kind = null;
      var ob = collision.collideObstacles(tr, b);
      if (ob.impact > impact) { impact = ob.impact; kind = 'obstacle'; }
      for (j = i + 1; j < racers.length; j++) {
        var im = collision.collideBodies(b, racers[j].body);
        if (im > 40 && a.bumpCd <= 0 && racing) {
          pushEvent(race, { type: 'bump', racer: a, other: racers[j], impact: im, kind: 'snail', x: b.x, y: b.y });
          a.bumpCd = 0.25;
        }
      }
      var loc = maps.locate(tr, b.x, b.y, a.loc.idx, 14);
      var wi = collision.collideWalls(tr, b, loc);
      if (wi > impact) { impact = wi; kind = 'wall'; }
      // a second pass settles an obstacle pushed against a wall
      collision.collideObstacles(tr, b);
      var loc2 = maps.locate(tr, b.x, b.y, loc.idx, 14);
      collision.collideWalls(tr, b, loc2);
      if (impact > 60 && a.bumpCd <= 0 && racing) {
        pushEvent(race, { type: 'bump', racer: a, impact: impact, kind: kind, x: b.x, y: b.y });
        a.bumpCd = 0.25;
      }
      updateProgress(race, a);
    }
    race.standings = racers.slice().sort(function (p, q) {
      if (p.finished && q.finished) return p.place - q.place;
      if (p.finished) return -1;
      if (q.finished) return 1;
      return q.max - p.max;
    });
    if (race.phase === 'racing') {
      var pl = race.playerIndex >= 0 ? racers[race.playerIndex] : null;
      if (pl ? pl.finished : race.finishOrder.length === racers.length) {
        race.phase = 'finished';
        pushEvent(race, { type: 'raceover' });
      }
    }
  }

  // Advance by real elapsed seconds using fixed slices.
  function step(race, dt, playerInput) {
    race.acc += Math.min(dt, 0.1);
    race.clock += Math.min(dt, 0.1);
    while (race.acc >= H) {
      race.acc -= H;
      if (race.phase === 'countdown') {
        race.countdown -= H;
        var c = Math.ceil(race.countdown - GO_FLASH);
        if (c !== race.lastCount) {
          race.lastCount = c;
          if (c > 0) pushEvent(race, { type: 'count', n: c });
        }
        if (race.countdown <= GO_FLASH) {
          race.phase = 'racing';
          pushEvent(race, { type: 'go' });
        }
      }
      simStep(race, playerInput);
    }
  }

  function drainEvents(race) { var e = race.events; race.events = []; return e; }

  function position(race, racer) { return race.standings.indexOf(racer) + 1; }

  function results(race) {
    return race.standings.map(function (r, i) {
      return { place: i + 1, snail: r.snail, isPlayer: r.isPlayer, finished: r.finished,
        time: r.finishTime, lapTimes: r.lapTimes.slice(), progress: r.max / (race.laps * race.track.L) };
    });
  }

  return { H: H, COUNTDOWN: COUNTDOWN, SNAILS: SNAILS, createRace: createRace, step: step,
    drainEvents: drainEvents, position: position, results: results };
});
