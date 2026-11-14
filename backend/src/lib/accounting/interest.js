// Interest on overdue outstanding (Busy "Interest Calculation"). For each open
// bill of a debtor/creditor, interest = outstanding × rate% × overdue-days / 365,
// where overdue-days counts from the bill date plus the party's credit period.
// Open amounts come from the bill-wise allocation layer, so a settled bill is
// excluded even when no explicit allocation was made (FIFO closing).
const R = require('./rules');
const { ymd } = require('./schema');

module.exports = (pool) => {
  const svc = require('./service')(pool);
  const alloc = require('./allocations')(pool);

  async function compute({ kind = 'RECEIVABLE', as_of, rate } = {}) {
    const to = (as_of && String(as_of).slice(0, 10)) || new Date().toISOString().slice(0, 10);
    const toMs = Date.parse(to + 'T00:00:00Z');
    const pct = Number(rate) || 18;
    const cid = await svc.companyId();
    const groups = await svc.listGroups();
    const byId = new Map(groups.map((g) => [g.group_id, g]));
    const target = kind === 'PAYABLE' ? 'SUNDRY_CREDITORS' : 'SUNDRY_DEBTORS';
    const inGroup = (gid) => { let g = byId.get(gid); while (g) { if (g.code === target) return true; g = g.parent_id ? byId.get(g.parent_id) : null; } return false; };
    const parties = (await pool.query(`SELECT ledger_id, name, credit_days, group_id FROM acct.ledgers WHERE company_id=$1 AND ledger_type='PARTY'`, [cid])).rows.filter((l) => inGroup(l.group_id));

    const rows = []; let totalInterest = 0; let totalOutstanding = 0;
    for (const l of parties) {
      let ob; try { ob = await alloc.openBills(l.ledger_id); } catch { continue; }
      for (const b of ob.open) {
        if (!b.voucher_date) continue;
        const billMs = Date.parse(ymd(b.voucher_date) + 'T00:00:00Z');
        if (Number.isNaN(billMs)) continue;
        const overdue = Math.floor((toMs - billMs) / 864e5) - (Number(l.credit_days) || 0);
        if (overdue <= 0) continue;
        const out = R.toPaise(b.outstanding) || 0;
        const interest = Math.round(out * pct / 100 * overdue / 365);
        totalInterest += interest; totalOutstanding += out;
        rows.push({ party: l.name, bill_no: b.voucher_no, bill_date: b.voucher_date, reference_no: b.reference_no,
          outstanding: b.outstanding, credit_days: Number(l.credit_days) || 0, overdue_days: overdue, interest: R.fromPaise(interest) });
      }
    }
    rows.sort((a, b) => Number(b.interest) - Number(a.interest));
    return { kind, as_of: to, rate_pct: pct, control_account: target,
      rows, total_outstanding: R.fromPaise(totalOutstanding), total_interest: R.fromPaise(totalInterest) };
  }

  return { compute };
};
