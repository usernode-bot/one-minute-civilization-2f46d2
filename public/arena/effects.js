// Lightweight particles and feedback. A fixed pool, no allocation per frame.
// Reduced motion drops shake, confetti and ambient drift and thins dust.
(function (root) {
  var MAX = 200;

  function create() {
    var p = [];
    for (var i = 0; i < MAX; i++) p.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, color: '#fff', kind: 0, rot: 0 });
    return { pool: p, reduced: false, shake: 0, flash: 0, ambient: 0, ambientKind: null, next: 0 };
  }

  function spawn(fx, kind, x, y, vx, vy, life, size, color) {
    for (var n = 0; n < MAX; n++) {
      var p = fx.pool[(fx.next + n) % MAX];
      if (!p.on) {
        fx.next = (fx.next + n + 1) % MAX;
        p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.life = life; p.max = life; p.size = size; p.color = color; p.rot = Math.random() * 6.28;
        return p;
      }
    }
    return null;
  }

  var DUST = { sand: '#e8cf9a', mud: '#7a5a3a', ash: '#b9aaa6', jelly: '#ff9ccd', ice: '#ffffff', boost: '#ffe27a', none: '#f2ead8' };

  // 0 dust puff, 1 spark, 2 ring, 3 confetti, 4 ambient drift
  function dust(fx, x, y, vx, vy, terrainKind, amount) {
    if (fx.reduced && Math.random() > 0.35) return;
    if (Math.random() > amount) return;
    var c = DUST[terrainKind || 'none'] || DUST.none;
    spawn(fx, terrainKind === 'ice' ? 1 : 0, x - vx * 0.03, y - vy * 0.03,
      -vx * 0.15 + (Math.random() - 0.5) * 30, -vy * 0.15 + (Math.random() - 0.5) * 30,
      0.45 + Math.random() * 0.3, 3 + Math.random() * 3, c);
  }

  function burst(fx, x, y, color, count, speed) {
    count = fx.reduced ? Math.ceil(count / 3) : count;
    for (var i = 0; i < count; i++) {
      var a = Math.random() * 6.283, s = speed * (0.4 + Math.random() * 0.6);
      spawn(fx, 1, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.3, 2.5 + Math.random() * 2, color);
    }
  }

  function ring(fx, x, y, color, size) { spawn(fx, 2, x, y, 0, 0, 0.45, size || 30, color); }

  function confetti(fx, x, y) {
    if (fx.reduced) { ring(fx, x, y, '#fde047', 60); return; }
    var cols = ['#f472b6', '#facc15', '#38bdf8', '#a3e635', '#fb923c'];
    for (var i = 0; i < 46; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, s = 120 + Math.random() * 260;
      spawn(fx, 3, x, y, Math.cos(a) * s, Math.sin(a) * s, 1.1 + Math.random() * 0.9, 4 + Math.random() * 3, cols[i % cols.length]);
    }
  }

  function bump(fx, x, y, impact) {
    burst(fx, x, y, '#ffffff', 6, 140);
    if (!fx.reduced) fx.shake = Math.min(7, Math.max(fx.shake, impact / 45));
  }

  function update(fx, dt) {
    for (var i = 0; i < MAX; i++) {
      var p = fx.pool[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 3) { p.vy += 380 * dt; p.vx *= 0.99; p.rot += dt * 9; }
      else if (p.kind === 4) { p.rot += dt; p.vx += Math.sin(p.rot * 2) * 6 * dt; }
      else { var d = Math.pow(0.04, dt); p.vx *= d; p.vy *= d; }
    }
    fx.shake = Math.max(0, fx.shake - dt * 18);
    fx.flash = Math.max(0, fx.flash - dt * 3);
  }

  var AMBIENT = {
    embers: { color: '#ff9a3c', vy: -40, size: 2.6 },
    fireflies: { color: '#b6ffd9', vy: -8, size: 2.4 },
    petals: { color: '#ffffff', vy: 14, size: 3 },
    wind: { color: '#fff0c8', vy: 4, size: 2 },
    sprinkles: { color: '#ffffff', vy: 18, size: 3 }
  };
  var THEME_AMBIENT = { meadow: 'petals', desert: 'wind', forest: 'fireflies', candy: 'sprinkles', volcano: 'embers' };

  // Spawn a few drifting specks inside the camera view.
  function ambient(fx, cam, themeId, dt) {
    var kind = AMBIENT[THEME_AMBIENT[themeId]];
    if (!kind || fx.reduced) return;
    fx.ambient += dt * 5;
    while (fx.ambient >= 1) {
      fx.ambient -= 1;
      var vw = cam.w / cam.zoom, vh = cam.h / cam.zoom;
      var colors = themeId === 'candy' ? ['#ff5fa2', '#fff', '#7ae0ff', '#ffe27a'] : null;
      spawn(fx, 4, cam.x + (Math.random() - 0.5) * vw, cam.y + (Math.random() - 0.5) * vh,
        (Math.random() - 0.5) * 20 + (themeId === 'desert' ? 40 : 0), kind.vy + (Math.random() - 0.5) * 8,
        1.6 + Math.random(), kind.size, colors ? colors[Math.floor(Math.random() * colors.length)] : kind.color);
    }
  }

  function draw(ctx, fx) {
    for (var i = 0; i < MAX; i++) {
      var p = fx.pool[i];
      if (!p.on) continue;
      var a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = p.kind === 4 ? Math.min(a, 1 - a) * 1.4 : a;
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
      if (p.kind === 2) {
        ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.3 - a), 0, 6.283); ctx.stroke();
      } else if (p.kind === 3) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 0 ? 1.6 - a * 0.6 : a * 0.5 + 0.5), 0, 6.283); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function clear(fx) { for (var i = 0; i < MAX; i++) fx.pool[i].on = false; fx.shake = 0; fx.flash = 0; }

  root.SnailArena = root.SnailArena || {};
  root.SnailArena.effects = { create: create, dust: dust, burst: burst, ring: ring, confetti: confetti, bump: bump, update: update, ambient: ambient, draw: draw, clear: clear };
})(window);
