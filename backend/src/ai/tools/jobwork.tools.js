// Job-work read tools — material out at the dye house / finisher and not yet back.
// For a job-work mill this is the daily "what's stuck and where" question: greige
// sent on a subcontract challan, versus what has been received against it. Read-only.

module.exports = function registerJobworkTools(registry, { pool }) {
  // What is currently at vendors: sent challans not yet received, by vendor + job.
  registry.register({
    name: 'get_jobwork_outstanding',
    description: 'Material currently out at job-workers (dye house / finisher) — sent challans not yet returned, total kg by vendor and job type, with an overdue count. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT COALESCE(vendor_name,'(unknown)') AS vendor,
                COALESCE(job_type,'—') AS job_type,
                COUNT(*) AS challans,
                COALESCE(SUM(sent_weight_kg),0) AS kg,
                COUNT(*) FILTER (WHERE expected_return_date IS NOT NULL AND expected_return_date < CURRENT_DATE) AS overdue
           FROM subcontract_challans
          WHERE COALESCE(status,'') = 'SENT'
          GROUP BY vendor_name, job_type
          ORDER BY kg DESC`)).rows;
      const total_kg = Math.round(rows.reduce((s, r) => s + Number(r.kg), 0) * 100) / 100;
      const total_challans = rows.reduce((s, r) => s + Number(r.challans), 0);
      const overdue = rows.reduce((s, r) => s + Number(r.overdue), 0);
      return {
        total_kg, total_challans, overdue_challans: overdue,
        by_vendor: rows.map(r => ({ vendor: r.vendor, job: r.job_type, challans: Number(r.challans), kg: Math.round(Number(r.kg) * 100) / 100, overdue: Number(r.overdue) })),
        note: total_challans === 0 ? 'Nothing is currently out at any job-worker.' : undefined,
      };
    },
  });

  // The overdue list — sent challans past their expected return date.
  registry.register({
    name: 'get_jobwork_overdue',
    description: 'Job-work challans that are overdue (sent, past their expected return date, not yet returned), with days overdue. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT challan_number, COALESCE(vendor_name,'(unknown)') AS vendor, job_type,
                sent_weight_kg, expected_return_date,
                (CURRENT_DATE - expected_return_date) AS days_overdue
           FROM subcontract_challans
          WHERE COALESCE(status,'') = 'SENT'
            AND expected_return_date IS NOT NULL AND expected_return_date < CURRENT_DATE
          ORDER BY expected_return_date ASC LIMIT 50`)).rows;
      return {
        count: rows.length,
        overdue: rows.map(r => ({
          challan: r.challan_number, vendor: r.vendor, job: r.job_type,
          kg: Number(r.sent_weight_kg), days_overdue: Number(r.days_overdue),
        })),
        note: rows.length === 0 ? 'No job-work challan is overdue.' : undefined,
      };
    },
  });

  // Process loss/gain — sent weight vs weight received back, over a period.
  registry.register({
    name: 'get_process_loss',
    description: 'Job-work process loss/gain: weight sent vs weight received back over a period. Args: {days?: number (default 30)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = Number(days) > 0 ? Number(days) : 30;
      const row = (await pool.query(
        `WITH recv AS (
           SELECT challan_id, SUM(received_weight_kg) AS rkg
             FROM subcontract_receipts
            WHERE received_date >= (CURRENT_DATE - $1::int)
            GROUP BY challan_id)
         SELECT COALESCE(SUM(c.sent_weight_kg),0) AS sent,
                COALESCE(SUM(recv.rkg),0) AS received
           FROM recv JOIN subcontract_challans c ON c.challan_id = recv.challan_id`, [d])).rows[0];
      const sent = Math.round(Number(row.sent) * 100) / 100;
      const received = Math.round(Number(row.received) * 100) / 100;
      const loss = Math.round((sent - received) * 100) / 100;
      return {
        period_days: d, sent_kg: sent, received_kg: received,
        loss_kg: loss, loss_pct: sent > 0 ? Math.round((loss / sent) * 1000) / 10 : 0,
        note: sent === 0 ? 'No returns received in this period to measure loss.' : undefined,
      };
    },
  });

  // ── WRITE tool — draft an outward subcontract challan, behind approvals ───────
  // Sends greige out to a dye house / finisher. Proposes only; a SUPERVISOR
  // approval creates the challan (its own SC number) and posts an OUT ledger line
  // to the In-Transit warehouse — the same footprint a human quick-challan makes.
  const { nextSeq } = require('../../lib/sequences');
  registry.register({
    name: 'create_subcontract_challan',
    description: 'Draft an outward subcontract challan — send greige to a dye house / finisher. Proposes for approval; a SUPERVISOR must approve before it is created. Args: {vendor_name, job_type: "DYEING"|"FINISHING", weight_kg, roll_count?, expected_return_date?, notes?}',
    safe: false,
    minRole: 'OPERATOR',
    approveRole: 'SUPERVISOR',
    propose: async ({ vendor_name, job_type, weight_kg, roll_count, expected_return_date, notes } = {}) => {
      const vendor = String(vendor_name || '').trim();
      const job = String(job_type || '').trim().toUpperCase();
      const kg = Number(weight_kg);
      if (!vendor) return { error: 'vendor_name is required' };
      if (!['DYEING', 'FINISHING'].includes(job)) return { error: 'job_type must be DYEING or FINISHING' };
      if (!(kg > 0)) return { error: 'weight_kg must be greater than zero' };
      const rolls = Number(roll_count) > 0 ? Math.floor(Number(roll_count)) : 0;
      let ret = null;
      if (expected_return_date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expected_return_date))) return { error: 'expected_return_date must be YYYY-MM-DD' };
        ret = String(expected_return_date);
      }
      return {
        summary: `Send ${kg} kg${rolls ? ` (${rolls} rolls)` : ''} to ${vendor} for ${job}${ret ? `, due ${ret}` : ''}`,
        payload: { vendor_name: vendor, job_type: job, weight_kg: kg, roll_count: rolls, expected_return_date: ret, notes: notes || null },
      };
    },
    execute: async ({ vendor_name, job_type, weight_kg, roll_count, expected_return_date, notes }, { user } = {}) => {
      const challan_number = await nextSeq('SC', 'subcontract_challans', 'challan_number');
      const row = (await pool.query(
        `INSERT INTO subcontract_challans
           (challan_number, batch_id, vendor_name, job_type, sent_date, expected_return_date,
            sent_weight_kg, roll_count, status, challan_type, source, notes, created_by)
         VALUES ($1,NULL,$2,$3,CURRENT_DATE,$4,$5,$6,'SENT','AI_DRAFT','AI',$7,$8)
         RETURNING challan_id, challan_number`,
        [challan_number, vendor_name, job_type, expected_return_date, weight_kg, roll_count,
         notes, user?.username || 'ai-approval'])).rows[0];
      // OUT ledger line to In-Transit, mirroring the human challan footprint.
      try {
        const transit = (await pool.query(`SELECT warehouse_id FROM warehouses WHERE code='TRANSIT' LIMIT 1`)).rows[0];
        await pool.query(
          `INSERT INTO stock_ledger (txn_date, doc_type, doc_id, item_desc, warehouse_id, movement_type, quantity, uom_code, notes, created_by)
           VALUES (CURRENT_DATE,'SC_CHALLAN',$1,$2,$3,'OUT',$4,'KG',$5,$6)`,
          [row.challan_number, `Greige — ${job_type}`, transit?.warehouse_id || null, weight_kg,
           `Sent to ${vendor_name} for ${job_type}`, user?.username || 'ai-approval']);
      } catch (e) { /* ledger is best-effort, the challan is the record of truth */ }
      return { ok: true, challan_id: row.challan_id, challan_number: row.challan_number, status: 'SENT' };
    },
  });
};
