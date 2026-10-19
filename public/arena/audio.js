// Optional lightweight sound effects, synthesised with Web Audio (no assets).
// The context is created inside a tap or click (unlock) so phones allow it.
(function (root) {
  var ctx = null, enabled = true;

  function unlock() {
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  }

  function tone(freq, len, type, vol, slideTo, delay) {
    if (!enabled || !ctx || ctx.state === 'closed') return;
    try {
      var t = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t + len * 0.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + len + 0.02);
    } catch (e) {}
  }

  var last = {};
  function throttled(name, ms) {
    var now = Date.now();
    if (last[name] && now - last[name] < ms) return false;
    last[name] = now; return true;
  }

  root.SnailArena = root.SnailArena || {};
  root.SnailArena.audio = {
    unlock: unlock,
    setEnabled: function (v) { enabled = !!v; },
    count: function () { tone(520, 0.14, 'sine', 0.16); },
    go: function () { tone(880, 0.45, 'square', 0.1, 1320); },
    checkpoint: function () { if (throttled('cp', 120)) tone(740, 0.1, 'triangle', 0.1, 960); },
    lap: function () { tone(660, 0.12, 'triangle', 0.12); tone(990, 0.2, 'triangle', 0.12, null, 0.12); },
    bump: function () { if (throttled('bump', 120)) tone(150, 0.12, 'sawtooth', 0.07, 80); },
    boost: function () { if (throttled('boost', 300)) tone(300, 0.25, 'sawtooth', 0.06, 700); },
    finish: function (win) {
      var n = win ? [523, 659, 784, 1046] : [523, 587, 659];
      n.forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.12, null, i * 0.13); });
    }
  };
})(window);
