// Greige controller — HTTP req/res for /api/greige*.
module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.list({ fabric_type: req.query.fabric_type, machine_id: req.query.machine_id })); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async summary(req, res) {
    try { res.json(await service.summary()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
});
