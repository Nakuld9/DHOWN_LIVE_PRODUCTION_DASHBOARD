// Alerts controller — HTTP req/res for /api/alerts.
module.exports = (service) => ({
  async get(req, res) {
    try { res.json(await service.get()); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
