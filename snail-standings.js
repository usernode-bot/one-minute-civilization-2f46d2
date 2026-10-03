// The snail standings: how many races each of the six snails has ever won,
// counted from derby_races, the one record of every race ever run. All-time
// and cross-player: every resolved race counts, whoever ran it.

// Wins per snail id, zero-filled for every id in `ids` (the Race Card's
// roster order) and sorted by wins descending, ties kept in roster order, so
// the board always shows all six snails and equal counts never swap around.
// `excludeId` keeps the staging demo derby out of the counts. A resolved row
// always has a winner (the schema's CHECK constraint), so no extra filter.
async function snailStandings(db, ids, excludeId) {
  const { rows } = await db.query(
    `SELECT winner_snail, COUNT(*)::int AS wins
       FROM derby_races
      WHERE resolved_at IS NOT NULL
        AND derby_id <> $1
      GROUP BY winner_snail`,
    [excludeId]
  );
  const wins = {};
  for (const r of rows) wins[r.winner_snail] = r.wins;
  return ids
    .map((id, i) => ({ id, i, wins: wins[id] || 0 }))
    .sort((a, b) => b.wins - a.wins || a.i - b.i)
    .map(s => ({ id: s.id, wins: s.wins }));
}

module.exports = { snailStandings };
