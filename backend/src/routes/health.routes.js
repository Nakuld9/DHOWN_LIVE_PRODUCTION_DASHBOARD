// Health and metrics. /live and /ready follow the usual container contract:
// live = the process is up, ready = it can actually serve traffic.
//
// /metrics and /deps are NOT public: dependency detail and error strings tell an
// attacker what you run and what is currently broken.
const express = require('express');
const https = require('https');
const obs = require('../lib/observability');

module.exports = ({ pool, verifyToken, requireRole, jobLock }) => {
  const router = express.Router();
  const startedAt = Date.now();

  // Base health ping (GET /api/health) — a simple "server is up" for uptime checks.
  router.get('/', (req, res) => res.json({ status: 'up', uptime_s: Math.round((Date.now() - startedAt) / 1000) }));

  // Liveness: no dependencies, never fails while the process runs.
  router.get('/live', (req, res) => res.json({ status: 'up', uptime_s: Math.round((Date.now() - startedAt) / 1000) }));

  // Readiness: the database must actually answer.
  router.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (e) {
      res.status(503).json({ status: 'not-ready', reason: 'database unavailable' });
    }
  });

  function reach(hostname, path = '/') {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const req = https.request({ hostname, path, method: 'GET', timeout: 5000 }, (r) => {
        r.resume();
        resolve({ ok: true, status: r.statusCode, ms: Date.now() - t0 });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    });
  }

  // Full dependency view — what the operator actually needs when something breaks.
  router.get('/deps', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const out = { checked_at: new Date().toISOString() };
    try { await pool.query('SELECT 1'); out.database = { ok: true }; }
    catch (e) { out.database = { ok: false, error: e.message }; }

    const [meta, nvidia, groq] = await Promise.all([
      reach('graph.facebook.com'),
      process.env.NVIDIA_API_KEY ? reach('integrate.api.nvidia.com') : Promise.resolve({ ok: null, error: 'not configured' }),
      process.env.GROQ_API_KEY ? reach('api.groq.com') : Promise.resolve({ ok: null, error: 'not configured' }),
    ]);
    out.whatsapp_api = meta;
    out.nvidia = nvidia;
    out.groq = groq;

    out.whatsapp_configured = Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
    out.vision_configured = Boolean(process.env.NVIDIA_API_KEY || process.env.GROQ_API_KEY);
    out.ai_providers = obs.providerHealth();
    res.json(out);
  });

  // Prometheus scrape. Internal only — see note above.
  router.get('/metrics', verifyToken, requireRole('SUPERVISOR'), (req, res) => {
    res.type('text/plain').send(obs.render());
  });

  // Same numbers as JSON, for the health screen.
  router.get('/stats', verifyToken, requireRole('SUPERVISOR'), (req, res) => {
    res.json({ uptime_s: Math.round((Date.now() - startedAt) / 1000), ...obs.snapshot(), providers: obs.providerHealth() });
  });

  // Scheduled job leases (CRIT-06) — who holds what, and when each last ran.
  router.get('/jobs', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try { res.json({ instance: jobLock?.INSTANCE, jobs: jobLock ? await jobLock.status() : [] }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Credential expiry (CRIT-08). Reports which secrets are CONFIGURED and when
  // they expire — never the values themselves.
  router.get('/credentials', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
      const tracked = (await pool.query(`SELECT * FROM integration_credentials ORDER BY provider`)).rows;
      const byProvider = Object.fromEntries(tracked.map(r => [r.provider, r]));
      const known = [
        { provider: 'whatsapp',  env_var: 'WHATSAPP_TOKEN' },
        { provider: 'nvidia',    env_var: 'NVIDIA_API_KEY' },
        { provider: 'groq',      env_var: 'GROQ_API_KEY' },
        { provider: 'jwt',       env_var: 'JWT_SECRET' },
        { provider: 'dc_ingest', env_var: 'DC_API_KEY' },
      ];
      res.json(known.map(k => {
        const t = byProvider[k.provider] || {};
        const configured = Boolean(process.env[k.env_var]);
        const expires = t.expires_at || (k.provider === 'whatsapp' ? process.env.WHATSAPP_TOKEN_EXPIRES_AT : null);
        const days = expires ? Math.floor((new Date(expires) - Date.now()) / 86400000) : null;
        return {
          provider: k.provider, env_var: k.env_var, configured,
          expires_at: expires || null, days_left: days,
          rotated_at: t.rotated_at || null, rotated_by: t.rotated_by || null,
          status: !configured ? 'not-configured'
                : days === null ? 'no-expiry-recorded'
                : days <= 0 ? 'EXPIRED' : days <= 7 ? 'expiring-soon' : 'ok',
        };
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Record an expiry / rotation. Values never touch this endpoint.
  router.post('/credentials/:provider', verifyToken, requireRole('ADMIN'), async (req, res) => {
    const b = req.body || {};
    if (b.value || b.token || b.secret) {
      return res.status(400).json({ error: 'Do not send secret values here — record expiry and rotation only.' });
    }
    try {
      const r = await pool.query(
        `INSERT INTO integration_credentials (provider, env_var, label, expires_at, rotated_at, rotated_by, notes, updated_at)
         VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END,$6,$7,NOW())
         ON CONFLICT (provider) DO UPDATE SET
           env_var=EXCLUDED.env_var, label=EXCLUDED.label,
           expires_at=COALESCE(EXCLUDED.expires_at, integration_credentials.expires_at),
           rotated_at=CASE WHEN $5 THEN NOW() ELSE integration_credentials.rotated_at END,
           rotated_by=CASE WHEN $5 THEN EXCLUDED.rotated_by ELSE integration_credentials.rotated_by END,
           notes=EXCLUDED.notes, updated_at=NOW()
         RETURNING *`,
        [req.params.provider, b.env_var || null, b.label || null, b.expires_at || null,
         !!b.rotated, req.user?.username || null, b.notes || null]);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
