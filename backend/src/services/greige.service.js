// Greige service — greige-warehouse views.
module.exports = (repo) => ({
  async list(filters) { return (await repo.list(filters)).rows; },
  async summary() {
    const [byFabric, totals] = await Promise.all([repo.summaryByFabric(), repo.summaryTotals()]);
    return { by_fabric: byFabric.rows, totals: totals.rows[0] };
  },
});
