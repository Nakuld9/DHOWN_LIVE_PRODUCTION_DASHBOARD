const { friendly } = require('../lib/db-errors');
// Dispatch controller — HTTP req/res. Preserves original response shapes:
// list → rows[]; get → {challan, items[]}; create → challan row; delete → {ok:true}.
module.exports = (service) => ({
  async list(req, res) {
    try {
      const { from, to, dispatch_type } = req.query;
      res.json(await service.list({ from, to, dispatch_type }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async get(req, res) {
    try {
      const result = await service.get(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Dispatch not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body, req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async jobworkReturn(req, res) {
    try {
      const result = await service.jobworkReturn(req.params.id, req.body, req.user.username);
      if (result.notFound) return res.status(404).json({ error: 'Dispatch not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
