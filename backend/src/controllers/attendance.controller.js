// Attendance controller — HTTP req/res for /api/attendance*.
module.exports = (service) => ({
  async list(req, res) {
    try { res.json(await service.list({ date: req.query.date, shift: req.query.shift })); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async summary(req, res) {
    try { res.json(await service.summary({ from: req.query.from, to: req.query.to })); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async markPresent(req, res) {
    try {
      const out = await service.markPresent(req.body || {});
      if (out.error) return res.status(400).json(out);
      res.status(201).json(out.row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  },
  async remove(req, res) {
    try { res.json(await service.remove(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
});
