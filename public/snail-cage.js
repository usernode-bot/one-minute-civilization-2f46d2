// Snail Cage: care for and customize each snail. Purely cosmetic and kept
// on this device only. Nothing here reads or changes the derby: speed,
// stamina, odds, winners and $NAIL are untouched, and nothing is ever sent
// to the server. The Race view only reads looks through `look()`.
//
// Shared-script pattern (as public/derby-stories.js): an IIFE that does
// module.exports = api under Node and window.snailDerbyCage = api in the
// browser, tested from test/ with node --test.
//
// Snail ids and shell colours mirror the SNAILS list in public/index.html:
// SHELLS entries carry the same literal badge strings that list uses, so no
// new colour classes exist.
(function () {
  var SHELLS = {
    lime: { badge: 'bg-lime-500/20 ring-1 ring-lime-400/50', hex: '#a3e635' },
    pink: { badge: 'bg-pink-500/20 ring-1 ring-pink-400/50', hex: '#f472b6' },
    teal: { badge: 'bg-teal-500/20 ring-1 ring-teal-400/50', hex: '#2dd4bf' },
    orange: { badge: 'bg-orange-500/20 ring-1 ring-orange-400/50', hex: '#fb923c' },
    slate: { badge: 'bg-slate-400/20 ring-1 ring-slate-300/50', hex: '#cbd5e1' },
    sky: { badge: 'bg-sky-500/20 ring-1 ring-sky-400/50', hex: '#38bdf8' }
  };

  // Each snail's own colour, so an untouched cage looks exactly like today.
  var DEFAULT_SHELL = {
    cycle_o: 'lime', drea: 'pink', evan: 'teal',
    lucas: 'orange', scradio: 'slate', snait: 'sky'
  };

  var ACCESSORIES = [
    { id: 'none', emoji: '', label: 'None' },
    { id: 'tophat', emoji: '🎩', label: 'Top hat' },
    { id: 'leaf', emoji: '🍃', label: 'Leaf' },
    { id: 'bow', emoji: '🎀', label: 'Bow' },
    { id: 'flower', emoji: '🌸', label: 'Flower' },
    { id: 'crown', emoji: '👑', label: 'Crown' }
  ];
  var ACC_EMOJI = {};
  ACCESSORIES.forEach(function (a) { ACC_EMOJI[a.id] = a.emoji; });

  var SNAIL_IDS = ['cycle_o', 'drea', 'evan', 'lucas', 'scradio', 'snait'];

  var HOUR = 60 * 60 * 1000; // mood drops 5 points per full hour without care
  var NICK_MAX = 16;

  function defaultEntry(now) {
    return { nick: '', shell: '', acc: 'none', mood: 60, at: now };
  }

  // Turns stored JSON into one clean entry per known snail id. Unknown ids
  // are dropped; wrong types, unknown shells/accessories and out-of-range
  // moods fall back to their defaults; a future `at` (clock moved back) is
  // kept but moodNow treats it as now, so mood never rises on its own.
  function parse(raw, ids, now) {
    ids = ids || SNAIL_IDS;
    now = typeof now === 'number' ? now : Date.now();
    var out = {};
    ids.forEach(function (id) { out[id] = defaultEntry(now); });
    var data = null;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) { data = null; }
    if (data && typeof data === 'object' && data.snails && typeof data.snails === 'object') {
      Object.keys(data.snails).forEach(function (id) {
        if (!out[id]) return;
        var e = data.snails[id];
        if (!e || typeof e !== 'object') return;
        var d = out[id];
        if (typeof e.nick === 'string') d.nick = e.nick.trim().slice(0, NICK_MAX);
        d.shell = SHELLS[e.shell] ? e.shell : (DEFAULT_SHELL[id] || 'lime');
        d.acc = ACC_EMOJI[e.acc] !== undefined ? e.acc : 'none';
        if (typeof e.mood === 'number' && isFinite(e.mood)) {
          d.mood = Math.max(0, Math.min(100, Math.round(e.mood)));
        }
        if (typeof e.at === 'number' && isFinite(e.at)) d.at = e.at;
      });
    }
    // Every known id ends with a valid shell: its own default when none
    // was stored.
    ids.forEach(function (id) {
      if (!SHELLS[out[id].shell]) out[id].shell = DEFAULT_SHELL[id] || 'lime';
    });
    // The same shape the store keeps, so every other function reads it.
    return { v: 1, snails: out };
  }

  // The mood a snail is at right now: the stored mood, minus 5 points per
  // full hour since it was last set, never below 0. A future `at` counts as
  // now, so mood never rises on its own.
  function moodNow(entry, now) {
    now = typeof now === 'number' ? now : Date.now();
    var mood = entry && typeof entry.mood === 'number' && isFinite(entry.mood) ? entry.mood : 60;
    var at = entry && typeof entry.at === 'number' && isFinite(entry.at) && entry.at < now ? entry.at : now;
    return Math.max(0, mood - 5 * Math.floor((now - at) / HOUR));
  }

  // 70 and up Happy, 40 to 69 Okay, below 40 Lonely.
  function moodLabel(n) {
    if (n >= 70) return 'Happy';
    if (n >= 40) return 'Okay';
    return 'Lonely';
  }

  // Feed (+20) or Pet (+10), capped at 100, applied to the mood as it is
  // right now (after decay), and stamped. Returns the new mood.
  function care(state, id, kind, now) {
    now = typeof now === 'number' ? now : Date.now();
    var e = state && state.snails && state.snails[id];
    if (!e) return null;
    var m = Math.min(100, moodNow(e, now) + (kind === 'feed' ? 20 : 10));
    e.mood = m;
    e.at = now;
    return m;
  }

  function entryOf(state, id) {
    return state && state.snails && state.snails[id] ? state.snails[id] : null;
  }

  function setNick(state, id, value) {
    var e = entryOf(state, id);
    if (!e) return;
    e.nick = typeof value === 'string' ? value.trim().slice(0, NICK_MAX) : '';
  }

  function setShell(state, id, value) {
    var e = entryOf(state, id);
    if (!e) return;
    e.shell = SHELLS[value] ? value : (DEFAULT_SHELL[id] || 'lime');
  }

  function setAccessory(state, id, value) {
    var e = entryOf(state, id);
    if (!e) return;
    e.acc = ACC_EMOJI[value] !== undefined ? value : 'none';
  }

  // How a snail should be drawn right now: its shell badge string and hex,
  // its accessory emoji ('' for none) and its nickname ('' for none).
  function look(state, id) {
    var e = entryOf(state, id);
    var shellKey = e && SHELLS[e.shell] ? e.shell : (DEFAULT_SHELL[id] || 'lime');
    var accKey = e && ACC_EMOJI[e.acc] !== undefined ? e.acc : 'none';
    return {
      shell: shellKey,
      badge: SHELLS[shellKey].badge,
      hex: SHELLS[shellKey].hex,
      acc: accKey,
      accEmoji: ACC_EMOJI[accKey],
      nick: e && typeof e.nick === 'string' ? e.nick : ''
    };
  }

  var api = {
    SHELLS: SHELLS,
    DEFAULT_SHELL: DEFAULT_SHELL,
    ACCESSORIES: ACCESSORIES,
    SNAIL_IDS: SNAIL_IDS,
    parse: parse,
    moodNow: moodNow,
    moodLabel: moodLabel,
    care: care,
    setNick: setNick,
    setShell: setShell,
    setAccessory: setAccessory,
    look: look
  };

  // Browser-only store: one localStorage key, parsed once per page, saved on
  // every change. If localStorage is missing, blocked or full, the state
  // just lives in memory for the session and nothing throws. Each save
  // dispatches a window `snail-cage-change` event so the Race view can
  // redraw the looks it shows.
  if (typeof window !== 'undefined' && window.document) {
    var KEY = 'snail-derby-cage';
    var memory = null;

    function load() {
      if (memory) return memory;
      var raw = null;
      try { raw = window.localStorage.getItem(KEY); } catch (_) { raw = null; }
      memory = parse(raw);
      return memory;
    }

    function save() {
      if (!memory) return;
      try { window.localStorage.setItem(KEY, JSON.stringify(memory)); } catch (_) {}
      try {
        window.dispatchEvent(new Event('snail-cage-change'));
      } catch (_) {}
    }

    function get() { return load(); }

    api.store = { load: load, save: save, get: get };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.snailDerbyCage = api;
})();
