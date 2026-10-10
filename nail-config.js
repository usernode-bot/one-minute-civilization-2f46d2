// $NAIL Points settings. Every threshold and reward lives here and nowhere
// else: the server resolves races with nailForOdds and sends each snail's
// tier points to the page, which never repeats the rules.
//
// $NAIL is an in-game score only. It is not a token and has no value.

// Races in one Daily Derby slate.
const RACES_PER_DERBY = 8;

// Reward for a winning pick, by the pick's DISPLAYED odds in tenths
// (9.3x is 93). Checked top-down; the first tier whose maxOddsTenths is at
// or above the odds applies:
//   under 6x        +100
//   6x to 8x        +150 (6.0x and 8.0x both count)
//   over 8x         +250
const NAIL_TIERS = [
  { maxOddsTenths: 59, points: 100 },
  { maxOddsTenths: 80, points: 150 },
  { maxOddsTenths: Infinity, points: 250 },
];

// A losing pick earns nothing.
const LOSS_POINTS = 0;

// Each snail's genes for a race, drawn inclusive of both ends: how fast it
// moves (spd) and how long it can hold a sprint (sta).
const SPD_MIN = 3;
const SPD_MAX = 9;
const STA_MIN = 3;
const STA_MAX = 9;

// The sprint model. A snail starts with a pool of `sta` energy and sprints
// from the gun at SPRINT_MULT times its speed, spending SPRINT_DRAIN per
// second until the pool is empty. Once empty it fades to EXHAUST_FADE times
// its speed for the rest of the race. Its "effective speed" is the average
// it actually covers over RACE_SECONDS, which is what sets its odds and the
// winner, so a fast snail with a small tank can be run down by a slower one
// that keeps sprinting.
//
// The model is deterministic (no randomness) and each snail's value depends
// only on its OWN two genes, so a slate's odds are a pure function of its
// field and can be computed once, on creation, and stored.
//
// A snail sprints once per race, from the gun. It does NOT get a second
// sprint after refilling: at the spec's numbers (a pool of 3..9, spent at 2
// per second, in a 6 second race) every tank empties before the line, and
// letting a drained snail sprint again makes effective speed NON-monotonic
// in stamina (a bigger tank can score lower), which the spec's own
// monotonicity test forbids. Fading out to the line is monotonic in both
// genes and reproduces the spec's own table (about 0.79x / 1.03x / 1.26x at
// stamina 3 / 6 / 9). STAMINA_RECOVERY and EXHAUST_EXIT_RATIO stay declared
// because the HUD (the lane energy bar and its DRAINED chip) is defined in
// terms of them.
const SPRINT_MULT = 1.5;         // speed multiplier while sprinting
const SPRINT_DRAIN = 2.0;        // energy spent per second of sprinting
const EXHAUST_FADE = 0.55;       // speed multiplier once the pool is empty
const STAMINA_RECOVERY = 1.0;    // energy refilled per second once drained
const EXHAUST_EXIT_RATIO = 0.25; // energy back (of the pool) that ends DRAINED
const RACE_SECONDS = 6.0;        // the model's race horizon
const SIM_STEP_SECONDS = 0.05;   // fixed integration step, 120 steps per race

// How much of the race a snail can sprint for, in seconds: sta / SPRINT_DRAIN.
function sprintSeconds(sta) {
  return sta / SPRINT_DRAIN;
}

// A snail's effective speed over RACE_SECONDS, in integer tenths, from its
// two genes. Sprint first, then fade: this keeps effective speed strictly
// rising with both genes, so a bigger tank is never worse than a smaller one.
function effectiveTenths(spd, sta) {
  let energy = sta;
  let distance = 0;
  const steps = Math.round(RACE_SECONDS / SIM_STEP_SECONDS);
  for (let i = 0; i < steps; i++) {
    let v;
    if (energy > 0) {
      v = spd * SPRINT_MULT;
      energy -= SPRINT_DRAIN * SIM_STEP_SECONDS;
    } else {
      v = spd * EXHAUST_FADE;
    }
    distance += v * SIM_STEP_SECONDS;
  }
  return Math.round((distance / RACE_SECONDS) * 10);
}

function nailForOdds(oddsTenths) {
  for (const tier of NAIL_TIERS) {
    if (oddsTenths <= tier.maxOddsTenths) return tier.points;
  }
  return LOSS_POINTS;
}

module.exports = {
  RACES_PER_DERBY,
  NAIL_TIERS,
  LOSS_POINTS,
  SPD_MIN,
  SPD_MAX,
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
  nailForOdds,
};
