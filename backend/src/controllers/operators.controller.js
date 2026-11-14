// Operators controller — HTTP req/res handling. Response shapes, status codes and
// error handling preserved verbatim from the original inline handlers in server.js.
module.exports = (service) => ({
  async list(req, res) {
    try {
      const includeInactive = req.query.include_inactive === 'true';
      const rows = await service.list(includeInactive);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load operators' });
    }
  },

  async create(req, res) {
    try {
      const row = await service.create(req.body);
      res.json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },

  async update(req, res) {
    try {
      const result = await service.edit(req.params.id, req.body);
      if (result.notFound) return res.status(404).json({ error: 'Operator not found' });
      res.json(result.row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },

  async remove(req, res) {
    try {
      const result = await service.deactivate(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Operator not found' });
      res.json({ success: true, message: 'Operator deactivated' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
});
