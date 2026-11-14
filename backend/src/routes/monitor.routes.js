// System monitor — mounted at /api/monitor. Ops/health data is sensitive
// (paths, stacks, users), so it is SUPERVISOR+ to view (AUDITOR may read too);
// resolving errors is SUPERVISOR.
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

module.exports = ({ verifyToken, requireRole, monitor, errors, ci }) => {
  const router = express.Router();
  router.use(verifyToken);
  const READ = { also: ['AUDITOR'] };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); } };

  router.get('/status', requireRole('SUPERVISOR', READ), wrap(async (req, res) => res.json(await monitor.status())));

  router.get('/errors', requireRole('SUPERVISOR', READ), wrap(async (req, res) => {
    const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : null;
    res.json(await errors.list({ resolved, kind: req.query.kind || null, limit: req.query.limit }));
  }));
  router.get('/errors/:id', requireRole('SUPERVISOR', READ), wrap(async (req, res) => {
    const e = await errors.getOne(req.params.id);
    return e ? res.json(e) : res.status(404).json({ error: 'Not found' });
  }));
  router.post('/errors/:id/resolve', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    const out = await errors.resolve(req.params.id, req.user, req.body?.resolved !== false);
    return out.error ? res.status(out.code || 400).json({ error: out.error }) : res.json(out);
  }));

  // ── Local CI: run the full test suite on demand, and read results/history ──
  if (ci) {
    router.get('/ci', requireRole('SUPERVISOR', READ), wrap(async (req, res) =>
      res.json({ latest: await ci.latest(), running: await ci.running(), history: await ci.history(20) })));

    // Trigger a run: spawn the runner detached so the request returns immediately;
    // it records its own result to ci_runs. ADMIN only (it exercises the whole app).
    router.post('/ci/run', requireRole('ADMIN'), wrap(async (req, res) => {
      const inflight = await ci.running();
      if (inflight) return res.status(409).json({ error: `A CI run is already in progress (run ${inflight.run_id}).` });
      const script = path.resolve(__dirname, '..', '..', 'scripts', 'ci-run.js');
      const child = spawn(process.execPath, [script, '--trigger', 'manual'], {
        cwd: path.resolve(__dirname, '..', '..'), detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      res.status(202).json({ ok: true, message: 'CI run started — refresh in a minute for results.' });
    }));
  }

  return router;
};
