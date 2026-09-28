const test = require('node:test');
const assert = require('node:assert');
const S = require('../public/derby-stories.js');

const IDS = ['cycle_o', 'drea', 'evan', 'lucas', 'scradio', 'snait'];
const NAMES = { cycle_o: 'Cycle_o', drea: 'Drea', evan: 'Evan', lucas: 'Lucas', scradio: 'Scradio', snait: 'Snait' };
const TIER = (spd) => (spd >= 8 ? 100 : spd >= 5 ? 150 : 250);

function allLines() {
  const out = [];
  for (const pool of ['win', 'lost', 'won']) {
    out.push(...S.LIBRARY.any[pool]);
    for (const id of IDS) out.push(...S.LIBRARY.own[id][pool]);
  }
  return out;
}

function allCopy() {
  const texts = allLines().map((l) => l.text);
  const add = (e) => { texts.push(e.label, ...e.lines); };
  Object.values(S.LABELS).forEach(add);
  Object.values(S.SNAIL_LABELS).forEach(add);
  Object.values(S.CLOSINGS).forEach((l) => texts.push(...l));
  return texts;
}

// A slate shaped like GET /api/derby. picks/winners are per race; speeds
// rotate so every race has one clear favourite and some longshots.
function derbyOf(picks, winners, opts = {}) {
  const races = picks.map((pick, i) => {
    const snails = IDS.map((id, k) => {
      const spd = opts.spd ? opts.spd(i, k, id) : 3 + ((i + k) % 7);
      return { id, spd, odds: '1.0×', nail: TIER(spd) };
    });
    const winner = winners[i];
    const won = winner === pick;
    const nail = won ? snails.find((s) => s.id === pick).nail : 0;
    return { raceNumber: i + 1, snails, result: winner ? { pick, winner, won, nail } : null };
  });
  return { derbyId: opts.derbyId || 'daily-2026-09-28', racesPerDerby: 8, total: 0, currentRace: null, races };
}

test('library has enough lines per snail and overall', () => {
  for (const id of IDS) {
    assert.ok(S.LIBRARY.own[id].win.length >= 12, id + ' win');
    assert.ok(S.LIBRARY.own[id].lost.length >= 12, id + ' lost');
    assert.ok(S.LIBRARY.own[id].won.length >= 6, id + ' won');
  }
  assert.ok(S.LIBRARY.any.win.length >= 30);
  assert.ok(S.LIBRARY.any.lost.length >= 30);
  assert.ok(S.LIBRARY.any.won.length >= 12);
  assert.ok(allLines().length >= 250);
});

test('line ids are unique and categories are known and all covered', () => {
  const lines = allLines();
  assert.strictEqual(new Set(lines.map((l) => l.id)).size, lines.length);
  const counts = {};
  for (const l of lines) {
    assert.ok(S.CATEGORIES.includes(l.category), l.id + ' ' + l.category);
    counts[l.category] = (counts[l.category] || 0) + 1;
    if (l.when) assert.ok(['favourite', 'longshot', 'beatenByLongshot'].includes(l.when), l.id);
  }
  for (const c of S.CATEGORIES) assert.ok((counts[c] || 0) >= 5, c + ' has ' + counts[c]);
});

test('copy has no em dashes, dash hyphens, or retired snail names', () => {
  for (const t of allCopy()) {
    assert.ok(!/[—–]/.test(t), 'dash in: ' + t);
    assert.ok(!/\s-\s/.test(t), 'spaced hyphen in: ' + t);
    assert.ok(!/\b(Bandit|Cheeko|Gizmo|Tumble|Rocky|Peanut)\b/.test(t), 'old name in: ' + t);
  }
});

test('eight races never repeat a winner line or a pick line', () => {
  // Worst case: the same snail wins and is picked every race.
  for (const id of IDS) {
    for (const won of [true, false]) {
      const winner = id;
      const pick = won ? id : IDS[(IDS.indexOf(id) + 1) % 6];
      const d = derbyOf(Array(8).fill(pick), Array(8).fill(winner), { derbyId: 'worst-' + id });
      const st = S.storiesFor(d, NAMES);
      const w = Object.values(st).map((x) => x.winnerLineId);
      const p = Object.values(st).map((x) => x.pickLineId);
      assert.strictEqual(w.length, 8);
      assert.strictEqual(new Set(w).size, 8, 'winner lines repeat for ' + id);
      assert.strictEqual(new Set(p).size, 8, 'pick lines repeat for ' + id);
    }
  }
});

test('winner and pick explanations are separate lines with names filled in', () => {
  const d = derbyOf(IDS.concat(['evan', 'lucas']), ['lucas', 'drea', 'evan', 'lucas', 'snait', 'snait', 'evan', 'cycle_o']);
  const st = S.storiesFor(d, NAMES);
  for (const r of d.races) {
    const x = st[r.raceNumber];
    assert.notStrictEqual(x.winnerLine, x.pickLine);
    assert.ok(!/\{\w+\}/.test(x.winnerLine + x.pickLine), 'unfilled placeholder');
    assert.strictEqual(x.pickWon, r.result.won);
  }
});

test('stories are deterministic and stable as later races resolve', () => {
  const picks = ['evan', 'evan', 'drea', 'snait', 'lucas', 'lucas', 'scradio', 'cycle_o'];
  const winners = ['drea', 'evan', 'drea', 'lucas', 'lucas', 'snait', 'scradio', 'evan'];
  const a = S.storiesFor(derbyOf(picks, winners), NAMES);
  const b = S.storiesFor(derbyOf(picks, winners), NAMES);
  assert.deepStrictEqual(a, b);
  const partial = S.storiesFor(derbyOf(picks, winners.slice(0, 3).concat(Array(5).fill(null))), NAMES);
  assert.deepStrictEqual(Object.keys(partial), ['1', '2', '3']);
  for (const n of [1, 2, 3]) assert.deepStrictEqual(partial[n], a[n]);
});

test('stories never modify the derby they read', () => {
  const d = derbyOf(Array(8).fill('drea'), Array(8).fill('snait'));
  const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const before = JSON.stringify(d);
  deepFreeze(d);
  S.storiesFor(d, NAMES);
  S.summaryFor(d, NAMES);
  S.finishOrder(d, 1, 'snait');
  assert.strictEqual(JSON.stringify(d), before);
});

test('finish order puts the real winner first and includes every snail', () => {
  const d = derbyOf(Array(8).fill('drea'), Array(8).fill('scradio'));
  for (let n = 1; n <= 8; n++) {
    const o = S.finishOrder(d, n, 'scradio');
    assert.strictEqual(o[0], 'scradio');
    assert.deepStrictEqual(o.slice().sort(), IDS.slice().sort());
  }
});

test('summary is null until all eight races are resolved', () => {
  const d = derbyOf(Array(8).fill('evan'), ['evan', 'drea', null, null, null, null, null, null]);
  assert.strictEqual(S.summaryFor(d, NAMES), null);
});

test('personality labels follow the rule table', () => {
  const fav = (i, k) => (k === 0 ? 9 : 5); // cycle_o is the favourite every race
  const rot = (i, k) => (k === i % 6 ? 9 : 5); // the favourite rotates
  const lng = (i, k) => (k === 0 ? 9 : k === 5 ? 3 : 6); // snait is the longshot
  const cases = [
    ['loyalist', Array(8).fill('drea'), ['drea', 'drea', 'drea', 'evan', 'evan', 'evan', 'evan', 'evan']],
    ['heartbreak', Array(8).fill('drea'), Array(8).fill('evan')],
    ['gambler', Array(5).fill('snait').concat(['drea', 'evan', 'lucas']), Array(8).fill('cycle_o'), lng],
    ['underdog', Array(5).fill('snait').concat(['drea', 'evan', 'lucas']), ['snait', 'snait', 'drea', 'drea', 'drea', 'drea', 'drea', 'drea'], lng],
    ['statistician', IDS.concat(['drea', 'evan']), IDS.slice(0, 3).concat(['cycle_o', 'cycle_o', 'cycle_o', 'cycle_o', 'cycle_o']), rot],
    ['favouriteChaser', IDS.concat(['drea', 'evan']), Array(8).fill('none'), rot],
    ['chaos', IDS.concat(['evan', 'lucas']), Array(8).fill('drea'), fav],
    ['romantic', ['evan', 'evan', 'evan', 'evan', 'drea', 'lucas', 'snait', 'cycle_o'], Array(8).fill('drea'), fav],
    ['snail:lucas', ['lucas', 'lucas', 'lucas', 'drea', 'drea', 'snait', 'snait', 'snait'].map((x, i) => (i === 7 ? 'lucas' : x)), Array(8).fill('evan'), fav],
    ['switcher', ['drea', 'evan', 'drea', 'evan', 'lucas', 'snait', 'lucas', 'snait'], Array(8).fill('drea'), fav],
    ['playboy', ['drea', 'drea', 'evan', 'evan', 'lucas', 'lucas', 'snait', 'scradio'], Array(8).fill('drea'), fav],
    ['contrarian', ['drea', 'drea', 'evan', 'evan', 'evan', 'drea', 'drea', 'evan'].map((x, i) => (i < 4 ? 'drea' : 'evan')), Array(8).fill('drea'), (i, k) => (k === 0 ? 9 : 6)]
  ];
  for (const [key, picks, winners, spd] of cases) {
    const s = S.summaryFor(derbyOf(picks, winners, { spd }), NAMES);
    assert.strictEqual(s.key, key, 'expected ' + key + ' for ' + picks.join(','));
    assert.ok(s.label.length > 0 && !/\{\w+\}/.test(s.label + s.text), key + ' placeholders');
  }
});

test('named labels use the current snail names', () => {
  const s = S.summaryFor(derbyOf(['lucas', 'lucas', 'lucas', 'drea', 'drea', 'snait', 'snait', 'lucas'], Array(8).fill('evan'), { spd: (i, k) => (k === 0 ? 9 : 5) }), NAMES);
  assert.strictEqual(s.label, 'The Lucas Loyalist');
  const e = S.summaryFor(derbyOf(['evan', 'evan', 'evan', 'drea', 'drea', 'lucas', 'lucas', 'snait'], Array(8).fill('drea'), { spd: (i, k) => (k === 0 ? 9 : 5) }), NAMES);
  assert.strictEqual(e.label, 'The Evan Admirer');
});

test('a derby with no wins gets the zero win closing line', () => {
  const s = S.summaryFor(derbyOf(Array(8).fill('drea'), Array(8).fill('evan')), NAMES);
  assert.strictEqual(s.closing, 'zero');
  assert.ok(S.CLOSINGS.zero.some((l) => s.text.endsWith(l)));
});

test('pick counts sum to eight', () => {
  const s = S.summaryFor(derbyOf(IDS.concat(['evan', 'lucas']), Array(8).fill('drea')), NAMES);
  assert.strictEqual(Object.values(s.counts).reduce((a, b) => a + b, 0), 8);
  assert.strictEqual(s.counts.evan, 2);
});
