// Work-orders controller — HTTP req/res for maintenance work orders.
module.exports = (service) => ({
  async list(req, res) {
    try {
      const rows = await service.list({ machine_id: req.query.machine_id, status: req.query.status });
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async get(req, res) {
    try {
      const result = await service.get(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Work order not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body, req.user && req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.status(201).json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async update(req, res) {
    try {
      const result = await service.edit(req.params.id, req.body);
      if (result.notFound) return res.status(404).json({ error: 'Work order not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async status(req, res) {
    try {
      const { status, downtime_hours, total_cost, resolution_notes, completed_by } = req.body;
      const result = await service.changeStatus(
        req.params.id, status,
        { downtime_hours, total_cost, resolution_notes, completed_by },
        req.user && req.user.username
      );
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'Work order not found' });
      res.json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Work order not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async partsUsed(req, res) {
    try {
      res.json(await service.partsUsed(req.params.id));
    } catch (err) { res.status(500).json({ error: err.message }); }
  },

  async usePart(req, res) {
    try {
      const result = await service.usePart(req.params.id, req.body, req.user && req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'Work order not found' });
      res.status(201).json(result.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
});
