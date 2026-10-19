// Input: keyboard (rebindable), gamepad, and touch (virtual joystick plus
// boost and brake buttons). Everything reduces to one state object:
//   { dx, dy, mag, boost, brake }  (direction in world axes, intensity 0..1)
// so the physics treats every device the same.
(function (root) {
  var DEFAULT_KEYS = {
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    boost: ['Space'], brake: ['ShiftLeft', 'ShiftRight']
  };
  var DEAD = 0.12;

  function cloneKeys(k) { var o = {}; Object.keys(k).forEach(function (a) { o[a] = k[a].slice(); }); return o; }

  function isTouchDevice() {
    try {
      if (root.matchMedia && root.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
    } catch (e) {}
    return false;
  }

  function keyLabel(code) {
    if (!code) return '';
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Arrow ').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'Shift').replace('ControlLeft', 'Ctrl').replace('Space', 'Space');
  }

  // els: { zone (stage element, for edit drags), joy (base), knob, boostBtn, brakeBtn }
  function create(els, hooks) {
    var st = {
      keys: cloneKeys(DEFAULT_KEYS), down: {}, active: false, mode: 'keyboard',
      joy: { id: null, x: 0, y: 0, mag: 0, cx: 0, cy: 0, r: 50 },
      btn: { boost: null, brake: null }, editing: false, snap8: false, listening: null,
      padPause: false, pauseCb: hooks && hooks.onPause, onCapture: null
    };
    var controls = [];

    function matches(action, code) { return st.keys[action].indexOf(code) >= 0; }
    function isGameKey(code) {
      return Object.keys(st.keys).some(function (a) { return matches(a, code); }) || code === 'Escape';
    }

    function onKeyDown(e) {
      if (st.listening) {
        // rebinding: take the next key; Escape cancels
        e.preventDefault(); e.stopPropagation();
        if (e.code !== 'Escape' && e.code !== 'Tab') {
          Object.keys(st.keys).forEach(function (a) { st.keys[a] = st.keys[a].filter(function (c) { return c !== e.code; }); });
          st.keys[st.listening] = [e.code];
        }
        var cb = st.onCapture; st.listening = null; st.onCapture = null;
        syncListeners();
        if (cb) cb();
        return;
      }
      if (!st.active) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Escape') { if (!e.repeat && st.pauseCb) st.pauseCb(); e.preventDefault(); return; }
      if (isGameKey(e.code)) {
        st.down[e.code] = true;
        // Space and the arrows must not scroll the page or press a focused button
        e.preventDefault();
      }
    }
    function onKeyUp(e) {
      if (st.down[e.code]) { delete st.down[e.code]; if (st.active && isGameKey(e.code)) e.preventDefault(); }
    }
    function clearAll() {
      st.down = {};
      resetJoy(); st.btn.boost = null; st.btn.brake = null;
      if (els.boostBtn) els.boostBtn.setAttribute('data-pressed', '0');
      if (els.brakeBtn) els.brakeBtn.setAttribute('data-pressed', '0');
    }

    // ----- joystick -----
    function placeKnob(vx, vy) {
      if (els.knob) els.knob.style.transform = 'translate(' + (vx * st.joy.r) + 'px,' + (vy * st.joy.r) + 'px)';
    }
    function resetJoy() {
      st.joy.id = null; st.joy.x = 0; st.joy.y = 0; st.joy.mag = 0;
      placeKnob(0, 0);
      if (els.joy) els.joy.setAttribute('data-active', '0');
    }
    function joyMove(e) {
      var rect = els.joy.getBoundingClientRect();
      st.joy.cx = rect.left + rect.width / 2; st.joy.cy = rect.top + rect.height / 2;
      st.joy.r = rect.width * 0.34;
      var dx = (e.clientX - st.joy.cx) / st.joy.r, dy = (e.clientY - st.joy.cy) / st.joy.r;
      var m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; m = 1; }
      placeKnob(dx, dy);
      var mag = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD);
      var ang = Math.atan2(dy, dx);
      if (st.snap8 && mag > 0) { ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4); mag = mag > 0.5 ? 1 : 0.6; }
      st.joy.x = Math.cos(ang); st.joy.y = Math.sin(ang); st.joy.mag = mag;
    }
    function bindPointerControl(el, down, move, up) {
      var onDown = function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        down(e);
      };
      var onMove = function (e) { move(e); };
      var onUp = function (e) { up(e); };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('lostpointercapture', onUp);
      var noMenu = function (e) { e.preventDefault(); };
      el.addEventListener('contextmenu', noMenu);
      controls.push(function () {
        el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('lostpointercapture', onUp); el.removeEventListener('contextmenu', noMenu);
      });
    }

    if (els.joy) {
      var drag = null;
      bindPointerControl(els.joy,
        function (e) {
          if (st.editing) {
            drag = { id: e.pointerId };
            try { els.joy.setPointerCapture(e.pointerId); } catch (x) {}
            if (hooks && hooks.onEditMove) hooks.onEditMove(e.clientX, e.clientY);
            return;
          }
          if (st.joy.id !== null) return;   // already held by another finger
          st.joy.id = e.pointerId;
          try { els.joy.setPointerCapture(e.pointerId); } catch (x) {}
          els.joy.setAttribute('data-active', '1');
          joyMove(e);
        },
        function (e) {
          if (drag && drag.id === e.pointerId) { if (hooks && hooks.onEditMove) hooks.onEditMove(e.clientX, e.clientY); return; }
          if (st.joy.id === e.pointerId) joyMove(e);
        },
        function (e) {
          if (drag && drag.id === e.pointerId) { drag = null; if (hooks && hooks.onEditEnd) hooks.onEditEnd(); return; }
          if (st.joy.id === e.pointerId) resetJoy();
        });
    }
    ['boost', 'brake'].forEach(function (name) {
      var el = els[name + 'Btn'];
      if (!el) return;
      bindPointerControl(el,
        function (e) {
          if (st.editing) return;
          st.btn[name] = e.pointerId; el.setAttribute('data-pressed', '1');
          try { el.setPointerCapture(e.pointerId); } catch (x) {}
        },
        function () {},
        function (e) { if (st.btn[name] === e.pointerId) { st.btn[name] = null; el.setAttribute('data-pressed', '0'); } });
    });

    // Block page gestures (pinch, double-tap zoom, pull to refresh) on the stage.
    if (els.zone) {
      var stop = function (e) { if (st.active && e.cancelable) e.preventDefault(); };
      els.zone.addEventListener('touchmove', stop, { passive: false });
      els.zone.addEventListener('gesturestart', stop);
      els.zone.addEventListener('contextmenu', stop);
      controls.push(function () {
        els.zone.removeEventListener('touchmove', stop); els.zone.removeEventListener('gesturestart', stop);
        els.zone.removeEventListener('contextmenu', stop);
      });
    }

    var onBlur = function () { clearAll(); };
    var onVis = function () { if (document.hidden) clearAll(); };
    // Page-level listeners exist only while the arena is being played or a
    // key is being rebound, so a closed arena leaves nothing attached.
    var bound = false;
    function syncListeners() {
      var want = st.active || !!st.listening;
      if (want === bound) return;
      bound = want;
      var fn = want ? 'addEventListener' : 'removeEventListener';
      root[fn]('keydown', onKeyDown, true);
      root[fn]('keyup', onKeyUp, true);
      root[fn]('blur', onBlur);
      document[fn]('visibilitychange', onVis);
    }

    function readGamepad() {
      var pads = (navigator.getGamepads && navigator.getGamepads()) || [], p = null, i;
      for (i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { p = pads[i]; break; }
      if (!p) return null;
      var x = p.axes[0] || 0, y = p.axes[1] || 0;
      if (p.buttons[14] && p.buttons[14].pressed) x = -1;
      if (p.buttons[15] && p.buttons[15].pressed) x = 1;
      if (p.buttons[12] && p.buttons[12].pressed) y = -1;
      if (p.buttons[13] && p.buttons[13].pressed) y = 1;
      var m = Math.hypot(x, y);
      var start = !!(p.buttons[9] && p.buttons[9].pressed);
      if (start && !st.padPause && st.active && st.pauseCb) st.pauseCb();
      st.padPause = start;
      return {
        dx: m ? x / m : 0, dy: m ? y / m : 0, mag: m < DEAD ? 0 : Math.min(1, (m - DEAD) / (1 - DEAD)),
        boost: !!(p.buttons[0] && p.buttons[0].pressed) || !!(p.buttons[5] && p.buttons[5].pressed),
        brake: !!(p.buttons[1] && p.buttons[1].pressed) || !!(p.buttons[4] && p.buttons[4].pressed) || !!(p.buttons[6] && p.buttons[6].pressed)
      };
    }

    var out = { dx: 0, dy: 0, mag: 0, boost: false, brake: false };
    function anyDown(action) { return st.keys[action].some(function (c) { return st.down[c]; }); }

    return {
      state: st,
      setActive: function (v) { st.active = !!v; if (!v) clearAll(); syncListeners(); },
      setMode: function (m) { st.mode = m; if (m !== 'touch') resetJoy(); },
      setSnap8: function (v) { st.snap8 = !!v; },
      setEditing: function (v) { st.editing = !!v; if (v) clearAll(); },
      getKeys: function () { return cloneKeys(st.keys); },
      setKeys: function (k) {
        var o = cloneKeys(DEFAULT_KEYS);
        Object.keys(o).forEach(function (a) { if (k && Array.isArray(k[a]) && k[a].length) o[a] = k[a].filter(function (c) { return typeof c === 'string'; }).slice(0, 3); });
        st.keys = o;
      },
      resetKeys: function () { st.keys = cloneKeys(DEFAULT_KEYS); },
      listen: function (action, cb) { st.listening = action; st.onCapture = cb; syncListeners(); },
      cancelListen: function () { st.listening = null; st.onCapture = null; syncListeners(); },
      clear: clearAll,
      // current merged input; touch, keyboard and gamepad can all be used at once
      read: function () {
        var x = (anyDown('right') ? 1 : 0) - (anyDown('left') ? 1 : 0), y = (anyDown('down') ? 1 : 0) - (anyDown('up') ? 1 : 0);
        var m = Math.hypot(x, y);
        out.dx = m ? x / m : 0; out.dy = m ? y / m : 0; out.mag = m ? 1 : 0;
        out.boost = anyDown('boost'); out.brake = anyDown('brake');
        if (st.joy.mag > 0) { out.dx = st.joy.x; out.dy = st.joy.y; out.mag = st.joy.mag; }
        if (st.btn.boost !== null) out.boost = true;
        if (st.btn.brake !== null) out.brake = true;
        var pad = readGamepad();
        if (pad && pad.mag > 0 && out.mag === 0) { out.dx = pad.dx; out.dy = pad.dy; out.mag = pad.mag; }
        if (pad) { out.boost = out.boost || pad.boost; out.brake = out.brake || pad.brake; }
        return out;
      },
      destroy: function () {
        st.active = false; st.listening = null; syncListeners();
        controls.forEach(function (f) { f(); }); controls = [];
        clearAll();
      }
    };
  }

  root.SnailArena = root.SnailArena || {};
  root.SnailArena.input = { create: create, DEFAULT_KEYS: DEFAULT_KEYS, isTouchDevice: isTouchDevice, keyLabel: keyLabel };
})(window);
