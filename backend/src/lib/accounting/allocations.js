// Phase 3/4 — bill-wise allocation (open-item). Links a settlement voucher
// (receipt from a customer, payment to a supplier) to the specific bill(s) it
// clears, so receivables/payables can be reported as true open items instead of
// FIFO-over-postings. Pure accounting integrity: an allocation can never exceed
// a bill's outstanding or the settlement's unallocated amount.
const R = require('./rules');
const { ymd } = require('./schema');

const P = (v) => R.toPaise(v) || 0;
const S = (p) => R.fromPaise(p);

module.exports = (pool) => {
  const svc = require('./service')(pool);
  async function cid() { return svc.companyId(); }

  // Which side of the party ledger is a "bill": Dr for a debtor, Cr for a creditor.
  async function billSide(partyLedgerId) {
    const c = await cid();
    const groups = await svc.listGroups();
    const byId = new Map(groups.map((g) => [g.group_id, g]));
    const led = (await pool.query(`SELECT group_id FROM acct.ledgers WHERE ledger_id=$1 AND company_id=$2`, [partyLedgerId, c])).rows[0];
    if (!led) throw new R.AccountingError('Party ledger not found', 'ACCT_NOT_FOUND');
    let g = byId.get(led.group_id);
    while (g) { if (g.code === 'SUNDRY_CREDITORS') return 'Cr'; if (g.code === 'SUNDRY_DEBTORS') return 'Dr'; g = g.parent_id ? byId.get(g.parent_id) : null; }
    throw new R.AccountingError('Allocation applies only to Sundry Debtor/Creditor party ledgers', 'ACCT_INVALID');
  }

  // Posted effect of a voucher on the party ledger, per side (paise).
  async function effect(c, voucherId, partyLedgerId) {
    const r = (await pool.query(
      `SELECT COALESCE(SUM(jl.dr_amount),0) dr, COALESCE(SUM(jl.cr_amount),0) cr
         FROM acct.journal_lines jl JOIN acct.journal_entries je ON je.je_id=jl.je_id
        WHERE je.company_id=$1 AND je.voucher_id=$2 AND jl.ledger_id=$3`, [c, voucherId, partyLedgerId])).rows[0];
    return { dr: P(r.dr), cr: P(r.cr) };
  }
  async function allocatedToBill(c, billId) { return P((await pool.query(`SELECT COALESCE(SUM(amount),0) a FROM acct.bill_allocations WHERE company_id=$1 AND bill_voucher_id=$2`, [c, billId])).rows[0].a); }
  async function allocatedFromSettle(c, settleId) { return P((await pool.query(`SELECT COALESCE(SUM(amount),0) a FROM acct.bill_allocations WHERE company_id=$1 AND settle_voucher_id=$2`, [c, settleId])).rows[0].a); }

  // Open bills for a party: posted vouchers that increase the party on the bill
  // side, net of what has already been allocated against them.
  async function openBills(partyLedgerId) {
    const c = await cid();
    const side = await billSide(partyLedgerId);
    const col = side === 'Cr' ? 'cr_amount' : 'dr_amount';
    const rows = (await pool.query(
      `SELECT v.voucher_id, v.voucher_no, v.voucher_date, v.reference_no, v.narration,
              SUM(jl.${col}) AS bill_amount
         FROM acct.journal_lines jl JOIN acct.journal_entries je ON je.je_id=jl.je_id JOIN acct.vouchers v ON v.voucher_id=je.voucher_id
        WHERE je.company_id=$1 AND jl.ledger_id=$2
        GROUP BY v.voucher_id, v.voucher_no, v.voucher_date, v.reference_no, v.narration
        HAVING SUM(jl.${col}) > 0
        ORDER BY v.voucher_date, v.voucher_no`, [c, partyLedgerId])).rows;
    const out = [];
    for (const r of rows) {
      const bill = P(r.bill_amount); const alloc = await allocatedToBill(c, r.voucher_id);
      out.push({ voucher_id: r.voucher_id, voucher_no: r.voucher_no, voucher_date: r.voucher_date,
        reference_no: r.reference_no, narration: r.narration,
        bill_amount: S(bill), allocated: S(alloc), outstanding: S(bill - alloc) });
    }
    return { party_ledger_id: partyLedgerId, bill_side: side, bills: out, open: out.filter((b) => P(b.outstanding) > 0) };
  }

  // Unallocated amount available on a settlement voucher (the opposite side).
  async function settlementAvailable(partyLedgerId, settleVoucherId) {
    const c = await cid();
    const side = await billSide(partyLedgerId);
    const eff = await effect(c, settleVoucherId, partyLedgerId);
    const settle = side === 'Cr' ? eff.dr : eff.cr; // creditor bill=Cr so settlement reduces via Dr
    const used = await allocatedFromSettle(c, settleVoucherId);
    return { settle: S(settle), allocated: S(used), available: S(settle - used) };
  }

  // Allocate a settlement across one or more bills. Validates every constraint
  // before writing anything (all-or-nothing).
  async function allocate({ party_ledger_id, settle_voucher_id, lines }, user) {
    if (!party_ledger_id || !settle_voucher_id) throw new R.AccountingError('party_ledger_id and settle_voucher_id are required', 'ACCT_INVALID');
    if (!Array.isArray(lines) || !lines.length) throw new R.AccountingError('Provide at least one bill allocation line', 'ACCT_INVALID');
    const c = await cid();
    const avail = P((await settlementAvailable(party_ledger_id, settle_voucher_id)).available);
    const open = await openBills(party_ledger_id);
    const byId = new Map(open.bills.map((b) => [b.voucher_id, b]));
    let total = 0;
    for (const ln of lines) {
      const amt = P(ln.amount);
      if (amt <= 0) throw new R.AccountingError('Allocation amount must be positive', 'ACCT_INVALID');
      if (ln.bill_voucher_id === settle_voucher_id) throw new R.AccountingError('A voucher cannot settle itself', 'ACCT_INVALID');
      const b = byId.get(ln.bill_voucher_id);
      if (!b) throw new R.AccountingError(`Bill ${ln.bill_voucher_id} is not an open bill for this party`, 'ACCT_INVALID');
      if (amt > P(b.outstanding)) throw new R.AccountingError(`Allocation ${S(amt)} exceeds bill ${b.voucher_no} outstanding ${b.outstanding}`, 'ACCT_CONFLICT');
      total += amt;
    }
    if (total > avail) throw new R.AccountingError(`Total allocation ${S(total)} exceeds settlement available ${S(avail)}`, 'ACCT_CONFLICT');
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      for (const ln of lines) {
        await c2.query(
          `INSERT INTO acct.bill_allocations (company_id, party_ledger_id, bill_voucher_id, settle_voucher_id, amount, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [c, party_ledger_id, ln.bill_voucher_id, settle_voucher_id, S(P(ln.amount)), (user && user.username) || 'system']);
      }
      await c2.query(`INSERT INTO acct.audit_log (company_id, entity, entity_id, action, actor, detail) VALUES ($1,'allocation',$2,'ALLOCATE',$3,$4)`,
        [c, settle_voucher_id, (user && user.username) || null, JSON.stringify({ party_ledger_id, lines })]);
      await c2.query('COMMIT');
    } catch (e) { await c2.query('ROLLBACK').catch(() => {}); throw e; } finally { c2.release(); }
    return { settle_voucher_id, allocated: S(total), ...(await openBills(party_ledger_id)) };
  }

  async function unallocate(allocId, user) {
    const c = await cid();
    const r = (await pool.query(`DELETE FROM acct.bill_allocations WHERE company_id=$1 AND alloc_id=$2 RETURNING settle_voucher_id, party_ledger_id`, [c, allocId])).rows[0];
    if (!r) throw new R.AccountingError(`Allocation ${allocId} not found`, 'ACCT_NOT_FOUND');
    await pool.query(`INSERT INTO acct.audit_log (company_id, entity, entity_id, action, actor) VALUES ($1,'allocation',$2,'UNALLOCATE',$3)`, [c, String(allocId), (user && user.username) || null]);
    return { removed: allocId };
  }

  // Bill-wise outstanding across ALL parties (Busy "Outstanding / Bills Receivable|
  // Payable"): every open bill with its party, age in days, net of allocations.
  async function openItemsAll({ kind = 'RECEIVABLE', as_of } = {}) {
    const c = await cid();
    const toD = (as_of ? String(as_of).slice(0, 10) : new Date().toISOString().slice(0, 10));
    const targetCode = kind === 'PAYABLE' ? 'SUNDRY_CREDITORS' : 'SUNDRY_DEBTORS';
    const col = kind === 'PAYABLE' ? 'cr_amount' : 'dr_amount';
    const groups = await svc.listGroups();
    const byId = new Map(groups.map((g) => [g.group_id, g]));
    const inGroup = (gid) => { let g = byId.get(gid); while (g) { if (g.code === targetCode) return true; g = g.parent_id ? byId.get(g.parent_id) : null; } return false; };
    const parties = (await pool.query(`SELECT ledger_id, name, group_id FROM acct.ledgers WHERE company_id=$1 AND ledger_type='PARTY'`, [c])).rows.filter((l) => inGroup(l.group_id));
    const zero = { bill_amount: S(0), allocated: S(0), outstanding: S(0) };
    if (!parties.length) return { kind, as_of: toD, rows: [], totals: zero };
    const nameById = new Map(parties.map((p) => [p.ledger_id, p.name]));
    const bills = (await pool.query(
      `SELECT jl.ledger_id, v.voucher_id, v.voucher_no, v.voucher_date, v.reference_no, SUM(jl.${col}) AS bill_amount
         FROM acct.journal_lines jl JOIN acct.journal_entries je ON je.je_id=jl.je_id JOIN acct.vouchers v ON v.voucher_id=je.voucher_id
        WHERE je.company_id=$1 AND jl.ledger_id = ANY($2) AND jl.posting_date <= $3
        GROUP BY jl.ledger_id, v.voucher_id, v.voucher_no, v.voucher_date, v.reference_no
        HAVING SUM(jl.${col}) > 0
        ORDER BY jl.ledger_id, v.voucher_date, v.voucher_no`, [c, parties.map((p) => p.ledger_id), toD])).rows;
    const allocRows = (await pool.query(`SELECT bill_voucher_id, SUM(amount) a FROM acct.bill_allocations WHERE company_id=$1 GROUP BY bill_voucher_id`, [c])).rows;
    const allocBy = new Map(allocRows.map((r) => [r.bill_voucher_id, P(r.a)]));
    const toMs = new Date(toD + 'T00:00:00Z').getTime();
    const rows = []; const T = { bill: 0, allocated: 0, outstanding: 0 };
    for (const b of bills) {
      const bill = P(b.bill_amount); const alloc = allocBy.get(b.voucher_id) || 0;
      const outst = bill - alloc; if (outst <= 0) continue;
      const vd = ymd(b.voucher_date);
      const days = Math.max(0, Math.floor((toMs - new Date(vd + 'T00:00:00Z').getTime()) / 86400000));
      T.bill += bill; T.allocated += alloc; T.outstanding += outst;
      rows.push({ party_name: nameById.get(b.ledger_id), voucher_no: b.voucher_no, voucher_date: vd,
        reference_no: b.reference_no, bill_amount: S(bill), allocated: S(alloc), outstanding: S(outst), days });
    }
    return { kind, as_of: toD, rows, totals: { bill_amount: S(T.bill), allocated: S(T.allocated), outstanding: S(T.outstanding) } };
  }

  async function listForVoucher(voucherId) {
    const c = await cid();
    return (await pool.query(
      `SELECT a.*, bv.voucher_no AS bill_no, sv.voucher_no AS settle_no
         FROM acct.bill_allocations a
         JOIN acct.vouchers bv ON bv.voucher_id=a.bill_voucher_id
         JOIN acct.vouchers sv ON sv.voucher_id=a.settle_voucher_id
        WHERE a.company_id=$1 AND (a.bill_voucher_id=$2 OR a.settle_voucher_id=$2) ORDER BY a.alloc_id`, [c, voucherId])).rows;
  }

  return { billSide, openBills, openItemsAll, settlementAvailable, allocate, unallocate, listForVoucher };
};
