// Command-center controller — HTTP req/res for /api/command-center.
module.exports = (service) => ({
  async get(req, res) {
    try { res.json(await service.get()); }
    catch (err) { console.error('command-center error:', err); res.status(500).json({ error: err.message }); }
  },
});
