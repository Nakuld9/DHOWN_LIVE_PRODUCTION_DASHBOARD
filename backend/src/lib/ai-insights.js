// AI Insights — proactive, deterministic rules over live data. Runs cheaply on
// every dashboard poll (no LLM call); each insight carries a question the operator
// can hand to the agent fleet ("Ask AI") for the why. Rules fail closed: a missing
// table or bad query drops that one insight, never the whole feed.

const RANK = { crit: 0, warn: 1, info: 2 };

module.exports = function makeInsights({ pool }) {
  async function q(sql, params = []) {
    try { return (await pool.query(sql, params)).rows; } catch { return null; }
  }

  async function compute() {
    const out = [];

    // 1. Material stuck at job-workers past its return date.
    const jw = await q(`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(sent_weight_kg),0)::float AS kg,
             COALESCE(MAX(CURRENT_DATE - expected_return_date::date),0)::int AS maxdays
        FROM subcontract_challans
       WHERE COALESCE(status,'') = 'SENT'
         AND expected_return_date IS NOT NULL AND expected_return_date < CURRENT_DATE`);
    if (jw && jw[0].n > 0) {
      const { n, kg, maxdays } = jw[0];
      out.push({
        id: 'jobwork-overdue', category: 'Job-work', severity: maxdays > 7 ? 'crit' : 'warn',
        title: `${n} challan${n > 1 ? 's' : ''} overdue at job-workers`,
        evidence: `${Math.round(kg)} kg still out; oldest ${maxdays} day${maxdays > 1 ? 's' : ''} past due.`,
        action: { label: 'Reconcile', to: '/jobwork-reconciliation' },
        ask: 'Which job-work challans are overdue and at which vendor?',
      });
    }

    // 2. Sales orders past their delivery date, not yet shipped.
    const so = await q(`
      SELECT COUNT(*)::int AS n
        FROM sales_orders
       WHERE delivery_date IS NOT NULL AND delivery_date < CURRENT_DATE
         AND UPPER(COALESCE(status,'')) NOT IN ('DELIVERED','DISPATCHED','COMPLETED','CLOSED','CANCELLED')`);
    if (so && so[0].n > 0) {
      out.push({
        id: 'orders-at-risk', category: 'Planning', severity: 'warn',
        title: `${so[0].n} order${so[0].n > 1 ? 's' : ''} at risk of missing dispatch`,
        evidence: 'Delivery date has passed and the order is not yet dispatched.',
        action: { label: 'Open orders', to: '/sales-orders' },
        ask: 'Which sales orders are at risk of missing dispatch, and why?',
      });
    }

    // 3. Today's fabric reject rate, once there's a meaningful sample.
    const qc = await q(`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE grade = 'REJECT')::int AS rej
        FROM fabric_inspection
       WHERE created_at::date = CURRENT_DATE`);
    if (qc && qc[0].total >= 5) {
      const rate = Math.round((qc[0].rej / qc[0].total) * 1000) / 10;
      if (rate > 5) out.push({
        id: 'reject-rate', category: 'Quality', severity: rate > 10 ? 'crit' : 'warn',
        title: `Reject rate ${rate}% today`,
        evidence: `${qc[0].rej} of ${qc[0].total} rolls inspected today graded REJECT.`,
        action: { label: 'Quality board', to: '/fabric-quality' },
        ask: "Break down today's fabric rejections by machine and defect type.",
      });
    }

    // 4. Yarn lots at or below reorder level.
    const yl = await q(`
      SELECT COUNT(*)::int AS n
        FROM yarn_lots
       WHERE COALESCE(current_stock_kg,0) > 0
         AND current_stock_kg <= COALESCE(NULLIF(low_stock_threshold_kg,0), 100)`);
    if (yl && yl[0].n > 0) {
      out.push({
        id: 'low-yarn', category: 'Inventory', severity: 'warn',
        title: `${yl[0].n} yarn lot${yl[0].n > 1 ? 's' : ''} below reorder level`,
        evidence: 'Stock has fallen to or below the low-stock threshold.',
        action: { label: 'Yarn store', to: '/yarn-store' },
        ask: 'Which yarn lots are low and should be reordered first?',
      });
    }

    // 5. Needle / sinker spare parts at or below their reorder point. Mirrors the
    //    yarn rule: only parts with stock ON HAND that has fallen to the reorder
    //    level are flagged, so untracked parts (stock 0) never create noise.
    const sp = await q(`
      SELECT COUNT(*)::int AS n
        FROM spare_parts
       WHERE deleted_at IS NULL
         AND category ILIKE ANY (ARRAY['%needle%','%sinker%'])
         AND COALESCE(min_stock,0) > 0
         AND current_stock > 0
         AND current_stock <= min_stock`);
    if (sp && sp[0].n > 0) {
      out.push({
        id: 'low-needles', category: 'Inventory', severity: 'warn',
        title: `${sp[0].n} needle/sinker part${sp[0].n > 1 ? 's' : ''} below reorder level`,
        evidence: 'On-hand stock has fallen to or below one full set — reorder before the next change.',
        action: { label: 'Spare parts', to: '/spare-parts' },
        ask: 'Which needle/sinker parts are low and how many should I reorder?',
      });
    }

    // 6. A data collector that was recently reporting has suddenly gone quiet —
    //    production isn't being captured on that machine. Only flags collectors that
    //    reported within the last 24h but not in the last 20 min, so not-yet-deployed
    //    ESP32s (never seen, or long-idle) never create noise — only a real drop does.
    const dc = await q(`
      SELECT COUNT(*)::int AS n
        FROM data_collectors d
        JOIN machines m ON m.machine_id = d.machine_id
       WHERE d.deleted_at IS NULL AND COALESCE(m.active, true) = true
         AND d.last_seen IS NOT NULL
         AND d.last_seen < NOW() - INTERVAL '20 minutes'
         AND d.last_seen > NOW() - INTERVAL '24 hours'`);
    if (dc && dc[0].n > 0) {
      out.push({
        id: 'collectors-offline', category: 'System', severity: dc[0].n >= 5 ? 'crit' : 'warn',
        title: `${dc[0].n} data collector${dc[0].n > 1 ? 's' : ''} not reporting`,
        evidence: 'Production on these machines is not being recorded — check the ESP32 / network.',
        action: { label: 'Machines', to: '/machines' },
        ask: 'Which machines have a data collector that stopped reporting, and since when?',
      });
    }

    // 7. Off-site (Google Drive) backup has gone stale. The MES service runs as
    //    LocalSystem, which cannot see the per-user G: Drive mount, so the copy is
    //    done by a Scheduled Task (running as the logged-in user) that writes a
    //    success marker on the local disk. We read that marker's age here — if the
    //    off-site copy stops working, this surfaces it instead of it rotting
    //    silently in a log (which is exactly what happened for ~5 weeks).
    try {
      if (!process.env.BACKUP_SECONDARY_DIR) throw 'no off-site target configured';   // nothing to check
      const fs = require('fs'), path = require('path');
      const maxHours = Number(process.env.OFFSITE_BACKUP_MAX_AGE_HOURS || 48);
      const marker = path.join(require('../../config/tenant').backupDir, '.offsite_last_sync');
      let ageH = null, ok = false;
      try { ageH = (Date.now() - fs.statSync(marker).mtimeMs) / 3600000; ok = true; } catch { /* missing */ }
      if (!ok || ageH > maxHours) {
        out.push({
          id: 'offsite-backup-stale', category: 'System', severity: ageH > maxHours * 2 || !ok ? 'crit' : 'warn',
          title: ok ? `Off-site backup is ${Math.round(ageH)}h old` : 'Off-site backup has never synced',
          evidence: ok
            ? `The Google Drive copy last succeeded ${Math.round(ageH)} hours ago (threshold ${maxHours}h). A disk failure now could lose everything since then off-machine.`
            : 'No off-site sync marker found — the Google Drive backup copy is not running. Local backups are unaffected.',
          action: { label: 'Backups', to: '/settings' },
          ask: 'Why has the off-site backup stopped, and how do I restore it?',
        });
      }
    } catch { /* never let the backup check break the feed */ }

    // 8. Import exceptions (control tower) — surface critical/high on the main feed.
    try {
      const importInsights = await require('./import-exceptions')(pool).insights();
      for (const i of importInsights) out.push(i);
    } catch { /* never let imports break the feed */ }

    out.sort((a, b) => (RANK[a.severity] - RANK[b.severity]));
    return out;
  }

  return { compute };
};
