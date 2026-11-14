// Spare-parts controller — HTTP req/res for spare parts inventory.
module.exports = (service) => ({
  async list(req, res) {
    try {
      const rows = await service.list({ category: req.query.category, low: req.query.low });
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async get(req, res) {
    try {
      const result = await service.get(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Spare part not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.status(201).json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async update(req, res) {
    try {
      const result = await service.edit(req.params.id, req.body);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'Spare part not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.id);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'Spare part not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async movements(req, res) {
    try {
      const rows = await service.movements(req.params.id);
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async move(req, res) {
    try {
      const result = await service.move(req.params.id, req.body, req.user && req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'Spare part not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
