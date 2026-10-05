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

module.exports = { derbyIdFor, yesterdayDerbyId, nailTotals, claimRaces };
