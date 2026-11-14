// Alerts service — assembles the alerts payload (low-stock parts best-effort).
module.exports = (repo) => ({
  async get() {
    const [stoppedMachines, openDowntime, activeAssignments] = await Promise.all([
      repo.stoppedMachines(),
      repo.openDowntime(),
      repo.activeAssignments(),
    ]);
    let lowStockParts = [];
    try { lowStockParts = (await repo.lowStockParts()).rows; }
    catch (_) { /* spare_parts table may not exist on first boot */ }
    return {
      stoppedMachines: stoppedMachines.rows,
      openDowntime: openDowntime.rows,
      activeAssignments: activeAssignments.rows,
      lowStockParts,
    };
  },
});
