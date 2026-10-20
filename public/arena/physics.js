// Snail movement. Input is a desired direction in world space plus an
// intensity, so a joystick, the arrow keys and the AI all drive it the same
// way. The snail turns toward that direction at a rate that falls with
// speed (steering inertia), accelerates toward a terrain-scaled top speed
// and keeps a little slide on low-grip ground.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SnailArena = root.SnailArena || {}; root.SnailArena.physics = api; }
})(this, function () {
  var CONFIG = {
    maxSpeed: 250,        // world units per second at full intensity
    boostMult: 1.45,
    accel: 330,
    decel: 260,           // coasting with no input
    brakeDecel: 720,
    turnLow: 5.2,         // rad/s when slow
    turnHigh: 2.3,        // rad/s at top speed
    boostDrain: 0.5,      // energy per second while boosting
    boostRegen: 0.14,
    boostMin: 0.08        // energy needed to start a boost
  };

  function angDiff(a, b) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function createBody(x, y, heading, stats) {
    stats = stats || {};
    return {
      x: x, y: y, vx: 0, vy: 0, r: 16, heading: heading,
      speedMul: stats.speed || 1, accelMul: stats.accel || 1,
      energy: 1, boosting: false, exhausted: false,
      terrain: null, wobble: 0
    };
  }

  // input: { dx, dy, mag (0..1), boost, brake }. terrain: { speed, grip, accel }.
  // dt is clamped by the caller; results do not depend on frame rate beyond
  // integration error (the race steps in fixed slices).
  function stepBody(b, input, terrain, dt, cfg) {
    cfg = cfg || CONFIG;
    var mag = Math.max(0, Math.min(1, input.mag || 0));
    var speed = Math.hypot(b.vx, b.vy);

    // boost energy
    var wantBoost = !!input.boost && !input.brake && mag > 0.05;
    if (b.exhausted && b.energy > 0.3) b.exhausted = false;
    b.boosting = wantBoost && !b.exhausted && b.energy > 0;
    if (b.boosting) {
      b.energy = Math.max(0, b.energy - cfg.boostDrain * dt);
      if (b.energy <= 0) { b.exhausted = true; b.boosting = false; }
    } else {
      b.energy = Math.min(1, b.energy + cfg.boostRegen * dt);
    }

    // steering: rotate heading toward the desired direction, slower when fast
    if (mag > 0.05) {
      var want = Math.atan2(input.dy, input.dx);
      var rate = cfg.turnLow + (cfg.turnHigh - cfg.turnLow) * Math.min(1, speed / cfg.maxSpeed);
      var diff = angDiff(b.heading, want);
      var turn = Math.max(-rate * dt, Math.min(rate * dt, diff));
      b.heading += turn;
    }
    var hx = Math.cos(b.heading), hy = Math.sin(b.heading);

    // target velocity along the heading
    var top = cfg.maxSpeed * b.speedMul * terrain.speed * (b.boosting ? cfg.boostMult : 1);
    var target = mag > 0.05 && !input.brake ? top * mag : 0;
    // turning sharply while moving costs speed, so cutting corners is not free
    if (mag > 0.05) {
      var misalign = Math.abs(angDiff(b.heading, Math.atan2(input.dy, input.dx)));
      target *= 1 - 0.35 * Math.min(1, misalign / 1.6);
    }
    var tvx = hx * target, tvy = hy * target;

    var rate2 = input.brake ? cfg.brakeDecel : (target > speed ? cfg.accel * b.accelMul * terrain.accel * (b.boosting ? 1.8 : 1) : cfg.decel);
    if (mag <= 0.05 && !input.brake) rate2 = cfg.decel;
    var dvx = tvx - b.vx, dvy = tvy - b.vy, dv = Math.hypot(dvx, dvy);
    var maxDv = rate2 * Math.max(0.15, terrain.grip) * dt;
    if (dv > maxDv) { dvx = dvx / dv * maxDv; dvy = dvy / dv * maxDv; }
    b.vx += dvx; b.vy += dvy;
    // hard cap so collisions or boost pads can never launch a snail
    var cap = cfg.maxSpeed * b.speedMul * 1.8 * Math.max(1, terrain.speed);
    var sp = Math.hypot(b.vx, b.vy);
    if (sp > cap) { b.vx *= cap / sp; b.vy *= cap / sp; }

    b.x += b.vx * dt; b.y += b.vy * dt;
    b.terrain = terrain;
    b.wobble += Math.hypot(b.vx, b.vy) * dt * 0.05;
  }

  return { CONFIG: CONFIG, angDiff: angDiff, createBody: createBody, stepBody: stepBody };
});
