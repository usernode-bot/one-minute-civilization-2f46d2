const test = require('node:test');
const assert = require('node:assert');
const {
  STA_MIN,
  STA_MAX,
  SPRINT_MULT,
  SPRINT_DRAIN,
  EXHAUST_FADE,
  STAMINA_RECOVERY,
  EXHAUST_EXIT_RATIO,
  RACE_SECONDS,
  SIM_STEP_SECONDS,
  sprintSeconds,
  effectiveTenths,
} = require('../nail-config');

const SPD_RANGE = [3, 4, 5, 6, 7, 8, 9]; // SPD_MIN..SPD_MAX
const STA_RANGE = [3, 4, 5, 6, 7, 8, 9]; // STA_MIN..STA_MAX

test('a sprint lasts sta / SPRINT_DRAIN seconds', () => {
  assert.strictEqual(sprintSeconds(3), 1.5);
  assert.strictEqual(sprintSeconds(6), 3.0);
  assert.strictEqual(sprintSeconds(9), 4.5);
});

test('the model is deterministic', () => {
  for (const spd of SPD_RANGE) {
    for (const sta of STA_RANGE) {
      assert.strictEqual(
        effectiveTenths(spd, sta),
        effectiveTenths(spd, sta),
        `spd ${spd} sta ${sta}`
      );
    }
  }
});

test('effective speed rises strictly with speed at a fixed stamina', () => {
  for (const sta of STA_RANGE) {
    for (let i = 0; i < SPD_RANGE.length - 1; i++) {
      const lo = effectiveTenths(SPD_RANGE[i], sta);
      const hi = effectiveTenths(SPD_RANGE[i + 1], sta);
      assert.ok(hi > lo, `spd ${SPD_RANGE[i]}->${SPD_RANGE[i + 1]} at sta ${sta}`);
    }
  }
});

test('effective speed rises strictly with stamina at a fixed speed', () => {
  for (const spd of SPD_RANGE) {
    for (let i = 0; i < STA_RANGE.length - 1; i++) {
      const lo = effectiveTenths(spd, STA_RANGE[i]);
      const hi = effectiveTenths(spd, STA_RANGE[i + 1]);
      assert.ok(hi > lo, `sta ${STA_RANGE[i]}->${STA_RANGE[i + 1]} at spd ${spd}`);
    }
  }
});

test('stamina is load bearing: a slower snail with a bigger tank out-runs a faster one', () => {
  assert.ok(effectiveTenths(5, 9) > effectiveTenths(7, 3));
  assert.ok(effectiveTenths(6, 9) > effectiveTenths(9, 3));
});

test('sprinting lifts a snail above its raw gene, fading drops it below', () => {
  // A tank big enough to sprint the whole race averages SPRINT_MULT times
  // the raw gene, so it beats the gene; a faded snail runs under it.
  assert.ok(effectiveTenths(6, RACE_SECONDS * SPRINT_DRAIN) > 60);
  assert.ok(effectiveTenths(6, STA_MIN) < 60);
  assert.ok(EXHAUST_FADE < 1 && STAMINA_RECOVERY > 0);
  assert.ok(EXHAUST_EXIT_RATIO > 0 && EXHAUST_EXIT_RATIO < 1);
  assert.ok(SPRINT_MULT > 1);
  assert.ok(Math.round(RACE_SECONDS / SIM_STEP_SECONDS) === 120);
});
