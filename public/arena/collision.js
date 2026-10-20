// Collision geometry: track walls, circular obstacles and snail-vs-snail.
// Everything works on bodies { x, y, vx, vy, r } and reports impacts so the
// race can play feedback. Positions are always pushed out exactly, so a
// body can never stay embedded or stuck in a wall.
(function (root, factory) {
  var maps = typeof module !== 'undefined' && module.exports ? require('./maps.js') : root.SnailArena.maps;
  var api = factory(maps);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SnailArena = root.SnailArena || {}; root.SnailArena.collision = api; }
})(this, function (maps) {
  var WALL_BOUNCE = 0.3, WALL_SCRAPE = 0.9, OBST_BOUNCE = 0.45;

  // Keep the body inside the walls. `loc` is maps.locate() for the body.
  // Returns impact speed (0 when nothing was hit).
  function collideWalls(tr, b, loc) {
    var limit = loc.hw - b.r;
    if (limit < 4) limit = 4;
    if (Math.abs(loc.off) <= limit) return 0;
    var sgn = loc.off > 0 ? 1 : -1;
    // push back to the limit, along the centreline normal
    var over = Math.abs(loc.off) - limit;
    b.x -= loc.nx * sgn * over; b.y -= loc.ny * sgn * over;
    var vn = (b.vx * loc.nx + b.vy * loc.ny) * sgn;   // speed into the wall
    var impact = 0;
    if (vn > 0) {
      impact = vn;
      b.vx -= loc.nx * sgn * vn * (1 + WALL_BOUNCE);
      b.vy -= loc.ny * sgn * vn * (1 + WALL_BOUNCE);
      // scrape: lose a little speed along the wall
      b.vx *= WALL_SCRAPE; b.vy *= WALL_SCRAPE;
    }
    return impact;
  }

  function collideCircle(b, c, bounce) {
    var dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy), min = b.r + c.r;
    if (d >= min) return 0;
    if (d < 0.001) { dx = 1; dy = 0; d = 1; }
    var nx = dx / d, ny = dy / d;
    b.x = c.x + nx * min; b.y = c.y + ny * min;
    var vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return 0;
    var e = bounce === undefined ? OBST_BOUNCE : bounce;
    b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
    return -vn;
  }

  function collideObstacles(tr, b) {
    var impact = 0, hit = null;
    for (var i = 0; i < tr.obstacles.length; i++) {
      var o = tr.obstacles[i];
      if (Math.abs(o.x - b.x) > 120 || Math.abs(o.y - b.y) > 120) continue;
      var e = (o.kind === 'jelly' || o.kind === 'candy') ? 0.9 : OBST_BOUNCE;
      var im = collideCircle(b, o, e);
      if (im > impact) { impact = im; hit = o; }
    }
    return { impact: impact, obstacle: hit };
  }

  // Two equal-ish snails: separate and exchange the normal velocity.
  function collideBodies(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
    if (d >= min) return 0;
    if (d < 0.001) { dx = 1; dy = 0; d = 1; }
    var nx = dx / d, ny = dy / d, push = (min - d) / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    var rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return 0;
    var j = -(1 + 0.35) * rv / 2;
    a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny;
    return -rv;
  }

  return { collideWalls: collideWalls, collideCircle: collideCircle, collideObstacles: collideObstacles, collideBodies: collideBodies };
});
