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
// count. `excludeId` keeps the staging demo derby out of the sums.
async function nailTotals(db, keys, yesterdayId, excludeId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(nail_awarded), 0)::int AS lifetime,
            COALESCE(SUM(nail_awarded) FILTER (WHERE derby_id = $2), 0)::int
              AS yesterday
       FROM derby_races
      WHERE player_key = ANY($1) AND resolved_at IS NOT NULL
        AND derby_id <> $3`,
    [keys, yesterdayId, excludeId]
  );
  return {
    lifetimeTotal: rows[0].lifetime,
    yesterdayTotal: rows[0].yesterday,
  };
}

module.exports = { derbyIdFor, yesterdayDerbyId, nailTotals };
