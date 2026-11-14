// Maintenance-records controller — HTTP req/res. Preserves original response shapes.
module.exports = (service) => ({
  async list(req, res) {
    try {
      res.json(await service.list());
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body);
      res.json(result.row);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async update(req, res) {
    try {
      const result = await service.edit(req.params.id, req.body);
      if (result.notFound) return res.status(404).json({ error: 'Record not found' });
      res.json(result.row);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Record not found' });
      res.json({ success: true, message: 'Record deleted' });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
