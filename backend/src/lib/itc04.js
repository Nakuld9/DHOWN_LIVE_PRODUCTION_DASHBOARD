// ITC-04 — the GST return for goods sent to / received back from a job worker
// (Sec 143 + Rule 45). Built from the MES's own job-work (dye-house) challans and
// receipts. Half-yearly for aggregate turnover > Rs 5 cr (Apr-Sep due 25 Oct,
// Oct-Mar due 25 Apr).
//
// Honest about gaps: the challan carries the DYEING RATE, not the value of the
// goods sent, and HSN isn't stored per challan — so taxable value and HSN come
// from caller-supplied defaults (goods_rate_per_kg, hsn), clearly flagged.
module.exports = (pool) => {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Default reporting half-year from today (IST).
  function defaultPeriod() {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const y = d.getFullYear(), m = d.getMonth(); // 0=Jan
    // FY Apr-Mar. H1 = Apr(3)-Sep(8); H2 = Oct(9)-Mar(2).
    if (m >= 3 && m <= 8) return { fy_start: y, half: 'H1', from: `${y}-04-01`, to: `${y}-09-30`, due: `${y}-10-25` };
    if (m >= 9) return { fy_start: y, half: 'H2', from: `${y}-10-01`, to: `${y + 1}-03-31`, due: `${y + 1}-04-25` };
    // Jan-Mar → still H2 of the previous FY-start year
    return { fy_start: y - 1, half: 'H2', from: `${y - 1}-10-01`, to: `${y}-03-31`, due: `${y}-04-25` };
  }

  async function report({ from, to, hsn, goods_rate_per_kg } = {}) {
    const period = (from && to) ? { from, to, half: 'CUSTOM', due: null } : defaultPeriod();
    const HSN = hsn || '6006';                      // knitted fabric default; caller can override
    const rate = Number(goods_rate_per_kg) || 0;    // approx value of goods/kg; 0 => value left blank

    // TABLE 4 — goods SENT to a job worker during the period.
    const sent = (await pool.query(`
      SELECT c.challan_number, c.sent_date, c.job_type, c.color_name, c.sent_weight_kg,
             c.roll_count, c.rate_per_kg, c.vendor_name, p.gstin AS jw_gstin, p.company_name AS jw_name,
             (SELECT string_agg(DISTINCT i.fabric_type, ', ') FROM subcontract_challan_items i WHERE i.challan_id = c.challan_id) AS fabrics
        FROM subcontract_challans c
        LEFT JOIN partners p ON p.partner_id = c.partner_id
       WHERE c.sent_date BETWEEN $1 AND $2
         AND COALESCE(c.status,'') <> 'CANCELLED'
       ORDER BY c.sent_date, c.challan_number`, [period.from, period.to])).rows;

    const table4 = sent.map((x) => {
      const qty = r2(x.sent_weight_kg);
      return {
        jw_gstin: x.jw_gstin || null,
        jw_name: x.jw_name || x.vendor_name || null,
        challan_no: x.challan_number, challan_date: x.sent_date,
        description: [x.fabrics || null, x.color_name || null].filter(Boolean).join(' · ') || (x.job_type || 'Greige fabric'),
        hsn: HSN, uqc: 'KGS', quantity: qty,
        goods_type: 'Inputs',
        taxable_value: rate ? r2(qty * rate) : null,
        nature: x.job_type || null,
      };
    });

    // TABLE 5A — goods RECEIVED BACK during the period, against the original challan.
    const recd = (await pool.query(`
      SELECT c.challan_number, c.sent_date, c.job_type, c.color_name, c.sent_weight_kg,
             c.vendor_name, p.gstin AS jw_gstin, p.company_name AS jw_name,
             r.received_date, r.received_weight_kg, r.rejected_weight_kg,
             (SELECT string_agg(DISTINCT i.fabric_type, ', ') FROM subcontract_challan_items i WHERE i.challan_id = c.challan_id) AS fabrics
        FROM subcontract_receipts r
        JOIN subcontract_challans c ON c.challan_id = r.challan_id
        LEFT JOIN partners p ON p.partner_id = c.partner_id
       WHERE r.received_date BETWEEN $1 AND $2
       ORDER BY r.received_date, c.challan_number`, [period.from, period.to])).rows;

    const table5a = recd.map((x) => {
      const got = r2(x.received_weight_kg);
      const rej = r2(x.rejected_weight_kg);
      const loss = r2(Math.max(0, Number(x.sent_weight_kg || 0) - got - rej));
      return {
        jw_gstin: x.jw_gstin || null, jw_name: x.jw_name || x.vendor_name || null,
        orig_challan_no: x.challan_number, orig_challan_date: x.sent_date,
        received_date: x.received_date,
        description: [x.fabrics || null, x.color_name || null].filter(Boolean).join(' · ') || (x.job_type || 'Finished fabric'),
        hsn: HSN, uqc: 'KGS',
        quantity_received: got, rejected: rej, loss_waste: loss,
        nature: x.job_type || 'Dyeing/finishing',
      };
    });

    // DEEMED SUPPLY RISK — sent > 1 year ago, not (fully) received/closed.
    const overdue = (await pool.query(`
      SELECT c.challan_number, c.sent_date, c.sent_weight_kg, c.vendor_name, p.gstin AS jw_gstin,
             COALESCE((SELECT SUM(r.received_weight_kg) FROM subcontract_receipts r WHERE r.challan_id = c.challan_id),0) AS received
        FROM subcontract_challans c
        LEFT JOIN partners p ON p.partner_id = c.partner_id
       WHERE c.sent_date < (CURRENT_DATE - INTERVAL '1 year')
         AND COALESCE(c.status,'') NOT IN ('CANCELLED','CLOSED','RECEIVED','COMPLETED')
       ORDER BY c.sent_date`)).rows
      .filter((x) => Number(x.received) < Number(x.sent_weight_kg || 0) - 0.01)
      .map((x) => ({
        challan_no: x.challan_number, challan_date: x.sent_date,
        jw_gstin: x.jw_gstin || null, vendor: x.vendor_name || null,
        sent_kg: r2(x.sent_weight_kg), received_kg: r2(x.received),
        pending_kg: r2(Number(x.sent_weight_kg || 0) - Number(x.received)),
        days_since: Math.floor((Date.now() - new Date(x.sent_date).getTime()) / 86400000),
      }));

    const sumQty = (a, k) => r2(a.reduce((s, x) => s + (Number(x[k]) || 0), 0));
    return {
      period, hsn: HSN, goods_rate_per_kg: rate || null,
      frequency: 'Half-yearly (aggregate turnover > Rs 5 crore)',
      table4, table5a, deemed_supply_risk: overdue,
      totals: {
        sent_challans: table4.length, sent_qty: sumQty(table4, 'quantity'),
        sent_value: rate ? sumQty(table4, 'taxable_value') : null,
        received_rows: table5a.length, received_qty: sumQty(table5a, 'quantity_received'),
        loss_qty: sumQty(table5a, 'loss_waste'), rejected_qty: sumQty(table5a, 'rejected'),
        overdue_count: overdue.length,
      },
      notes: [
        'HSN defaults to 6006 (knitted fabric) — override per your goods.',
        'Taxable value is quantity x the goods rate/kg you enter (the challan stores only the dyeing rate). Leave blank to file values from your books.',
        'Deemed-supply risk lists job-work sent > 1 year ago not received back (inputs); verify before the limit lapses.',
        'MES prepares ITC-04; file it on the GST portal (or via Busy).',
      ],
    };
  }

  return { report, defaultPeriod };
};
