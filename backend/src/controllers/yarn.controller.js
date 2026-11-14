// Yarn controller — HTTP req/res for yarn store/issues/returns.
// Status codes match the original inline handlers exactly.
module.exports = (service) => ({
  // ── STORE ──
  async storeList(req, res) {
    try { res.json(await service.storeList(req.query.status)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async storeSummary(req, res) {
    try { res.json(await service.storeSummary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async storeLowStock(req, res) {
    try { res.json(await service.storeLowStock(req.query.threshold_pct)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async storeMovements(req, res) {
    try { res.json(await service.storeMovements(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async storeSetLocation(req, res) {
    try { res.json(await service.storeSetLocation(req.params.id, req.body.location)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ── ISSUES ──
  async issuesList(req, res) {
    try { res.json(await service.issuesList({ status: req.query.status, machine_id: req.query.machine_id })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async createIssue(req, res) {
    try { res.json(await service.createIssue(req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  },
  async issueById(req, res) {
    try {
      const result = await service.issueById(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Not found' });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async returnAgainstIssue(req, res) {
    try { res.json(await service.returnAgainstIssue(req.params.id, req.body.returns)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  },
  async deleteIssue(req, res) {
    try {
      const result = await service.deleteIssue(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async cancelIssue(req, res) {
    try {
      const result = await service.cancelIssue(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async editIssue(req, res) {
    try {
      const result = await service.editIssue(req.params.id, req.body);
      if (result.notFound) return res.status(404).json({ error: 'Not found' });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // ── RETURNS ──
  async returnsList(req, res) {
    try { res.json(await service.returnsList()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },
  async returnById(req, res) {
    try {
      const result = await service.returnById(req.params.id);
      if (result.notFound) return res.status(404).json({ error: 'Return not found' });
      res.json(result.row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  async createReturn(req, res) {
    try {
      const result = await service.createReturn(req.body, req.user.username);
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.notFound) return res.status(404).json({ error: 'Issue not found' });
      res.json(result.row);
    } catch (e) { res.status(400).json({ error: e.message }); }
  },
});
