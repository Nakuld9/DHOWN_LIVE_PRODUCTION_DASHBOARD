// Finishing controller — HTTP req/res for /api/finishing*.
module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.list()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async saveQC(req, res) {
    try { res.json(await service.saveQC(req.params.receipt_id, req.body, req.user.username)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
});
