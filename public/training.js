// Training tab: pick one of the six snails, run one of three free training
// sessions a day to raise its level, and race it on a short track for more
// XP. The level, XP and best times live on the server (snail_training), so a
// snail's progress survives a reload, another tab and another device.
//
// The race is a one-thumb sprint on a canvas: the snail runs the loop by
// itself, and HOLD TO BOOST spends the boost tank for extra speed. Release
// to recharge. Empty the tank and the snail is winded for a moment, so short
// bursts beat holding the button down.
//
// Nothing here touches the Daily Derby, the $NAIL totals or the cage.
(function () {
  var SNAILS = (window.snailDerby && window.snailDerby.snails) || [];
  var snailToken = window.snailDerby && window.snailDerby.snailToken;
  var authHeaders = window.snailDerby && window.snailDerby.authHeaders;
  var root = document.getElementById('training-root');
  if (!root || !SNAILS.length || !snailToken || !authHeaders) return;

  var arena = window.SnailArena;
  var audio = arena && arena.audio;
  var drawSnail = arena && arena.render && arena.render.drawSnail;
  var TAU = Math.PI * 2;

  // Whole literal class strings, so the Tailwind build sees every one.
  var PRIMARY = 'w-full h-12 rounded-xl text-base font-bold tracking-wide transition-colors bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed';
  var PRIMARY_SM = 'h-12 px-5 rounded-xl text-sm font-bold tracking-wide transition-colors bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed';
  var SECONDARY = 'h-12 px-4 rounded-xl text-sm font-bold tracking-wide transition-colors border border-zinc-700 text-zinc-100 hover:bg-zinc-800 active:bg-zinc-700 disabled:text-zinc-500 disabled:border-zinc-800';
  var TILE = 'w-full flex flex-col items-center gap-1 rounded-xl border px-1 pt-3 pb-2 text-center transition-colors ';
  var TILE_ON = 'border-violet-500/70 bg-violet-500/15 ring-2 ring-violet-400';
  var TILE_OFF = 'border-zinc-800 hover:bg-zinc-800/60';
  var CARD = 'rounded-2xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-3';
  var CARD_HEAD = 'flex items-baseline justify-between gap-3';
  var H2 = 'text-sm font-bold tracking-wide text-zinc-100';
  var CHIP = 'shrink-0 text-[11px] font-bold tracking-widest rounded-full px-2.5 py-1 whitespace-nowrap ';

  var view = null;      // the last GET /api/training
  var failed = false;
  var selected = readSelected();
  var homeEl = null;    // holds the two cards
  var stage = null;     // the race stage, built once
  var race = null;      // the race in progress
  var raf = 0;
  var resizeObs = null;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saveState = 'idle'; // idle | saving | failed

  function readSelected() {
    try {
      var raw = JSON.parse(localStorage.getItem('snailDerby.train.v1') || 'null');
      if (raw && typeof raw.snail === 'string') return raw.snail;
    } catch (e) {}
    return SNAILS[0].id;
  }

  function writeSelected(id) {
    try { localStorage.setItem('snailDerby.train.v1', JSON.stringify({ snail: id })); } catch (e) {}
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function snailOf(id) {
    for (var i = 0; i < SNAILS.length; i++) if (SNAILS[i].id === id) return SNAILS[i];
    return SNAILS[0];
  }

  // The chosen snail's server record, with a level-1 fallback so the page
  // still renders while the view is loading.
  function recordOf(id) {
    if (view) {
      for (var i = 0; i < view.snails.length; i++) if (view.snails[i].id === id) return view.snails[i];
    }
    return {
      id: id, xp: 0, level: 1, xpIntoLevel: 0, xpForNext: 20, maxed: false,
      races: 0, wins: 0, bests: {}, sessionsToday: 0, sessionsLeft: 3,
      speedPct: 0, boostPct: 0, speedMult: 1, boostMult: 1.6, energyCap: 1,
    };
  }

  function fmt(sec) {
    if (sec == null || !isFinite(sec)) return '0:00.0';
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function fmtMs(ms) {
    return fmt(Number(ms) / 1000);
  }

  function ordinal(n) {
    var x = Number(n) || 0;
    return x + (x % 10 === 1 && x !== 11 ? 'st' : x % 10 === 2 && x !== 12 ? 'nd' : x % 10 === 3 && x !== 13 ? 'rd' : 'th');
  }

  // ---------------- home ----------------

  function token(s, px) {
    var el = snailToken(s, 'relative block');
    el.style.width = px + 'px';
    el.style.height = px + 'px';
    return el;
  }

  function levelChip(rec) {
    return node('span', 'text-[10px] font-bold tracking-widest rounded px-1.5 py-0.5 ' +
      (rec.level > 1 ? 'bg-violet-600 text-white' : 'text-zinc-400 bg-zinc-800'),
    'LV ' + rec.level);
  }

  function renderTiles(listEl) {
    SNAILS.forEach(function (s) {
      var rec = recordOf(s.id);
      var li = node('li');
      li.setAttribute('data-training-snail', s.id);
      var on = s.id === selected;
      var btn = node('button', TILE + (on ? TILE_ON : TILE_OFF));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var tok = node('span', 'relative block w-10 h-10 mt-2.5');
      tok.appendChild(token(s, 40));
      var name = node('span', 'max-w-full truncate text-xs font-semibold text-zinc-100', s.name);
      var lvl = node('span', 'flex items-center gap-1 text-[10px] font-semibold text-zinc-400');
      lvl.appendChild(levelChip(rec));
      btn.appendChild(tok);
      btn.appendChild(name);
      btn.appendChild(lvl);
      btn.addEventListener('click', function () {
        selected = s.id;
        writeSelected(selected);
        renderHome();
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function xpRow(rec) {
    var row = node('div', 'flex flex-col gap-1');
    row.setAttribute('data-training-xp', '');
    var line = node('div', 'flex items-baseline justify-between gap-3 text-xs font-mono tabular-nums text-zinc-400');
    if (rec.maxed) {
      line.appendChild(node('span', null, 'MAX LEVEL'));
      line.appendChild(node('span', 'text-violet-300', 'XP ' + rec.xp));
    } else {
      line.appendChild(node('span', null, 'XP ' + rec.xpIntoLevel + ' / ' + rec.xpForNext));
      line.appendChild(node('span', null, 'LEVEL ' + (rec.level + 1) + ' AT ' + rec.xpForNext));
    }
    row.appendChild(line);
    var track = node('div', 'h-2 rounded-full bg-zinc-800 overflow-hidden');
    var fill = node('div', 'h-full rounded-full bg-violet-500');
    fill.style.width = rec.maxed ? '100%' : Math.round(100 * rec.xpIntoLevel / rec.xpForNext) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  // The chosen snail's card: level, XP bar, record and the TRAIN action.
  function detailEls() {
    var s = snailOf(selected);
    var rec = recordOf(selected);
    var frag = document.createDocumentFragment();

    var who = node('div', 'flex items-center gap-3 pt-1');
    who.appendChild(token(s, 56));
    var whoText = node('div', 'min-w-0 flex flex-col gap-1');
    whoText.appendChild(node('p', 'truncate text-lg font-bold text-zinc-100', s.name));
    var chips = node('div', 'flex flex-wrap gap-1.5');
    chips.appendChild(node('span', 'text-[10px] font-bold tracking-widest rounded px-1.5 py-0.5 bg-violet-600 text-white', 'LEVEL ' + rec.level));
    if (rec.speedPct > 0) {
      chips.appendChild(node('span', 'text-[10px] font-bold tracking-widest rounded px-1.5 py-0.5 text-lime-300 bg-lime-500/10', '+' + rec.speedPct + '% SPEED'));
    }
    if (rec.boostPct > 0) {
      chips.appendChild(node('span', 'text-[10px] font-bold tracking-widest rounded px-1.5 py-0.5 text-sky-300 bg-sky-500/10', '+' + rec.boostPct + '% BOOST'));
    }
    whoText.appendChild(chips);
    who.appendChild(whoText);
    frag.appendChild(who);

    frag.appendChild(xpRow(rec));

    var stats = node('div', 'flex items-center justify-between gap-3 text-xs font-mono tabular-nums text-zinc-400');
    stats.appendChild(node('span', 'truncate', 'RACES ' + rec.races + ' · WINS ' + rec.wins));
    stats.appendChild(node('span', 'shrink-0', 'SESSIONS ' + rec.sessionsLeft + ' OF ' + sessionsPerDay()));
    frag.appendChild(stats);

    var train = node('button', PRIMARY);
    train.type = 'button';
    train.setAttribute('data-training-train', '');
    if (failed) {
      train.textContent = 'TRAINING UNAVAILABLE';
      train.disabled = true;
    } else if (rec.maxed) {
      train.textContent = 'MAX LEVEL REACHED';
      train.disabled = true;
    } else if (!view) {
      train.textContent = 'LOADING';
      train.disabled = true;
    } else if (rec.sessionsLeft <= 0) {
      train.textContent = 'NO SESSIONS LEFT TODAY';
      train.disabled = true;
    } else {
      train.textContent = 'TRAIN · +' + xpPerTrain() + ' XP';
      train.addEventListener('click', function () { trainSnail(train); });
    }
    frag.appendChild(train);

    var hint = node('p', 'text-xs text-zinc-500 text-center');
    hint.textContent = rec.sessionsLeft <= 0
      ? 'Sessions reset at 00:00 UTC. Race a short track for more XP.'
      : 'Each session adds ' + xpPerTrain() + ' XP. Sessions reset at 00:00 UTC.';
    frag.appendChild(hint);

    return frag;
  }

  function sessionsPerDay() {
    return view && view.rules ? view.rules.sessionsPerDay : 3;
  }

  function xpPerTrain() {
    return view && view.rules ? view.rules.xpPerTrain : 10;
  }

  // A small drawn loop, so each track card shows its own shape and colour.
  function drawThumb(canvas, track) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 64, h = 44;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#09090b';
    c.fillRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;
    var rx = w * track.rx, ry = h * track.ry;
    c.beginPath();
    for (var i = 0; i <= 90; i++) {
      var th = -Math.PI / 2 + (i / 90) * TAU;
      var wob = 1 + (track.wobble || 0) * Math.sin(th * 3);
      var x = cx + Math.cos(th) * rx * wob;
      var y = cy + Math.sin(th) * ry * wob;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
    c.lineWidth = 5;
    c.strokeStyle = '#3f3f46';
    c.stroke();
    c.lineWidth = 1.5;
    c.strokeStyle = track.accent;
    c.stroke();
  }

  function renderTracks(listEl) {
    var tracks = (view && view.tracks) || [];
    tracks.forEach(function (tr) {
      var rec = recordOf(selected);
      var li = node('li', 'flex items-center gap-3 rounded-xl border border-zinc-800 p-2');
      li.setAttribute('data-track', tr.id);
      var cv = node('canvas', 'shrink-0 rounded-lg');
      cv.style.width = '64px';
      cv.style.height = '44px';
      cv.setAttribute('aria-hidden', 'true');
      drawThumb(cv, tr);
      li.appendChild(cv);
      var mid = node('div', 'min-w-0 flex-1 flex flex-col gap-0.5');
      mid.appendChild(node('span', 'text-sm font-semibold text-zinc-100', tr.name));
      var best = rec.bests && rec.bests[tr.id];
      var meta = tr.metres + ' m · ' + (best ? fmtMs(best) : '--');
      mid.appendChild(node('span', 'text-xs text-zinc-400 font-mono tabular-nums', meta));
      li.appendChild(mid);
      var go = node('button', 'shrink-0 h-10 px-4 rounded-lg text-sm font-bold tracking-wide transition-colors border border-violet-500/70 text-violet-200 hover:bg-violet-600/20 active:bg-violet-600/30');
      go.type = 'button';
      go.setAttribute('data-track-start', tr.id);
      go.textContent = 'RACE';
      go.disabled = !view;
      go.addEventListener('click', function () { startRace(tr); });
      li.appendChild(go);
      listEl.appendChild(li);
    });
  }

  function renderHome() {
    if (!homeEl) {
      homeEl = node('div', 'space-y-4');
      homeEl.id = 'training-home';
      root.insertBefore(homeEl, stage);
    }
    homeEl.textContent = '';

    var training = node('section', CARD);
    training.id = 'training';
    var head = node('div', 'flex items-start justify-between gap-3');
    var headText = node('div', 'flex flex-col gap-0.5');
    headText.appendChild(node('h2', H2, 'TRAINING'));
    headText.appendChild(node('p', 'text-xs text-zinc-400', 'Train a snail, then race it on a short track.'));
    head.appendChild(headText);
    var rec = recordOf(selected);
    head.appendChild(node('span', CHIP + 'border border-zinc-700 text-zinc-300', rec.sessionsLeft + ' OF ' + sessionsPerDay() + ' SESSIONS'));
    training.appendChild(head);

    var snails = node('ul', 'grid grid-cols-3 sm:grid-cols-6 gap-2');
    snails.id = 'training-snails';
    renderTiles(snails);
    training.appendChild(snails);

    var detail = node('div', 'border-t border-zinc-800 pt-3 flex flex-col gap-3');
    detail.id = 'training-detail';
    if (failed) {
      detail.appendChild(node('p', 'text-sm text-zinc-400', 'Training unavailable right now.'));
    } else if (!view) {
      detail.appendChild(node('p', 'text-sm text-zinc-400', 'Loading training...'));
    } else {
      detail.appendChild(detailEls());
    }
    training.appendChild(detail);
    if (view) training.setAttribute('data-loaded', '');
    homeEl.appendChild(training);

    var tracksCard = node('section', CARD);
    tracksCard.id = 'training-tracks';
    var tHead = node('div', CARD_HEAD);
    tHead.appendChild(node('h2', H2, 'SHORT TRACKS'));
    tHead.appendChild(node('span', 'shrink-0 text-[11px] font-bold tracking-widest text-zinc-500', 'BEST TIME · 1 LAP'));
    tracksCard.appendChild(tHead);
    var list = node('ul', 'flex flex-col gap-2');
    list.id = 'training-track-list';
    renderTracks(list);
    tracksCard.appendChild(list);
    var foot = node('p', 'text-xs leading-relaxed text-zinc-500 border-t border-zinc-800 pt-3');
    foot.textContent = 'Every race pays training XP. Your snail\'s level makes it faster and its boost stronger.';
    tracksCard.appendChild(foot);
    if (view) tracksCard.setAttribute('data-loaded', '');
    homeEl.appendChild(tracksCard);
  }

  // ---------------- race stage ----------------

  function buildStage() {
    stage = node('section', 'hidden ' + CARD);
    stage.id = 'training-stage';

    var head = node('div', 'flex items-center justify-between gap-3');
    var back = node('button', 'h-9 px-3 rounded-lg text-xs font-bold tracking-wide transition-colors border border-zinc-700 text-zinc-200 hover:bg-zinc-800', '‹ BACK');
    back.type = 'button';
    back.id = 'training-back';
    back.addEventListener('click', leaveRace);
    head.appendChild(back);
    var title = node('div', 'flex flex-col items-end');
    title.appendChild(node('h2', 'text-sm font-bold tracking-wide text-zinc-100', ''));
    title.firstChild.id = 'training-track-name';
    var sub = node('span', 'text-[11px] font-bold tracking-widest text-zinc-500', '');
    sub.id = 'training-track-meta';
    title.appendChild(sub);
    head.appendChild(title);
    stage.appendChild(head);

    var hud = node('div', 'flex items-center justify-between gap-2 text-xs font-mono tabular-nums');
    var place = node('span', 'rounded-lg border border-zinc-700 px-2.5 py-1 font-bold text-zinc-100', '1ST / 4');
    place.id = 'training-place';
    var time = node('span', 'rounded-lg border border-zinc-700 px-2.5 py-1 font-bold text-zinc-100', '0:00.0');
    time.id = 'training-time';
    hud.appendChild(place);
    hud.appendChild(time);
    stage.appendChild(hud);

    var wrap = node('div', 'relative rounded-xl overflow-hidden bg-zinc-950');
    wrap.style.aspectRatio = '16 / 10';
    var cv = node('canvas', 'absolute inset-0 w-full h-full touch-none');
    cv.id = 'training-canvas';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Short track race');
    wrap.appendChild(cv);
    var count = node('div', 'hidden absolute inset-0 items-center justify-center rounded-xl bg-zinc-950/60 pointer-events-none');
    count.id = 'training-countdown';
    count.setAttribute('aria-live', 'assertive');
    var countText = node('span', 'font-mono text-6xl font-bold text-zinc-100', '3');
    countText.id = 'training-countdown-text';
    count.appendChild(countText);
    wrap.appendChild(count);
    stage.appendChild(wrap);
    stage._wrap = wrap;
    stage._canvas = cv;
    stage._ctx = cv.getContext('2d');
    stage._count = count;
    stage._countText = countText;

    var gauge = node('div', 'flex flex-col gap-1');
    var gaugeLine = node('div', 'flex items-center justify-between gap-3 text-xs font-semibold text-zinc-400');
    gaugeLine.appendChild(node('span', null, 'BOOST'));
    gaugeLine.appendChild(node('span', 'font-mono tabular-nums', '100%'));
    gaugeLine.lastChild.id = 'training-energy-text';
    gauge.appendChild(gaugeLine);
    var meter = node('div', 'h-2 rounded-full bg-zinc-800 overflow-hidden');
    var meterFill = node('div', 'h-full rounded-full bg-amber-400');
    meterFill.style.width = '100%';
    meterFill.id = 'training-energy';
    meter.appendChild(meterFill);
    gauge.appendChild(meter);
    stage.appendChild(gauge);
    stage._gauge = gauge;

    var boost = node('button', 'w-full h-14 rounded-xl text-lg font-bold tracking-wide transition-colors select-none touch-none bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700');
    boost.type = 'button';
    boost.id = 'training-boost';
    boost.textContent = 'HOLD TO BOOST';
    boost.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      boostStart();
      try { boost.setPointerCapture(e.pointerId); } catch (_) {}
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      boost.addEventListener(ev, function (e) {
        e.preventDefault();
        boostStop();
        try { boost.releasePointerCapture(e.pointerId); } catch (_) {}
      });
    });
    boost.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    stage.appendChild(boost);
    stage._boostBtn = boost;

    var hint = node('p', 'text-xs text-zinc-500 text-center');
    hint.id = 'training-boost-hint';
    hint.textContent = 'Hold to sprint. Release before the meter empties to recharge. An empty meter leaves your snail winded.';
    stage.appendChild(hint);
    stage._hint = hint;

    var result = node('div', 'hidden border-t border-zinc-800 pt-3 flex-col gap-3');
    result.id = 'training-result';
    result.setAttribute('aria-live', 'polite');
    stage.appendChild(result);
    stage._result = result;

    root.appendChild(stage);

    if (window.ResizeObserver) {
      resizeObs = new ResizeObserver(function () { sizeCanvas(); });
      resizeObs.observe(wrap);
    } else {
      window.addEventListener('resize', sizeCanvas);
    }
    return stage;
  }

  var W = 0, H = 0;

  function sizeCanvas() {
    if (!stage) return;
    var cv = stage._canvas;
    var r = stage._wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    stage._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = r.width;
    H = r.height;
    draw();
  }

  // Point on the loop at `frac` of one lap. `off` moves it across the road:
  // positive is inward, like a lane closer to the infield.
  function pointAt(track, frac, off) {
    var cx = W / 2, cy = H / 2;
    var rx = W * track.rx - (off || 0);
    var ry = H * track.ry - (off || 0);
    var th = -Math.PI / 2 + frac * TAU;
    var wob = 1 + (track.wobble || 0) * Math.sin(th * 3);
    return { x: cx + Math.cos(th) * rx * wob, y: cy + Math.sin(th) * ry * wob, th: th };
  }

  function roadPath(track, off) {
    var c = stage._ctx;
    c.beginPath();
    for (var i = 0; i <= 160; i++) {
      var p = pointAt(track, i / 160, off);
      if (i === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    }
    c.closePath();
  }

  function draw() {
    if (!stage || !race || !W || !H) return;
    var c = stage._ctx;
    var tr = race.track;
    var ring = Math.min(W, H) * 0.30;
    var gap = ring / 4.6;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#09090b';
    c.fillRect(0, 0, W, H);

    // The road: a soft edge, the surface, then a dashed centre line.
    roadPath(tr, 0);
    c.lineWidth = ring + 6;
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.stroke();
    roadPath(tr, 0);
    c.lineWidth = ring;
    c.strokeStyle = '#27272a';
    c.stroke();
    roadPath(tr, 0);
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(228,228,231,0.28)';
    c.setLineDash([5, 7]);
    c.stroke();
    c.setLineDash([]);

    // Finish line across the road at the top of the loop.
    var a = pointAt(tr, 0, -1.5 * gap);
    var b = pointAt(tr, 0, 1.5 * gap);
    c.lineWidth = 4;
    c.strokeStyle = '#e4e4e7';
    c.setLineDash([5, 5]);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.setLineDash([]);

    race.racers.forEach(function (r) {
      var frac = Math.min(1, r.dist);
      var p = pointAt(tr, frac, (r.lane - 1.5) * gap);
      // A soft wake behind a boosting snail.
      if (r.boosting && !reduced && !r.finished) {
        var back = pointAt(tr, Math.max(0, frac - 0.02), (r.lane - 1.5) * gap);
        c.strokeStyle = 'rgba(251,191,36,0.55)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(back.x, back.y);
        c.stroke();
      }
      if (r.isPlayer) {
        c.beginPath();
        c.ellipse(p.x, p.y, 20, 14, 0, 0, TAU);
        c.lineWidth = 2;
        c.strokeStyle = '#a78bfa';
        c.stroke();
      }
      if (drawSnail) {
        drawSnail(c, r.snail, p.x, p.y, 0, reduced ? 0 : race.t + r.lane,
          { scale: 0.52, moving: !reduced && !r.finished && race.phase !== 'countdown' });
      } else {
        c.beginPath();
        c.arc(p.x, p.y, 7, 0, TAU);
        c.fillStyle = r.snail.shell;
        c.fill();
      }
    });
  }

  function playerRacer() {
    for (var i = 0; i < race.racers.length; i++) if (race.racers[i].isPlayer) return race.racers[i];
    return race.racers[0];
  }

  function placeOf(r) {
    if (!r) return 1;
    if (r.finished) return r.place;
    var ahead = 0;
    race.racers.forEach(function (o) { if (o !== r && (o.finished || o.dist > r.dist)) ahead += 1; });
    return ahead + 1;
  }

  // A snail from the Arena's roster, so the canvas draws exactly the same
  // snail the Arena does. Falls back to the page's Tailwind-based token
  // colours when the Arena is not loaded.
  function arenaSnail(id) {
    if (arena && arena.race && arena.race.SNAILS) {
      for (var i = 0; i < arena.race.SNAILS.length; i++) {
        if (arena.race.SNAILS[i].id === id) return arena.race.SNAILS[i];
      }
    }
    return { id: id, name: snailOf(id).name, color: '#a1a1aa', shell: '#d4d4d8', pattern: 'solid' };
  }

  function startRace(track) {
    if (!view || !track) return;
    if (audio) audio.unlock();
    saveState = 'idle';
    if (!stage) buildStage();
    homeEl.classList.add('hidden');
    stage.classList.remove('hidden');
    stage._result.className = 'hidden border-t border-zinc-800 pt-3 flex-col gap-3';
    stage._result.textContent = '';
    stage._boostBtn.classList.remove('hidden');
    stage._gauge.classList.remove('hidden');
    stage._hint.classList.remove('hidden');
    stage._boostBtn.textContent = 'HOLD TO BOOST';
    stage._boostBtn.disabled = false;
    document.getElementById('training-track-name').textContent = track.name;
    document.getElementById('training-track-meta').textContent = track.metres + ' m · 1 lap · ' + view.rules.racers + ' snails';

    var rec = recordOf(selected);
    var base = 1 / track.baseSeconds;
    var racers = [];
    var mine = {
      snail: arenaSnail(selected),
      isPlayer: true,
      lane: 1,
      dist: 0,
      energy: rec.energyCap,
      cap: rec.energyCap,
      boosting: false,
      aiBoost: false,
      windedUntil: 0,
      finished: false,
      time: null,
      place: null,
      base: base,
      speedMult: rec.speedMult,
      boostMult: rec.boostMult,
    };
    racers.push(mine);
    var rivals = SNAILS.filter(function (s) { return s.id !== selected; }).slice(0, Math.max(1, view.rules.racers - 1));
    var lanes = [0, 2, 3];
    var stagger = [0.985, 1.0, 1.015];
    rivals.forEach(function (s, i) {
      racers.push({
        snail: arenaSnail(s.id),
        isPlayer: false,
        lane: lanes[i % lanes.length],
        dist: 0,
        energy: 1,
        cap: 1,
        boosting: false,
        aiBoost: true,
        windedUntil: 0,
        finished: false,
        time: null,
        place: null,
        base: base * track.pace * stagger[i % stagger.length],
        speedMult: 1,
        boostMult: view.rules.boostMult,
      });
    });

    race = {
      track: track,
      phase: 'countdown',
      countdown: 3.2,
      lastCount: 4,
      t: 0,
      settle: 0,
      finishCount: 0,
      boostHeld: false,
      racers: racers,
    };
    sizeCanvas();
    stage.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    if (audio) audio.count();
    stage._countText.textContent = '3';
    stage._count.className = 'flex absolute inset-0 items-center justify-center rounded-xl bg-zinc-950/60 pointer-events-none';
    addKeys();
    cancelAnimationFrame(raf);
    stage._last = 0;
    raf = requestAnimationFrame(tick);
  }

  function tick(ts) {
    if (!race) return;
    if (!stage._last) stage._last = ts;
    var dt = Math.min(0.05, Math.max(0, (ts - stage._last) / 1000));
    stage._last = ts;
    update(dt);
    draw();
    updateHud(ts);
    // A finished race keeps its last frame on screen; there is nothing left
    // to animate, so the loop stops until the next race starts.
    raf = race && race.phase !== 'done' ? requestAnimationFrame(tick) : 0;
  }

  function update(dt) {
    var rules = view.rules;
    if (race.phase === 'countdown') {
      race.countdown -= dt;
      var n = Math.ceil(race.countdown);
      if (n !== race.lastCount && n > 0) {
        race.lastCount = n;
        stage._countText.textContent = String(n);
        if (audio) audio.count();
      }
      if (race.countdown <= 0) {
        race.phase = 'running';
        race.t = 0;
        stage._countText.textContent = 'GO!';
        if (audio) audio.go();
        setTimeout(function () {
          if (race && race.phase === 'running') stage._count.className = 'hidden absolute inset-0 items-center justify-center rounded-xl bg-zinc-950/60 pointer-events-none';
        }, 700);
      }
      return;
    }
    if (race.phase !== 'running' && race.phase !== 'settling') return;

    race.t += dt;
    race.racers.forEach(function (r) {
      if (r.finished) return;
      var winded = race.t < r.windedUntil;
      if (r.isPlayer) {
        r.boosting = race.phase === 'running' && race.boostHeld && !winded && r.energy > 0;
      } else {
        if (r.aiBoost) {
          if (r.energy <= 0.25) r.aiBoost = false;
        } else if (r.energy >= 0.5) {
          r.aiBoost = true;
        }
        r.boosting = !winded && r.aiBoost;
      }
      if (r.boosting) {
        r.energy = Math.max(0, r.energy - rules.boostDrain * dt);
        if (r.energy <= 0) {
          r.boosting = false;
          r.windedUntil = race.t + rules.windMs / 1000;
        }
      } else {
        // The tank refills whether or not the snail is winded, so letting go
        // for a moment is always a way back into the race.
        r.energy = Math.min(r.cap, r.energy + rules.energyRegen * dt);
      }
      var rate = r.base * r.speedMult * (r.boosting ? r.boostMult : 1) * (winded ? rules.windMult : 1);
      r.dist += rate * dt;
      if (r.dist >= 1) {
        r.finished = true;
        r.time = race.t;
        r.place = race.finishCount + 1;
        race.finishCount += 1;
        if (r.isPlayer) {
          race.phase = 'settling';
          race.settle = 0;
          if (audio) audio.finish(r.place === 1);
        }
      }
    });

    if (race.phase === 'settling') {
      race.settle += dt;
      if (race.settle >= 1.4) {
        race.phase = 'done';
        finishRace();
      }
    }
  }

  var hudAt = 0;

  function updateHud(ts) {
    if (!race) return;
    var p = playerRacer();
    if (ts - hudAt < 90) return;
    hudAt = ts;
    document.getElementById('training-place').textContent = ordinal(placeOf(p)) + ' / ' + race.racers.length;
    // Once the player is over the line the clock holds at their finish time,
    // so the HUD matches the result while the rest of the field comes home.
    document.getElementById('training-time').textContent = fmt(p.finished ? p.time : race.t);
    var pct = Math.max(0, Math.min(100, Math.round(100 * p.energy / p.cap)));
    document.getElementById('training-energy').style.width = pct + '%';
    var winded = race.t < p.windedUntil;
    document.getElementById('training-energy-text').textContent = winded ? 'WINDED' : pct + '%';
    stage._boostBtn.textContent = winded ? 'WINDED' : 'HOLD TO BOOST';
    stage._canvas.setAttribute('aria-label',
      race.track.name + '. Place ' + placeOf(p) + ' of ' + race.racers.length +
      '. ' + fmt(race.t) + '. Energy ' + (winded ? 'empty, winded' : pct + ' percent') + '.');
  }

  function boostStart() {
    if (!race || (race.phase !== 'running' && race.phase !== 'settling')) return;
    if (race.phase === 'settling') return;
    race.boostHeld = true;
    if (audio) audio.boost();
  }

  function boostStop() {
    if (race) race.boostHeld = false;
  }

  var keysOn = false;

  function onKeyDown(e) {
    if (!race || (e.key !== ' ' && e.key !== 'ArrowUp')) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (!e.repeat) boostStart();
  }

  function onKeyUp(e) {
    if (e.key === ' ' || e.key === 'ArrowUp') {
      e.preventDefault();
      boostStop();
    }
  }

  function addKeys() {
    if (keysOn) return;
    keysOn = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  function removeKeys() {
    if (!keysOn) return;
    keysOn = false;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }

  // ---------------- result ----------------

  function finishRace() {
    removeKeys();
    race.boostHeld = false;
    var p = playerRacer();
    var winner = null;
    race.racers.forEach(function (r) { if (r.place === 1) winner = r; });
    var res = {
      place: p.place || placeOf(p),
      timeMs: Math.round((p.time || race.t) * 1000),
      winner: winner ? winner.snail.name : null,
    };
    saveRace(res);
  }

  function saveRace(res) {
    saveState = 'saving';
    renderResult(res, null, 'saving');
    fetch('/api/training/races', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
      body: JSON.stringify({
        snailId: selected,
        trackId: race.track.id,
        place: res.place,
        timeMs: res.timeMs,
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
          return body;
        });
      })
      .then(function (data) {
        view = data;
        saveState = 'idle';
        renderResult(res, data.race, 'saved');
        renderHome();
      })
      .catch(function () {
        saveState = 'failed';
        renderResult(res, null, 'failed');
      });
  }

  function renderResult(res, info, state) {
    var box = stage._result;
    box.textContent = '';
    box.className = 'border-t border-zinc-800 pt-3 flex flex-col gap-2';
    // The race is over: a big HOLD TO BOOST button that does nothing would
    // read as broken, so the controls step aside for the result.
    stage._boostBtn.classList.add('hidden');
    stage._gauge.classList.add('hidden');
    stage._hint.classList.add('hidden');
    var won = res.place === 1;
    var heading = won ? 'YOU WIN' : ordinal(res.place).toUpperCase() + ' PLACE';
    box.appendChild(node('p', 'text-center text-2xl font-bold tracking-wide ' + (won ? 'text-violet-300' : 'text-zinc-200'), heading));
    if (!won && res.winner) {
      box.appendChild(node('p', 'text-center text-xs text-zinc-400', res.winner + ' won this one.'));
    }

    var line = fmtMs(res.timeMs);
    if (state === 'saved' && info) line += ' · +' + info.xpEarned + ' XP';
    if (state === 'saving') line += ' · saving...';
    box.appendChild(node('p', 'text-center text-sm font-mono tabular-nums text-zinc-300', line));

    if (state === 'saved' && info) {
      if (info.leveledUp) {
        box.appendChild(node('p', 'text-center text-xs font-bold tracking-wide text-lime-300',
          'LEVEL ' + info.level + ' · FASTER NOW'));
      }
      if (info.newBest) {
        box.appendChild(node('p', 'text-center text-xs font-semibold text-sky-300', 'NEW BEST TIME'));
      }
    }
    if (state === 'failed') {
      box.appendChild(node('p', 'text-center text-xs text-amber-300', 'Progress not saved. Try again.'));
    }

    var row = node('div', 'grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1');
    if (state === 'failed') {
      var retry = node('button', PRIMARY_SM + ' w-full', 'TRY AGAIN');
      retry.type = 'button';
      retry.addEventListener('click', function () { saveRace(res); });
      row.appendChild(retry);
    } else {
      var again = node('button', PRIMARY_SM + ' w-full', 'RACE AGAIN');
      again.type = 'button';
      again.disabled = state !== 'saved';
      again.addEventListener('click', function () {
        if (saveState !== 'idle') return;
        startRace(race.track);
      });
      row.appendChild(again);
    }
    var back = node('button', SECONDARY + ' w-full', 'BACK TO TRAINING');
    back.type = 'button';
    back.addEventListener('click', leaveRace);
    row.appendChild(back);
    box.appendChild(row);
  }

  function leaveRace() {
    cancelAnimationFrame(raf);
    raf = 0;
    removeKeys();
    race = null;
    if (stage) stage.classList.add('hidden');
    if (homeEl) homeEl.classList.remove('hidden');
    renderHome();
  }

  // ---------------- data ----------------

  function trainSnail(btn) {
    if (!view) return;
    btn.disabled = true;
    fetch('/api/training/snails/' + selected + '/train', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
      body: '{}',
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status);
          return body;
        });
      })
      .then(function (data) {
        view = data;
        renderHome();
      })
      .catch(function (err) {
        if (err.message === 'no_sessions') return load();
        failed = true;
        renderHome();
      });
  }

  function load() {
    return fetch('/api/training', { headers: authHeaders() })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        view = data;
        failed = false;
        if (!view.snails.some(function (s) { return s.id === selected; })) {
          selected = view.snails[0].id;
        }
        renderHome();
      })
      .catch(function () {
        failed = true;
        renderHome();
      });
  }

  function onReducedChange() {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', onReducedChange);
  } catch (e) {}

  // Opening the tab: refresh quietly so a race run elsewhere (another tab,
  // another device) shows up. Leaving an open race alone.
  window.snailDerby.loadTraining = function () {
    if (race) return;
    if (!view) return load();
    return load();
  };

  renderHome();
  load();
})();
