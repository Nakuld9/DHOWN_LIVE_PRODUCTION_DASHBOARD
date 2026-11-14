// Costing controller — HTTP req/res for /api/costing/*. Status codes verbatim.
module.exports = (service) => ({
  async knittingVariance(req, res) {
    try { res.json(await service.knittingVariance({ from: req.query.from, to: req.query.to })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async bomVariance(req, res) {
    try { res.json(await service.bomVariance({ from: req.query.from, to: req.query.to })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async rates(req, res) {
    try { res.json(await service.rates()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async upsertRate(req, res) {
    try { res.json(await service.upsertRate(req.body, req.user.username)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async rollCost(req, res) {
    try {
      const result = await service.rollCost(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Roll not found' });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async batchCost(req, res) {
    try {
      const result = await service.batchCost(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Batch not found' });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async summary(req, res) {
    try { res.json(await service.summary({ from: req.query.from, to: req.query.to })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async fgCost(req, res) {
    try {
      const result = await service.fgCost(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'FG lot not found' });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async ask(req, res) {
    try {
      const result = await service.ask(req.body.question);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
});
