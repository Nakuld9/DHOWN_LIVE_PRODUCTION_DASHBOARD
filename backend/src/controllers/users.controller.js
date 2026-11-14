// Users controller — HTTP req/res for /api/users/*. Status codes verbatim.
module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.list()); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async create(req, res) {
    try {
      const result = await service.create(req.body, req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json(result.row);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async update(req, res) {
    try {
      const result = await service.update(req.params.id, req.body, req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'User not found' });
      res.json(result.row);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async remove(req, res) {
    try {
      const result = await service.remove(req.params.id, req.user.username);
      if (result.notFound) return res.status(404).json({ error: 'User not found' });
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async setPin(req, res) {
    try {
      const result = await service.setPin(req.params.id, req.body.pin);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'User not found' });
      res.json({ success: true, user: result.user });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async clearPin(req, res) {
    try {
      await service.clearPin(req.params.id);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
