// Charts service — validation + hour clamping for the chart endpoints.
module.exports = (repo) => ({
  async trends({ machine_id, hours }) {
    if (!machine_id) return { badRequest: 'machine_id required' };
    const h = Math.min(Math.max(parseInt(hours) || 12, 1), 48);
    return { rows: (await repo.trends(machine_id, h)).rows };
  },

  async productionHourly({ date, machine_id }) {
    const today = new Date().toISOString().slice(0, 10);
    return { rows: (await repo.productionHourly({ date: date || today, machineId: machine_id })).rows };
  },
});
