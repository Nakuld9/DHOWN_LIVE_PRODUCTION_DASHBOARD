// Production (knitting) read tools. These are the facts the Production agent may
// look up. All read-only. Numbers come straight from the tables — the agent never
// computes production itself, so it can only report what the mill actually recorded.

const { computeLiveStatus } = require('../../lib/machine');

module.exports = function registerProductionTools(registry, { pool }) {
  // Knit output for a day (defaults to today), by shift. "Produced" = a roll
  // closed (weighed) that day; an unweighed open roll is not output yet.
  registry.register({
    name: 'get_production_summary',
    description: 'Knitting output for a date (default today): total rolls and kg, broken down by shift. Args: {date?: "YYYY-MM-DD"}',
    minRole: 'OPERATOR',
    handler: async ({ date } = {}) => {
      const d = date || null;
      const rows = (await pool.query(
        `SELECT COALESCE(shift,'?') AS shift,
                COUNT(*) AS rolls,
                COALESCE(SUM(actual_weight_kg),0) AS kg
           FROM rolls
          WHERE closed_at::date = COALESCE($1::date, CURRENT_DATE)
            AND COALESCE(warehouse_status,'') <> 'CANCELLED'
          GROUP BY shift ORDER BY shift`, [d])).rows;
      const total_rolls = rows.reduce((s, r) => s + Number(r.rolls), 0);
      const total_kg = Math.round(rows.reduce((s, r) => s + Number(r.kg), 0) * 100) / 100;
      return {
        date: d || 'today',
        total_rolls,
        total_kg,
        by_shift: rows.map(r => ({ shift: r.shift, rolls: Number(r.rolls), kg: Math.round(Number(r.kg) * 100) / 100 })),
        note: total_rolls === 0 ? 'No rolls were closed (weighed) on this date — no recorded production.' : undefined,
      };
    },
  });

  // Live machine status — running / stopped / offline, from the collector feed.
  registry.register({
    name: 'get_machine_status',
    description: 'Live status of each knitting machine (RUNNING / STOPPED / OFFLINE) and its RPM, from the collector feed.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT m.machine_id, m.machine_name,
                ld.dc_status, ld.rpm
           FROM machines m
           LEFT JOIN machine_live_data ld ON ld.machine_id = m.machine_id
          WHERE COALESCE(m.active, true) = true
          ORDER BY m.machine_id`)).rows;
      const machines = rows.map(r => ({
        machine_id: r.machine_id,
        name: r.machine_name || r.machine_id,
        status: computeLiveStatus(r.dc_status, r.rpm),
        rpm: r.rpm != null ? Number(r.rpm) : null,
      }));
      const running = machines.filter(m => m.status === 'RUNNING').length;
      const offline = machines.filter(m => m.status === 'OFFLINE').length;
      return { total: machines.length, running, stopped: machines.length - running - offline, offline, machines };
    },
  });
};
