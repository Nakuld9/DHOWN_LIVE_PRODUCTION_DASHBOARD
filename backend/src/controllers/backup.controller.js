// Backup controller — HTTP req/res for /api/backup + /api/admin/backup(s).
module.exports = (service) => ({
  async create(req, res) {
    try {
      const { filename, path } = await service.createDump();
      res.json({ success: true, filename, path });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },

  async triggerDaily(req, res) {
    try { res.json(await service.triggerDaily()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },

  async listBackups(req, res) {
    try { res.json(service.listBackups()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
});
