// Knitting-structures controller — HTTP req/res.
module.exports = (service) => ({
  async list(req, res) {
    try {
      res.json(await service.list({ machine_type: req.query.machine_type, fabric_code: req.query.fabric_code, favourite: req.query.favourite }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async get(req, res) {
    try {
      const r = await service.get(req.params.id);
      if (r.notFound) return res.status(404).json({ error: 'Structure not found' });
      res.json(r.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async create(req, res) {
    try {
      const r = await service.create(req.body);
      if (r.badRequest) return res.status(400).json({ error: r.badRequest });
      res.status(201).json(r.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async update(req, res) {
    try {
      const r = await service.edit(req.params.id, req.body);
      if (r.badRequest) return res.status(400).json({ error: r.badRequest });
      if (r.notFound) return res.status(404).json({ error: 'Structure not found' });
      res.json(r.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async favourite(req, res) {
    try {
      const r = await service.favourite(req.params.id, req.body.is_favourite);
      if (r.notFound) return res.status(404).json({ error: 'Structure not found' });
      res.json(r.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async remove(req, res) {
    try {
      const r = await service.remove(req.params.id);
      if (r.notFound) return res.status(404).json({ error: 'Structure not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
