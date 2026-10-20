// Arena screens: map selection and race setup (in the Arena tab), plus the
// full-screen stage with HUD, joystick, buttons, countdown, pause menu,
// results and the settings sheet. Settings and best times persist in
// localStorage under one key.
(function (root) {
  var A = root.SnailArena;
  var maps = A.maps, race = A.race, input = A.input, game = A.game, render = A.render, audio = A.audio;
  var KEY = 'snailDerby.arena.v1';

  var BTN_PRIMARY = 'h-12 px-5 rounded-xl text-base font-bold tracking-wide transition-colors bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300';
  var BTN_SECOND = 'h-11 px-4 rounded-xl text-sm font-semibold transition-colors border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300';
  var SEG_ON = 'h-10 flex-1 rounded-lg text-sm font-semibold transition-colors bg-violet-600 text-white';
  var SEG_OFF = 'h-10 flex-1 rounded-lg text-sm font-semibold transition-colors text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800';

  var DEFAULTS = {
    map: 'meadow', laps: 2, difficulty: 'normal', snail: 'cycle_o', controls: 'auto', sound: true, reduced: false,
    joy: { size: 0, opacity: 0.6, x: null, y: null, snap8: false }, keys: null, best: {}
  };

  function load() {
    var s = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        ['map', 'difficulty', 'snail', 'controls'].forEach(function (k) { if (typeof raw[k] === 'string') s[k] = raw[k]; });
        if (raw.laps >= 1 && raw.laps <= 5) s.laps = raw.laps | 0;
        if (typeof raw.sound === 'boolean') s.sound = raw.sound;
        if (typeof raw.reduced === 'boolean') s.reduced = raw.reduced;
        if (raw.joy && typeof raw.joy === 'object') {
          if (raw.joy.size >= 80 && raw.joy.size <= 200) s.joy.size = raw.joy.size;
          if (raw.joy.opacity >= 0.2 && raw.joy.opacity <= 1) s.joy.opacity = raw.joy.opacity;
          if (raw.joy.x >= 0 && raw.joy.x <= 1) s.joy.x = raw.joy.x;
          if (raw.joy.y >= 0 && raw.joy.y <= 1) s.joy.y = raw.joy.y;
          s.joy.snap8 = !!raw.joy.snap8;
        }
        if (raw.keys && typeof raw.keys === 'object') s.keys = raw.keys;
        if (raw.best && typeof raw.best === 'object') s.best = raw.best;
      }
    } catch (e) {}
    if (!maps.MAPS.some(function (m) { return m.id === s.map; })) s.map = 'meadow';
    if (!race.SNAILS.some(function (n) { return n.id === s.snail; })) s.snail = 'cycle_o';
    if (!{ auto: 1, touch: 1, keyboard: 1 }[s.controls]) s.controls = 'auto';
    return s;
  }

  function h(tag, cls, attrs, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'style') el.style.cssText = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }

  function fmt(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '--';
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function ordinal(n) { return n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'); }

  var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var ICON_GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  function mount(host) {
    if (!host || host.getAttribute('data-arena-mounted')) return null;
    host.setAttribute('data-arena-mounted', '1');
    var S = load();
    var qs = new URLSearchParams(location.search);
    var qMap = qs.get('map');
    if (qMap && maps.MAPS.some(function (m) { return m.id === qMap; })) S.map = qMap;

    function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

    // ---------------- setup screen ----------------
    var setup = h('section', 'flex flex-col gap-4', { id: 'arena-setup' });
    var head = h('div', 'flex items-start justify-between gap-3');
    head.appendChild(h('div', 'min-w-0', null, [
      h('h2', 'text-base font-bold tracking-wide', { text: 'Arena' }),
      h('p', 'text-sm text-zinc-400', { text: 'Free practice on five maps. Arena races never change your $NAIL.' })
    ]));
    var ctlBtn = h('button', BTN_SECOND + ' shrink-0', { type: 'button', id: 'arena-open-settings', text: 'Controls' });
    head.appendChild(ctlBtn);
    setup.appendChild(head);

    var mapsEl = h('div', 'grid grid-cols-1 sm:grid-cols-2 gap-3', { id: 'arena-maps', role: 'radiogroup', 'aria-label': 'Map' });
    var cards = {};
    maps.MAPS.forEach(function (m) {
      var cv = h('canvas', 'w-full rounded-lg bg-zinc-800', { 'aria-hidden': 'true', style: 'aspect-ratio:16/10;display:block' });
      var dots = h('span', 'flex gap-1', { 'aria-hidden': 'true' });
      for (var i = 1; i <= 4; i++) dots.appendChild(h('span', 'w-2 h-2 rounded-full ' + (i <= m.difficulty ? 'bg-violet-400' : 'bg-zinc-700')));
      var best = h('span', 'text-xs font-mono tabular-nums text-zinc-400', { 'data-best': '' });
      var card = h('button', 'text-left rounded-2xl border p-3 flex flex-col gap-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300', {
        type: 'button', role: 'radio', 'data-map': m.id, 'aria-checked': 'false'
      }, [
        cv,
        h('div', 'flex items-center justify-between gap-2', null, [
          h('span', 'text-sm font-bold text-zinc-100', { text: m.name }),
          h('span', 'flex items-center gap-2 text-xs font-medium text-zinc-300', null, [h('span', null, { text: m.difficultyLabel }), dots])
        ]),
        h('p', 'text-xs leading-relaxed text-zinc-400', { text: m.description }),
        best
      ]);
      card.addEventListener('click', function () { selectMap(m.id); });
      cards[m.id] = { el: card, cv: cv, best: best, drawn: false };
      mapsEl.appendChild(card);
    });
    setup.appendChild(mapsEl);

    // options
    function group(label) { return h('div', 'flex flex-col gap-2', null, [h('h3', 'text-sm font-semibold text-zinc-200', { text: label })]); }
    function segmented(id, label, items, getVal, setVal) {
      var g = group(label), row = h('div', 'flex gap-1 p-1 rounded-xl border border-zinc-800 bg-zinc-900', { id: id, role: 'radiogroup', 'aria-label': label });
      var btns = items.map(function (it) {
        var b = h('button', SEG_OFF, { type: 'button', role: 'radio', 'data-value': String(it.value), text: it.label });
        b.addEventListener('click', function () { setVal(it.value); paint(); });
        row.appendChild(b); return b;
      });
      function paint() {
        btns.forEach(function (b, i) { var on = String(getVal()) === String(items[i].value); b.className = on ? SEG_ON : SEG_OFF; b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      }
      paint(); g.appendChild(row); g._paint = paint; return g;
    }

    var snailRow = h('div', 'grid grid-cols-3 sm:grid-cols-6 gap-2', { id: 'arena-snails', role: 'radiogroup', 'aria-label': 'Your snail' });
    var snailBtns = {};
    race.SNAILS.forEach(function (sn) {
      var cv = h('canvas', '', { width: 64, height: 40, 'aria-hidden': 'true', style: 'width:48px;height:30px' });
      var b = h('button', 'rounded-xl border p-2 flex flex-col items-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300', { type: 'button', role: 'radio', 'data-snail': sn.id }, [cv, h('span', 'text-xs font-semibold text-zinc-200', { text: sn.name })]);
      var c = cv.getContext('2d'); c.translate(32, 22); render.drawSnail(c, sn, 0, 0, 0, 0, { scale: 1.1 });
      b.addEventListener('click', function () { S.snail = sn.id; save(); paintSnails(); updatePreview(); });
      snailBtns[sn.id] = b; snailRow.appendChild(b);
    });
    function paintSnails() {
      race.SNAILS.forEach(function (sn) {
        var on = S.snail === sn.id;
        snailBtns[sn.id].className = 'rounded-xl border p-2 flex flex-col items-center gap-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ' + (on ? 'border-violet-400 bg-violet-600/20' : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800');
        snailBtns[sn.id].setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    var snailGroup = group('Your snail'); snailGroup.appendChild(snailRow);

    var lapsGroup = segmented('arena-laps', 'Laps', [1, 2, 3, 4, 5].map(function (n) { return { value: n, label: String(n) }; }),
      function () { return S.laps; }, function (v) { S.laps = v; save(); updatePreview(); });
    var diffGroup = segmented('arena-difficulty', 'Opponents', [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }],
      function () { return S.difficulty; }, function (v) { S.difficulty = v; save(); updatePreview(); });
    var opts = h('div', 'rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-4', { id: 'arena-options' }, [snailGroup, h('div', 'grid grid-cols-1 sm:grid-cols-2 gap-4', null, [lapsGroup, diffGroup])]);
    setup.appendChild(opts);

    // race preview
    var pvCanvas = h('canvas', 'w-full rounded-lg bg-zinc-800', { id: 'arena-preview-canvas', role: 'img', 'aria-label': 'Race preview', style: 'aspect-ratio:16/10;display:block' });
    var pvTitle = h('h3', 'text-sm font-bold text-zinc-100', { id: 'arena-preview-title' });
    var pvStats = h('p', 'text-xs text-zinc-400 font-mono tabular-nums', { id: 'arena-preview-stats' });
    var pvLegend = h('div', 'flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-300', { id: 'arena-preview-legend' });
    var preview = h('section', 'rounded-2xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3', { id: 'arena-preview', 'data-map': S.map }, [
      h('div', 'flex items-baseline justify-between gap-3', null, [h('h2', 'text-sm font-semibold text-zinc-200', { text: 'Race preview' }), pvStats]),
      pvCanvas, pvTitle, pvLegend
    ]);
    setup.appendChild(preview);
    var startBtn = h('button', BTN_PRIMARY + ' w-full', { type: 'button', id: 'arena-start', text: 'Start race' });
    setup.appendChild(startBtn);
    var keyHint = h('p', 'text-xs text-zinc-400 text-center', { id: 'arena-hint' });
    setup.appendChild(keyHint);
    host.appendChild(setup);

    // ---------------- stage ----------------
    var SAFE = 'padding-top:var(--un-safe-inset-top,env(safe-area-inset-top,0px));padding-left:var(--un-safe-inset-left,env(safe-area-inset-left,0px));padding-right:var(--un-safe-inset-right,env(safe-area-inset-right,0px));padding-bottom:var(--un-safe-inset-bottom,env(safe-area-inset-bottom,0px));';
    var stage = h('div', 'hidden fixed inset-0 z-50 bg-black text-zinc-100 select-none touch-none', { id: 'arena-stage', style: 'overscroll-behavior:none;-webkit-user-select:none;-webkit-touch-callout:none' });
    var canvas = h('canvas', 'absolute inset-0 w-full h-full touch-none', { id: 'arena-canvas', 'aria-label': 'Race arena', role: 'img', style: 'display:block' });
    stage.appendChild(canvas);

    var chip = 'rounded-lg bg-black/55 px-2 py-1 text-xs font-bold tabular-nums text-white';
    var lapEl = h('span', chip, { 'data-hud-lap': '', text: 'Lap 1 / 2' });
    var posEl = h('span', chip, { 'data-hud-pos': '', text: 'Place 1 / 6' });
    var timeEl = h('span', 'rounded-lg bg-black/55 px-2 py-1 text-sm font-mono font-bold tabular-nums text-white', { 'data-hud-time': '', text: '0:00.0' });
    var pauseBtn = h('button', 'w-10 h-10 rounded-xl bg-black/55 text-white flex items-center justify-center active:bg-black/80', { type: 'button', id: 'arena-pause-btn', 'aria-label': 'Pause' });
    pauseBtn.innerHTML = ICON_PAUSE;
    var gearBtn = h('button', 'w-10 h-10 rounded-xl bg-black/55 text-white flex items-center justify-center active:bg-black/80', { type: 'button', id: 'arena-gear-btn', 'aria-label': 'Settings' });
    gearBtn.innerHTML = ICON_GEAR;
    var cpText = h('span', 'text-xs font-semibold tabular-nums text-white', { 'data-hud-cp': '', text: 'Checkpoint 0 / 8' });
    var cpBar = h('div', 'relative h-2 rounded-full bg-black/55 overflow-hidden', { 'data-hud-progress': '' });
    var cpFill = h('div', 'absolute inset-y-0 left-0 bg-violet-400', { style: 'width:0%' });
    cpBar.appendChild(cpFill);
    var energyFill = h('div', 'absolute inset-y-0 left-0 bg-amber-400', { style: 'width:100%' });
    var energyBar = h('div', 'relative h-2 rounded-full bg-black/55 overflow-hidden', { 'data-hud-boost': '' }, [energyFill]);
    var speedEl = h('span', 'text-xs font-semibold tabular-nums text-white', { 'data-hud-speed': '', text: '0' });
    var terrainEl = h('span', 'text-xs font-semibold text-amber-200', { 'data-hud-terrain': '' });
    var hudEl = h('div', 'absolute inset-x-0 top-0 flex flex-col gap-1.5 p-2 pointer-events-none', { id: 'arena-hud', style: SAFE }, [
      h('div', 'flex items-center justify-between gap-2', null, [
        h('div', 'flex items-center gap-1.5', null, [lapEl, posEl]),
        timeEl,
        h('div', 'flex items-center gap-1.5 pointer-events-auto', null, [pauseBtn, gearBtn])
      ]),
      h('div', 'grid grid-cols-2 gap-x-3 gap-y-0.5 max-w-sm rounded-lg bg-black/30 px-2 py-1', null, [
        cpText, h('span', 'flex items-center justify-between gap-2', null, [h('span', 'text-xs font-semibold text-white', { text: 'Boost' }), terrainEl]),
        cpBar, energyBar
      ]),
      h('div', 'flex', null, [h('span', 'rounded-lg bg-black/30 px-2 py-0.5 text-xs text-white', null, [speedEl, h('span', 'text-zinc-300', { text: ' cm/s' })])])
    ]);
    stage.appendChild(hudEl);

    var countEl = h('div', 'hidden absolute inset-0 items-center justify-center pointer-events-none', { id: 'arena-count', 'aria-live': 'assertive' });
    var countNum = h('span', 'text-7xl font-black text-white tabular-nums', { 'data-count': '', style: 'text-shadow:0 4px 24px rgba(0,0,0,0.7)' });
    countEl.appendChild(countNum);
    stage.appendChild(countEl);
    var toast = h('div', 'absolute inset-x-0 hidden justify-center pointer-events-none', { id: 'arena-toast', style: 'top:30%', 'aria-live': 'polite' });
    var toastText = h('span', 'rounded-full bg-black/65 px-4 py-2 text-sm font-bold text-white');
    toast.appendChild(toastText);
    stage.appendChild(toast);

    // touch controls
    var joy = h('div', 'absolute rounded-full touch-none select-none hidden', { id: 'arena-joy', 'aria-label': 'Joystick', 'data-active': '0', style: 'background:rgba(255,255,255,0.18);box-shadow:inset 0 0 0 3px rgba(255,255,255,0.45)' });
    var knob = h('div', 'absolute rounded-full', { id: 'arena-knob', style: 'left:29%;top:29%;width:42%;height:42%;background:rgba(255,255,255,0.8);box-shadow:0 2px 8px rgba(0,0,0,0.4)' });
    joy.appendChild(knob);
    var BTN_ROUND = 'absolute hidden rounded-full touch-none select-none text-sm font-bold text-white flex items-center justify-center';
    var boostBtn = h('button', BTN_ROUND, { type: 'button', id: 'arena-boost', 'data-pressed': '0', 'aria-label': 'Boost', text: 'Boost', style: 'width:76px;height:76px;background:rgba(245,158,11,0.55);box-shadow:inset 0 0 0 3px rgba(255,255,255,0.55)' });
    var brakeBtn = h('button', BTN_ROUND, { type: 'button', id: 'arena-brake', 'data-pressed': '0', 'aria-label': 'Brake', text: 'Brake', style: 'width:60px;height:60px;background:rgba(239,68,68,0.5);box-shadow:inset 0 0 0 3px rgba(255,255,255,0.5)' });
    stage.appendChild(joy); stage.appendChild(boostBtn); stage.appendChild(brakeBtn);

    var editBar = h('div', 'hidden absolute inset-x-0 top-0 z-10 p-3 flex items-center justify-between gap-3 bg-black/70 text-sm', { id: 'arena-edit', style: SAFE });
    editBar.appendChild(h('span', 'font-semibold', { text: 'Drag the joystick where you want it.' }));
    var editDone = h('button', BTN_SECOND, { type: 'button', id: 'arena-edit-done', text: 'Done' });
    editBar.appendChild(editDone);
    stage.appendChild(editBar);

    function overlay(id, title) {
      var box = h('div', 'w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-5 flex flex-col gap-3 max-h-full overflow-y-auto');
      var ov = h('div', 'hidden absolute inset-0 items-center justify-center bg-black/70 p-4', { id: id, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [box]);
      stage.appendChild(ov); return { ov: ov, box: box };
    }
    function show(o) { o.ov.classList.remove('hidden'); o.ov.classList.add('flex'); }
    function hide(o) { o.ov.classList.add('hidden'); o.ov.classList.remove('flex'); }

    var pauseO = overlay('arena-pause', 'Paused');
    pauseO.box.appendChild(h('h2', 'text-lg font-bold', { text: 'Paused' }));
    var resumeBtn = h('button', BTN_PRIMARY + ' w-full', { type: 'button', id: 'arena-resume', text: 'Resume' });
    var restartBtn = h('button', BTN_SECOND + ' w-full', { type: 'button', id: 'arena-restart', text: 'Restart race' });
    var mapsBtn = h('button', BTN_SECOND + ' w-full', { type: 'button', id: 'arena-to-maps', text: 'Change map' });
    var pSettingsBtn = h('button', BTN_SECOND + ' w-full', { type: 'button', id: 'arena-pause-settings', text: 'Controls and sound' });
    [resumeBtn, restartBtn, pSettingsBtn, mapsBtn].forEach(function (b) { pauseO.box.appendChild(b); });

    var resO = overlay('arena-results', 'Race results');
    document.body.appendChild(stage);   // above the page chrome

    // ---------------- settings sheet ----------------
    var setO = overlay('arena-settings', 'Controls and sound');
    var setBox = setO.box;
    var detected = input.isTouchDevice() ? 'touch' : 'keyboard';
    function effectiveMode() { return S.controls === 'auto' ? detected : S.controls; }

    var ctl = input.create({ zone: stage, joy: joy, knob: knob, boostBtn: boostBtn, brakeBtn: brakeBtn }, {
      onPause: function () { doPause(); },
      onEditMove: function (x, y) {
        var r = stage.getBoundingClientRect();
        S.joy.x = Math.max(0, Math.min(1, (x - r.left) / r.width)); S.joy.y = Math.max(0, Math.min(1, (y - r.top) / r.height));
        layoutControls();
      },
      onEditEnd: function () { save(); }
    });
    if (S.keys) ctl.setKeys(S.keys);
    ctl.setSnap8(S.joy.snap8);

    var gm = game.create(canvas, ctl, {
      hud: updateHud, count: showCount, toast: showToast,
      finished: showResults
    });
    var pv = game.createPreview(pvCanvas);

    // ---------------- layout of touch controls ----------------
    var editing = false;
    function layoutControls() {
      var r = stage.getBoundingClientRect(), W = r.width || 360, H = r.height || 640;
      var size = S.joy.size || Math.round(Math.max(104, Math.min(170, Math.min(W, H) * 0.3)));
      var cx = S.joy.x === null ? (22 + size / 2) / W : S.joy.x, cy = S.joy.y === null ? 1 - (30 + size / 2) / H : S.joy.y;
      cx = Math.max(size / 2 / W, Math.min(1 - size / 2 / W, cx)); cy = Math.max(size / 2 / H, Math.min(1 - size / 2 / H, cy));
      joy.style.width = size + 'px'; joy.style.height = size + 'px';
      joy.style.left = Math.round(cx * W - size / 2) + 'px'; joy.style.top = Math.round(cy * H - size / 2) + 'px';
      joy.style.opacity = String(S.joy.opacity);
      boostBtn.style.right = 'calc(20px + var(--un-safe-inset-right, env(safe-area-inset-right, 0px)))';
      boostBtn.style.bottom = 'calc(34px + var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px)))';
      brakeBtn.style.right = 'calc(106px + var(--un-safe-inset-right, env(safe-area-inset-right, 0px)))';
      brakeBtn.style.bottom = 'calc(24px + var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px)))';
      boostBtn.style.opacity = brakeBtn.style.opacity = String(Math.min(1, S.joy.opacity + 0.15));
    }
    function applyMode() {
      var touch = effectiveMode() === 'touch' || editing;
      [joy, boostBtn, brakeBtn].forEach(function (el) { el.classList.toggle('hidden', !touch); });
      boostBtn.classList.toggle('flex', touch); brakeBtn.classList.toggle('flex', touch);
      ctl.setMode(touch ? 'touch' : 'keyboard');
      refreshHint();
      layoutControls();
    }
    function refreshHint() {
      var k = ctl.getKeys(), L = input.keyLabel;
      var moveTxt = JSON.stringify(k.up) + JSON.stringify(k.left) + JSON.stringify(k.down) + JSON.stringify(k.right) === JSON.stringify(input.DEFAULT_KEYS.up) + JSON.stringify(input.DEFAULT_KEYS.left) + JSON.stringify(input.DEFAULT_KEYS.down) + JSON.stringify(input.DEFAULT_KEYS.right)
        ? 'Arrow keys or WASD' : [k.up, k.left, k.down, k.right].map(function (a) { return L(a[0]); }).join(' ');
      keyHint.textContent = effectiveMode() === 'touch'
        ? 'Touch controls: joystick to steer, Boost and Brake buttons on the right.'
        : moveTxt + ' to steer, ' + L(k.boost[0]) + ' boosts, ' + L(k.brake[0]) + ' brakes, Esc pauses.';
    }

    function buildSettings() {
      setBox.innerHTML = '';
      setBox.appendChild(h('h2', 'text-lg font-bold', { text: 'Controls and sound' }));
      var modeG = group('Controls');
      var modeRow = h('div', 'flex gap-1 p-1 rounded-xl border border-zinc-800 bg-zinc-950', { role: 'radiogroup', 'aria-label': 'Controls', id: 'arena-controls-mode' });
      [['auto', 'Auto (' + (detected === 'touch' ? 'touch' : 'keyboard') + ')'], ['touch', 'Touch'], ['keyboard', 'Keyboard']].forEach(function (it) {
        var on = S.controls === it[0];
        var b = h('button', on ? SEG_ON : SEG_OFF, { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-value': it[0], text: it[1] });
        b.addEventListener('click', function () { S.controls = it[0]; save(); applyMode(); buildSettings(); });
        modeRow.appendChild(b);
      });
      modeG.appendChild(modeRow); setBox.appendChild(modeG);

      function slider(label, id, min, max, step, val, fmtv, onInput) {
        var out = h('span', 'text-xs font-mono tabular-nums text-zinc-400', { text: fmtv(val) });
        var inp = h('input', 'w-full accent-violet-500', { type: 'range', id: id, min: min, max: max, step: step, value: val, 'aria-label': label });
        inp.addEventListener('input', function () { var v = +inp.value; out.textContent = fmtv(v); onInput(v); });
        return h('label', 'flex flex-col gap-1', null, [h('span', 'flex items-center justify-between text-sm text-zinc-200', null, [h('span', null, { text: label }), out]), inp]);
      }
      function check(label, id, val, onChange) {
        var cb = h('input', 'w-5 h-5 accent-violet-500', { type: 'checkbox', id: id });
        cb.checked = !!val;
        cb.addEventListener('change', function () { onChange(cb.checked); });
        return h('label', 'flex items-center gap-3 text-sm text-zinc-200', null, [cb, h('span', null, { text: label })]);
      }

      var touchG = group('Touch joystick');
      var autoSize = Math.round(Math.max(104, Math.min(170, Math.min(stage.clientWidth || 360, stage.clientHeight || 640) * 0.3)));
      touchG.appendChild(slider('Size', 'arena-joy-size', 80, 200, 2, S.joy.size || autoSize, function (v) { return v + ' px'; }, function (v) { S.joy.size = v; save(); layoutControls(); }));
      touchG.appendChild(slider('Opacity', 'arena-joy-opacity', 20, 100, 5, Math.round(S.joy.opacity * 100), function (v) { return v + '%'; }, function (v) { S.joy.opacity = v / 100; save(); layoutControls(); }));
      touchG.appendChild(check('Snap to 8 directions', 'arena-joy-snap', S.joy.snap8, function (v) { S.joy.snap8 = v; ctl.setSnap8(v); save(); }));
      var moveRow = h('div', 'flex gap-2');
      var moveBtn = h('button', BTN_SECOND + ' flex-1', { type: 'button', id: 'arena-joy-move', text: 'Move joystick' });
      var resetJoyBtn = h('button', BTN_SECOND + ' flex-1', { type: 'button', id: 'arena-joy-reset', text: 'Reset joystick' });
      moveBtn.addEventListener('click', function () { enterEdit(); });
      resetJoyBtn.addEventListener('click', function () { S.joy.size = 0; S.joy.x = null; S.joy.y = null; S.joy.opacity = 0.6; save(); layoutControls(); buildSettings(); });
      moveRow.appendChild(moveBtn); moveRow.appendChild(resetJoyBtn); touchG.appendChild(moveRow);
      setBox.appendChild(touchG);

      var keyG = group('Keyboard');
      var labels = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', boost: 'Boost', brake: 'Brake' };
      var keys = ctl.getKeys(), grid = h('div', 'grid grid-cols-2 gap-2', { id: 'arena-keys' });
      Object.keys(labels).forEach(function (a) {
        var b = h('button', BTN_SECOND + ' flex items-center justify-between gap-2', { type: 'button', 'data-key': a }, [h('span', 'text-zinc-400', { text: labels[a] }), h('span', 'font-mono', { text: keys[a].map(input.keyLabel).join(' / ') })]);
        b.addEventListener('click', function () {
          b.lastChild.textContent = 'Press a key';
          ctl.listen(a, function () { S.keys = ctl.getKeys(); save(); refreshHint(); buildSettings(); });
        });
        grid.appendChild(b);
      });
      keyG.appendChild(grid);
      keyG.appendChild(h('p', 'text-xs text-zinc-400', { text: 'Esc always pauses. A gamepad works too: left stick steers, A boosts, B brakes, Start pauses.' }));
      var resetKeys = h('button', BTN_SECOND, { type: 'button', id: 'arena-keys-reset', text: 'Reset keys' });
      resetKeys.addEventListener('click', function () { ctl.resetKeys(); S.keys = null; save(); refreshHint(); buildSettings(); });
      keyG.appendChild(resetKeys);
      setBox.appendChild(keyG);

      var miscG = group('Sound and motion');
      miscG.appendChild(check('Sound effects', 'arena-sound', S.sound, function (v) { S.sound = v; save(); gm.updateOptions({ sound: v }); }));
      miscG.appendChild(check('Reduce motion', 'arena-reduced', S.reduced || game.reducedByDevice(), function (v) { S.reduced = v; save(); gm.updateOptions({ reduced: v }); }));
      setBox.appendChild(miscG);

      var done = h('button', BTN_PRIMARY + ' w-full', { type: 'button', id: 'arena-settings-done', text: 'Done' });
      done.addEventListener('click', closeSettings);
      setBox.appendChild(done);
    }

    var settingsReturn = null;   // 'pause' | 'setup'
    function openSettings(from) {
      settingsReturn = from; buildSettings();
      if (from === 'setup') {
        // the sheet lives in the stage, so show the stage with no race behind it
        openStageShell(); hide(pauseO); hide(resO);
      }
      show(setO);
    }
    function closeSettings() {
      ctl.cancelListen(); hide(setO);
      if (settingsReturn === 'setup') closeStageShell();
      settingsReturn = null;
      applyMode();
      gm.redraw();
    }

    function enterEdit() {
      editing = true; ctl.setEditing(true); hide(setO); editBar.classList.remove('hidden'); applyMode();
    }
    editDone.addEventListener('click', function () {
      editing = false; ctl.setEditing(false); editBar.classList.add('hidden'); applyMode(); save();
      show(setO); buildSettings();
    });

    // ---------------- stage open / close ----------------
    function lockPage(on) {
      document.documentElement.style.overflow = on ? 'hidden' : '';
      document.documentElement.style.overscrollBehavior = on ? 'none' : '';
    }
    var shellOpen = false;
    function openStageShell() {
      if (shellOpen) return;
      shellOpen = true; stage.classList.remove('hidden'); lockPage(true);
      canvas.style.background = '#18181b';
      applyMode();
    }
    function closeStageShell() {
      if (!shellOpen) return;
      shellOpen = false; stage.classList.add('hidden'); lockPage(false);
    }

    var cfgNow = null;
    function currentConfig() {
      return { mapId: S.map, laps: S.laps, difficulty: S.difficulty, snailId: S.snail, reduced: S.reduced, sound: S.sound };
    }
    var resizeRaf = 0;
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(function () {
        if (shellOpen) { gm.resize(); layoutControls(); }
        if (!host.closest('[hidden]')) pv.draw();
      });
    }
    var ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(onResize); ro.observe(stage); ro.observe(pvCanvas); }
    root.addEventListener('resize', onResize);
    root.addEventListener('orientationchange', onResize);

    function startRace() {
      audio.unlock();   // inside the tap, so the browser allows sound
      cfgNow = currentConfig();
      hide(pauseO); hide(resO); hide(setO);
      openStageShell();
      ctl.setActive(true);
      gm.start(cfgNow);
      pauseBtn.focus({ preventScroll: true });
    }
    function doPause() {
      if (!shellOpen || settingsReturn === 'setup' || editing) return;
      if (!setO.ov.classList.contains('hidden')) return;
      if (gm.pause()) { show(pauseO); resumeBtn.focus({ preventScroll: true }); }
    }
    function doResume() { hide(pauseO); hide(setO); ctl.clear(); gm.resume(); }
    function toMaps() {
      gm.stop(); ctl.setActive(false); hide(pauseO); hide(resO); hide(setO);
      closeStageShell(); updatePreview();
      try { host.scrollIntoView({ block: 'start' }); } catch (e) {}
    }
    startBtn.addEventListener('click', startRace);
    resumeBtn.addEventListener('click', doResume);
    restartBtn.addEventListener('click', function () { hide(pauseO); ctl.clear(); gm.restart(); });
    mapsBtn.addEventListener('click', toMaps);
    pauseBtn.addEventListener('click', doPause);
    gearBtn.addEventListener('click', function () { if (gm.pause()) show(pauseO); openSettings('pause'); });
    pSettingsBtn.addEventListener('click', function () { openSettings('pause'); });
    ctlBtn.addEventListener('click', function () { openSettings('setup'); });

    // auto-pause when the page is hidden mid-race
    function onVis() { if (document.hidden && shellOpen) doPause(); }
    document.addEventListener('visibilitychange', onVis);

    // ---------------- HUD / overlays ----------------
    var last = {};
    function setText(el, key, v) { if (last[key] !== v) { last[key] = v; el.textContent = v; } }
    function updateHud(d) {
      setText(lapEl, 'lap', 'Lap ' + d.lap + ' / ' + d.laps);
      setText(posEl, 'pos', 'Place ' + d.place + ' / ' + d.total);
      setText(timeEl, 'time', fmt(d.time));
      setText(cpText, 'cp', 'Checkpoint ' + d.cp + ' / ' + d.cpTotal);
      setText(speedEl, 'spd', String(Math.round(d.speed / 10)));
      var lab = d.terrain ? maps.TERRAIN[d.terrain].label : '';
      setText(terrainEl, 'ter', lab);
      var pw = (d.progress * 100).toFixed(1) + '%';
      if (last.pw !== pw) { last.pw = pw; cpFill.style.width = pw; }
      var ew = Math.round(d.energy * 100) + '%';
      if (last.ew !== ew) { last.ew = ew; energyFill.style.width = ew; }
      var ec = d.exhausted ? 'absolute inset-y-0 left-0 bg-zinc-500' : d.boosting ? 'absolute inset-y-0 left-0 bg-yellow-200' : 'absolute inset-y-0 left-0 bg-amber-400';
      if (last.ec !== ec) { last.ec = ec; energyFill.className = ec; }
    }
    function showCount(label) {
      if (label === null) { countEl.classList.add('hidden'); countEl.classList.remove('flex'); return; }
      countNum.textContent = label; countEl.classList.remove('hidden'); countEl.classList.add('flex');
      countNum.setAttribute('data-label', label);
    }
    var toastTimer = 0;
    function showToast(text) {
      toastText.textContent = text; toast.classList.remove('hidden'); toast.classList.add('flex');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.add('hidden'); toast.classList.remove('flex'); }, 1300);
    }

    function showResults(results, info) {
      ctl.setActive(false);
      var me = results.filter(function (r) { return r.isPlayer; })[0];
      var map = info.track.def, key = map.id + '|' + info.laps;
      var best = S.best[key], isBest = false;
      if (me && me.finished && (best === undefined || me.time < best)) { S.best[key] = me.time; isBest = true; save(); refreshBest(); }
      var box = resO.box; box.innerHTML = '';
      box.setAttribute('data-place', me ? String(me.place) : '');
      box.appendChild(h('h2', 'text-lg font-bold', { 'data-result': '', text: me.place === 1 ? 'You won!' : 'You finished ' + ordinal(me.place) }));
      box.appendChild(h('p', 'text-sm text-zinc-300', { text: map.name + ', ' + info.laps + (info.laps === 1 ? ' lap' : ' laps') + ' · Time ' + fmt(me.time) + (isBest ? ' · New best' : best !== undefined ? ' · Best ' + fmt(best) : '') }));
      var list = h('ol', 'flex flex-col rounded-xl border border-zinc-800 text-sm tabular-nums', { id: 'arena-standings' });
      var leader = results[0];
      results.forEach(function (r) {
        list.appendChild(h('li', 'flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800 last:border-b-0 ' + (r.isPlayer ? 'bg-violet-600/20 font-bold' : ''), { 'data-place': String(r.place) }, [
          h('span', null, { text: r.place + '. ' + r.snail.name + (r.isPlayer ? ' (you)' : '') }),
          h('span', 'font-mono text-zinc-300', { text: r.finished ? fmt(r.time) : Math.round(r.progress * 100) + '% done' })
        ]));
      });
      box.appendChild(list);
      var again = h('button', BTN_PRIMARY + ' w-full', { type: 'button', id: 'arena-again', text: 'Race again' });
      var back = h('button', BTN_SECOND + ' w-full', { type: 'button', id: 'arena-results-maps', text: 'Change map' });
      again.addEventListener('click', function () { hide(resO); ctl.setActive(true); ctl.clear(); gm.restart(); });
      back.addEventListener('click', toMaps);
      box.appendChild(again); box.appendChild(back);
      show(resO); again.focus({ preventScroll: true });
    }

    // ---------------- map selection ----------------
    function refreshBest() {
      maps.MAPS.forEach(function (m) {
        var b = S.best[m.id + '|' + S.laps];
        cards[m.id].best.textContent = b !== undefined ? 'Best, ' + S.laps + (S.laps === 1 ? ' lap: ' : ' laps: ') + fmt(b) : 'No time yet for ' + S.laps + (S.laps === 1 ? ' lap' : ' laps');
      });
    }
    function paintCards() {
      maps.MAPS.forEach(function (m) {
        var on = S.map === m.id, c = cards[m.id];
        c.el.setAttribute('aria-checked', on ? 'true' : 'false');
        c.el.setAttribute('data-selected', on ? '1' : '0');
        c.el.className = 'text-left rounded-2xl border p-3 flex flex-col gap-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ' + (on ? 'border-violet-400 bg-violet-600/15 ring-2 ring-violet-400' : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800');
      });
    }
    function selectMap(id) { S.map = id; save(); paintCards(); updatePreview(); }

    function updatePreview() {
      var m = maps.MAPS.filter(function (x) { return x.id === S.map; })[0], tr = maps.getTrack(S.map);
      preview.setAttribute('data-map', m.id);
      pvTitle.textContent = m.name + ' · ' + m.difficultyLabel;
      var lapSec = tr.L / 205;
      pvStats.textContent = Math.round(tr.L / 10) + ' cm lap · about ' + fmt(lapSec * S.laps);
      var kinds = {};
      tr.patches.forEach(function (p) { kinds[p.kind] = 1; });
      pvLegend.innerHTML = '';
      Object.keys(kinds).forEach(function (k) {
        pvLegend.appendChild(h('span', 'rounded-md bg-zinc-800 px-2 py-0.5', { text: maps.TERRAIN[k].label }));
      });
      pvLegend.appendChild(h('span', 'rounded-md bg-zinc-800 px-2 py-0.5', { text: 'Obstacles: ' + tr.obstacles.length }));
      pvLegend.appendChild(h('span', 'rounded-md bg-zinc-800 px-2 py-0.5', { text: 'Checkpoints: ' + maps.CHECKPOINTS }));
      refreshBest(); paintSnails();
      pv.set(currentConfig());
    }

    // thumbnails are drawn when the Arena tab is first visible (canvases need a size)
    function drawThumbs() {
      maps.MAPS.forEach(function (m) {
        var c = cards[m.id];
        if (c.drawn) return;
        var w = c.cv.clientWidth;
        if (!w) return;
        render.drawThumbnail(c.cv, maps.getTrack(m.id), w, Math.round(w * 0.625));
        c.drawn = true;
      });
    }
    function onVisible() {
      drawThumbs(); updatePreview();
    }
    var panel = host.closest('[role="tabpanel"]');
    var mo = null;
    if (panel) {
      mo = new MutationObserver(function () { if (!panel.hidden) onVisible(); });
      mo.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }

    paintCards(); paintSnails(); applyMode(); refreshBest();
    if (!panel || !panel.hidden) onVisible();

    function destroy() {
      gm.destroy(); ctl.destroy(); pv.destroy(); render.releaseStatic();
      if (ro) ro.disconnect(); if (mo) mo.disconnect();
      root.removeEventListener('resize', onResize); root.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVis);
      cancelAnimationFrame(resizeRaf); clearTimeout(toastTimer);
      lockPage(false);
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    }
    root.addEventListener('pagehide', destroy);
    return { destroy: destroy, game: gm, settings: S, input: ctl };
  }

  A.ui = { mount: mount };
})(window);
