// Fabric-types controller — HTTP req/res. Status codes, messages and error handling
// preserved verbatim from the original inline handlers in server.js.
module.exports = (service) => ({
  async list(req, res) {
    try {
      res.json(await service.list());
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body);
      if (result.badRequest) return res.status(400).json({ error: 'code and name are required' });
      res.json(result.row);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: `Code "${req.body.code}" already exists` });
      res.status(500).json({ error: err.message });
    }
  },

  async update(req, res) {
    try {
      const result = await service.edit(req.params.code, req.body);
      if (result.notFound) return res.status(404).json({ error: 'Fabric type not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.code);
      if (result.inUse) return res.status(409).json({ error: 'Cannot delete - fabric is assigned to one or more machines' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
