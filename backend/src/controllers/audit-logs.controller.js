// Audit-logs controller — HTTP req/res for /api/audit-logs.
module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.list({ page: req.query.page, limit: req.query.limit, module: req.query.module })); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
