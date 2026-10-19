var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var cage = require('../public/snail-cage.js');

var NOW = 1_700_000_000_000;
var IDS = cage.SNAIL_IDS;

// The badge strings the page's SNAILS list already wears (public/index.html).
var PAGE_BADGES = {
  lime: 'bg-lime-500/20 ring-1 ring-lime-400/50',
  pink: 'bg-pink-500/20 ring-1 ring-pink-400/50',
  teal: 'bg-teal-500/20 ring-1 ring-teal-400/50',
  orange: 'bg-orange-500/20 ring-1 ring-orange-400/50',
  slate: 'bg-slate-400/20 ring-1 ring-slate-300/50',
  sky: 'bg-sky-500/20 ring-1 ring-sky-400/50'
};

test('parse defaults: missing, junk and bare JSON all give the six snails at mood 60', function () {
  [null, 'junk', '{"v":1}', undefined, 42].forEach(function (raw) {
    var state = cage.parse(raw, IDS, NOW);
    assert.deepStrictEqual(Object.keys(state.snails).sort(), IDS.slice().sort());
    IDS.forEach(function (id) {
      var e = state.snails[id];
      assert.strictEqual(e.mood, 60, id + ' mood');
      assert.strictEqual(e.nick, '', id + ' nick');
      assert.strictEqual(e.shell, cage.DEFAULT_SHELL[id], id + ' default shell');
      assert.strictEqual(e.acc, 'none', id + ' acc');
      assert.strictEqual(e.at, NOW, id + ' at');
    });
  });
});

test('parse sanitises: unknown shell/accessory fall back, nick is trimmed to 16 chars, mood clamped, unknown ids dropped', function () {
  var raw = JSON.stringify({
    v: 1,
    snails: {
      drea: { nick: '  Shelly the magnificent  ', shell: 'chartreuse', acc: 'jetpack', mood: 999, at: NOW },
      evan: { nick: 123, shell: 7, acc: 9, mood: -50, at: 'nope' },
      lucas: { nick: 'x'.repeat(40), shell: 'teal', acc: 'crown', mood: 50.4, at: NOW },
      notasnail: { nick: 'ghost', mood: 100 }
    }
  });
  var s = cage.parse(raw, IDS, NOW);
  assert.strictEqual(s.snails.drea.nick, 'Shelly the magni', 'trimmed to 16');
  assert.strictEqual(s.snails.drea.shell, 'pink', 'unknown shell falls back to the snail default');
  assert.strictEqual(s.snails.drea.acc, 'none', 'unknown accessory falls back');
  assert.strictEqual(s.snails.drea.mood, 100, 'mood clamped to 100');
  assert.strictEqual(s.snails.evan.nick, '', 'non-string nick falls back');
  assert.strictEqual(s.snails.evan.shell, 'teal');
  assert.strictEqual(s.snails.evan.mood, 0, 'mood clamped to 0');
  assert.strictEqual(s.snails.evan.at, NOW, 'non-number at falls back');
  assert.strictEqual(s.snails.lucas.nick, 'x'.repeat(16), 'long nick cut to 16');
  assert.strictEqual(s.snails.lucas.shell, 'teal');
  assert.strictEqual(s.snails.lucas.acc, 'crown');
  assert.strictEqual(s.snails.lucas.mood, 50, 'mood rounded');
  assert.strictEqual('notasnail' in s.snails, false, 'unknown snail id dropped');
});

test('care: Feed adds 20, Pet adds 10, both cap at 100 and stamp at', function () {
  var state = cage.parse(null, IDS, NOW);
  assert.strictEqual(cage.care(state, 'drea', 'feed', NOW), 80);
  assert.strictEqual(state.snails.drea.mood, 80);
  assert.strictEqual(state.snails.drea.at, NOW);
  assert.strictEqual(cage.care(state, 'evan', 'pet', NOW), 70);
  assert.strictEqual(state.snails.evan.mood, 70);
  state.snails.snait.mood = 95;
  assert.strictEqual(cage.care(state, 'snait', 'feed', NOW), 100, 'feed caps at 100');
  state.snails.snait.mood = 100;
  assert.strictEqual(cage.care(state, 'snait', 'pet', NOW + 1), 100, 'pet caps at 100');
  assert.strictEqual(cage.care(state, 'nobody', 'feed', NOW), null);
});

test('decay: -5 per full hour, floors at 0, a future at gives no rise, and care applies after decay', function () {
  var HOUR = 60 * 60 * 1000;
  var state = cage.parse(null, IDS, NOW);
  // 59 minutes: no full hour, no decay.
  assert.strictEqual(cage.moodNow(state.snails.drea, NOW + 59 * 60 * 1000), 60);
  // 2 full hours: -10.
  assert.strictEqual(cage.moodNow(state.snails.drea, NOW + 2 * HOUR), 50);
  // 30 hours below 40: floors at 0, never negative.
  var low = { mood: 40, at: NOW };
  assert.strictEqual(cage.moodNow(low, NOW + 30 * HOUR), 0);
  // Clock moved backwards: a future at is treated as now, no rise.
  var future = { mood: 60, at: NOW + 5 * HOUR };
  assert.strictEqual(cage.moodNow(future, NOW), 60);
  // Care applies after decay: 2 h passes (60 -> 50), then feed.
  var mid = { mood: 60, at: NOW };
  var after = cage.care({ snails: { drea: mid } }, 'drea', 'feed', NOW + 2 * HOUR);
  assert.strictEqual(after, 70);
  assert.strictEqual(mid.at, NOW + 2 * HOUR, 'care stamps the new time');
});

test('moodLabel: 70 Happy, 69 Okay, 40 Okay, 39 Lonely, 0 Lonely', function () {
  assert.strictEqual(cage.moodLabel(70), 'Happy');
  assert.strictEqual(cage.moodLabel(69), 'Okay');
  assert.strictEqual(cage.moodLabel(40), 'Okay');
  assert.strictEqual(cage.moodLabel(39), 'Lonely');
  assert.strictEqual(cage.moodLabel(0), 'Lonely');
  assert.strictEqual(cage.moodLabel(100), 'Happy');
});

test('look: returns the shell badge string and hex plus the accessory emoji', function () {
  var state = cage.parse(null, IDS, NOW);
  var drea = cage.look(state, 'drea');
  assert.strictEqual(drea.badge, PAGE_BADGES.pink);
  assert.strictEqual(drea.hex, '#f472b6');
  assert.strictEqual(drea.acc, 'none');
  assert.strictEqual(drea.accEmoji, '');
  assert.strictEqual(drea.nick, '');
  cage.setShell(state, 'drea', 'lime');
  cage.setAccessory(state, 'drea', 'crown');
  cage.setNick(state, 'drea', 'Shelly');
  var custom = cage.look(state, 'drea');
  assert.strictEqual(custom.badge, PAGE_BADGES.lime);
  assert.strictEqual(custom.hex, '#a3e635');
  assert.strictEqual(custom.acc, 'crown');
  assert.strictEqual(custom.accEmoji, '👑');
  assert.strictEqual(custom.nick, 'Shelly');
  // Invalid values fall back instead of throwing.
  cage.setShell(state, 'drea', 'chartreuse');
  cage.setAccessory(state, 'drea', 'jetpack');
  var back = cage.look(state, 'drea');
  assert.strictEqual(back.shell, cage.DEFAULT_SHELL.drea);
  assert.strictEqual(back.acc, 'none');
});

test('look: every SHELLS badge string is already worn by SNAILS in index.html, so no new colour classes', function () {
  var page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  Object.keys(cage.SHELLS).forEach(function (key) {
    assert.strictEqual(cage.SHELLS[key].badge, PAGE_BADGES[key], key + ' badge matches the page');
    assert.ok(page.indexOf(cage.SHELLS[key].badge) !== -1, key + ' badge literal present in index.html');
  });
  Object.keys(PAGE_BADGES).forEach(function (key) {
    assert.ok(cage.SHELLS[key], 'index.html badge ' + key + ' has a SHELLS entry');
  });
});

test('no network: snail-cage.js never fetches or uses XMLHttpRequest', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'public', 'snail-cage.js'), 'utf8');
  assert.strictEqual(src.indexOf('fetch'), -1);
  assert.strictEqual(src.indexOf('XMLHttpRequest'), -1);
});
