// Compliance dashboard — the statutory and contractual clocks that run out.
//
// Three things in this business expire or go stale quietly, and each is only a
// problem once it is too late:
//
//   - An e-way bill has a validity window. Goods moving on an expired one are a
//     detention risk at a checkpost, and the fine lands on us, not the driver.
//   - A dispatch with no proof of delivery is a payment dispute waiting to
//     happen: "we never received it" is unanswerable without a POD.
//   - A sales return sitting in DRAFT has taken goods off the customer but has
//     not credited them, so we are still chasing money for fabric in our own
//     warehouse.
//
// Everything here is a countdown, so it is ordered by urgency rather than by
// date created. A screen sorted newest-first would bury the thing expiring
// today under things logged today.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {

  // E-way bills close to, or past, their validity.
  async function ewayExpiring({ withinHours = 48 } = {}) {
    const r = await pool.query(
      `SELECT e.eway_id, e.eway_no, e.valid_until, e.status, e.vehicle_number, e.doc_value,
              e.dispatch_id, d.dispatch_number, p.company_name,
              EXTRACT(EPOCH FROM (e.valid_until - NOW()))/3600 AS hours_left
         FROM eway_bills e
         LEFT JOIN dispatch_challans d ON d.dispatch_id = e.dispatch_id
         LEFT JOIN partners p ON p.partner_id = e.partner_id
        WHERE COALESCE(e.status,'ACTIVE') NOT IN ('CANCELLED')
          AND e.valid_until IS NOT NULL
          AND e.valid_until <= NOW() + ($1 || ' hours')::interval
        ORDER BY e.valid_until`, [String(withinHours)]);
    return r.rows.map(x => ({
      ...x,
      doc_value: r2(x.doc_value),
      hours_left: x.hours_left === null ? null : Math.round(Number(x.hours_left) * 10) / 10,
      expired: Number(x.hours_left) < 0,
    }));
  }

  // Dispatches that left without a proof of delivery coming back.
  //
  // A grace period is deliberate: a lorry that left this morning has not failed
  // to deliver, it is simply still on the road, and listing it as an exception
  // would train people to ignore the list.
  async function podOutstanding({ olderThanDays = 3 } = {}) {
    const r = await pool.query(
      `SELECT d.dispatch_id, d.dispatch_number, d.dispatch_date, d.partner_id,
              COALESCE(p.company_name, d.customer_name) AS company_name,
              d.total_weight_kg, d.grand_total, d.vehicle_number, d.lr_number,
              (CURRENT_DATE - d.dispatch_date) AS days_since
         FROM dispatch_challans d
         LEFT JOIN partners p ON p.partner_id = d.partner_id
        WHERE COALESCE(d.status,'') <> 'CANCELLED'
          AND d.dispatch_date <= CURRENT_DATE - $1::int
          AND NOT EXISTS (SELECT 1 FROM delivery_proofs dp WHERE dp.dispatch_id = d.dispatch_id)
        ORDER BY d.dispatch_date`, [olderThanDays]);
    return r.rows.map(x => ({
      ...x,
      total_weight_kg: r2(x.total_weight_kg),
      grand_total: r2(x.grand_total),
      days_since: Number(x.days_since),
    }));
  }

  // Returns that have not been approved or rejected.
  async function returnsPending() {
    const r = await pool.query(
      `SELECT sr.return_id, sr.return_number, sr.return_date, sr.reason, sr.disposition,
              sr.total_value, sr.status, p.company_name,
              (CURRENT_DATE - sr.return_date) AS days_open
         FROM sales_returns sr
         LEFT JOIN partners p ON p.partner_id = sr.partner_id
        WHERE sr.status = 'DRAFT'
        ORDER BY sr.return_date`);
    return r.rows.map(x => ({
      ...x, total_value: r2(x.total_value), days_open: Number(x.days_open),
    }));
  }

  // Credit notes raised but never applied to an invoice. The customer has been
  // promised the money back and is still being chased for it.
  async function creditNotesUnapplied() {
    const r = await pool.query(
      `SELECT cn.note_id, cn.note_number, cn.note_date, cn.amount, p.company_name,
              cn.amount - COALESCE((SELECT SUM(amount) FROM credit_note_allocations ca
                                     WHERE ca.note_id = cn.note_id), 0) AS unapplied
         FROM credit_notes cn
         LEFT JOIN partners p ON p.partner_id = cn.partner_id
        WHERE cn.status = 'ACTIVE'
        ORDER BY cn.note_date`);
    return r.rows
      .map(x => ({ ...x, amount: r2(x.amount), unapplied: r2(x.unapplied) }))
      .filter(x => x.unapplied > 0.009);
  }

  // ── Statutory due-date calendar (Indian GST / TDS / PF / ESI / advance tax) ──
  // Pure date math — the next upcoming occurrence of each recurring obligation.
  // Assumes MONTHLY GST filing (not QRMP). Dates computed in IST.
  function statutoryDueDates({ aheadDays = 75 } = {}) {
    const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmtPeriodMonth = (y, m) => { const d = new Date(y, m, 1); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daysUntil = (d) => Math.round((d - today) / 86400000);
    const out = [];

    // Next date with day-of-month `day`, on or after today. Returns {due, periodOffset}
    // periodOffset = how many months back the covered period is from the due month.
    const nextMonthly = (day) => {
      let d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
      return d;
    };
    const addMonthly = (name, category, day, note) => {
      const due = nextMonthly(day);
      // the obligation filed on `due` covers the previous calendar month
      const pm = new Date(due.getFullYear(), due.getMonth() - 1, 1);
      out.push({ name, category, due_date: ymd(due), period: fmtPeriodMonth(pm.getFullYear(), pm.getMonth()), note, days_until: daysUntil(due) });
    };
    // Next occurrence from a list of {month(0-11), day} within this/next year.
    const addFromList = (name, category, list, note, periodFn) => {
      const cands = [];
      for (const yr of [today.getFullYear(), today.getFullYear() + 1]) {
        for (const it of list) cands.push(new Date(yr, it.month, it.day));
      }
      const due = cands.filter(d => d >= today).sort((a, b) => a - b)[0];
      if (due) out.push({ name, category, due_date: ymd(due), period: periodFn ? periodFn(due) : null, note, days_until: daysUntil(due) });
    };

    addMonthly('GSTR-1', 'GST', 11, 'Outward supplies return (monthly filer)');
    addMonthly('GSTR-3B', 'GST', 20, 'Summary return + tax payment (monthly filer)');
    addMonthly('TDS payment', 'TDS', 7, 'Deposit TDS deducted (challan 281); March → 30 Apr');
    addMonthly('PF (EPF)', 'PF', 15, 'EPF contribution + ECR');
    addMonthly('ESI', 'ESI', 15, 'ESI contribution');

    const q = (d) => {
      const m = d.getMonth();
      if (m === 6) return 'Q1 (Apr–Jun)'; if (m === 9) return 'Q2 (Jul–Sep)';
      if (m === 0) return 'Q3 (Oct–Dec)'; return 'Q4 (Jan–Mar)';
    };
    addFromList('TDS return (26Q/24Q)', 'TDS',
      [{ month: 6, day: 31 }, { month: 9, day: 31 }, { month: 0, day: 31 }, { month: 4, day: 31 }],
      'Quarterly TDS statement', q);
    addFromList('Advance tax', 'IT',
      [{ month: 5, day: 15 }, { month: 8, day: 15 }, { month: 11, day: 15 }, { month: 2, day: 15 }],
      'Advance-tax instalment (15/45/75/100%)', null);

    const items = out.sort((a, b) => a.due_date.localeCompare(b.due_date));
    const soon = items.filter(i => i.days_until <= aheadDays);
    return {
      items: soon,
      next: items[0] || null,
      urgent: items.filter(i => i.days_until >= 0 && i.days_until <= 7).length,
      assumptions: 'Monthly GST filing assumed; verify your filing frequency (QRMP differs). Dates are standard due dates, not holiday-adjusted.',
    };
  }

  async function overview({ ewayHours = 48, podDays = 3 } = {}) {
    const [eway, pod, returns, notes] = await Promise.all([
      ewayExpiring({ withinHours: ewayHours }),
      podOutstanding({ olderThanDays: podDays }),
      returnsPending(),
      creditNotesUnapplied(),
    ]);

    return {
      settings: { eway_within_hours: ewayHours, pod_older_than_days: podDays },
      eway: {
        items: eway,
        expired: eway.filter(x => x.expired).length,
        expiring: eway.filter(x => !x.expired).length,
      },
      pod: {
        items: pod,
        count: pod.length,
        value: r2(pod.reduce((s, x) => s + (x.grand_total || 0), 0)),
      },
      returns: { items: returns, count: returns.length,
                 value: r2(returns.reduce((s, x) => s + (x.total_value || 0), 0)) },
      credit_notes: { items: notes, count: notes.length,
                      value: r2(notes.reduce((s, x) => s + x.unapplied, 0)) },
      // One number for "is anything on fire" — expired e-way bills are the only
      // item here that carries an immediate fine.
      urgent: eway.filter(x => x.expired).length,
      clear: !eway.length && !pod.length && !returns.length && !notes.length,
      statutory: statutoryDueDates(),
    };
  }

  return { overview, ewayExpiring, podOutstanding, returnsPending, creditNotesUnapplied, statutoryDueDates };
};
