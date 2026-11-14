// Active-operators controller — HTTP req/res for /api/active-operators.
module.exports = (service) => ({
  async get(req, res) {
    try { res.json(await service.list()); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
