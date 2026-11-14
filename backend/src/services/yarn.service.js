// Yarn service — validation + realtime (io) emits for yarn store/issues/returns.
// SQL + transactions live in the repository; this layer keeps the same socket
// events and pre-checks the original inline handlers had.
module.exports = (repo, { io }) => ({
  // ── STORE ──
  async storeList(status) { const { rows } = await repo.storeList(status); return rows; },
  async storeSummary() { const { rows } = await repo.storeSummary(); return rows; },
  async storeLowStock(thresholdPct) {
    const threshold = parseFloat(thresholdPct || 20) / 100;
    const { rows } = await repo.storeLowStock(threshold);
    return rows;
  },
  async storeMovements(id) { const { rows } = await repo.storeMovements(id); return rows; },
  async storeSetLocation(id, location) { const { rows } = await repo.storeSetLocation(id, location); return rows[0]; },

  // ── ISSUES ──
  async issuesList(filters) { const { rows } = await repo.issuesList(filters); return rows; },

  async createIssue(body) {
    const { row, issue_id } = await repo.createIssue(body);
    io.emit('inventory:yarn_stock_update', { action: 'issued', issue_id });
    io.emit('inventory:dashboard_update', { type: 'yarn_issue' });
    return row;
  },

  async issueById(id) { return repo.issueById(id); },

  async returnAgainstIssue(id, returns) {
    await repo.returnAgainstIssue(id, returns);
    io.emit('inventory:yarn_stock_update', { action: 'returned' });
    return { success: true };
  },

  async deleteIssue(id) {
    const result = await repo.deleteIssue(id);
    if (result.ok) io.emit('inventory:yarn_stock_update', { action: 'issue_deleted' });
    return result;
  },

  async cancelIssue(id) {
    const result = await repo.cancelIssue(id);
    if (result.ok) io.emit('inventory:yarn_stock_update', { action: 'issue_cancelled' });
    return result;
  },

  async editIssue(id, body) { return repo.editIssue(id, body); },

  // ── RETURNS ──
  async returnsList() { const { rows } = await repo.returnsList(); return rows; },
  async returnById(id) { return repo.returnById(id); },

  async createReturn(body, username) {
    const { issue_id, returns } = body;
    if (!issue_id || !Array.isArray(returns) || !returns.filter(r => parseFloat(r.returned_kg) > 0).length)
      return { badRequest: 'issue_id and at least one return quantity required' };
    const result = await repo.createReturn(body, username);
    if (result.row) io.emit('inventory:yarn_stock_update', { action: 'returned' });
    return result;
  },
});
