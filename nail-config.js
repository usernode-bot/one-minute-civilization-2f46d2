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

// Each snail's speed gene for a race, drawn inclusive of both ends.
const SPD_MIN = 3;
const SPD_MAX = 9;

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
  nailForOdds,
};
