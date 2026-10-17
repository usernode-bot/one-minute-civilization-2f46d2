// The Snail Cage: per-player care (feed, clean) and cosmetics (name, shell,
// hat) for the six snails. Rows in cage_events are only ever INSERTed, never
// updated or deleted: the latest row per (snail, kind) is the current look,
// today's feed/clean rows are the cared-for state, and SUM(nail_spent) is
// everything used. Nothing here is read by the race code, so caring for a
// snail can never change a race.

const CARE_COSTS = { feed: 25, clean: 25 };
const SHELL_IDS = ['own', 'violet', 'amber', 'emerald', 'rose'];
const HAT_IDS = ['none', 'top_hat', 'crown', 'bow', 'cap', 'flower'];
const KINDS = ['name', 'shell', 'hat', 'feed', 'clean'];
const NICKNAME_MAX = 20;

// Letters, numbers, spaces and . ' - _, up to NICKNAME_MAX characters.
const NICKNAME_RE = new RegExp("^[\\p{L}\\p{N} '._-]{1," + NICKNAME_MAX + '}$', 'u');

// A nickname as typed: trimmed, runs of spaces collapsed. '' means "go back
// to the snail's real name" and returns null. Anything longer than
// NICKNAME_MAX, or holding characters outside the set above, throws — the
// route answers bad_value.
function cleanNickname(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (!NICKNAME_RE.test(s)) {
    const err = new Error('bad nickname');
    err.code = 'bad_value';
    throw err;
  }
  return s;
}

// A shell or hat choice must be one of the listed ids. Names go through
// cleanNickname instead; feed and clean take no value.
function validValue(kind, value) {
  if (kind === 'shell') return SHELL_IDS.includes(value);
  if (kind === 'hat') return HAT_IDS.includes(value);
  return false;
}

// The cage view for a player: what each snail looks like now, whether it
// was fed and cleaned since `todayStart`, and the $NAIL balance (everything
// ever earned in races minus everything used in the cage). `earned` is
// computed by the caller (totalsFor), so this module never reads races.
async function readCage(db, userId, snailIds, earned, todayStart) {
  const look = await db.query(
    `SELECT DISTINCT ON (snail_id, kind) snail_id, kind, value
       FROM cage_events
      WHERE user_id = $1 AND kind IN ('name', 'shell', 'hat')
      ORDER BY snail_id, kind, id DESC`,
    [userId]
  );
  const cared = await db.query(
    `SELECT snail_id, kind
       FROM cage_events
      WHERE user_id = $1 AND kind IN ('feed', 'clean')
        AND created_at >= $2::timestamptz
      GROUP BY snail_id, kind`,
    [userId, todayStart]
  );
  const spentRows = await db.query(
    `SELECT COALESCE(SUM(nail_spent), 0)::int AS spent
       FROM cage_events WHERE user_id = $1`,
    [userId]
  );

  const latest = {};
  for (const row of look.rows) latest[row.snail_id + ':' + row.kind] = row.value;
  const done = {};
  for (const row of cared.rows) done[row.snail_id + ':' + row.kind] = true;

  const spent = spentRows.rows[0].spent;
  return {
    spent,
    balance: earned - spent,
    snails: snailIds.map(id => ({
      id,
      nickname: latest[id + ':name'] || null,
      shell: latest[id + ':shell'] || 'own',
      hat: latest[id + ':hat'] || 'none',
      fedToday: !!done[id + ':feed'],
      cleanToday: !!done[id + ':clean'],
    })),
  };
}

// One cage action, inside the caller's transaction. Takes the player's
// advisory lock first, so two tabs cannot both feed or overspend, then
// re-reads the spent total inside the lock, checks, and inserts one row.
// Returns { error: 'not_enough' | 'already_done' }, or {} when the row was
// written (or was needless because the value did not change). Earned only
// grows — races are never deleted — so the balance can never go negative.
async function applyCage(client, userId, snailId, kind, value, earned, todayStart) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('cage:' || $1))`,
    [userId]
  );
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(nail_spent), 0)::int AS spent
       FROM cage_events WHERE user_id = $1`,
    [userId]
  );
  const spent = rows[0].spent;
  const cost = CARE_COSTS[kind] || 0;
  if (earned - spent < cost) return { error: 'not_enough' };

  if (kind === 'feed' || kind === 'clean') {
    const done = await client.query(
      `SELECT 1 FROM cage_events
        WHERE user_id = $1 AND snail_id = $2 AND kind = $3
          AND created_at >= $4::timestamptz
        LIMIT 1`,
      [userId, snailId, kind, todayStart]
    );
    if (done.rows.length) return { error: 'already_done' };
  } else {
    // A style write that changes nothing writes no row: the latest row is
    // already the value being asked for.
    const cur = await client.query(
      `SELECT value FROM cage_events
        WHERE user_id = $1 AND snail_id = $2 AND kind = $3
        ORDER BY id DESC LIMIT 1`,
      [userId, snailId, kind]
    );
    const defaults = { shell: 'own', hat: 'none', name: null };
    const current = cur.rows.length ? cur.rows[0].value : defaults[kind];
    const next = value == null ? null : value;
    if (current === next) return {};
  }

  await client.query(
    `INSERT INTO cage_events (user_id, snail_id, kind, value, nail_spent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, snailId, kind, kind === 'feed' || kind === 'clean' ? null : value, cost]
  );
  return {};
}

module.exports = {
  CARE_COSTS,
  SHELL_IDS,
  HAT_IDS,
  KINDS,
  NICKNAME_MAX,
  cleanNickname,
  validValue,
  readCage,
  applyCage,
};
