// Payroll controller — HTTP req/res for /api/payroll.
function send(res, out) {
  if (out.notFound)   return res.status(404).json({ error: 'Payroll run not found' });
  if (out.badRequest) return res.status(400).json({ error: out.badRequest });
  return res.json(out.row ?? out);
}

module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.listRuns()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async get(req, res) {
    try { send(res, await service.getRun(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async create(req, res) {
    try {
      const body = { ...req.body, created_by: req.user?.username || req.body.created_by || null };
      const out = await service.createRun(body);
      if (out.badRequest) return res.status(400).json({ error: out.badRequest });
      res.status(201).json(out.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async updateItem(req, res) {
    try { send(res, await service.updateItem(req.params.id, req.params.itemId, req.body)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async finalize(req, res) { try { send(res, await service.transition(req.params.id, 'FINALIZED')); } catch (e) { res.status(500).json({ error: e.message }); } },
  async pay(req, res)      { try { send(res, await service.transition(req.params.id, 'PAID')); }       catch (e) { res.status(500).json({ error: e.message }); } },
  async reopen(req, res)   { try { send(res, await service.transition(req.params.id, 'DRAFT')); }      catch (e) { res.status(500).json({ error: e.message }); } },
  async cancel(req, res)   { try { send(res, await service.transition(req.params.id, 'CANCELLED')); }  catch (e) { res.status(500).json({ error: e.message }); } },
  async remove(req, res)   { try { const out = await service.removeRun(req.params.id); if (out.notFound) return res.status(404).json({ error: 'Not found' }); if (out.badRequest) return res.status(400).json({ error: out.badRequest }); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } },
});
