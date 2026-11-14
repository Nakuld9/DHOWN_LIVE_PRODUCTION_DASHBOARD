// GRN controller — HTTP req/res. Preserves original response shapes:
// list → {data,total}; create/get/addLot/approve/updateHeader → row;
// removeLot → {ok:true}; remove → {success:true}; cancel → {success:true}.
module.exports = (service) => ({
  async list(req, res) {
    try {
      res.json(await service.list(req.query));
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body);
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async get(req, res) {
    try {
      const result = await service.get(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'GRN not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async addLot(req, res) {
    try {
      const result = await service.addLot(req.params.id, req.body);
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async removeLot(req, res) {
    try {
      const result = await service.removeLot(req.params.id, req.params.lotId);
      if (result.notFound) return res.status(404).json({ error: 'GRN not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async approve(req, res) {
    try {
      const result = await service.approve(req.params.id, req.user && req.user.username);
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'GRN not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async cancel(req, res) {
    try {
      const result = await service.cancel(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'GRN not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async updateHeader(req, res) {
    try {
      const result = await service.updateHeader(req.params.id, req.body);
      if (result.notFound) return res.status(404).json({ error: 'GRN not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
