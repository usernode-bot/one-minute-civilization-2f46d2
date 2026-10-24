// Training: a per-player, per-snail training level that makes a snail faster
// and its boost stronger on the short tracks, plus the short-track race
// records. Rows in snail_training hold a snail's cumulative XP, its race and
// win counts and its best time per track; rows in training_sessions are the
// append-only drills, at most TRAIN_SESSIONS_PER_DAY per snail per UTC day.
//
// Nothing here is read by the Daily Derby or the Cage, so training can never
// change a derby race, the $NAIL economy, the cage balance or a leaderboard
// score. It also costs no $NAIL: the limit is the three sessions a day and
// the XP a short-track race pays out.

// A snail starts at level 1 and stops at MAX_LEVEL. Each level is a little
// quicker off the mark, a little stronger on the boost and a little longer
// between winded spells.
const MAX_LEVEL = 10;
const XP_PER_TRAIN = 10;
const TRAIN_SESSIONS_PER_DAY = 3;
const RACERS = 4;

// XP by finishing place, 1st to 4th. Every race pays something, so a run is
// always progress even when a trained rival wins.
const RACE_XP = [25, 15, 10, 6];

const SPEED_PER_LEVEL = 0.03;  // +3% top speed per level
const BOOST_PER_LEVEL = 0.02;  // +0.02x boost per level
const ENERGY_PER_LEVEL = 0.04; // +4% boost tank per level

// The boost rule, shared by the page's race and the server's sanity checks.
// Hold BOOST to sprint at boostMult, spending BOOST_DRAIN energy a second;
// release and the tank refills at ENERGY_REGEN a second. Empty the tank and
// the snail is winded for WIND_MS at WIND_MULT speed, so a measured burst
// beats holding the button down.
const BASE_BOOST_MULT = 1.6;
const BOOST_DRAIN = 0.5;
const ENERGY_REGEN = 0.22;
const WIND_MS = 1200;
const WIND_MULT = 0.85;

// The short tracks. `metres` is the length shown on the card, baseSeconds is
// how long a level-1 snail takes at a steady crawl with no boost at all, and
// `pace` is how fast the three rivals run against that same baseline. Later
// tracks pay the same XP but set a faster field, so a snail needs training
// (and clean boost timing) to win there.
//
// rx / ry are the loop's half-axes as a share of the canvas, `wobble` bends
// the oval into a friendlier shape, and accent colours the track. The page
// draws from these numbers so a track is defined in exactly one place.
const TRACKS = [
  {
    id: 'garden',
    name: 'Back Garden',
    metres: 40,
    baseSeconds: 15,
    pace: 0.72,
    rx: 0.36,
    ry: 0.30,
    wobble: 0,
    accent: '#a3e635',
  },
  {
    id: 'orchard',
    name: 'Orchard Bend',
    metres: 55,
    baseSeconds: 16,
    pace: 0.92,
    rx: 0.33,
    ry: 0.32,
    wobble: 0.06,
    accent: '#fbbf24',
  },
  {
    id: 'night',
    name: 'Midnight Dash',
    metres: 70,
    baseSeconds: 17,
    pace: 1.08,
    rx: 0.38,
    ry: 0.26,
    wobble: 0.04,
    accent: '#38bdf8',
  },
];

// XP needed to climb out of `level`. The curve widens with every level, so
// the first one lands after two training sessions and the last takes real
// work. MAX_LEVEL needs nothing more.
function xpToNext(level) {
  if (level >= MAX_LEVEL) return 0;
  return 20 + (Math.max(1, Math.floor(level)) - 1) * 10;
}

function clampLevel(level) {
  const n = Math.floor(Number(level) || 1);
  return Math.max(1, Math.min(MAX_LEVEL, n));
}

// A snail's level and how far it is into it, from its cumulative XP. Pure,
// so the page and the server always agree on what a pile of XP means.
function levelProgress(xp) {
  let rest = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (rest < need) return { level, into: rest, need, maxed: false };
    rest -= need;
    level += 1;
  }
  return { level: MAX_LEVEL, into: 0, need: 0, maxed: true };
}

function speedMultiplier(level) {
  return 1 + SPEED_PER_LEVEL * (clampLevel(level) - 1);
}

function boostMultiplier(level) {
  return BASE_BOOST_MULT + BOOST_PER_LEVEL * (clampLevel(level) - 1);
}

function energyCapacity(level) {
  return 1 + ENERGY_PER_LEVEL * (clampLevel(level) - 1);
}

function xpForPlace(place) {
  const p = Math.floor(Number(place));
  return p >= 1 && p <= RACERS ? RACE_XP[p - 1] : 0;
}

function trackFor(id) {
  for (const t of TRACKS) if (t.id === id) return t;
  return null;
}

// A reported race must be one of this app's tracks, a real finishing place
// and a time a snail could actually have run: never faster than twice the
// baseline (a fully trained snail at full boost is ~1.6x), never longer
// than five minutes. The page runs the race, so this is the guard that keeps
// a stray request out of the records.
const MAX_RACE_MS = 5 * 60 * 1000;

function validateRace(trackId, place, timeMs) {
  const track = trackFor(trackId);
  if (!track) return { ok: false, error: 'bad_track' };
  const p = Number(place);
  if (!Number.isInteger(p) || p < 1 || p > RACERS) {
    return { ok: false, error: 'bad_place' };
  }
  const ms = Number(timeMs);
  const floor = Math.round((track.baseSeconds * 1000) / 2.2);
  if (!Number.isInteger(ms) || ms < floor || ms > MAX_RACE_MS) {
    return { ok: false, error: 'bad_time' };
  }
  return { ok: true, track, place: p, timeMs: ms };
}

// One snail's public training record, with its level worked out from XP.
function snailView(row, sessionsToday) {
  const info = levelProgress(row.xp);
  return {
    id: row.snail_id,
    xp: row.xp,
    level: info.level,
    xpIntoLevel: info.into,
    xpForNext: info.need,
    maxed: info.maxed,
    races: row.races,
    wins: row.wins,
    bests: row.bests || {},
    sessionsToday,
    sessionsLeft: Math.max(0, TRAIN_SESSIONS_PER_DAY - sessionsToday),
    speedPct: Math.round(SPEED_PER_LEVEL * (info.level - 1) * 100),
    boostPct: Math.round(BOOST_PER_LEVEL * (info.level - 1) * 100),
    speedMult: speedMultiplier(info.level),
    boostMult: boostMultiplier(info.level),
    energyCap: energyCapacity(info.level),
  };
}

// Every snail's training record for a player. A snail with no row yet is a
// level-1 snail with nothing raced, so the page can render the whole roster
// before the player has done anything.
async function readTraining(db, userId, snailIds, todayStart) {
  const { rows } = await db.query(
    `SELECT snail_id, xp, races, wins, bests
       FROM snail_training WHERE user_id = $1`,
    [userId]
  );
  const byId = new Map(rows.map(r => [r.snail_id, r]));
  const sessions = await db.query(
    `SELECT snail_id, COUNT(*)::int AS n
       FROM training_sessions
      WHERE user_id = $1 AND created_at >= $2::timestamptz
      GROUP BY snail_id`,
    [userId, todayStart]
  );
  const today = new Map(sessions.rows.map(r => [r.snail_id, r.n]));
  return {
    snails: snailIds.map(id => {
      const row = byId.get(id) || {
        snail_id: id, xp: 0, races: 0, wins: 0, bests: {},
      };
      return snailView(row, today.get(id) || 0);
    }),
  };
}

// One training session, inside the caller's transaction. Takes the player's
// training advisory lock first, so two tabs cannot both spend the day's
// third session, then records the session and adds its XP. Returns
// { error: 'no_sessions' } when the day is full, or {} when the drill ran.
async function applyTraining(client, userId, snailId, todayStart) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('training:' || $1))`,
    [userId]
  );
  const done = await client.query(
    `SELECT COUNT(*)::int AS n FROM training_sessions
      WHERE user_id = $1 AND snail_id = $2 AND created_at >= $3::timestamptz`,
    [userId, snailId, todayStart]
  );
  if (done.rows[0].n >= TRAIN_SESSIONS_PER_DAY) {
    return { error: 'no_sessions' };
  }
  await client.query(
    `INSERT INTO training_sessions (user_id, snail_id) VALUES ($1, $2)`,
    [userId, snailId]
  );
  await client.query(
    `INSERT INTO snail_training (user_id, snail_id, xp)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, snail_id) DO UPDATE
       SET xp = snail_training.xp + EXCLUDED.xp,
           updated_at = now()`,
    [userId, snailId, XP_PER_TRAIN]
  );
  return {};
}

// One finished short-track race, inside the caller's transaction. Same
// advisory lock, then the XP for the place, one more race (and one more win
// for first) and the track's best time when this run beat it. Returns the XP
// paid and whether the time was a new best, so the result card can say so.
async function applyRace(client, userId, snailId, trackId, place, timeMs) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('training:' || $1))`,
    [userId]
  );
  const { rows } = await client.query(
    `SELECT xp, races, wins, bests FROM snail_training
      WHERE user_id = $1 AND snail_id = $2`,
    [userId, snailId]
  );
  const prev = rows[0] || { xp: 0, races: 0, wins: 0, bests: {} };
  const bests = Object.assign({}, prev.bests || {});
  const before = bests[trackId];
  const newBest = typeof before !== 'number' || timeMs < before;
  if (newBest) bests[trackId] = timeMs;
  const xpEarned = xpForPlace(place);
  await client.query(
    `INSERT INTO snail_training (user_id, snail_id, xp, races, wins, bests)
     VALUES ($1, $2, $3, 1, $4, $5)
     ON CONFLICT (user_id, snail_id) DO UPDATE
       SET xp = snail_training.xp + EXCLUDED.xp,
           races = snail_training.races + 1,
           wins = snail_training.wins + EXCLUDED.wins,
           bests = EXCLUDED.bests,
           updated_at = now()`,
    [userId, snailId, xpEarned, place === 1 ? 1 : 0, JSON.stringify(bests)]
  );
  return { xpEarned, prevXp: prev.xp, newBest, best: bests[trackId] };
}

// The rules the page's race runs on, straight from this file so the page
// never repeats them.
function rulesView() {
  return {
    sessionsPerDay: TRAIN_SESSIONS_PER_DAY,
    xpPerTrain: XP_PER_TRAIN,
    maxLevel: MAX_LEVEL,
    raceXp: RACE_XP,
    racers: RACERS,
    boostMult: BASE_BOOST_MULT,
    boostDrain: BOOST_DRAIN,
    energyRegen: ENERGY_REGEN,
    windMs: WIND_MS,
    windMult: WIND_MULT,
    speedPerLevel: SPEED_PER_LEVEL,
    boostPerLevel: BOOST_PER_LEVEL,
    energyPerLevel: ENERGY_PER_LEVEL,
  };
}

module.exports = {
  MAX_LEVEL,
  XP_PER_TRAIN,
  TRAIN_SESSIONS_PER_DAY,
  RACERS,
  RACE_XP,
  SPEED_PER_LEVEL,
  BOOST_PER_LEVEL,
  ENERGY_PER_LEVEL,
  BASE_BOOST_MULT,
  BOOST_DRAIN,
  ENERGY_REGEN,
  WIND_MS,
  WIND_MULT,
  TRACKS,
  xpToNext,
  levelProgress,
  speedMultiplier,
  boostMultiplier,
  energyCapacity,
  xpForPlace,
  trackFor,
  validateRace,
  snailView,
  readTraining,
  applyTraining,
  applyRace,
  rulesView,
};
