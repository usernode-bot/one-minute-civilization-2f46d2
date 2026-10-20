// AI drivers. Each AI follows the centreline with a speed-scaled look-ahead,
// shifts sideways around obstacles, slows for sharp corners and ice, uses a
// little boost on straights, and runs a short recovery manoeuvre if it ever
// stops moving. Output is the same { dx, dy, mag, boost, brake } the player
// produces, so physics treats everyone alike.
(function (root, factory) {
  var node = typeof module !== 'undefined' && module.exports;
  var maps = node ? require('./maps.js') : root.SnailArena.maps;
  var physics = node ? require('./physics.js') : root.SnailArena.physics;
  var api = factory(maps, physics);
  if (node) module.exports = api;
  else { root.SnailArena = root.SnailArena || {}; root.SnailArena.ai = api; }
})(this, function (maps, physics) {
  var DIFFICULTY = {
    easy:   { label: 'Easy',   speed: 0.84, corner: 480, boost: 0,   wobble: 0.35 },
    normal: { label: 'Normal', speed: 0.93, corner: 560, boost: 0.5, wobble: 0.2 },
    hard:   { label: 'Hard',   speed: 1.0,  corner: 640, boost: 1,   wobble: 0.08 }
  };

  function createDriver(track, level, seed) {
    var rnd = maps.rng(seed || 1);
    return {
      level: DIFFICULTY[level] ? level : 'normal',
      lane: (rnd() - 0.5) * 0.7,         // preferred lateral position, fraction of half width
      phase: rnd() * 10,
      curOff: 0, slow: 0, stuck: 0, recover: 0, boostOn: false
    };
  }

  function wrapAhead(track, from, to) {
    var d = (to - from) % track.L;
    return d < 0 ? d + track.L : d;
  }

  // racer: { body, loc, ... }. Returns an input object.
  function drive(track, drv, racer, dt, time) {
    var D = DIFFICULTY[drv.level], b = racer.body, R = b.r;
    var loc = racer.loc || maps.locate(track, b.x, b.y, -1);
    var speed = Math.hypot(b.vx, b.vy);

    // recovery: after being stuck, head for the centreline for a moment
    if (drv.recover > 0) {
      drv.recover -= dt;
      // back out toward the middle of the road first, then pull away again
      var ahead = maps.pointAt(track, loc.s + (drv.recover > 0.7 ? -70 : 60));
      return { dx: ahead.x - b.x, dy: ahead.y - b.y, mag: 1, boost: false, brake: false };
    }
    if (speed < 18 && time > 0.5) {
      drv.stuck += dt;
      if (drv.stuck > 0.7) { drv.stuck = 0; drv.recover = 1.4; }
    } else drv.stuck = Math.max(0, drv.stuck - dt * 2);

    // preferred offset with a slow weave so the pack spreads out
    var hwHere = loc.hw;
    var pref = (drv.lane + Math.sin(time * 0.6 + drv.phase) * D.wobble) * hwHere;

    // obstacles ahead: pick the nearest clear offset to the preferred one
    var look = 90 + speed * 0.55;
    var cands = [pref], cons = [], i;
    for (i = 0; i < track.obstacles.length; i++) {
      var o = track.obstacles[i];
      var ds = wrapAhead(track, loc.s, o.s);
      if (ds > look + 80 && ds < track.L - 40) continue;
      if (ds >= track.L - 40) ds -= track.L;
      var clear = o.r + R + 16;
      cons.push({ off: o.off, clear: clear, hw: o.hw });
      cands.push(o.off + clear, o.off - clear);
    }
    var best = pref, bestCost = Infinity;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i], ok = true;
      for (var k = 0; k < cons.length; k++) {
        if (Math.abs(c - cons[k].off) < cons[k].clear || Math.abs(c) > cons[k].hw - R - 6) { ok = false; break; }
      }
      if (ok && Math.abs(c - pref) < bestCost) { bestCost = Math.abs(c - pref); best = c; }
    }
    var lim = Math.max(0, hwHere - R - 8);
    best = Math.max(-lim, Math.min(lim, best));
    drv.curOff += Math.max(-260 * dt, Math.min(260 * dt, best - drv.curOff));

    var la = 80 + speed * 0.35;
    var tgt = maps.pointAt(track, loc.s + la);
    var tlim = Math.max(0, tgt.hw - R - 8);
    var off = Math.max(-tlim, Math.min(tlim, drv.curOff));
    var ax = tgt.x + tgt.nx * off, ay = tgt.y + tgt.ny * off;

    // speed: corners ahead and low-grip ground
    var maxK = 0, steps = Math.ceil(170 / track.step), idx = loc.idx;
    for (i = 1; i <= steps; i++) {
      var kc = Math.abs(track.curv[(idx + i) % track.n]);
      if (kc > maxK) maxK = kc;
    }
    var top = physics.CONFIG.maxSpeed * b.speedMul * (b.terrain ? b.terrain.speed : 1);
    var vCorner = maxK > 0.0004 ? Math.sqrt(D.corner / maxK) : Infinity;
    var mag = Math.min(1, vCorner / top) * D.speed;
    if (b.terrain && b.terrain.grip < 0.5) mag = Math.min(mag, 0.55);
    mag = Math.max(0.35, mag);

    var boost = false;
    if (D.boost > 0 && maxK < 0.0016 && !(b.terrain && b.terrain.grip < 0.5)) {
      if (drv.boostOn) { if (b.energy < 0.12) drv.boostOn = false; }
      else if (b.energy > 0.85 - 0.3 * D.boost) drv.boostOn = true;
      boost = drv.boostOn && mag > 0.8;
    } else drv.boostOn = false;
    if (boost) mag = Math.min(1, mag + 0.1);

    return { dx: ax - b.x, dy: ay - b.y, mag: mag, boost: boost, brake: false };
  }

  return { DIFFICULTY: DIFFICULTY, createDriver: createDriver, drive: drive };
});
