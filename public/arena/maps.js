// Map data and track geometry for the Arena. Maps are plain data: a closed
// list of control points, a width, themed obstacles, terrain patches and
// bridges. buildTrack() turns one into a sampled centreline with widths,
// normals, curvature, checkpoints and a start grid. Pure, no DOM.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SnailArena = root.SnailArena || {}; root.SnailArena.maps = api; }
})(this, function () {
  var SNAIL_R = 16;      // collision radius of every snail, world units
  var STEP = 14;         // centreline sample spacing, world units
  var CHECKPOINTS = 8;   // checkpoints per lap; #0 is the start/finish line

  // Obstacles and patches are placed by `at` (0..1 along the lap), `off`
  // (-1..1 of the half width, + is the right-hand side of travel) and `r`.
  // Obstacle kinds: rock cactus tree log mushroom jelly candy.
  // Patch kinds: sand mud ice ash jelly boost.
  var MAPS = [
    {
      id: 'meadow', name: 'Meadow Circuit', difficulty: 1, difficultyLabel: 'Beginner',
      description: 'Wide, gentle bends through flowers and ponds. A friendly first lap.',
      width: 190, margin: 40, defaultLaps: 2,
      points: [[430,1000],[290,650],[470,330],[820,260],[1130,430],[1420,640],[1780,610],[2060,780],[2080,1100],[1800,1300],[1420,1260],[1130,1100],[860,1160],[642,1184]],
      narrows: [],
      bridges: [],
      obstacles: [
        { at: 0.12, off: 0.55, r: 26, kind: 'mushroom' }, { at: 0.30, off: -0.5, r: 24, kind: 'rock' },
        { at: 0.52, off: 0.5, r: 26, kind: 'mushroom' }, { at: 0.72, off: -0.45, r: 24, kind: 'rock' }
      ],
      patches: [
        { at: 0.20, off: 0, r: 70, kind: 'mud' }, { at: 0.62, off: 0.2, r: 62, kind: 'mud' },
        { at: 0.90, off: 0, r: 56, kind: 'boost' }
      ],
      base: { speed: 1, grip: 1 },
      theme: {
        bgTop: '#7ccf6a', bgBottom: '#4da24a', track: '#e9d29c', trackEdge: '#b88a52', lane: 'rgba(255,255,255,0.35)',
        boundary: 'fence', decor: ['flower', 'flower', 'bush', 'mushroom', 'pond', 'tuft'], accent: '#ffd54a'
      }
    },
    {
      id: 'desert', name: 'Desert Dunes', difficulty: 2, difficultyLabel: 'Intermediate',
      description: 'Narrow turns between dunes. Soft sand and slick riverbeds change your pace.',
      width: 128, margin: 50, defaultLaps: 2,
      points: [[500,373],[870,240],[1400,330],[1960,250],[2280,560],[2200,980],[1760,1090],[1470,1310],[1110,1110],[790,1320],[380,1280],[291,982],[508,795],[500,600]],
      narrows: [{ from: 0.60, to: 0.68, width: 100 }],
      bridges: [],
      obstacles: [
        { at: 0.09, off: -0.45, r: 20, kind: 'cactus' }, { at: 0.22, off: 0.45, r: 22, kind: 'rock' },
        { at: 0.40, off: -0.4, r: 20, kind: 'cactus' }, { at: 0.55, off: 0.4, r: 22, kind: 'rock' },
        { at: 0.78, off: -0.4, r: 20, kind: 'cactus' }, { at: 0.93, off: 0.4, r: 22, kind: 'rock' }
      ],
      patches: [
        { at: 0.15, off: 0, r: 72, kind: 'sand' }, { at: 0.34, off: 0, r: 64, kind: 'ice' },
        { at: 0.48, off: 0.1, r: 70, kind: 'sand' }, { at: 0.70, off: 0, r: 66, kind: 'sand' },
        { at: 0.86, off: 0, r: 58, kind: 'boost' }
      ],
      base: { speed: 0.97, grip: 0.95 },
      theme: {
        bgTop: '#f3cf86', bgBottom: '#e0a95a', track: '#d9ae6c', trackEdge: '#8d5b2a', lane: 'rgba(255,240,200,0.3)',
        boundary: 'dunes', decor: ['dune', 'cactus', 'rock', 'bones', 'dune', 'tuft'], accent: '#ff8a3d'
      }
    },
    {
      id: 'forest', name: 'Mystic Forest', difficulty: 3, difficultyLabel: 'Advanced',
      description: 'A twisting trail under giant trees. Logs and glowing mushrooms crowd the tight turns.',
      width: 118, margin: 40, defaultLaps: 2,
      points: [[375,442],[720,250],[1030,560],[1420,330],[1880,470],[1960,820],[1671,1028],[1713,1322],[1340,1520],[987,1323],[1012,1065],[813,916],[520,1180],[292,991],[420,700]],
      narrows: [{ from: 0.34, to: 0.40, width: 96 }],
      bridges: [],
      obstacles: [
        { at: 0.07, off: 0.42, r: 22, kind: 'log' }, { at: 0.19, off: -0.4, r: 22, kind: 'mushroom' },
        { at: 0.33, off: 0.42, r: 22, kind: 'log' }, { at: 0.46, off: -0.4, r: 22, kind: 'mushroom' },
        { at: 0.58, off: 0.42, r: 22, kind: 'log' }, { at: 0.70, off: -0.4, r: 22, kind: 'log' },
        { at: 0.82, off: 0.42, r: 22, kind: 'mushroom' }, { at: 0.94, off: -0.4, r: 22, kind: 'log' }
      ],
      patches: [
        { at: 0.13, off: 0, r: 64, kind: 'mud' }, { at: 0.52, off: -0.1, r: 64, kind: 'mud' },
        { at: 0.76, off: 0.1, r: 60, kind: 'mud' }, { at: 0.88, off: 0, r: 54, kind: 'boost' }
      ],
      base: { speed: 1, grip: 1 },
      theme: {
        bgTop: '#1f5a4a', bgBottom: '#0f3a33', track: '#7a5a3a', trackEdge: '#2e1f14', lane: 'rgba(255,255,255,0.18)',
        boundary: 'roots', decor: ['tree', 'tree', 'glowshroom', 'tree', 'fern', 'glowshroom'], accent: '#7dffd4'
      }
    },
    {
      id: 'candy', name: 'Candy Kingdom', difficulty: 2, difficultyLabel: 'Intermediate',
      description: 'A sweet three-lobed circuit with candy-cane rails, chocolate bridges and bouncy jelly.',
      width: 158, margin: 40, defaultLaps: 2,
      points: [],
      polar: { cx: 1250, cy: 1000, r: 640, amp: 0.26, lobes: 3, count: 24, phase: -1.57 },
      narrows: [],
      bridges: [{ from: 0.14, to: 0.22 }, { from: 0.47, to: 0.55 }, { from: 0.80, to: 0.88 }],
      obstacles: [
        { at: 0.10, off: 0.5, r: 24, kind: 'candy' }, { at: 0.30, off: -0.5, r: 26, kind: 'jelly' },
        { at: 0.38, off: 0.5, r: 24, kind: 'candy' }, { at: 0.64, off: -0.5, r: 26, kind: 'jelly' },
        { at: 0.71, off: 0.5, r: 24, kind: 'candy' }, { at: 0.93, off: -0.5, r: 26, kind: 'jelly' }
      ],
      patches: [
        { at: 0.26, off: 0, r: 66, kind: 'jelly' }, { at: 0.59, off: 0, r: 66, kind: 'jelly' },
        { at: 0.92, off: 0, r: 66, kind: 'jelly' }, { at: 0.08, off: 0, r: 56, kind: 'boost' }
      ],
      base: { speed: 1, grip: 1 },
      theme: {
        bgTop: '#ffc6e6', bgBottom: '#cfa0ff', track: '#ffe9f4', trackEdge: '#ff5fa2', lane: 'rgba(255,95,162,0.28)',
        boundary: 'candycane', decor: ['lollipop', 'lollipop', 'cupcake', 'gumdrop', 'sprinkle', 'gumdrop'], accent: '#ff4f9a'
      }
    },
    {
      id: 'volcano', name: 'Volcano Island', difficulty: 4, difficultyLabel: 'Expert',
      description: 'Narrow stone bridges over lava, ash patches and a hairpin. Hold your line.',
      width: 112, margin: 40, defaultLaps: 2,
      points: [[420,1250],[1000,1330],[1650,1250],[2100,980],[2060,620],[1650,420],[1350,640],[1020,400],[640,310],[290,540],[260,900]],
      narrows: [{ from: 0.10, to: 0.30, width: 92 }, { from: 0.62, to: 0.76, width: 92 }],
      bridges: [{ from: 0.10, to: 0.30 }, { from: 0.62, to: 0.76 }],
      obstacles: [
        { at: 0.05, off: 0.4, r: 20, kind: 'rock' }, { at: 0.37, off: -0.4, r: 20, kind: 'rock' },
        { at: 0.47, off: 0.4, r: 20, kind: 'rock' }, { at: 0.82, off: -0.4, r: 20, kind: 'rock' },
        { at: 0.92, off: 0.4, r: 20, kind: 'rock' }
      ],
      patches: [
        { at: 0.04, off: 0, r: 62, kind: 'ash' }, { at: 0.42, off: 0, r: 62, kind: 'ash' },
        { at: 0.52, off: 0, r: 58, kind: 'ash' }, { at: 0.88, off: 0, r: 62, kind: 'ash' },
        { at: 0.19, off: 0, r: 50, kind: 'boost' }
      ],
      base: { speed: 0.98, grip: 1 },
      theme: {
        bgTop: '#4a2a22', bgBottom: '#240f10', track: '#5b4a46', trackEdge: '#1a0d0c', lane: 'rgba(255,200,150,0.18)',
        boundary: 'lava', decor: ['lava', 'lava', 'crag', 'ember', 'crag', 'ashheap'], accent: '#ff7a1a'
      }
    }
  ];

  var TERRAIN = {
    sand:  { speed: 0.62, grip: 0.9, accel: 0.8, label: 'Sand' },
    mud:   { speed: 0.55, grip: 1.0, accel: 0.8, label: 'Mud' },
    ice:   { speed: 1.0, grip: 0.16, accel: 1.0, label: 'Slippery' },
    ash:   { speed: 0.72, grip: 0.7, accel: 0.9, label: 'Ash' },
    jelly: { speed: 0.7, grip: 0.8, accel: 0.9, label: 'Jelly' },
    boost: { speed: 1.35, grip: 1.0, accel: 2.5, label: 'Boost pad' }
  };

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function controlPoints(def) {
    if (def.points && def.points.length) return def.points;
    var p = def.polar, out = [];
    for (var i = 0; i < p.count; i++) {
      var th = p.phase + (i / p.count) * Math.PI * 2;
      var r = p.r * (1 + p.amp * Math.cos(p.lobes * (th - p.phase)));
      out.push([p.cx + Math.cos(th) * r, p.cy + Math.sin(th) * r]);
    }
    return out;
  }

  // Closed uniform Catmull-Rom through the control points, then resampled at
  // an even arc-length spacing so progress maths is simple.
  function sampleSpline(ctrl) {
    var n = ctrl.length, dense = [], i, k;
    for (i = 0; i < n; i++) {
      var p0 = ctrl[(i + n - 1) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (k = 0; k < 40; k++) {
        var t = k / 40, t2 = t * t, t3 = t2 * t;
        dense.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    var cum = [0];
    for (i = 1; i <= dense.length; i++) {
      var a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    var total = cum[cum.length - 1];
    var count = Math.max(8, Math.round(total / STEP));
    var step = total / count, out = [], j = 0;
    for (i = 0; i < count; i++) {
      var target = i * step;
      while (cum[j + 1] < target) j++;
      var f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      var A = dense[j], B = dense[(j + 1) % dense.length];
      out.push({ x: A[0] + (B[0] - A[0]) * f, y: A[1] + (B[1] - A[1]) * f });
    }
    return { pts: out, step: step, length: total };
  }

  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  function buildTrack(def) {
    var sp = sampleSpline(controlPoints(def));
    var pts = sp.pts, n = pts.length, L = sp.length, step = sp.step, i;
    var tr = {
      id: def.id, def: def, theme: def.theme, n: n, L: L, step: step, pts: pts,
      tx: [], ty: [], nx: [], ny: [], curv: [], halfW: [], base: def.base
    };
    for (i = 0; i < n; i++) {
      var a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      var dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1;
      tr.tx.push(dx / m); tr.ty.push(dy / m);
      tr.nx.push(-dy / m); tr.ny.push(dx / m);   // right-hand normal (y down)
    }
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n, h = (i + n - 1) % n;
      var ang = Math.atan2(tr.ty[j], tr.tx[j]) - Math.atan2(tr.ty[h], tr.tx[h]);
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      tr.curv.push(ang / (2 * step));            // signed turn per unit length
    }
    // Width per sample with smooth tapering into the narrow sections.
    for (i = 0; i < n; i++) {
      var f = i / n, w = def.width;
      for (var q = 0; q < (def.narrows || []).length; q++) {
        var nr = def.narrows[q], taper = 0.035;
        var inside = smooth((f - nr.from) / taper) * (1 - smooth((f - nr.to) / taper + 0));
        w = Math.min(w, def.width + (nr.width - def.width) * inside);
      }
      tr.halfW.push(w / 2);
    }
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var mg = def.margin + def.width + 160;
    tr.bounds = { x0: Math.min.apply(null, xs) - mg, y0: Math.min.apply(null, ys) - mg,
      x1: Math.max.apply(null, xs) + mg, y1: Math.max.apply(null, ys) + mg };
    tr.bounds.w = tr.bounds.x1 - tr.bounds.x0; tr.bounds.h = tr.bounds.y1 - tr.bounds.y0;

    function place(at, off) {
      var idx = Math.round(at * n) % n;
      var hw = tr.halfW[idx];
      return { idx: idx, s: idx * step, x: pts[idx].x + tr.nx[idx] * off * hw, y: pts[idx].y + tr.ny[idx] * off * hw, hw: hw };
    }
    tr.place = place;
    tr.obstacles = (def.obstacles || []).map(function (o) {
      var p = place(o.at, o.off);
      return { x: p.x, y: p.y, r: o.r, kind: o.kind, s: p.s, off: o.off * p.hw, hw: p.hw, idx: p.idx };
    });
    tr.patches = (def.patches || []).map(function (o) {
      var p = place(o.at, o.off), t = TERRAIN[o.kind];
      return { x: p.x, y: p.y, r: o.r, kind: o.kind, s: p.s, speed: t.speed, grip: t.grip, accel: t.accel };
    });
    tr.bridges = (def.bridges || []).map(function (b) {
      return { from: Math.round(b.from * n), to: Math.round(b.to * n) };
    });
    // Checkpoints split the lap evenly; #0 is the start/finish line.
    tr.checkpoints = [];
    for (i = 0; i < CHECKPOINTS; i++) {
      var ci = Math.round((i / CHECKPOINTS) * n) % n;
      tr.checkpoints.push({ i: i, idx: ci, s: ci * step, x: pts[ci].x, y: pts[ci].y,
        tx: tr.tx[ci], ty: tr.ty[ci], nx: tr.nx[ci], ny: tr.ny[ci], hw: tr.halfW[ci] });
    }
    tr.cpSpan = L / CHECKPOINTS;
    tr.start = tr.checkpoints[0];
    return tr;
  }

  // Start grid: two columns, staggered rows, behind the line. `slot` 0 is
  // the front-left. Returns position, heading and the (negative) progress.
  function gridSlot(tr, slot) {
    var row = Math.floor(slot / 2), col = slot % 2;
    var back = 46 + row * 52 + col * 22;
    var idx = ((tr.n - Math.round(back / tr.step)) % tr.n + tr.n) % tr.n;
    var off = (col ? 0.34 : -0.34) * tr.halfW[idx];
    return {
      x: tr.pts[idx].x + tr.nx[idx] * off, y: tr.pts[idx].y + tr.ny[idx] * off,
      heading: Math.atan2(tr.ty[idx], tr.tx[idx]), progress: -back
    };
  }

  // Nearest point on the centreline near `hint` (a sample index), searching
  // +-window samples so a track that doubles back never snaps to a distant,
  // unrelated stretch. Pass hint < 0 for a full search.
  function locate(tr, x, y, hint, window) {
    var n = tr.n, best = Infinity, bi = 0, bt = 0, i, k;
    var lo, count;
    if (hint === undefined || hint < 0) { lo = 0; count = n; }
    else { lo = hint - (window || 14); count = 2 * (window || 14) + 1; }
    for (k = 0; k < count; k++) {
      i = ((lo + k) % n + n) % n;
      var a = tr.pts[i], b = tr.pts[(i + 1) % n];
      var ex = b.x - a.x, ey = b.y - a.y;
      var t = ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var px = a.x + ex * t, py = a.y + ey * t;
      var d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d < best) { best = d; bi = i; bt = t; }
    }
    var j = (bi + 1) % n;
    var cx = tr.pts[bi].x + (tr.pts[j].x - tr.pts[bi].x) * bt;
    var cy = tr.pts[bi].y + (tr.pts[j].y - tr.pts[bi].y) * bt;
    var nx = tr.nx[bi] + (tr.nx[j] - tr.nx[bi]) * bt, ny = tr.ny[bi] + (tr.ny[j] - tr.ny[bi]) * bt;
    var nm = Math.hypot(nx, ny) || 1; nx /= nm; ny /= nm;
    var hw = tr.halfW[bi] + (tr.halfW[j] - tr.halfW[bi]) * bt;
    var dist = Math.sqrt(best);
    var side = (x - cx) * nx + (y - cy) * ny;
    return { idx: bi, t: bt, s: (bi + bt) * tr.step, cx: cx, cy: cy, nx: nx, ny: ny,
      dist: dist, off: side, hw: hw };
  }

  // Point on the centreline at arc position s (wraps), with its normal.
  function pointAt(tr, s) {
    var f = (((s / tr.step) % tr.n) + tr.n) % tr.n;
    var i = Math.floor(f), t = f - i, j = (i + 1) % tr.n;
    return {
      x: tr.pts[i].x + (tr.pts[j].x - tr.pts[i].x) * t, y: tr.pts[i].y + (tr.pts[j].y - tr.pts[i].y) * t,
      nx: tr.nx[i] + (tr.nx[j] - tr.nx[i]) * t, ny: tr.ny[i] + (tr.ny[j] - tr.ny[i]) * t,
      hw: tr.halfW[i] + (tr.halfW[j] - tr.halfW[i]) * t, idx: i
    };
  }

  // Combined terrain under a point: the map's base plus the strongest patch.
  function terrainAt(tr, x, y) {
    var out = { speed: tr.base.speed, grip: tr.base.grip, accel: 1, kind: null };
    for (var i = 0; i < tr.patches.length; i++) {
      var p = tr.patches[i], d = Math.hypot(x - p.x, y - p.y);
      if (d < p.r) {
        out.speed = p.speed * tr.base.speed; out.grip = p.grip * tr.base.grip; out.accel = p.accel; out.kind = p.kind;
        break;
      }
    }
    return out;
  }

  var cache = {};
  function getTrack(id) {
    if (!cache[id]) {
      for (var i = 0; i < MAPS.length; i++) if (MAPS[i].id === id) cache[id] = buildTrack(MAPS[i]);
    }
    return cache[id] || null;
  }

  return {
    SNAIL_R: SNAIL_R, STEP: STEP, CHECKPOINTS: CHECKPOINTS, MAPS: MAPS, TERRAIN: TERRAIN,
    rng: rng, buildTrack: buildTrack, getTrack: getTrack, gridSlot: gridSlot, locate: locate,
    pointAt: pointAt, terrainAt: terrainAt
  };
});
