// Inventory-views service — assembles warehouse/inventory/QR/work-center views.
module.exports = (repo) => ({
  async warehouseOverview() {
    const [yarnStore, greige, inBatch, sentOut, finishedStock, dispatched, overdue] = await repo.warehouseOverview();
    return {
      yarn_store:      yarnStore.rows[0],
      greige:          greige.rows[0],
      in_batch:        inBatch.rows[0],
      sent_out:        sentOut.rows[0],
      finished_stock:  finishedStock.rows[0],
      dispatched:      dispatched.rows[0],
      overdue_challans: parseInt(overdue.rows[0].count),
    };
  },

  async inventoryDashboard() {
    const [yarnStock, grnPending, issueActive, greige, batches, finished, dispatched] = await repo.inventoryDashboard();
    return {
      yarn_store:    { lots: yarnStock.rows[0].lots, stock_kg: yarnStock.rows[0].kg },
      grn_pending:   parseInt(grnPending.rows[0].count),
      active_issues: parseInt(issueActive.rows[0].count),
      greige:        { rolls: greige.rows[0].rolls, kg: greige.rows[0].kg },
      batches:       { open: batches.rows[0].open, sealed: batches.rows[0].sealed },
      finished:      { lots: finished.rows[0].lots, kg: finished.rows[0].kg },
      dispatched_30d: parseInt(dispatched.rows[0].count),
    };
  },

  async qrLookup(code) {
    if (code.startsWith('GRN:')) {
      const r = await repo.grnByNumber(code.replace('GRN:', ''));
      return { row: { type: 'grn', data: r.rows[0] } };
    }
    if (code.startsWith('YARN:')) {
      const r = await repo.yarnLotByNumber(code.replace('YARN:', ''));
      return { row: { type: 'yarn_lot', data: r.rows[0] } };
    }
    return { notFound: true };
  },

  async workCenterStock() {
    return (await repo.workCenterStock()).rows;
  },
});
