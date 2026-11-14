// Shift-handovers controller — HTTP req/res for /api/shift-handovers.
module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.list(req.query.limit)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async create(req, res) {
    try {
      const result = await service.create(req.body, req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
