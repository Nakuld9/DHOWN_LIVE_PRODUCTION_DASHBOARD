// Analytics controller — HTTP req/res for OEE/utilization/analytics. 500 on error.
module.exports = (service) => ({
  async oee(req, res) {
    try { res.json(await service.oee({ date: req.query.date, shift: req.query.shift })); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
  async oeeMachine(req, res) {
    try { res.json(await service.oeeMachine(req.params.machineId, req.query.date)); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
  async utilization(req, res) {
    try { res.json(await service.utilization(req.query.date)); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
  async utilizationMachine(req, res) {
    try { res.json(await service.utilizationMachine(req.params.machineId, req.query.days)); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
  async analyticsShifts(req, res) {
    try { res.json(await service.analyticsShifts(req.query.date)); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
  async topDowntime(req, res) {
    try { res.json(await service.topDowntime(req.query.days)); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  },
});
