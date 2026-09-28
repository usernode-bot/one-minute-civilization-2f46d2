const test = require('node:test');
const assert = require('node:assert');
const {
  nailForOdds,
  LOSS_POINTS,
  RACES_PER_DERBY,
} = require('../nail-config');

test('odds under 6x earn 100 $NAIL', () => {
  assert.strictEqual(nailForOdds(20), 100);
  assert.strictEqual(nailForOdds(59), 100);
});

test('odds from 6x to 8x inclusive earn 150 $NAIL', () => {
  assert.strictEqual(nailForOdds(60), 150);
  assert.strictEqual(nailForOdds(74), 150);
  assert.strictEqual(nailForOdds(80), 150);
});

test('odds over 8x earn 250 $NAIL', () => {
  assert.strictEqual(nailForOdds(81), 250);
  assert.strictEqual(nailForOdds(93), 250);
});

test('a longshot win beats a favourite win', () => {
  assert.ok(nailForOdds(93) > nailForOdds(53));
});

test('a loss earns 0 and a derby is 8 races', () => {
  assert.strictEqual(LOSS_POINTS, 0);
  assert.strictEqual(RACES_PER_DERBY, 8);
});
