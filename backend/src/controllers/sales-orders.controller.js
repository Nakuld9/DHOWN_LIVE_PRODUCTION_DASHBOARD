// Sales Orders controller — HTTP req/res for /api/sales-orders.
function send(res, out) {
  if (out.notFound)   return res.status(404).json({ error: 'Sales order not found' });
  if (out.badRequest) return res.status(400).json({ error: out.badRequest });
  return res.json(out.row ?? out);
}

module.exports = (service) => ({
  async list(req, res) {
    try {
      const { status, from, to, limit, offset } = req.query;
      res.json(await service.list({ status, from, to, limit, offset }));
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
  async confirm(req, res)  { try { send(res, await service.transition(req.params.id, 'CONFIRMED')); }            catch (e) { res.status(500).json({ error: e.message }); } },
  async dispatch(req, res) { try { send(res, await service.transition(req.params.id, 'DISPATCHED')); }           catch (e) { res.status(500).json({ error: e.message }); } },
  async partial(req, res)  { try { send(res, await service.transition(req.params.id, 'PARTIALLY_DISPATCHED')); } catch (e) { res.status(500).json({ error: e.message }); } },
  async cancel(req, res)   { try { send(res, await service.transition(req.params.id, 'CANCELLED')); }            catch (e) { res.status(500).json({ error: e.message }); } },
  async updateHeader(req, res) { try { send(res, await service.updateHeader(req.params.id, req.body)); }          catch (e) { res.status(500).json({ error: e.message }); } },
  async remove(req, res)   { try { const out = await service.remove(req.params.id); if (out.notFound) return res.status(404).json({ error: 'Not found' }); if (out.badRequest) return res.status(400).json({ error: out.badRequest }); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } },
});
