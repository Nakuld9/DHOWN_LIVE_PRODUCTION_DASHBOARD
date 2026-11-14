// Analytics service — OEE/utilization/shift computations. Post-processing kept
// verbatim from the original inline handlers. Shift helpers injected from server.
module.exports = (repo, { getShiftSettings, detectCurrentShift }) => ({
  async oee({ date, shift }) {
    const day = date || new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const sh = shift || detectCurrentShift(shiftSettings);
    const r = await repo.oeeByDateShift(day, sh);
    const avg = r.rows.length > 0 ? Math.round(r.rows.reduce((s, x) => s + parseFloat(x.oee || 0), 0) / r.rows.length * 100) / 100 : 0;
    return { date: day, shift: sh, records: r.rows, avg_oee: avg };
  },

  async oeeMachine(machineId, date) {
    const day = date || new Date().toISOString().slice(0, 10);
    const [todayR, histR] = await Promise.all([
      repo.oeeMachineToday(machineId, day),
      repo.oeeMachineHistory(machineId),
    ]);
    return { machine_id: machineId, today: todayR.rows[0] || null, history: histR.rows };
  },

  async utilization(date) {
    const day = date || new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const plannedMinutes = parseFloat(shiftSettings.planned_hours_per_shift || '8') * 60;
    const r = await repo.utilizationByDate(day);
    const byMachine = {};
    r.rows.forEach(row => {
      if (!byMachine[row.machine_id]) byMachine[row.machine_id] = { running: 0, stopped: 0, offline: 0 };
      const k = (row.status || '').toLowerCase();
      if (k in byMachine[row.machine_id]) byMachine[row.machine_id][k] = parseFloat(row.total_minutes || 0);
    });
    const machines = Object.entries(byMachine).map(([machine_id, m]) => ({
      machine_id,
      running_minutes: Math.round(m.running),
      stopped_minutes: Math.round(m.stopped),
      offline_minutes: Math.round(m.offline),
      utilization_pct: plannedMinutes > 0 ? Math.min(100, Math.round(m.running / plannedMinutes * 10000) / 100) : 0,
    }));
    return { date: day, planned_minutes: plannedMinutes, machines };
  },

  async utilizationMachine(machineId, days) {
    const d = parseInt(days || '7');
    const r = await repo.utilizationMachine(machineId, d);
    return { machine_id: machineId, days: d, records: r.rows };
  },

  async analyticsShifts(date) {
    const day = date || new Date().toISOString().slice(0, 10);
    const shiftSettings = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftSettings);
    const [prodR, oeeR, dtR] = await Promise.all([
      repo.shiftsProduction(day),
      repo.shiftsOee(day),
      repo.shiftsDowntime(day),
    ]);
    const shiftNames = {
      D: shiftSettings.day_shift   || '08:00 - 20:00',
      N: shiftSettings.night_shift || '20:00 - 08:00',
      A: `${shiftSettings.shift_a_start || '06:00'} - ${shiftSettings.shift_a_end || '14:00'}`,
      B: `${shiftSettings.shift_b_start || '14:00'} - ${shiftSettings.shift_b_end || '22:00'}`,
      C: `${shiftSettings.shift_c_start || '22:00'} - ${shiftSettings.shift_c_end || '06:00'}`,
    };
    return { date: day, current_shift: currentShift, shift_timings: shiftNames, production_by_shift: prodR.rows, oee_by_shift: oeeR.rows, downtime_reasons: dtR.rows };
  },

  async topDowntime(days) {
    const d = parseInt(days || '7');
    const r = await repo.topDowntime(d);
    const totalMins = r.rows.reduce((s, x) => s + parseFloat(x.total_minutes || 0), 0);
    return { days: d, total_minutes: Math.round(totalMins), reasons: r.rows.map(x => ({ ...x, percentage: totalMins > 0 ? Math.round(parseFloat(x.total_minutes) / totalMins * 1000) / 10 : 0 })) };
  },
});
