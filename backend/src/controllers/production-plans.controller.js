// Production Plans controller — HTTP req/res for /api/production-plans.
function send(res, out) {
  if (out.notFound)   return res.status(404).json({ error: 'Production plan not found' });
  if (out.badRequest) return res.status(400).json({ error: out.badRequest });
  return res.json(out.row ?? out);
}

module.exports = (service) => ({
  async list(req, res) {
    try {
      const { status, machine_id, plan_type, from, to } = req.query;
      res.json(await service.list({ status, machine_id, plan_type, from, to }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async get(req, res) {
    try { send(res, await service.get(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async create(req, res) {
    try {
      const body = { ...req.body, created_by: req.user?.username || req.body.created_by || null };
      const out = await service.create(body);
      if (out.badRequest) return res.status(400).json({ error: out.badRequest });
      res.status(201).json(out.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async update(req, res)   { try { send(res, await service.update(req.params.id, req.body)); }                     catch (e) { res.status(500).json({ error: e.message }); } },
  async start(req, res)    { try { send(res, await service.transition(req.params.id, 'IN_PROGRESS')); }            catch (e) { res.status(500).json({ error: e.message }); } },
  async complete(req, res) { try { send(res, await service.transition(req.params.id, 'COMPLETED')); }              catch (e) { res.status(500).json({ error: e.message }); } },
  async hold(req, res)     { try { send(res, await service.transition(req.params.id, 'ON_HOLD')); }                catch (e) { res.status(500).json({ error: e.message }); } },
  async cancel(req, res)   { try { send(res, await service.transition(req.params.id, 'CANCELLED')); }              catch (e) { res.status(500).json({ error: e.message }); } },
  async progress(req, res) { try { send(res, await service.setProgress(req.params.id, req.body.produced_qty_kg)); } catch (e) { res.status(500).json({ error: e.message }); } },
  async remove(req, res)   { try { const out = await service.remove(req.params.id); if (out.notFound) return res.status(404).json({ error: 'Not found' }); if (out.badRequest) return res.status(400).json({ error: out.badRequest }); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } },
});
