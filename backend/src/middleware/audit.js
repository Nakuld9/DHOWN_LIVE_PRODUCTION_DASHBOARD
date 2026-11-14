// Global audit middleware — safety-net log of every mutating API request.
// Domain-specific audit_logs writes (CREATE_DISPATCH, COMPLETE_MAINTENANCE_TASK, …)
// stay as-is and are richer; this catches everything else, so "who deleted that lot"
// is always answerable. Entries are distinguishable by the "HTTP " action prefix.
//
// Skipped: non-/api paths, GETs, and the high-frequency DC ingest (/api/live-data
// fires every ~10s per machine and would flood the table).

const SKIP_PATHS = ['/api/live-data'];
const SENSITIVE_KEYS = ['password', 'new_password', 'old_password', 'token', 'api_key', 'pin'];

function sanitize(body) {
  if (!body || typeof body !== 'object') return null;
  try {
    const clean = {};
    for (const [key, val] of Object.entries(body)) {
      clean[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '***' : val;
    }
    const s = JSON.stringify(clean);
    return s.length > 800 ? s.slice(0, 800) + '…' : s;
  } catch { return null; }
}

module.exports = (pool) => (req, res, next) => {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  if (!req.path.startsWith('/api') || SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

  res.on('finish', () => {
    // req.user is populated by verifyToken by the time the response finishes.
    const username = (req.user && req.user.username) || 'anonymous';
    const module_ = (req.path.split('/')[2] || 'api').toUpperCase();
    const action = `HTTP ${req.method} ${req.path} → ${res.statusCode}`;
    pool.query(
      `INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,$3,$4)`,
      [username, action.slice(0, 100), module_.slice(0, 50), sanitize(req.body)]
    ).catch(() => { /* auditing must never break a request */ });
  });

  next();
};
