// Charts controller — HTTP req/res for /api/charts/*.
module.exports = (service) => ({
  async trends(req, res) {
    try {
      const result = await service.trends({ machine_id: req.query.machine_id, hours: req.query.hours });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
  async productionHourly(req, res) {
    try {
      const result = await service.productionHourly({ date: req.query.date, machine_id: req.query.machine_id });
      res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
