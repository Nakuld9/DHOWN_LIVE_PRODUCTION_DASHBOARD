// Busy-21 CSV sync controller — streams CSV downloads for /api/busy-sync/*.
function sendCsv(res, { filename, csv }) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

module.exports = (service) => ({
  async grnCsv(req, res) {
    try { sendCsv(res, await service.grnCsv({ from: req.query.from, to: req.query.to })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async dispatchCsv(req, res) {
    try { sendCsv(res, await service.dispatchCsv({ from: req.query.from, to: req.query.to })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
});
