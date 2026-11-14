// Error tracking — persists server errors so they can be queried, counted and
// resolved, instead of scrolling logs. Errors are GROUPED by a signature (kind +
// normalised path + message) so a recurring 500 is one row with an occurrence
// count and first/last-seen, not thousands of rows. Self-ensuring schema.

const crypto = require('crypto');

let ensured = false;

module.exports = (pool) => {
  async function ensure() {
    if (ensured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_errors (
        error_id     BIGSERIAL PRIMARY KEY,
        signature    TEXT UNIQUE NOT NULL,        -- groups identical errors
        kind         TEXT NOT NULL DEFAULT 'route', -- route | unhandledRejection | uncaughtException
        method       TEXT,
        path         TEXT,                          -- normalised (ids -> :id)
        status       INTEGER,
        message      TEXT,
        stack        TEXT,
        occurrences  INTEGER NOT NULL DEFAULT 1,
        last_user    TEXT,
        first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved     BOOLEAN NOT NULL DEFAULT false,
        resolved_by  TEXT,
        resolved_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_system_errors_last_seen ON system_errors(last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_system_errors_resolved ON system_errors(resolved);
    `);
    ensured = true;
  }

  // Collapse volatile path segments so /api/imports/15/costing groups with /.../16/...
  const normPath = (p) => String(p || '')
    .split('?')[0]
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:hash')
    .slice(0, 300);

  async function record({ kind = 'route', method = null, path = null, status = null, message = '', stack = null, user = null } = {}) {
    try {
      await ensure();
      const np = normPath(path);
      const msg = String(message || '').slice(0, 500);
      const sig = crypto.createHash('sha1').update(`${kind}|${np}|${msg}`).digest('hex').slice(0, 32);
      await pool.query(
        `INSERT INTO system_errors (signature, kind, method, path, status, message, stack, last_user)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (signature) DO UPDATE SET
           occurrences = system_errors.occurrences + 1,
           last_seen = NOW(), last_user = COALESCE(EXCLUDED.last_user, system_errors.last_user),
           status = COALESCE(EXCLUDED.status, system_errors.status),
           stack = COALESCE(EXCLUDED.stack, system_errors.stack),
           resolved = false, updated_at = NOW()`,   // a new occurrence re-opens it
        [sig, kind, method, np, status, msg, stack ? String(stack).slice(0, 4000) : null, user]);
    } catch { /* tracking must never throw into the request path */ }
  }

  async function list({ resolved = null, kind = null, limit = 100 } = {}) {
    await ensure();
    const where = []; const params = [];
    if (resolved === true || resolved === false) { params.push(resolved); where.push(`resolved = $${params.length}`); }
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    params.push(Math.min(Number(limit) || 100, 500));
    const sql = `SELECT error_id, signature, kind, method, path, status, message, occurrences, last_user,
                        first_seen, last_seen, resolved, resolved_by, resolved_at
                   FROM system_errors ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY resolved ASC, last_seen DESC LIMIT $${params.length}`;
    return (await pool.query(sql, params)).rows;
  }

  const getOne = async (id) => (await pool.query(`SELECT * FROM system_errors WHERE error_id=$1`, [id])).rows[0] || null;

  async function summary() {
    await ensure();
    const r = (await pool.query(`
      SELECT COUNT(*) FILTER (WHERE NOT resolved) AS open_groups,
             COALESCE(SUM(occurrences) FILTER (WHERE last_seen > NOW() - INTERVAL '24 hours'),0) AS last_24h,
             COALESCE(SUM(occurrences) FILTER (WHERE last_seen > NOW() - INTERVAL '1 hour'),0) AS last_1h,
             MAX(last_seen) FILTER (WHERE NOT resolved) AS most_recent
        FROM system_errors`)).rows[0];
    return { open_groups: Number(r.open_groups), last_24h: Number(r.last_24h), last_1h: Number(r.last_1h), most_recent: r.most_recent };
  }

  async function resolve(id, user, resolved = true) {
    await ensure();
    const r = await pool.query(
      `UPDATE system_errors SET resolved=$2, resolved_by=$3, resolved_at=CASE WHEN $2 THEN NOW() ELSE NULL END, updated_at=NOW()
       WHERE error_id=$1 RETURNING error_id`, [id, resolved, resolved ? (user?.username || null) : null]);
    return r.rows.length ? { ok: true } : { error: 'Not found', code: 404 };
  }

  // Housekeeping: drop resolved groups older than N days.
  async function prune(days = 30) {
    await ensure();
    const r = await pool.query(`DELETE FROM system_errors WHERE resolved AND resolved_at < NOW() - ($1 || ' days')::interval`, [String(days)]);
    return { pruned: r.rowCount };
  }

  return { ensure, record, list, getOne, summary, resolve, prune };
};
