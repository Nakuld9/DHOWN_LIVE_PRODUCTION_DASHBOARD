// Inventory-views controller — HTTP for warehouse/inventory/QR/work-center.
module.exports = (service) => ({
  async warehouseOverview(req, res) {
    try { res.json(await service.warehouseOverview()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  },
  async inventoryDashboard(req, res) {
    try { res.json(await service.inventoryDashboard()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async qrLookup(req, res) {
    try {
      const result = await service.qrLookup(req.params.code);
      if (result.notFound) return res.status(404).json({ error: 'Unknown QR code' });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async workCenterStock(req, res) {
    try { res.json(await service.workCenterStock()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
});
