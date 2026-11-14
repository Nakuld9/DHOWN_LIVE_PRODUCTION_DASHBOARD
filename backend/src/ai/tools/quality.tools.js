// Quality read tools — grade split, defect Pareto, and the worst machine, straight
// from the 4-point inspections built in Phase 1. Read-only; the agent reports only
// what was inspected, never an estimate.

module.exports = function registerQualityTools(registry, { pool }) {
  const inspection = require('../../lib/fabric-inspection')(pool);

  // Turn a "days" window into a from-date (default 30 days).
  const fromDate = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - (Number(days) > 0 ? Number(days) : 30));
    return d.toISOString().slice(0, 10);
  };

  // Grade distribution + reject rate for a period. Args: {days?, stage?}.
  registry.register({
    name: 'get_quality_summary',
    description: 'Fabric grade split (A/B/REJECT), reject rate, and the worst machine for a period. Args: {days?: number (default 30), stage?: "GREIGE"|"FINISHED"}',
    minRole: 'OPERATOR',
    handler: async ({ days, stage } = {}) => {
      const rep = await inspection.report({ stage: stage || undefined, from: fromDate(days) });
      const g = Object.fromEntries(rep.grades.map(x => [x.grade, Number(x.rolls)]));
      const total = rep.grades.reduce((s, x) => s + Number(x.rolls), 0);
      const p = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
      const worst = rep.byMachine
        .filter(m => Number(m.inspections) > 0)
        .sort((a, b) => Number(b.rejects) - Number(a.rejects))[0];
      return {
        period_days: Number(days) > 0 ? Number(days) : 30,
        stage: stage || 'all',
        rolls_inspected: total,
        grade_pct: { A: p(g.A || 0), B: p(g.B || 0), REJECT: p(g.REJECT || 0) },
        reject_rate_pct: p(g.REJECT || 0),
        worst_machine: worst ? { machine_id: worst.machine_id, rejects: Number(worst.rejects), inspected: Number(worst.inspections) } : null,
        note: total === 0 ? 'No fabric inspections recorded in this period.' : undefined,
      };
    },
  });

  // Defect Pareto — which defects cause the most penalty points. Args: {days?, stage?}.
  registry.register({
    name: 'get_defect_pareto',
    description: 'Top fabric defects by penalty points for a period (what is failing most). Args: {days?: number, stage?: "GREIGE"|"FINISHED"}',
    minRole: 'OPERATOR',
    handler: async ({ days, stage } = {}) => {
      const rep = await inspection.report({ stage: stage || undefined, from: fromDate(days) });
      const total = rep.pareto.reduce((s, d) => s + Number(d.points), 0);
      return {
        period_days: Number(days) > 0 ? Number(days) : 30,
        top_defects: rep.pareto.slice(0, 8).map(d => ({
          defect: d.defect_type || '(unspecified)',
          points: Number(d.points),
          occurrences: Number(d.occurrences),
          share_pct: total > 0 ? Math.round((Number(d.points) / total) * 1000) / 10 : 0,
        })),
        note: rep.pareto.length === 0 ? 'No defects recorded in this period.' : undefined,
      };
    },
  });

  // ── WRITE tool — hold (quarantine) a roll, behind the approvals queue ────────
  // Reuses the exact roll-quarantine mechanism used elsewhere. Proposes only; a
  // SUPERVISOR approval actually quarantines the roll.
  registry.register({
    name: 'hold_roll',
    description: 'Quarantine (hold) a roll so it cannot be allocated/shipped. Proposes for approval; a SUPERVISOR must approve. Args: {roll_id, reason}',
    safe: false,
    minRole: 'OPERATOR',
    approveRole: 'SUPERVISOR',
    propose: async ({ roll_id, reason } = {}) => {
      const id = String(roll_id || '').trim();
      if (!id) return { error: 'roll_id is required' };
      const r = (await pool.query(`SELECT quarantine_status FROM rolls WHERE roll_id=$1`, [id])).rows[0];
      if (!r) return { error: `unknown roll: ${id}` };
      if (r.quarantine_status === 'QUARANTINED') return { error: `roll ${id} is already quarantined` };
      return { summary: `Hold (quarantine) roll ${id}${reason ? ` — ${reason}` : ''}`, payload: { roll_id: id, reason: reason || null } };
    },
    execute: async ({ roll_id, reason }, { user } = {}) => {
      const upd = await pool.query(
        `UPDATE rolls SET quarantine_status='QUARANTINED', quarantine_reason=$2, quarantined_at=NOW(), quarantined_by=$3
           WHERE roll_id=$1 AND quarantine_status <> 'QUARANTINED'`,
        [roll_id, reason || 'Held via approval', user?.username || 'ai-approval']);
      if (upd.rowCount === 0) return { error: 'roll not found or already quarantined' };
      await pool.query(
        `INSERT INTO roll_quarantine_log (roll_id, from_status, to_status, reason, changed_by)
         VALUES ($1,'NONE','QUARANTINED',$2,$3)`, [roll_id, reason || 'Held via approval', user?.username || 'ai-approval']);
      return { ok: true, roll_id, status: 'QUARANTINED' };
    },
  });

  // ── WRITE tool — open a CAPA (corrective/preventive action) ticket ───────────
  // Proposes only; a SUPERVISOR approval creates the ticket so a quality problem
  // (bad Pareto, a failing machine) gets an owner and a status.
  registry.register({
    name: 'open_capa',
    description: 'Open a CAPA (corrective/preventive action) ticket for a quality problem. Proposes for approval; a SUPERVISOR must approve. Args: {title, severity?: "LOW"|"MEDIUM"|"HIGH", machine_id?, defect_type?, description?}',
    safe: false,
    minRole: 'OPERATOR',
    approveRole: 'SUPERVISOR',
    propose: async ({ title, severity, machine_id, defect_type, description } = {}) => {
      const t = String(title || '').trim();
      if (!t) return { error: 'title is required' };
      const sev = String(severity || 'MEDIUM').toUpperCase();
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(sev)) return { error: 'severity must be LOW, MEDIUM or HIGH' };
      const mc = machine_id ? String(machine_id).trim() : null;
      if (mc) {
        const m = (await pool.query(`SELECT 1 FROM machines WHERE machine_id=$1`, [mc])).rows[0];
        if (!m) return { error: `unknown machine: ${mc}` };
      }
      return {
        summary: `Open ${sev} CAPA: ${t}${mc ? ` (machine ${mc})` : ''}${defect_type ? ` — ${defect_type}` : ''}`,
        payload: { title: t, severity: sev, machine_id: mc, defect_type: defect_type || null, description: description || null },
      };
    },
    execute: async ({ title, severity, machine_id, defect_type, description }, { user } = {}) => {
      const capa_number = 'CAPA-' + Date.now().toString().slice(-8);
      const row = (await pool.query(
        `INSERT INTO capa (capa_number, title, severity, source, machine_id, defect_type, description, status, created_by)
         VALUES ($1,$2,$3,'AI',$4,$5,$6,'OPEN',$7) RETURNING capa_id, capa_number`,
        [capa_number, title, severity, machine_id, defect_type, description, user?.username || 'ai-approval'])).rows[0];
      return { ok: true, capa_id: row.capa_id, capa_number: row.capa_number, status: 'OPEN' };
    },
  });
};
