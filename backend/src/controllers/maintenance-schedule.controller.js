// Maintenance-schedule controller — HTTP req/res. Preserves original response shapes.
module.exports = (service) => ({
  async list(req, res) {
    try {
      res.json(await service.list());
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async complete(req, res) {
    try {
      const result = await service.complete(req.params.id, req.body, req.user.username);
      if (result.notFound) return res.status(404).json({ error: 'Schedule not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      await service.remove(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
