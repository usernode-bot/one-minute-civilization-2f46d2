// Canvas rendering. The map is drawn once into an offscreen "static layer"
// (ground, decor, track, boundaries, terrain, obstacles, start line); each
// frame then blits the visible part and draws snails, gates and particles on
// top. The same static drawing serves the map thumbnails and race preview.
(function (root) {
  var A = root.SnailArena, maps = A.maps, camera = A.camera, effects = A.effects;
  var TAU = Math.PI * 2;

  // ---------- small helpers ----------
  function blob(ctx, x, y, r, rnd, jit, pts) {
    pts = pts || 11;
    ctx.beginPath();
    for (var i = 0; i <= pts; i++) {
      var a = (i / pts) * TAU, rr = r * (1 - jit + rnd() * jit * 2);
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function circle(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
  function ellipse(ctx, x, y, rx, ry, fill, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
  function shadow(ctx, x, y, r) { ellipse(ctx, x + 3, y + r * 0.35, r * 1.05, r * 0.7, 'rgba(0,0,0,0.22)'); }

  function ringPath(ctx, tr, extra, i0, i1) {
    var n = tr.n, full = i0 === undefined, i, k, idx;
    var count = full ? n : ((i1 - i0 + n) % n) + 1;
    var left = [], right = [];
    for (k = 0; k < count; k++) {
      idx = full ? k : (i0 + k) % n;
      var hw = tr.halfW[idx] + extra;
      left.push([tr.pts[idx].x - tr.nx[idx] * hw, tr.pts[idx].y - tr.ny[idx] * hw]);
      right.push([tr.pts[idx].x + tr.nx[idx] * hw, tr.pts[idx].y + tr.ny[idx] * hw]);
    }
    ctx.beginPath();
    if (full) {
      for (i = 0; i < left.length; i++) { if (i) ctx.lineTo(left[i][0], left[i][1]); else ctx.moveTo(left[i][0], left[i][1]); }
      ctx.closePath();
      for (i = 0; i < right.length; i++) { if (i) ctx.lineTo(right[i][0], right[i][1]); else ctx.moveTo(right[i][0], right[i][1]); }
      ctx.closePath();
    } else {
      for (i = 0; i < left.length; i++) { if (i) ctx.lineTo(left[i][0], left[i][1]); else ctx.moveTo(left[i][0], left[i][1]); }
      for (i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
    }
  }

  // stroke one edge (side -1 left / +1 right) at offset `extra` beyond the wall
  function edgePath(ctx, tr, side, extra) {
    ctx.beginPath();
    for (var i = 0; i <= tr.n; i++) {
      var k = i % tr.n, hw = tr.halfW[k] + extra;
      var x = tr.pts[k].x + tr.nx[k] * hw * side, y = tr.pts[k].y + tr.ny[k] * hw * side;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
  }

  function bandPath(ctx, tr, i0, i1) {
    var n = tr.n; ctx.beginPath();
    for (var k = 0; k <= ((i1 - i0 + n) % n); k++) {
      var i = (i0 + k) % n;
      if (k) ctx.lineTo(tr.pts[i].x, tr.pts[i].y); else ctx.moveTo(tr.pts[i].x, tr.pts[i].y);
    }
  }

  // ---------- decor (off the track) ----------
  var DECOR = {
    flower: function (c, x, y, s, r, th) {
      var col = ['#ff6fa5', '#ffd54a', '#ffffff', '#8ecbff', '#ff9a5c'][Math.floor(r() * 5)];
      for (var i = 0; i < 5; i++) circle(c, x + Math.cos(i * 1.2566) * 5 * s, y + Math.sin(i * 1.2566) * 5 * s, 3.6 * s, col);
      circle(c, x, y, 2.8 * s, '#ffb300');
    },
    bush: function (c, x, y, s) { shadow(c, x, y, 20 * s); circle(c, x - 9 * s, y + 3 * s, 14 * s, '#2f8f3a'); circle(c, x + 9 * s, y + 4 * s, 13 * s, '#37a043'); circle(c, x, y - 6 * s, 15 * s, '#46b84f'); },
    mushroom: function (c, x, y, s) { shadow(c, x, y, 11 * s); c.fillStyle = '#f5e9d2'; c.fillRect(x - 3 * s, y, 6 * s, 9 * s); ellipse(c, x, y, 12 * s, 9 * s, '#e0382f'); circle(c, x - 4 * s, y - 2 * s, 2.2 * s, '#fff'); circle(c, x + 4 * s, y + 1 * s, 2 * s, '#fff'); },
    pond: function (c, x, y, s, r) { var rx = 40 * s, ry = 26 * s; ellipse(c, x, y, rx + 6, ry + 5, '#3d8f4b'); var g = c.createRadialGradient(x - 8, y - 6, 4, x, y, rx); g.addColorStop(0, '#9be0ff'); g.addColorStop(1, '#3f9ad8'); ellipse(c, x, y, rx, ry, g); ellipse(c, x - rx * 0.3, y - ry * 0.3, rx * 0.25, ry * 0.12, 'rgba(255,255,255,0.55)'); circle(c, x + rx * 0.4, y + ry * 0.2, 7, '#4cb85a'); },
    tuft: function (c, x, y, s, r, th) { c.strokeStyle = th.bgBottom; c.lineWidth = 2; c.globalAlpha = 0.7; for (var i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * 3, y); c.lineTo(x + i * 4, y - 9 * s); c.stroke(); } c.globalAlpha = 1; },
    dune: function (c, x, y, s, r) { var g = c.createLinearGradient(x, y - 30 * s, x, y + 30 * s); g.addColorStop(0, '#f8dc9b'); g.addColorStop(1, '#d7a35b'); ellipse(c, x, y, 85 * s, 34 * s, g, (r() - 0.5) * 0.5); c.strokeStyle = 'rgba(160,100,40,0.35)'; c.lineWidth = 2; c.beginPath(); c.ellipse(x, y - 4, 60 * s, 18 * s, 0, 3.3, 5.9); c.stroke(); },
    cactus: function (c, x, y, s) { shadow(c, x, y + 8, 14 * s); c.fillStyle = '#3f9b52'; c.strokeStyle = '#2b7a3d'; c.lineWidth = 1.5; [[x - 5 * s, y - 24 * s, 10 * s, 36 * s], [x - 17 * s, y - 14 * s, 8 * s, 18 * s], [x + 9 * s, y - 18 * s, 8 * s, 18 * s]].forEach(function (a) { c.beginPath(); if (c.roundRect) c.roundRect(a[0], a[1], a[2], a[3], 4 * s); else c.rect(a[0], a[1], a[2], a[3]); c.fill(); c.stroke(); }); },
    rock: function (c, x, y, s, r) { shadow(c, x, y, 18 * s); blob(c, x, y, 17 * s, r, 0.25, 8); c.fillStyle = '#9a8f86'; c.fill(); blob(c, x - 3 * s, y - 4 * s, 9 * s, r, 0.2, 7); c.fillStyle = '#b8aea4'; c.fill(); },
    bones: function (c, x, y, s) { c.strokeStyle = '#f4efe2'; c.lineWidth = 4 * s; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - 14 * s, y - 4 * s); c.lineTo(x + 14 * s, y + 4 * s); c.moveTo(x - 10 * s, y + 8 * s); c.lineTo(x + 12 * s, y - 8 * s); c.stroke(); c.lineCap = 'butt'; },
    tree: function (c, x, y, s, r) { var R = (46 + r() * 34) * s; shadow(c, x, y + R * 0.2, R * 1.1); circle(c, x, y, R, '#0f4a3c'); circle(c, x - R * 0.2, y - R * 0.2, R * 0.78, '#14604a'); circle(c, x - R * 0.3, y - R * 0.3, R * 0.42, '#1c7a5c'); },
    glowshroom: function (c, x, y, s) { var g = c.createRadialGradient(x, y, 1, x, y, 34 * s); g.addColorStop(0, 'rgba(125,255,212,0.55)'); g.addColorStop(1, 'rgba(125,255,212,0)'); circle(c, x, y, 34 * s, g); c.fillStyle = '#d9fff0'; c.fillRect(x - 2.5 * s, y, 5 * s, 8 * s); ellipse(c, x, y, 11 * s, 8 * s, '#7dffd4'); circle(c, x - 3 * s, y - 2 * s, 2 * s, '#e8fff7'); },
    fern: function (c, x, y, s) { c.strokeStyle = '#2c9a6a'; c.lineWidth = 2.5; c.lineCap = 'round'; for (var i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + i * 6 * s, y - 10 * s, x + i * 9 * s, y - 22 * s + Math.abs(i) * 4 * s); c.stroke(); } c.lineCap = 'butt'; },
    lollipop: function (c, x, y, s, r) { shadow(c, x, y + 14 * s, 14 * s); c.fillStyle = '#fff'; c.fillRect(x - 2 * s, y, 4 * s, 26 * s); var col = ['#ff4f9a', '#7a5cff', '#2ec4b6', '#ff9f1c'][Math.floor(r() * 4)]; circle(c, x, y, 17 * s, col); c.strokeStyle = '#fff'; c.lineWidth = 3 * s; c.beginPath(); for (var a = 0; a < 12; a += 0.3) { var rr = a * 1.3 * s; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.stroke(); },
    cupcake: function (c, x, y, s) { shadow(c, x, y + 8, 16 * s); c.fillStyle = '#e29a5b'; c.beginPath(); c.moveTo(x - 13 * s, y); c.lineTo(x + 13 * s, y); c.lineTo(x + 9 * s, y + 16 * s); c.lineTo(x - 9 * s, y + 16 * s); c.fill(); circle(c, x, y - 4 * s, 15 * s, '#ff8fc2'); circle(c, x, y - 12 * s, 9 * s, '#fff4fa'); circle(c, x, y - 21 * s, 4 * s, '#e0285a'); },
    gumdrop: function (c, x, y, s, r) { var col = ['#ff5fa2', '#7ae0ff', '#ffe27a', '#8cf27a', '#b894ff'][Math.floor(r() * 5)]; shadow(c, x, y + 4, 12 * s); ellipse(c, x, y, 13 * s, 10 * s, col); ellipse(c, x - 4 * s, y - 4 * s, 4 * s, 2.5 * s, 'rgba(255,255,255,0.6)'); },
    sprinkle: function (c, x, y, s, r) { c.lineCap = 'round'; c.lineWidth = 3; for (var i = 0; i < 5; i++) { c.strokeStyle = ['#ff5fa2', '#7ae0ff', '#ffe27a', '#8cf27a'][i % 4]; var px = x + (r() - 0.5) * 30, py = y + (r() - 0.5) * 20, a = r() * 3; c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a) * 7, py + Math.sin(a) * 7); c.stroke(); } c.lineCap = 'butt'; },
    lava: function (c, x, y, s, r) { var R = (55 + r() * 60) * s; blob(c, x, y, R + 9, r, 0.12, 14); c.fillStyle = '#1a0a09'; c.fill(); var g = c.createRadialGradient(x, y, 4, x, y, R); g.addColorStop(0, '#fff2a0'); g.addColorStop(0.35, '#ffb02e'); g.addColorStop(0.75, '#ff5a14'); g.addColorStop(1, '#b3200b'); blob(c, x, y, R, r, 0.1, 14); c.fillStyle = g; c.fill(); },
    crag: function (c, x, y, s, r) { shadow(c, x, y, 26 * s); blob(c, x, y, 24 * s, r, 0.3, 7); c.fillStyle = '#3a2a28'; c.fill(); blob(c, x - 4 * s, y - 5 * s, 12 * s, r, 0.25, 6); c.fillStyle = '#54403c'; c.fill(); },
    ember: function (c, x, y, s) { var g = c.createRadialGradient(x, y, 1, x, y, 14 * s); g.addColorStop(0, 'rgba(255,170,60,0.9)'); g.addColorStop(1, 'rgba(255,90,20,0)'); circle(c, x, y, 14 * s, g); },
    ashheap: function (c, x, y, s, r) { blob(c, x, y, 26 * s, r, 0.3, 9); c.fillStyle = '#6b5f5c'; c.fill(); blob(c, x, y, 14 * s, r, 0.3, 8); c.fillStyle = '#857875'; c.fill(); }
  };

  function nearestDist(tr, x, y) {
    var best = Infinity, hw = 0;
    for (var i = 0; i < tr.n; i += 2) {
      var dx = x - tr.pts[i].x, dy = y - tr.pts[i].y, d = dx * dx + dy * dy;
      if (d < best) { best = d; hw = tr.halfW[i]; }
    }
    return Math.sqrt(best) - hw;
  }

  function drawDecor(ctx, tr, scale) {
    var th = tr.theme, rnd = maps.rng(tr.id.length * 977 + tr.n), b = tr.bounds;
    var count = Math.max(90, Math.min(330, Math.round(b.w * b.h / 14000)));
    // fewer, simpler items when drawing a small thumbnail
    if (scale && scale < 0.2) count = Math.round(count * 0.7);
    var items = [];
    for (var i = 0; i < count * 3 && items.length < count; i++) {
      var x = b.x0 + rnd() * b.w, y = b.y0 + rnd() * b.h;
      var kind = th.decor[Math.floor(rnd() * th.decor.length)], size = 0.8 + rnd() * 0.7;
      var big = kind === 'tree' || kind === 'lava' || kind === 'dune' || kind === 'pond';
      if (nearestDist(tr, x, y) < (big ? 105 : 46) + 26) continue;
      items.push({ x: x, y: y, kind: kind, s: size, seed: Math.floor(rnd() * 1e6) });
    }
    items.sort(function (p, q) { return p.y - q.y; });
    items.forEach(function (it) { DECOR[it.kind](ctx, it.x, it.y, it.s, maps.rng(it.seed), th); });
  }

  // ---------- terrain patches ----------
  var PATCH = {
    sand: function (c, p, r) { blob(c, p.x, p.y, p.r, r, 0.12, 14); c.fillStyle = '#efd49a'; c.fill(); c.strokeStyle = 'rgba(150,100,40,0.45)'; c.lineWidth = 2; c.setLineDash([6, 7]); c.stroke(); c.setLineDash([]); for (var i = 0; i < 40; i++) { var a = r() * TAU, d = r() * p.r * 0.9; circle(c, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1.6, 'rgba(150,100,40,0.5)'); } },
    mud: function (c, p, r) { blob(c, p.x, p.y, p.r, r, 0.14, 13); c.fillStyle = '#5e4128'; c.fill(); c.strokeStyle = '#3d2a19'; c.lineWidth = 3; c.stroke(); for (var i = 0; i < 9; i++) { var a = r() * TAU, d = r() * p.r * 0.7; circle(c, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 3 + r() * 4, '#7b5836'); } },
    ice: function (c, p, r) { blob(c, p.x, p.y, p.r, r, 0.08, 13); var g = c.createLinearGradient(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r); g.addColorStop(0, '#e8fbff'); g.addColorStop(1, '#8fd2f0'); c.fillStyle = g; c.fill(); c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.stroke(); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2; for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(p.x - p.r * 0.5 + i * 14, p.y + p.r * 0.5); c.lineTo(p.x - p.r * 0.1 + i * 14, p.y - p.r * 0.4); c.stroke(); } },
    ash: function (c, p, r) { blob(c, p.x, p.y, p.r, r, 0.15, 12); c.fillStyle = '#8b807c'; c.fill(); for (var i = 0; i < 46; i++) { var a = r() * TAU, d = r() * p.r * 0.92; circle(c, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1.4 + r() * 2.2, r() < 0.5 ? '#a99e9a' : '#6d6360'); } },
    jelly: function (c, p, r) { blob(c, p.x, p.y, p.r, r, 0.07, 12); c.fillStyle = 'rgba(255,120,180,0.82)'; c.fill(); c.strokeStyle = '#ffd0e6'; c.lineWidth = 3; c.stroke(); ellipse(c, p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.3, p.r * 0.14, 'rgba(255,255,255,0.6)', -0.5); },
    boost: function (c, p, r, tr) {
      var idx = Math.round(p.s / tr.step) % tr.n, ang = Math.atan2(tr.ty[idx], tr.tx[idx]);
      c.save(); c.translate(p.x, p.y); c.rotate(ang);
      var g = c.createRadialGradient(0, 0, 4, 0, 0, p.r); g.addColorStop(0, 'rgba(255,240,140,0.95)'); g.addColorStop(1, 'rgba(255,190,40,0.55)');
      c.beginPath(); c.arc(0, 0, p.r, 0, TAU); c.fillStyle = g; c.fill(); c.strokeStyle = '#fff6c2'; c.lineWidth = 3; c.stroke();
      c.strokeStyle = '#e07a00'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
      for (var i = -1; i <= 1; i += 2) { c.beginPath(); c.moveTo(i * 12 - 10, -17); c.lineTo(i * 12 + 6, 0); c.lineTo(i * 12 - 10, 17); c.stroke(); }
      c.restore();
    }
  };

  // ---------- obstacles ----------
  var OBST = {
    rock: function (c, o, r) { shadow(c, o.x, o.y, o.r); blob(c, o.x, o.y, o.r, r, 0.14, 9); c.fillStyle = '#8c8279'; c.fill(); c.strokeStyle = '#4a423c'; c.lineWidth = 2; c.stroke(); blob(c, o.x - o.r * 0.2, o.y - o.r * 0.25, o.r * 0.5, r, 0.15, 7); c.fillStyle = '#b3a99f'; c.fill(); },
    cactus: function (c, o) { shadow(c, o.x, o.y, o.r); circle(c, o.x, o.y, o.r, '#2f8a47'); c.strokeStyle = '#1d6a33'; c.lineWidth = 2.5; c.stroke(); circle(c, o.x, o.y, o.r * 0.45, '#47b062'); c.strokeStyle = '#e7ffd0'; c.lineWidth = 1.5; for (var i = 0; i < 8; i++) { var a = i * TAU / 8; c.beginPath(); c.moveTo(o.x + Math.cos(a) * o.r * 0.9, o.y + Math.sin(a) * o.r * 0.9); c.lineTo(o.x + Math.cos(a) * (o.r + 6), o.y + Math.sin(a) * (o.r + 6)); c.stroke(); } },
    mushroom: function (c, o, r, th) { shadow(c, o.x, o.y, o.r); var glow = th.id === 'forest'; if (glow) { var g = c.createRadialGradient(o.x, o.y, 2, o.x, o.y, o.r * 2.2); g.addColorStop(0, 'rgba(125,255,212,0.5)'); g.addColorStop(1, 'rgba(125,255,212,0)'); circle(c, o.x, o.y, o.r * 2.2, g); } circle(c, o.x, o.y, o.r, glow ? '#5fe8c0' : '#e0382f'); c.strokeStyle = glow ? '#1f9a7a' : '#8f1d17'; c.lineWidth = 2.5; c.stroke(); for (var i = 0; i < 5; i++) { var a = i * 1.26 + 0.4; circle(c, o.x + Math.cos(a) * o.r * 0.5, o.y + Math.sin(a) * o.r * 0.5, o.r * 0.17, '#fff'); } },
    log: function (c, o) { shadow(c, o.x, o.y, o.r); circle(c, o.x, o.y, o.r, '#8a5a30'); c.strokeStyle = '#4e2f16'; c.lineWidth = 3; c.stroke(); circle(c, o.x, o.y, o.r * 0.75, '#c99259'); c.strokeStyle = '#8a5a30'; c.lineWidth = 1.8; c.beginPath(); c.arc(o.x, o.y, o.r * 0.5, 0, TAU); c.stroke(); c.beginPath(); c.arc(o.x, o.y, o.r * 0.25, 0, TAU); c.stroke(); },
    jelly: function (c, o) { shadow(c, o.x, o.y, o.r); var g = c.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, 2, o.x, o.y, o.r); g.addColorStop(0, '#d9ffb8'); g.addColorStop(1, '#4ed67a'); circle(c, o.x, o.y, o.r, g); c.strokeStyle = '#2ba85a'; c.lineWidth = 2.5; c.stroke(); ellipse(c, o.x - o.r * 0.35, o.y - o.r * 0.4, o.r * 0.3, o.r * 0.15, 'rgba(255,255,255,0.7)', -0.6); },
    candy: function (c, o) { shadow(c, o.x, o.y, o.r); circle(c, o.x, o.y, o.r, '#fff'); c.strokeStyle = '#ff3b7a'; c.lineWidth = o.r * 0.38; for (var i = 0; i < 6; i++) { c.beginPath(); c.arc(o.x, o.y, o.r * (0.2 + i * 0.14), i, i + 2.3); c.stroke(); } c.strokeStyle = '#ff3b7a'; c.lineWidth = 2.5; c.beginPath(); c.arc(o.x, o.y, o.r - 1, 0, TAU); c.stroke(); }
  };

  // ---------- boundaries ----------
  function drawBoundary(ctx, tr) {
    var th = tr.theme, style = th.boundary, side, i;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (side = -1; side <= 1; side += 2) {
      if (style === 'fence') {
        edgePath(ctx, tr, side, 9); ctx.strokeStyle = '#6e4521'; ctx.lineWidth = 6; ctx.stroke();
        edgePath(ctx, tr, side, 9); ctx.strokeStyle = '#c28a4a'; ctx.lineWidth = 3; ctx.stroke();
        for (i = 0; i < tr.n; i += 3) {
          var hw = tr.halfW[i] + 9;
          var x = tr.pts[i].x + tr.nx[i] * hw * side, y = tr.pts[i].y + tr.ny[i] * hw * side;
          circle(ctx, x, y, 5.2, '#6e4521'); circle(ctx, x, y, 3.4, '#d9a263');
        }
      } else if (style === 'dunes') {
        edgePath(ctx, tr, side, 8); ctx.strokeStyle = '#a8692c'; ctx.lineWidth = 20; ctx.stroke();
        edgePath(ctx, tr, side, 6); ctx.strokeStyle = '#d99a52'; ctx.lineWidth = 13; ctx.stroke();
        edgePath(ctx, tr, side, 4); ctx.strokeStyle = '#f2c987'; ctx.lineWidth = 4; ctx.stroke();
      } else if (style === 'roots') {
        edgePath(ctx, tr, side, 8); ctx.strokeStyle = '#2a1a0f'; ctx.lineWidth = 17; ctx.stroke();
        edgePath(ctx, tr, side, 7); ctx.strokeStyle = '#5b3a20'; ctx.lineWidth = 9; ctx.stroke();
        var rr = maps.rng(side + 11);
        ctx.strokeStyle = '#3d2615'; ctx.lineWidth = 4;
        for (i = 0; i < tr.n; i += 4) {
          var h2 = tr.halfW[i] + 12, px = tr.pts[i].x + tr.nx[i] * h2 * side, py = tr.pts[i].y + tr.ny[i] * h2 * side;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + tr.nx[i] * side * 14 + (rr() - 0.5) * 14, py + tr.ny[i] * side * 14 + (rr() - 0.5) * 14, px + tr.nx[i] * side * 26 + (rr() - 0.5) * 22, py + tr.ny[i] * side * 26 + (rr() - 0.5) * 22); ctx.stroke();
        }
      } else if (style === 'candycane') {
        edgePath(ctx, tr, side, 8); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 13; ctx.stroke();
        edgePath(ctx, tr, side, 8); ctx.strokeStyle = '#ff3b7a'; ctx.lineWidth = 13; ctx.lineCap = 'butt'; ctx.setLineDash([13, 13]); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'round';
        edgePath(ctx, tr, side, 14.5); ctx.strokeStyle = 'rgba(160,40,100,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      } else {
        edgePath(ctx, tr, side, 10); ctx.strokeStyle = '#120807'; ctx.lineWidth = 22; ctx.stroke();
        edgePath(ctx, tr, side, 5); ctx.strokeStyle = '#ff5a14'; ctx.lineWidth = 3; ctx.stroke();
        edgePath(ctx, tr, side, 8); ctx.strokeStyle = '#2d1b19'; ctx.lineWidth = 8; ctx.stroke();
      }
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  function drawBridges(ctx, tr) {
    var th = tr.theme, volc = th.boundary === 'lava';
    tr.bridges.forEach(function (br) {
      // what the bridge crosses
      ringPath(ctx, tr, 34, br.from, br.to); ctx.fillStyle = volc ? '#c8340c' : '#b0307a'; ctx.fill();
      ringPath(ctx, tr, 22, br.from, br.to); ctx.fillStyle = volc ? '#ff7a1a' : '#e24d9a'; ctx.fill();
      ringPath(ctx, tr, 0, br.from, br.to); ctx.fillStyle = volc ? '#6b5650' : '#6a3a22'; ctx.fill();
      var k, cnt = ((br.to - br.from + tr.n) % tr.n);
      for (k = 0; k <= cnt; k += 1) {
        var i = (br.from + k) % tr.n, hw = tr.halfW[i];
        ctx.beginPath(); ctx.moveTo(tr.pts[i].x - tr.nx[i] * hw, tr.pts[i].y - tr.ny[i] * hw); ctx.lineTo(tr.pts[i].x + tr.nx[i] * hw, tr.pts[i].y + tr.ny[i] * hw);
        ctx.strokeStyle = volc ? (k % 2 ? '#4a3a35' : '#7b655e') : (k % 2 ? '#4a2614' : '#8a5130'); ctx.lineWidth = 12; ctx.stroke();
      }
      // rails
      [-1, 1].forEach(function (side) {
        ctx.beginPath();
        for (var q = 0; q <= cnt; q++) { var j = (br.from + q) % tr.n, h = tr.halfW[j] + 3; var x = tr.pts[j].x + tr.nx[j] * h * side, y = tr.pts[j].y + tr.ny[j] * h * side; if (q) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.strokeStyle = volc ? '#2a1c19' : '#4a2614'; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = volc ? '#8a7068' : '#b87a4a'; ctx.lineWidth = 3; ctx.stroke();
      });
    });
  }

  function drawStartLine(ctx, tr) {
    var s = tr.start, hw = s.hw, cols = Math.max(6, Math.round(hw / 9)), size = (hw * 2) / cols;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.ty, s.tx));
    for (var row = 0; row < 3; row++) for (var c = 0; c < cols; c++) {
      ctx.fillStyle = (row + c) % 2 ? '#111' : '#fff'; ctx.fillRect(-size * 1.5 + row * size, -hw + c * size, size, size);
    }
    // arch posts
    [-1, 1].forEach(function (side) { circle(ctx, 0, side * (hw + 14), 11, '#222'); circle(ctx, 0, side * (hw + 14), 7, tr.theme.accent); });
    ctx.restore();
  }

  function drawGates(ctx, tr) {
    for (var i = 1; i < tr.checkpoints.length; i++) {
      var g = tr.checkpoints[i];
      ctx.beginPath(); ctx.moveTo(g.x - g.nx * g.hw, g.y - g.ny * g.hw); ctx.lineTo(g.x + g.nx * g.hw, g.y + g.ny * g.hw);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]);
      [-1, 1].forEach(function (side) { circle(ctx, g.x + g.nx * (g.hw + 10) * side, g.y + g.ny * (g.hw + 10) * side, 6, tr.theme.accent); });
    }
  }

  // Everything that never changes, in world coordinates.
  function drawStaticLayer(ctx, tr, scale) {
    var th = tr.theme, b = tr.bounds;
    th.id = tr.id;
    var g = ctx.createLinearGradient(0, b.y0, 0, b.y1);
    g.addColorStop(0, th.bgTop); g.addColorStop(1, th.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(b.x0, b.y0, b.w, b.h);
    drawDecor(ctx, tr, scale);
    // track: edge colour, surface, speckle, centre dashes
    ringPath(ctx, tr, 6); ctx.fillStyle = th.trackEdge; ctx.fill('evenodd');
    ringPath(ctx, tr, 0); ctx.fillStyle = th.track; ctx.fill('evenodd');
    var rnd = maps.rng(tr.n * 13 + 5);
    ctx.globalAlpha = 0.16; ctx.fillStyle = th.trackEdge;
    for (var i = 0; i < tr.n; i += 1) {
      var o = (rnd() * 2 - 1) * tr.halfW[i] * 0.9;
      ctx.beginPath(); ctx.arc(tr.pts[i].x + tr.nx[i] * o, tr.pts[i].y + tr.ny[i] * o, 1.5 + rnd() * 2.5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    bandPath(ctx, tr, 0, tr.n - 1); ctx.lineTo(tr.pts[0].x, tr.pts[0].y);
    ctx.strokeStyle = th.lane; ctx.lineWidth = 3; ctx.setLineDash([16, 22]); ctx.stroke(); ctx.setLineDash([]);
    drawBridges(ctx, tr);
    drawBoundary(ctx, tr);
    tr.patches.forEach(function (p) { PATCH[p.kind](ctx, p, maps.rng(Math.round(p.x * 7 + p.y)), tr); });
    drawGates(ctx, tr);
    drawStartLine(ctx, tr);
    tr.obstacles.forEach(function (o) { OBST[o.kind](ctx, o, maps.rng(Math.round(o.x + o.y * 3)), th); });
  }

  // Offscreen cache of the static layer; only one map is kept at a time.
  var cache = null;
  function getStatic(tr) {
    if (cache && cache.id === tr.id) return cache;
    releaseStatic();
    var b = tr.bounds, scale = Math.min(1.5, 3072 / Math.max(b.w, b.h));
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(b.w * scale); cv.height = Math.ceil(b.h * scale);
    var c = cv.getContext('2d');
    c.setTransform(scale, 0, 0, scale, -b.x0 * scale, -b.y0 * scale);
    drawStaticLayer(c, tr, scale);
    cache = { id: tr.id, canvas: cv, scale: scale };
    return cache;
  }
  function releaseStatic() { if (cache) { cache.canvas.width = 0; cache.canvas.height = 0; cache = null; } }

  // ---------- snails ----------
  function drawSnail(ctx, sn, x, y, heading, t, opts) {
    opts = opts || {};
    var sc = opts.scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ellipse(ctx, 2, 5, 19 * sc, 10 * sc, 'rgba(0,0,0,0.25)');
    ctx.rotate(heading);
    ctx.scale(sc, sc);
    var wig = Math.sin(t * 9) * (opts.moving ? 1.6 : 0.6);
    // body: tail, foot, head
    ctx.fillStyle = '#efe0b0'; ctx.strokeStyle = '#c4ad6b'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-20, 0); ctx.quadraticCurveTo(-12, -9, 2, -8); ctx.lineTo(10, -6); ctx.quadraticCurveTo(19, -5, 19, 0); ctx.quadraticCurveTo(19, 5, 10, 6); ctx.lineTo(2, 8); ctx.quadraticCurveTo(-12, 9, -20, 0); ctx.fill(); ctx.stroke();
    // eye stalks
    ctx.strokeStyle = '#c4ad6b'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(15, -3); ctx.lineTo(22, -7 + wig); ctx.moveTo(15, 3); ctx.lineTo(22, 7 - wig); ctx.stroke(); ctx.lineCap = 'butt';
    circle(ctx, 22, -7 + wig, 2.3, '#222'); circle(ctx, 22, 7 - wig, 2.3, '#222');
    // shell, with a little bob
    var bob = Math.sin(t * 7) * (opts.moving ? 0.8 : 0.2);
    ctx.translate(-3, bob);
    circle(ctx, 0, 0, 13, sn.shell); ctx.lineWidth = 2.5; ctx.strokeStyle = sn.color; ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.clip();
    ctx.fillStyle = sn.color; ctx.strokeStyle = sn.color; ctx.lineWidth = 2;
    switch (sn.pattern) {
      case 'dotted': for (var i = 0; i < 7; i++) circle(ctx, Math.cos(i * 0.9) * (i * 1.6), Math.sin(i * 0.9) * (i * 1.6), 1.7, sn.color); break;
      case 'striped': for (var s = -12; s <= 12; s += 6) { ctx.beginPath(); ctx.moveTo(s, -13); ctx.lineTo(s, 13); ctx.stroke(); } break;
      case 'double': ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.stroke(); break;
      case 'checkered': for (var cx = -12; cx < 12; cx += 6) for (var cy = -12; cy < 12; cy += 6) if (((cx + cy) / 6) % 2 === 0) ctx.fillRect(cx, cy, 6, 6); break;
      case 'dashed': ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]); break;
      default: ctx.beginPath(); for (var a = 0; a < 12; a += 0.25) ctx.lineTo(Math.cos(a) * a * 0.9, Math.sin(a) * a * 0.9); ctx.stroke();
    }
    ctx.restore();
    ellipse(ctx, -4, -5, 4, 2, 'rgba(255,255,255,0.55)', -0.6);
    ctx.restore();
  }

  // ---------- frame ----------
  function create(canvas) {
    return { canvas: canvas, ctx: canvas.getContext('2d', { alpha: false }), cam: camera.create(), maxDpr: 2 };
  }

  function resizeView(view, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, view.maxDpr);
    var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (view.canvas.width !== w || view.canvas.height !== h) { view.canvas.width = w; view.canvas.height = h; }
    camera.resize(view.cam, cssW, cssH, dpr);
  }

  function nextGateIndex(race, racer) { return (racer.cpPassed + 1) % maps.CHECKPOINTS; }

  // opts: { race, fx, time, focus (racer), showLabels }
  function drawFrame(view, opts) {
    var ctx = view.ctx, cam = view.cam, race = opts.race, tr = race.track, t = opts.time || 0;
    var st = getStatic(tr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = tr.theme.bgBottom; ctx.fillRect(0, 0, view.canvas.width, view.canvas.height);
    var shakeX = 0, shakeY = 0;
    if (opts.fx && opts.fx.shake > 0) { shakeX = (Math.random() - 0.5) * opts.fx.shake; shakeY = (Math.random() - 0.5) * opts.fx.shake; }
    var save = { x: cam.x, y: cam.y };
    cam.x += shakeX / cam.zoom; cam.y += shakeY / cam.zoom;
    camera.apply(ctx, cam);
    // visible world rectangle, blitted from the cache
    var vw = cam.w / cam.zoom, vh = cam.h / cam.zoom, b = tr.bounds;
    var x0 = Math.max(b.x0, cam.x - vw / 2 - 4), y0 = Math.max(b.y0, cam.y - vh / 2 - 4);
    var x1 = Math.min(b.x1, cam.x + vw / 2 + 4), y1 = Math.min(b.y1, cam.y + vh / 2 + 4);
    if (x1 > x0 && y1 > y0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(st.canvas, (x0 - b.x0) * st.scale, (y0 - b.y0) * st.scale, (x1 - x0) * st.scale, (y1 - y0) * st.scale, x0, y0, x1 - x0, y1 - y0);
    }
    // the gate the player must cross next
    var focus = opts.focus;
    if (focus && race.phase !== 'countdown' && !focus.finished) {
      var g = tr.checkpoints[nextGateIndex(race, focus)], pulse = 0.55 + 0.45 * Math.sin(t * 6);
      ctx.beginPath(); ctx.moveTo(g.x - g.nx * g.hw, g.y - g.ny * g.hw); ctx.lineTo(g.x + g.nx * g.hw, g.y + g.ny * g.hw);
      ctx.strokeStyle = tr.theme.accent; ctx.globalAlpha = pulse; ctx.lineWidth = 6; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // snails, back to front
    var order = race.racers.slice().sort(function (p, q) { return p.body.y - q.body.y; });
    for (var i = 0; i < order.length; i++) {
      var r = order[i], bd = r.body, sp = Math.hypot(bd.vx, bd.vy);
      if (Math.abs(bd.x - cam.x) > vw / 2 + 50 || Math.abs(bd.y - cam.y) > vh / 2 + 50) continue;
      if (bd.boosting && !(opts.fx && opts.fx.reduced)) {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bd.x, bd.y); ctx.lineTo(bd.x - bd.vx * 0.14, bd.y - bd.vy * 0.14); ctx.stroke(); ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
      }
      drawSnail(ctx, r.snail, bd.x, bd.y, bd.heading, opts.reducedMotion ? 0 : bd.wobble, { moving: sp > 20 && !opts.reducedMotion });
      if (r.isPlayer) {
        // marker above the player's snail
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bd.x, bd.y - 30); ctx.lineTo(bd.x - 8, bd.y - 44); ctx.lineTo(bd.x + 8, bd.y - 44); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    if (opts.fx) effects.draw(ctx, opts.fx);
    cam.x = save.x; cam.y = save.y;
    if (opts.fx && opts.fx.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(255,255,255,' + (opts.fx.flash * 0.35) + ')'; ctx.fillRect(0, 0, view.canvas.width, view.canvas.height);
    }
  }

  // Thumbnail of a whole map: the real static layer, scaled to the canvas.
  function drawThumbnail(canvas, tr, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    var c = canvas.getContext('2d'), b = tr.bounds;
    c.fillStyle = tr.theme.bgBottom; c.fillRect(0, 0, canvas.width, canvas.height);
    var z = Math.max(canvas.width / (b.w - 300), canvas.height / (b.h - 300));
    c.setTransform(z, 0, 0, z, (canvas.width - b.w * z) / 2 - b.x0 * z, (canvas.height - b.h * z) / 2 - b.y0 * z);
    c.save(); c.beginPath(); c.rect(b.x0, b.y0, b.w, b.h); c.clip();
    drawStaticLayer(c, tr, z);
    c.restore();
  }

  root.SnailArena.render = {
    create: create, resizeView: resizeView, drawFrame: drawFrame, drawThumbnail: drawThumbnail,
    drawSnail: drawSnail, getStatic: getStatic, releaseStatic: releaseStatic
  };
})(window);
