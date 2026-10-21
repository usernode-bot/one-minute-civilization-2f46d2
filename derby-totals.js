// A player's $NAIL totals across days, read from derby_races, the one record
// of every race ever run. Rows there are never deleted, so a sum over them
// cannot lose a past day the way a separately kept counter can.

// The derby id for a UTC date: 'daily-YYYY-MM-DD'.
function derbyIdFor(d) {
  return 'daily-' + d.toISOString().slice(0, 10);
}

// Yesterday's derby id, one UTC day before `now`.
function yesterdayDerbyId(now) {
  return derbyIdFor(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

// Every $NAIL the player has earned (lifetimeTotal) and what they earned in
// yesterday's derby (yesterdayTotal). `keys` lists every player key the
// player may have raced under, so races run before a wallet was linked still
// count, and `userId` (the platform user id) also finds races stamped with
// it under a wallet the player no longer has linked. `excludeId` keeps the
// staging demo derby out of the sums.
async function nailTotals(db, keys, userId, yesterdayId, excludeId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(nail_awarded), 0)::int AS lifetime,
            COALESCE(SUM(nail_awarded) FILTER (WHERE derby_id = $2), 0)::int
              AS yesterday
       FROM derby_races
      WHERE (player_key = ANY($1) OR user_id = $4)
        AND resolved_at IS NOT NULL AND derby_id <> $3`,
    [keys, yesterdayId, excludeId, userId]
  );
  return {
    lifetimeTotal: rows[0].lifetime,
    yesterdayTotal: rows[0].yesterday,
  };
}

// The player's finished races on the derby days from `sinceId` (inclusive)
// up to `beforeId` (exclusive), newest day first. The player filter is the
// same as nailTotals, `excludeId` keeps the staging demo derby out, and
// unresolved races have no result to show, so they are left out.
async function raceHistory(db, keys, userId, sinceId, beforeId, excludeId) {
  const { rows } = await db.query(
    `SELECT derby_id, race_number, picked_snail, winner_snail, nail_awarded
       FROM derby_races
      WHERE (player_key = ANY($1) OR user_id = $2)
        AND resolved_at IS NOT NULL
        AND derby_id <> $5
        AND derby_id >= $3 AND derby_id < $4
      ORDER BY derby_id DESC, race_number ASC, resolved_at ASC`,
    [keys, userId, sinceId, beforeId, excludeId]
  );
  return groupHistory(rows);
}

// Rows to [{ derbyId, date, total, races: [{ raceNumber, pick, winner, won,
// nail }] }], newest day first. Pure, so the grouping is tested without a
// database. A race is a win when the pick is the winner. One player can have
// the same race number twice on a day (once before linking a wallet, once
// after), so both rows are kept in race-number order, matching nailTotals,
// which counts both.
function groupHistory(rows) {
  const days = [];
  const byId = new Map();
  for (const r of rows) {
    let day = byId.get(r.derby_id);
    if (!day) {
      day = {
        derbyId: r.derby_id,
        date: r.derby_id.replace(/^daily-/, ''),
        total: 0,
        races: [],
      };
      byId.set(r.derby_id, day);
      days.push(day);
    }
    const nail = r.nail_awarded || 0;
    day.total += nail;
    day.races.push({
      raceNumber: r.race_number,
      pick: r.picked_snail,
      winner: r.winner_snail,
      won: r.picked_snail === r.winner_snail,
      nail,
    });
  }
  days.sort((a, b) => (a.derbyId < b.derbyId ? 1 : a.derbyId > b.derbyId ? -1 : 0));
  for (const day of days) day.races.sort((a, b) => a.raceNumber - b.raceNumber);
  return days;
}

// Stamps the platform user id on every race stored under the player's
// current keys that has none yet, so those races stay theirs after the
// wallet changes. Rows already stamped are left alone.
function claimRaces(db, keys, userId) {
  return db.query(
    `UPDATE derby_races SET user_id = $2
      WHERE player_key = ANY($1) AND user_id IS NULL`,
    [keys, userId]
  );
}

module.exports = {
  derbyIdFor,
  yesterdayDerbyId,
  nailTotals,
  raceHistory,
  groupHistory,
  claimRaces,
};
