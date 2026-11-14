const { friendly } = require('../lib/db-errors');
// Tax Invoices controller — HTTP req/res for /api/tax-invoices.
function send(res, out) {
  if (out.notFound)   return res.status(404).json({ error: 'Invoice not found' });
  if (out.badRequest) return res.status(400).json({ error: out.badRequest });
  return res.json(out.row ?? out);
}

module.exports = (service) => ({
  async list(req, res) {
    try {
      const { status, from, to } = req.query;
      res.json(await service.list({ status, from, to }));
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
  async issue(req, res)  { try { send(res, await service.transition(req.params.id, 'ISSUED')); }    catch (e) { const f = friendly(e); if (f) return res.status(f.status).json({ error: f.error }); res.status(500).json({ error: e.message }); } },
  async pay(req, res)    { try { send(res, await service.transition(req.params.id, 'PAID')); }      catch (e) { const f = friendly(e); if (f) return res.status(f.status).json({ error: f.error }); res.status(500).json({ error: e.message }); } },
  async cancel(req, res) { try { send(res, await service.transition(req.params.id, 'CANCELLED')); } catch (e) { const f = friendly(e); if (f) return res.status(f.status).json({ error: f.error }); res.status(500).json({ error: e.message }); } },
  async remove(req, res) { try { const out = await service.remove(req.params.id); if (out.notFound) return res.status(404).json({ error: 'Not found' }); if (out.badRequest) return res.status(400).json({ error: out.badRequest }); res.json(out); } catch (e) { const f = friendly(e); if (f) return res.status(f.status).json({ error: f.error }); res.status(500).json({ error: e.message }); } },
});
