// Accounting engine — integration tests (Phase 1) against a SCRATCH database.
//
// Runs on dhown_mes_staging (override: ACCT_TEST_DB). It resets the `acct`
// schema there, so it refuses to touch a production database.
//
//   node tests/accounting.e2e.js
//
// Covers: posting, idempotency, concurrent double-post, concurrent numbering,
// trial balance / ledger / day book, reversal, period lock, maker-checker,
// company isolation, and DB-level tamper resistance (append-only journals,
// deferred balance check, posted-voucher immutability).

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const DB = process.env.ACCT_TEST_DB || 'dhown_mes_staging';
if (['dhown_mes', 'vdknits_mes'].includes(DB)) {
  console.error(`Refusing to run destructive accounting tests on production DB "${DB}"`);
  process.exit(1);
}
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB, port: process.env.DB_PORT || 5432, max: 10 });
const { ensureAccountingSchema } = require('../src/lib/accounting/schema');

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const rejects = async (p, re, m) => {
  try { await p; ok(false, m, '(no error thrown)'); } catch (e) { ok(re.test(e.message), m, re.test(e.message) ? '' : `(got: ${e.message})`); }
};

const A = { username: 'acct_tester_a' };
const B = { username: 'acct_tester_b' };
const D = '2026-10-01';

(async () => {
  // Fresh acct schema on the scratch DB.
  await pool.query('DROP SCHEMA IF EXISTS acct CASCADE');
  const cid = await ensureAccountingSchema(pool);
  await ensureAccountingSchema(pool); // idempotent second run
  const svc = require('../src/lib/accounting/service')(pool);
  ok(!!cid, 'schema ensured + default company seeded (idempotent)');

  const groups = await svc.listGroups();
  const G = Object.fromEntries(groups.map((g) => [g.code, g.group_id]));
  ok(G.SUNDRY_DEBTORS && G.BANK_ACCOUNTS && G.SALES, 'standard account groups seeded', `${groups.length} groups`);

  // ── Masters ──────────────────────────────────────────────────────────────
  const bank = await svc.saveLedger(null, { name: 'HDFC Current A/c', group_id: G.BANK_ACCOUNTS, opening: { amount: '100000', side: 'Dr' } }, A);
  const cust = await svc.saveLedger(null, { name: 'Test Customer', group_id: G.SUNDRY_DEBTORS, gstin: '03AAAAA0000A1Z5' }, A);
  const capital = await svc.saveLedger(null, { name: 'Partners Capital', group_id: G.CAPITAL, opening: { amount: '100000', side: 'Cr' } }, A);
  const sales = (await svc.listLedgers({ q: 'Sales' })).find((l) => l.code === 'SALES');
  const cash = (await svc.listLedgers({})).find((l) => l.code === 'CASH');
  ok(bank.ledger_type === 'BANK' && cust.ledger_type === 'PARTY' && cust.state_code === '03', 'ledger type + state inferred from group/GSTIN');
  await rejects(svc.saveLedger(null, { name: 'Test Customer', group_id: G.SUNDRY_DEBTORS }, A), /Duplicate/, 'duplicate ledger name refused');
  const sub = await svc.createGroup({ name: 'Ludhiana Debtors', parent_id: G.SUNDRY_DEBTORS }, A);
  ok(sub.nature === 'ASSET' && sub.report === 'BS', 'sub-group inherits nature/report from its parent');

  // ── Sales journal: Dr Customer 1180 / Cr Sales 1180 ──────────────────────
  const v1 = await svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D, narration: 'Credit sale',
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '1180' }, { ledger_id: sales.ledger_id, cr_amount: '1180' }] }, A);
  ok(v1.status === 'DRAFT' && !v1.voucher_no, 'draft has no voucher number yet');
  const val = await svc.validateVoucher(v1.voucher_id, A);
  ok(val.ok && val.voucher.status === 'VALIDATED', 'validate: balanced voucher -> VALIDATED');
  const p1 = await svc.postVoucher(v1.voucher_id, A);
  ok(p1.status === 'POSTED' && p1.voucher_no === 'JV/26-27/0001', 'post assigns number JV/26-27/0001', p1.voucher_no);
  ok(!!p1.journal, 'journal entry written');
  const again = await svc.postVoucher(v1.voucher_id, A);
  ok(again.idempotent_replay && again.voucher_no === p1.voucher_no, 'posting twice is idempotent (no second journal)');
  const jeCount = (await pool.query(`SELECT COUNT(*)::int n FROM acct.journal_entries WHERE voucher_id=$1`, [v1.voucher_id])).rows[0].n;
  ok(jeCount === 1, 'exactly one journal entry for the voucher');

  // Idempotent create.
  const k1 = await svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D, idempotency_key: 'evt-123',
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '1' }, { ledger_id: sales.ledger_id, cr_amount: '1' }] }, A);
  const k2 = await svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D, idempotency_key: 'evt-123',
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '999' }, { ledger_id: sales.ledger_id, cr_amount: '999' }] }, A);
  ok(k2.idempotent_replay && k2.voucher_id === k1.voucher_id, 'same idempotency key returns the original draft');
  await svc.cancelDraft(k1.voucher_id, A);

  // ── Validation failures ──────────────────────────────────────────────────
  const bad = await svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D,
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '100' }, { ledger_id: sales.ledger_id, cr_amount: '99.99' }] }, A);
  const bv = await svc.validateVoucher(bad.voucher_id, A);
  ok(!bv.ok && bv.voucher.status === 'DRAFT', 'unbalanced voucher fails validation and stays DRAFT');
  await rejects(svc.postVoucher(bad.voucher_id, A), /do not match/, 'unbalanced voucher cannot be posted');
  await rejects(svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: '2099-01-01',
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '1' }, { ledger_id: sales.ledger_id, cr_amount: '1' }] }, A), /No financial year/, 'date outside any financial year refused');
  await rejects(svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D,
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '1.005' }, { ledger_id: sales.ledger_id, cr_amount: '1' }] }, A), /2 decimal/, 'amount with 3 decimals refused');
  await rejects(svc.createDraft({ voucher_type: 'CONTRA', voucher_date: D,
    lines: [{ ledger_id: cash.ledger_id, dr_amount: '5' }, { ledger_id: cust.ledger_id, cr_amount: '5' }] }, A).then((v) => svc.postVoucher(v.voucher_id, A)), /Contra/, 'contra with a non cash/bank account refused');

  // Receipt: Dr Bank 1180 / Cr Customer 1180
  const rc = await svc.createDraft({ voucher_type: 'RECEIPT', voucher_date: '2026-10-05', party_ledger_id: cust.ledger_id,
    lines: [{ ledger_id: bank.ledger_id, dr_amount: '1180' }, { ledger_id: cust.ledger_id, cr_amount: '1180' }] }, A);
  const rcp = await svc.postVoucher(rc.voucher_id, A);
  ok(rcp.voucher_no === 'RC/26-27/0001', 'receipt numbered in its own series', rcp.voucher_no);

  // ── Reports ──────────────────────────────────────────────────────────────
  let tb = await svc.trialBalance({ as_of: '2026-10-31' });
  ok(tb.totals.debit === tb.totals.credit, 'trial balance: period debits = credits', `${tb.totals.debit} / ${tb.totals.credit}`);
  ok(tb.totals.closing_dr === tb.totals.closing_cr, 'trial balance: closing Dr = closing Cr', `${tb.totals.closing_dr} / ${tb.totals.closing_cr}`);
  ok(tb.opening_difference.amount === '0.00', 'no opening difference (openings balanced 1L Dr / 1L Cr)');
  const custTb = tb.ledgers.find((l) => l.ledger_id === cust.ledger_id);
  ok(!custTb || custTb.closing.amount === '0.00', 'customer nets to zero after sale + receipt');
  const bal = await svc.ledgerBalance(bank.ledger_id, '2026-10-31');
  ok(bal.amount === '101180.00' && bal.side === 'Dr', 'bank balance = opening 1,00,000 + 1,180 receipt', `${bal.amount} ${bal.side}`);
  const st = await svc.ledgerStatement({ ledger_id: cust.ledger_id, from: '2026-10-01', to: '2026-10-31' });
  ok(st.lines.length === 2 && st.total_debit === '1180.00' && st.total_credit === '1180.00' && st.closing.amount === '0.00',
    'ledger statement: 2 lines, running balance closes at 0');
  const db = await svc.dayBook({ from: '2026-10-01', to: '2026-10-31' });
  ok(db.vouchers.length === 2, 'day book lists the 2 posted vouchers', `${db.vouchers.length}`);

  // ── Reversal ─────────────────────────────────────────────────────────────
  const rev = await svc.reverseVoucher(rcp.voucher_id, {}, B);
  ok(rev.original.status === 'REVERSED' && rev.reversal.status === 'POSTED' && rev.reversal.voucher_no === 'RV/26-27/0001',
    'reversal posts RV/26-27/0001 and marks the receipt REVERSED');
  await rejects(svc.reverseVoucher(rcp.voucher_id, {}, B), /already reversed/, 'cannot reverse twice');
  const bal2 = await svc.ledgerBalance(bank.ledger_id, '2026-10-31');
  ok(bal2.amount === '100000.00', 'after reversal the bank is back to its opening', bal2.amount);
  tb = await svc.trialBalance({ as_of: '2026-10-31' });
  ok(tb.totals.debit === tb.totals.credit && tb.totals.closing_dr === tb.totals.closing_cr, 'trial balance still balances after reversal');
  await rejects(svc.updateDraft(rcp.voucher_id, { narration: 'edit' }, A), /cannot be edited/, 'a reversed voucher cannot be edited');

  // ── Maker-checker ────────────────────────────────────────────────────────
  const mc = await svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D,
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '10' }, { ledger_id: sales.ledger_id, cr_amount: '10' }] }, A);
  await svc.validateVoucher(mc.voucher_id, A);
  await rejects(svc.approveVoucher(mc.voucher_id, A), /Maker-checker/, 'maker cannot approve their own voucher');
  const ap = await svc.approveVoucher(mc.voucher_id, B);
  ok(ap.status === 'APPROVED' && ap.approved_by === B.username, 'a different user approves');
  const ed = await svc.updateDraft(mc.voucher_id, { narration: 'changed after approval' }, A);
  ok(ed.status === 'DRAFT' && !ed.approved_by, 'editing an approved voucher sends it back to DRAFT');
  await svc.cancelDraft(mc.voucher_id, A);

  // ── Period lock ──────────────────────────────────────────────────────────
  const per = (await svc.listPeriods()).find((p) => p.start_date <= '2026-11-15' && p.end_date >= '2026-11-15');
  await svc.setPeriodStatus(per.period_id, 'CLOSED', null, B);
  const pv = await svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: '2026-11-15',
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '5' }, { ledger_id: sales.ledger_id, cr_amount: '5' }] }, A);
  await rejects(svc.postVoucher(pv.voucher_id, A), /CLOSED/, 'posting into a CLOSED period is refused');
  await rejects(svc.setPeriodStatus(per.period_id, 'OPEN', '', B), /needs a reason/, 'reopening requires a reason');
  await svc.setPeriodStatus(per.period_id, 'OPEN', 'test reopen', B);
  const pvp = await svc.postVoucher(pv.voucher_id, A);
  ok(pvp.status === 'POSTED', 'after reopening (with reason) the voucher posts');

  // ── Concurrency ──────────────────────────────────────────────────────────
  const cc = await svc.createDraft({ voucher_type: 'PAYMENT', voucher_date: D,
    lines: [{ ledger_id: cust.ledger_id, dr_amount: '7' }, { ledger_id: bank.ledger_id, cr_amount: '7' }] }, A);
  const both = await Promise.allSettled([svc.postVoucher(cc.voucher_id, A), svc.postVoucher(cc.voucher_id, A), svc.postVoucher(cc.voucher_id, A)]);
  const jeN = (await pool.query(`SELECT COUNT(*)::int n FROM acct.journal_entries WHERE voucher_id=$1`, [cc.voucher_id])).rows[0].n;
  ok(both.every((r) => r.status === 'fulfilled') && jeN === 1, 'three simultaneous posts of one voucher -> exactly one journal');

  const drafts = [];
  for (let i = 0; i < 6; i++) {
    drafts.push(await svc.createDraft({ voucher_type: 'CONTRA', voucher_date: D,
      lines: [{ ledger_id: cash.ledger_id, dr_amount: String(i + 1) }, { ledger_id: bank.ledger_id, cr_amount: String(i + 1) }] }, A));
  }
  const posted = await Promise.all(drafts.map((d) => svc.postVoucher(d.voucher_id, A)));
  const nos = posted.map((p) => p.voucher_no).sort();
  const expect = ['CN/26-27/0001', 'CN/26-27/0002', 'CN/26-27/0003', 'CN/26-27/0004', 'CN/26-27/0005', 'CN/26-27/0006'];
  ok(JSON.stringify(nos) === JSON.stringify(expect), 'six concurrent posts get six unique, gap-free numbers', nos.join(','));

  // ── Company isolation ────────────────────────────────────────────────────
  const other = (await pool.query(`INSERT INTO acct.companies (name) VALUES ('Other Co') RETURNING company_id`)).rows[0].company_id;
  const og = (await pool.query(`INSERT INTO acct.account_groups (company_id, code, name, nature, report) VALUES ($1,'X','X','ASSET','BS') RETURNING group_id`, [other])).rows[0].group_id;
  const ol = (await pool.query(`INSERT INTO acct.ledgers (company_id, name, group_id) VALUES ($1,'Foreign Ledger',$2) RETURNING ledger_id`, [other, og])).rows[0].ledger_id;
  await rejects(svc.createDraft({ voucher_type: 'JOURNAL', voucher_date: D,
    lines: [{ ledger_id: ol, dr_amount: '1' }, { ledger_id: sales.ledger_id, cr_amount: '1' }] }, A), /not found/, "another company's ledger cannot be used");

  // ── DB-level tamper resistance ───────────────────────────────────────────
  await rejects(pool.query(`UPDATE acct.journal_lines SET dr_amount = dr_amount + 1 WHERE company_id=$1`, [cid]), /append-only/, 'UPDATE on journal_lines blocked by DB');
  await rejects(pool.query(`DELETE FROM acct.journal_entries WHERE company_id=$1`, [cid]), /append-only/, 'DELETE on journal_entries blocked by DB');
  await rejects(pool.query(`DELETE FROM acct.audit_log`), /append-only/, 'audit log cannot be deleted');
  await rejects(pool.query(`UPDATE acct.vouchers SET narration='tampered' WHERE voucher_id=$1`, [v1.voucher_id]), /cannot be modified/, 'posted voucher row cannot be modified in the DB');
  await rejects(pool.query(`DELETE FROM acct.vouchers WHERE voucher_id=$1`, [v1.voucher_id]), /cannot be deleted/, 'posted voucher cannot be deleted in the DB');
  await rejects(pool.query(`INSERT INTO acct.voucher_lines (voucher_id, line_no, ledger_id, dr_amount) VALUES ($1, 99, $2, 1)`, [v1.voucher_id, cust.ledger_id]), /cannot be changed/, 'lines cannot be added to a posted voucher');
  // An unbalanced journal written straight into the DB is rejected at COMMIT.
  {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const vv = (await c.query(`INSERT INTO acct.vouchers (company_id, fy_id, voucher_type, voucher_date, created_by) VALUES ($1,$2,'JOURNAL',$3,'x') RETURNING voucher_id, fy_id`, [cid, rcp.fy_id, D])).rows[0];
      const je = (await c.query(`INSERT INTO acct.journal_entries (company_id, voucher_id, fy_id, period_id, posting_date) VALUES ($1,$2,$3,(SELECT period_id FROM acct.periods WHERE company_id=$1 AND $4::date BETWEEN start_date AND end_date),$4) RETURNING je_id`, [cid, vv.voucher_id, vv.fy_id, D])).rows[0];
      await c.query(`INSERT INTO acct.journal_lines (je_id, company_id, line_no, ledger_id, posting_date, dr_amount) VALUES ($1,$2,1,$3,$4,100)`, [je.je_id, cid, cust.ledger_id, D]);
      await c.query(`INSERT INTO acct.journal_lines (je_id, company_id, line_no, ledger_id, posting_date, cr_amount) VALUES ($1,$2,2,$3,$4,99)`, [je.je_id, cid, sales.ledger_id, D]);
      await c.query('COMMIT');
      ok(false, 'unbalanced journal written directly is rejected at COMMIT', '(committed!)');
    } catch (e) {
      ok(/does not balance/.test(e.message), 'unbalanced journal written directly is rejected at COMMIT', /does not balance/.test(e.message) ? '' : e.message);
      await c.query('ROLLBACK').catch(() => {});
    } finally { c.release(); }
  }

  // ── Operations link (party sync + sales invoice -> voucher) ──────────────
  const ops = require('../src/lib/accounting/ops-link')(pool);
  // A MES customer + an issued sales invoice on the scratch DB.
  const pid = (await pool.query(`INSERT INTO public.partners (partner_code, company_name, gstin, is_active) VALUES ('ZZLINK','ZZ Link Customer','03ZZLINK0000Z1Z5',true) ON CONFLICT (partner_code) DO UPDATE SET company_name=EXCLUDED.company_name RETURNING partner_id`)).rows[0].partner_id;
  const inv = (await pool.query(
    `INSERT INTO public.tax_invoices (invoice_number, invoice_date, partner_id, customer_name, customer_gstin, status,
       taxable_value, cgst_amount, sgst_amount, igst_amount, total_tax, round_off, grand_total)
     VALUES ('ZZINV-001','2026-10-02',$1,'ZZ Link Customer','03ZZLINK0000Z1Z5','ISSUED',10000,900,900,0,1800,0,11800)
     ON CONFLICT (invoice_number) DO UPDATE SET status='ISSUED' RETURNING invoice_id`, [pid])).rows[0].invoice_id;

  const ledBefore = (await svc.listLedgers({})).length;
  const pl = await ops.ensurePartyLedger(pid, 'DEBTOR');
  ok(!!pl, 'party sync creates an acct ledger for a MES partner');
  const pl2 = await ops.ensurePartyLedger(pid, 'DEBTOR');
  ok(pl === pl2, 'party sync is idempotent (one ledger per partner)');
  ok((await svc.listLedgers({})).length === ledBefore + 1, 'exactly one new party ledger');

  // Shadow (DRAFT) mode — no posting, for reconciliation vs Busy.
  const d = await ops.postSalesInvoice(inv, { mode: 'DRAFT' }, A);
  ok(d.action === 'drafted' && d.voucher.status === 'DRAFT', 'invoice link in shadow mode creates a DRAFT voucher');
  const d2 = await ops.postSalesInvoice(inv, { mode: 'DRAFT' }, A);
  ok(d2.action === 'already_linked' && d2.voucher.voucher_id === d.voucher.voucher_id, 'linking the same invoice again is idempotent');
  ok(d.voucher.total_dr === '11800.00' && d.voucher.total_cr === '11800.00', 'drafted sales voucher balances to the invoice total');

  // Now POST it (post-cutover mode). Same idempotency key -> upgrades the same voucher.
  const postedInv = await ops.postSalesInvoice(inv, { mode: 'POST' }, A);
  ok(postedInv.action === 'posted' && postedInv.voucher.status === 'POSTED', 'POST mode posts the sales voucher', postedInv.voucher_no);
  // Customer debited the grand total; sales + output tax credited.
  const custBal = await svc.ledgerBalance(pl, '2026-10-31');
  ok(custBal.amount === '11800.00' && custBal.side === 'Dr', 'customer ledger debited 11,800', `${custBal.amount} ${custBal.side}`);
  const salesLed = (await svc.listLedgers({ q: 'Sales' })).find((l) => l.code === 'SALES');
  const salesBal = await svc.ledgerBalance(salesLed.ledger_id, '2026-10-31');
  ok(salesBal.amount === '11180.00' && salesBal.side === 'Cr', 'Sales credited (incl earlier 1,180 + 10,000 invoice)', `${salesBal.amount} ${salesBal.side}`);
  const tbL = await svc.trialBalance({ as_of: '2026-10-31' });
  ok(tbL.totals.closing_dr === tbL.totals.closing_cr, 'trial balance still ties after the invoice posting');

  // A cancelled invoice is refused.
  await pool.query(`UPDATE public.tax_invoices SET status='CANCELLED' WHERE invoice_id=$1`, [inv]);
  const inv2 = (await pool.query(
    `INSERT INTO public.tax_invoices (invoice_number, invoice_date, partner_id, customer_name, status, taxable_value, igst_amount, total_tax, grand_total)
     VALUES ('ZZINV-DRAFT','2026-10-03',$1,'ZZ Link Customer','DRAFT',500,90,90,590)
     ON CONFLICT (invoice_number) DO UPDATE SET status='DRAFT' RETURNING invoice_id`, [pid])).rows[0].invoice_id;
  await rejects(ops.postSalesInvoice(inv2, { mode: 'DRAFT' }, A), /is DRAFT/, 'a DRAFT invoice is not linked to the ledger');

  // ── Document voucher (Sales from item lines, GST computed by the engine) ──
  const docs = require('../src/lib/accounting/documents')(pool);
  const dv = await docs.create({
    voucher_type: 'SALES', voucher_date: '2026-10-10', party_ledger_id: pl, reference_no: 'DOC-1', intra: true,
    items: [{ item_name: 'Single Jersey', hsn_code: '6006', quantity: 100, uom: 'KG', rate: '250', gst_rate: 5 }],
  }, A);
  ok(dv.computed.taxable === '25000.00' && dv.computed.cgst === '625.00' && dv.computed.grand === '26250.00', 'document engine computes taxable/CGST/grand', `${dv.computed.grand}`);
  ok(dv.items.length === 1 && dv.items[0].line_total === '26250.00', 'item detail stored on the voucher');
  ok(dv.total_dr === '26250.00' && dv.total_dr === dv.total_cr, 'document voucher lines balance');
  const dvp = await svc.postVoucher(dv.voucher_id, A);
  ok(dvp.status === 'POSTED' && dvp.voucher_no.startsWith('SL/'), 'document sales voucher posts', dvp.voucher_no);

  // ── P&L and Balance Sheet ────────────────────────────────────────────────
  const pnl = await svc.profitAndLoss({ as_of: '2026-10-31' });
  // Sales so far: v1 1,180 + invoice 10,000 + doc 25,000 = 36,180 income.
  ok(pnl.total_income === '36180.00' && pnl.is_profit, 'P&L total income = 36,180 (profit)', `${pnl.total_income}`);
  const bs = await svc.balanceSheet({ as_of: '2026-10-31' });
  ok(bs.balanced, 'balance sheet balances (Assets = Liabilities + net profit)', `A ${bs.total_assets} / L ${bs.total_liabilities}`);
  ok(bs.net_profit === pnl.net_profit, 'balance sheet carries the P&L net profit');

  // ── Phase 3: Cash & Bank book + receivables/payables ageing ──────────────
  const cbb = await svc.cashBankBook({ as_of: '2026-10-31' });
  ok(cbb.ledgers.some((l) => l.name === 'HDFC Current A/c' && l.kind === 'BANK'), 'cash/bank book lists the bank account');
  ok(cbb.ledgers.some((l) => l.kind === 'CASH'), 'cash/bank book lists the cash account');
  const cbbBank = cbb.ledgers.find((l) => l.name === 'HDFC Current A/c');
  const bankBalNow = await svc.ledgerBalance(bank.ledger_id, '2026-10-31');
  ok(cbbBank.balance.amount === bankBalNow.amount && cbbBank.balance.side === bankBalNow.side,
    'cash/bank book bank balance matches the ledger balance', `${cbbBank.balance.amount} ${cbbBank.balance.side}`);

  const ag = await svc.ageing({ kind: 'RECEIVABLE', as_of: '2026-10-31' });
  ok(ag.control_account === 'SUNDRY_DEBTORS', 'receivables ageing uses the Sundry Debtors control account');
  ok(ag.reconciled, 'receivables ageing reconciles to the control account', `aged net vs ctrl ${ag.control_balance}`);
  const agPl = ag.rows.find((r) => r.ledger_id === pl);
  // ZZ Link Customer: invoice 11,800 (2-Oct) + document 26,250 (10-Oct), no receipts.
  ok(agPl && agPl.outstanding === '38050.00', 'linked customer outstanding aged at 38,050', agPl && agPl.outstanding);
  ok(agPl && agPl.current === '38050.00' && agPl.d90_plus === '0.00', 'both invoices fall in the current bucket (<=30 days)');
  const agP = await svc.ageing({ kind: 'PAYABLE', as_of: '2026-10-31' });
  ok(agP.control_account === 'SUNDRY_CREDITORS' && agP.reconciled, 'payables ageing reconciles to Sundry Creditors');

  // ── Phase 4: MES auto-post via transactional outbox ──────────────────────
  const ob = require('../src/lib/accounting/outbox')(pool);
  const pols = await ob.listPolicies();
  ok(['GRN_RECEIPT', 'DISPATCH_COGS', 'JOBWORK_CHARGES', 'WASTAGE'].every((e) => pols.some((p) => p.event_type === e && p.is_active && p.approved_by)),
    'four pre-approved posting policies are seeded', `${pols.length} policies`);

  const sup = await svc.saveLedger(null, { name: 'Yarn Supplier Co', group_id: G.SUNDRY_CREDITORS, gstin: '03BBBBB1111B1Z5' }, A);
  const invLed = (await svc.listLedgers({})).find((l) => l.code === 'INVENTORY');
  ok(!!invLed, 'Inventory system ledger seeded');

  // Idempotent enqueue: twice => one outbox row.
  const e1 = await ob.enqueue({ event_type: 'GRN_RECEIPT', source_ref: 'GRN-1', event_date: '2026-10-12',
    payload: { value: '10000', gst_rate: 5, intra: true, party_ledger_id: sup.ledger_id } });
  const e1b = await ob.enqueue({ event_type: 'GRN_RECEIPT', source_ref: 'GRN-1', event_date: '2026-10-12', payload: { value: '999' } });
  ok(e1.created && !e1b.created && e1.outbox_id === e1b.outbox_id, 'enqueue is idempotent on (event, source_ref) — a retry adds no row');

  const prev = await ob.preview({ event_type: 'GRN_RECEIPT', payload: { value: '10000', gst_rate: 5, intra: true } });
  ok(prev.lines.length >= 2, 'preview builds balanced lines without posting');

  // Process twice — exactly one voucher (POST mode).
  const grnPost = await ob.process(e1.outbox_id, { mode: 'POST' }, A);
  ok(grnPost.action === 'posted' && grnPost.status === 'POSTED', 'GRN event posts a voucher', grnPost.voucher_no);
  const grnReplay = await ob.process(e1.outbox_id, { mode: 'POST' }, A);
  ok(grnReplay.voucher_id === grnPost.voucher_id && grnReplay.replay, 'reprocessing the same outbox row is idempotent (no second voucher)');
  const grnCount = (await pool.query(`SELECT COUNT(*)::int n FROM acct.vouchers WHERE company_id=$1 AND idempotency_key='MES:GRN_RECEIPT:GRN-1'`, [cid])).rows[0].n;
  ok(grnCount === 1, 'exactly one voucher exists for the GRN event', `count=${grnCount}`);

  // GL effect: Inventory Dr 10,000; supplier Cr 10,500 (incl GST).
  const invBal = await svc.ledgerBalance(invLed.ledger_id, '2026-10-31');
  ok(invBal.amount === '10000.00' && invBal.side === 'Dr', 'Inventory debited 10,000 by the GRN', `${invBal.amount} ${invBal.side}`);
  const supBal = await svc.ledgerBalance(sup.ledger_id, '2026-10-31');
  ok(supBal.amount === '10500.00' && supBal.side === 'Cr', 'supplier credited 10,500 (value + input GST)', `${supBal.amount} ${supBal.side}`);

  // Dispatch/COGS reduces inventory at cost.
  const disp = await ob.emit({ event_type: 'DISPATCH_COGS', source_ref: 'DISP-1', event_date: '2026-10-15', payload: { cost: '7500' } }, { mode: 'POST' }, A);
  ok(disp.action === 'posted', 'dispatch COGS posts', disp.voucher_no);
  const invBal2 = await svc.ledgerBalance(invLed.ledger_id, '2026-10-31');
  ok(invBal2.amount === '10000.00' && invBal2.side === 'Dr', 'Inventory unchanged by COGS (Finished Goods relieved instead)', `${invBal2.amount}`);
  const fgLedChk = (await svc.listLedgers({})).find((l) => l.code === 'FINISHED_GOODS');
  const fgBal2 = await svc.ledgerBalance(fgLedChk.ledger_id, '2026-10-31');
  ok(fgBal2.amount === '7500.00' && fgBal2.side === 'Cr', 'COGS relieves Finished Goods by 7,500', `${fgBal2.amount} ${fgBal2.side}`);

  // Concurrency: three simultaneous processes of one wastage event -> one voucher.
  const w = await ob.enqueue({ event_type: 'WASTAGE', source_ref: 'W-1', event_date: '2026-10-16', payload: { cost: '500' } });
  const races = await Promise.allSettled([ob.process(w.outbox_id, { mode: 'POST' }, A), ob.process(w.outbox_id, { mode: 'POST' }, A), ob.process(w.outbox_id, { mode: 'POST' }, A)]);
  ok(races.every((r) => r.status === 'fulfilled'), 'all three concurrent wastage processes resolve');
  const wCount = (await pool.query(`SELECT COUNT(*)::int n FROM acct.vouchers WHERE company_id=$1 AND idempotency_key='MES:WASTAGE:W-1'`, [cid])).rows[0].n;
  ok(wCount === 1, 'concurrent processing produced exactly one wastage voucher', `count=${wCount}`);
  const invBal3 = await svc.ledgerBalance(invLed.ledger_id, '2026-10-31');
  ok(invBal3.amount === '9500.00' && invBal3.side === 'Dr', 'Inventory reduced to 9,500 after wastage', `${invBal3.amount}`);

  // Shadow mode leaves the ledger untouched (DRAFT only).
  const sh = await ob.emit({ event_type: 'GRN_RECEIPT', source_ref: 'GRN-SHADOW', event_date: '2026-10-17', payload: { value: '5000' } }, { mode: 'DRAFT' }, A);
  ok(sh.action === 'drafted' && sh.status === 'DRAFT', 'shadow mode creates a DRAFT only (Busy stays the record)');
  const obList = await ob.list({ status: 'PROCESSED' });
  ok(obList.length >= 4, 'outbox lists processed rows with their vouchers', `${obList.length}`);
  const tb4 = await svc.trialBalance({ as_of: '2026-10-31' });
  ok(tb4.totals.closing_dr === tb4.totals.closing_cr, 'trial balance still ties after MES auto-posts');

  // ── Phase 4 wiring: bridge REAL MES tables (grn / cost_entries) -> outbox ──
  const meb = require('../src/lib/accounting/mes-events')(pool);
  const supPid = (await pool.query(`INSERT INTO public.partners (partner_code, company_name, gstin, is_active) VALUES ('ZZSUP','ZZ Supplier Co','03ZZSUP0000Z1Z5',true) ON CONFLICT (partner_code) DO UPDATE SET company_name=EXCLUDED.company_name RETURNING partner_id`)).rows[0].partner_id;
  const grnId = (await pool.query(`INSERT INTO public.grn (grn_number, supplier_name, receipt_date, status, partner_id) VALUES ('ZZGRN1','ZZ Supplier Co','2026-10-14','APPROVED',$1) RETURNING grn_id`, [supPid])).rows[0].grn_id;
  await pool.query(`INSERT INTO public.yarn_lots (lot_number, grn_id, yarn_type, net_weight_kg, current_stock_kg, rate_per_kg) VALUES ('ZZL1',$1,'Polyester',100,100,150),('ZZL2',$1,'Polyester',50,50,200)`, [grnId]);
  const weId = (await pool.query(`INSERT INTO public.cost_entries (reference_type,reference_id,cost_component,amount_rs,quantity_kg) VALUES ('ROLL','ZZR1','WASTAGE',500,5) RETURNING entry_id`)).rows[0].entry_id;
  const jwId = (await pool.query(`INSERT INTO public.cost_entries (reference_type,reference_id,cost_component,amount_rs,quantity_kg) VALUES ('BATCH','ZZB1','JOBWORK_DYEING',2000,100) RETURNING entry_id`)).rows[0].entry_id;

  const sync1 = await meb.syncAll({ mode: 'DRAFT' }, A);
  ok(sync1.grns.emitted >= 1 && sync1.cost_entries.emitted >= 2, 'MES sync emits GRN + cost events (wastage/job-work/conversion)', JSON.stringify({ grn: sync1.grns.emitted, ce: sync1.cost_entries.emitted }));
  const obGrn = (await ob.list({})).find((r) => r.source_ref === `GRN:${grnId}`);
  ok(obGrn && obGrn.voucher_id, 'GRN outbox row produced a voucher');
  const grnV = await svc.getVoucher(obGrn.voucher_id);
  ok(grnV.total_dr === '25000.00', 'GRN voucher valued at the yarn cost (100*150 + 50*200)', grnV.total_dr);
  await meb.syncAll({ mode: 'DRAFT' }, A); // re-run
  const nGrn = (await pool.query(`SELECT COUNT(*)::int n FROM acct.vouchers WHERE company_id=$1 AND idempotency_key='MES:GRN_RECEIPT:GRN:'||$2`, [cid, grnId])).rows[0].n;
  ok(nGrn === 1, 're-syncing the MES tables is idempotent (one GRN voucher)', `count=${nGrn}`);

  // DISPATCH_COGS at the actual accumulated roll cost.
  await pool.query(`INSERT INTO public.cost_entries (reference_type,reference_id,cost_component,amount_rs,quantity_kg) VALUES ('ROLL','90001','YARN_COST',1200,10)`);
  const dispId = (await pool.query(`INSERT INTO public.dispatch_challans (dispatch_number, customer_name, dispatch_date, status) VALUES ('ZZD1','ZZ Customer','2026-10-18','DISPATCHED') RETURNING dispatch_id`)).rows[0].dispatch_id;
  await pool.query(`INSERT INTO public.dispatch_items (dispatch_id, roll_id, weight_kg) VALUES ($1,90001,10)`, [dispId]);
  const sd = await meb.syncDispatch({ mode: 'POST' }, A);
  ok(sd.emitted >= 1, 'dispatch sync emits a DISPATCH_COGS event', JSON.stringify({ emitted: sd.emitted, skipped: sd.skipped }));
  const dispOb = (await ob.list({})).find((r) => r.source_ref === `DISP:${dispId}`);
  const dispV = await svc.getVoucher(dispOb.voucher_id);
  ok(dispV.total_dr === '1200.00' && dispV.status === 'POSTED', 'COGS voucher = accumulated roll cost 1,200, posted', dispV.total_dr);

  // Valued stock status (yarn lots seeded above: 100*150 + 50*200 = 25,000).
  const stk = await require('../src/lib/accounting/stock-valuation')(pool).valuedStock({ as_of: '2026-10-31' });
  ok(stk.yarn.total_value === 25000, 'valued stock: yarn at FIFO lot cost = 25,000', String(stk.yarn.total_value));
  ok(stk.gl_stock !== null, 'valued stock reports the Raw/WIP/Finished Goods GL ledgers');

  // Full WIP cost cycle: Raw → WIP (issue + conversion) → Finished Goods.
  const invBeforeWip = await svc.ledgerBalance(invLed.ledger_id, '2026-10-31'); // 9,500 Dr
  await ob.emit({ event_type: 'ISSUE_TO_WIP', source_ref: 'ISS-X', event_date: '2026-10-19', payload: { cost: '4000' } }, { mode: 'POST' }, A);
  await ob.emit({ event_type: 'CONVERSION_APPLIED', source_ref: 'CONV-X', event_date: '2026-10-19', payload: { cost: '1000' } }, { mode: 'POST' }, A);
  await ob.emit({ event_type: 'PRODUCTION_OUTPUT', source_ref: 'PROD-X', event_date: '2026-10-19', payload: { cost: '5000' } }, { mode: 'POST' }, A);
  const wipLed = (await svc.listLedgers({})).find((l) => l.code === 'WIP');
  const wipBal = await svc.ledgerBalance(wipLed.ledger_id, '2026-10-31');
  ok(wipBal.amount === '0.00', 'WIP nets to 0 after issue(4000)+conversion(1000) in, production(5000) out', `${wipBal.amount} ${wipBal.side}`);
  const invAfterWip = await svc.ledgerBalance(invLed.ledger_id, '2026-10-31');
  ok(invAfterWip.amount === '5500.00' && invAfterWip.side === 'Dr', 'Inventory relieved by the yarn issue (9,500 → 5,500)', `${invAfterWip.amount}`);
  const convLed = (await svc.listLedgers({})).find((l) => l.code === 'CONVERSION_APPLIED');
  const convBal = await svc.ledgerBalance(convLed.ledger_id, '2026-10-31');
  ok(convBal.amount === '1000.00' && convBal.side === 'Cr', 'conversion cost absorbed into WIP (1,000 Cr applied)', `${convBal.amount} ${convBal.side}`);

  // ── Phase 5: Busy XML migration (dry-run, import, dedupe, reconcile, rollback) ─
  const mig = require('../src/lib/accounting/migration')(pool);
  const XML1 = `<?xml version="1.0"?>
<BusyExport Company="ZZ Co">
  <Masters>
    <Group><Name>Migrated Debtors</Name><Parent>Sundry Debtors</Parent></Group>
    <Ledger><Name>Migrated Customer</Name><Group>Migrated Debtors</Group><GSTIN>03MMMMM0000M1Z5</GSTIN><OpeningBalance>50000</OpeningBalance><DrCr>Dr</DrCr></Ledger>
    <Ledger><Name>Migrated Capital</Name><Group>Capital Account</Group><OpeningBalance>50000</OpeningBalance><DrCr>Cr</DrCr></Ledger>
  </Masters>
  <Transactions>
    <Voucher><Type>Journal</Type><Number>JVM1</Number><Date>2026-10-18</Date>
      <Line><Ledger>Migrated Customer</Ledger><DrCr>Dr</DrCr><Amount>1180</Amount></Line>
      <Line><Ledger>Sales</Ledger><DrCr>Cr</DrCr><Amount>1000</Amount></Line>
      <Line><Ledger>Output CGST</Ledger><DrCr>Cr</DrCr><Amount>90</Amount></Line>
      <Line><Ledger>Output SGST</Ledger><DrCr>Cr</DrCr><Amount>90</Amount></Line>
    </Voucher>
  </Transactions>
</BusyExport>`;

  const dry = await mig.dryRun(XML1);
  ok(dry.counts.groups_new === 1 && dry.counts.ledgers_new === 2 && dry.counts.vouchers === 1, 'dry-run counts new masters + vouchers', JSON.stringify(dry.counts));
  ok(dry.export_totals.opening_diff === '0.00' && dry.export_totals.unbalanced_vouchers === 0 && dry.ok_to_import, 'dry-run: export control totals balance');

  const imp = await mig.import(XML1, { mode: 'DRAFT', label: 'test batch' }, A);
  ok(imp.stats.groups_created === 1 && imp.stats.ledgers_created === 2 && imp.stats.vouchers_created === 1 && imp.stats.posted === 0, 'import (shadow): creates masters + a DRAFT voucher', JSON.stringify(imp.stats));
  const migCust = (await svc.listLedgers({ q: 'Migrated Customer' }))[0];
  const migCustBal = await svc.ledgerBalance(migCust.ledger_id, '2026-10-31');
  ok(migCustBal.amount === '50000.00' && migCustBal.side === 'Dr', 'opening balance migrated onto the new ledger', `${migCustBal.amount} ${migCustBal.side}`);

  const imp2 = await mig.import(XML1, { mode: 'DRAFT' }, A);
  ok(imp2.stats.groups_created === 0 && imp2.stats.ledgers_created === 0 && imp2.stats.vouchers_duplicate === 1 && imp2.stats.vouchers_created === 0, 'restartable: re-importing the same export is idempotent', JSON.stringify(imp2.stats));

  const rec = await mig.reconcile(imp.batch_id);
  ok(rec.trial_balance_ties && rec.mode === 'DRAFT', 'reconcile: trial balance ties, shadow note');

  const roll = await mig.rollback(imp.batch_id, B);
  ok(roll.cancelled === 1, 'rollback cancels the batch\x27s DRAFT voucher', JSON.stringify(roll));
  const batches = await mig.listBatches();
  ok(batches.find((b) => b.batch_id === imp.batch_id).status === 'ROLLED_BACK', 'batch marked ROLLED_BACK');

  // POST-mode import then rollback via reversal.
  const XML2 = `<BusyExport><Transactions>
    <Voucher><Type>Receipt</Type><Number>JVM2</Number><Date>2026-10-20</Date>
      <Line><Ledger>Cash</Ledger><DrCr>Dr</DrCr><Amount>500</Amount></Line>
      <Line><Ledger>Sales</Ledger><DrCr>Cr</DrCr><Amount>500</Amount></Line>
    </Voucher></Transactions></BusyExport>`;
  const impP = await mig.import(XML2, { mode: 'POST' }, A);
  ok(impP.stats.vouchers_created === 1 && impP.stats.posted === 1, 'POST-mode import posts the migrated voucher');
  const recP = await mig.reconcile(impP.batch_id, { as_of: '2026-10-31' });
  ok(recP.posted_effect.dr === '500.00' && recP.posted_effect.cr === '500.00' && recP.trial_balance_ties, 'reconcile: posted effect 500 Dr/Cr, TB ties');
  const rollP = await mig.rollback(impP.batch_id, B);
  ok(rollP.reversed === 1, 'rollback reverses the posted migrated voucher');
  const tb5 = await svc.trialBalance({ as_of: '2026-10-31' });
  ok(tb5.totals.closing_dr === tb5.totals.closing_cr, 'trial balance still ties after migration + rollback');

  // ── Bill-wise allocation (open-item) ─────────────────────────────────────
  const allocSvc = require('../src/lib/accounting/allocations')(pool);
  // Customer pays 20,000 (Dr Bank / Cr Customer) — a settlement for pl's bills.
  const payRec = await svc.createDraft({ voucher_type: 'RECEIPT', voucher_date: '2026-10-25', party_ledger_id: pl,
    lines: [{ ledger_id: bank.ledger_id, dr_amount: '20000' }, { ledger_id: pl, cr_amount: '20000' }] }, A);
  const payRecV = await svc.postVoucher(payRec.voucher_id, A);
  const ob0 = await allocSvc.openBills(pl);
  ok(ob0.open.length === 2 && ob0.bill_side === 'Dr', 'open bills lists the customer\x27s two posted invoices', `${ob0.open.length} open`);
  const avail = await allocSvc.settlementAvailable(pl, payRecV.voucher_id);
  ok(avail.available === '20000.00', 'settlement shows 20,000 available to allocate');
  const bills = ob0.open.sort((a, b) => Number(a.bill_amount) - Number(b.bill_amount));
  const res = await allocSvc.allocate({ party_ledger_id: pl, settle_voucher_id: payRecV.voucher_id,
    lines: [{ bill_voucher_id: bills[0].voucher_id, amount: bills[0].outstanding }, { bill_voucher_id: bills[1].voucher_id, amount: '8200' }] }, A);
  ok(res.allocated === '20000.00', 'allocate clears the smaller bill fully + part of the larger', res.allocated);
  const ob1 = await allocSvc.openBills(pl);
  const smaller = ob1.bills.find((b) => b.voucher_id === bills[0].voucher_id);
  const larger = ob1.bills.find((b) => b.voucher_id === bills[1].voucher_id);
  ok(smaller.outstanding === '0.00' && Number(larger.outstanding) === Number(bills[1].bill_amount) - 8200, 'outstanding reflects the allocation', `${smaller.outstanding} / ${larger.outstanding}`);
  await rejects(allocSvc.allocate({ party_ledger_id: pl, settle_voucher_id: payRecV.voucher_id, lines: [{ bill_voucher_id: bills[1].voucher_id, amount: '100' }] }, A), /exceeds settlement available/, 'cannot over-allocate a fully-used settlement');
  await rejects(allocSvc.allocate({ party_ledger_id: pl, settle_voucher_id: payRecV.voucher_id, lines: [{ bill_voucher_id: payRecV.voucher_id, amount: '1' }] }, A), /cannot settle itself/, 'a voucher cannot settle itself');
  // Undo an allocation — the bill becomes open again.
  const allocList = await allocSvc.listForVoucher(payRecV.voucher_id);
  const smallerAlloc = allocList.find((a) => a.bill_voucher_id === bills[0].voucher_id);
  await allocSvc.unallocate(smallerAlloc.alloc_id, A);
  const ob2 = await allocSvc.openBills(pl);
  const reopened = ob2.bills.find((b) => b.voucher_id === bills[0].voucher_id);
  ok(reopened && reopened.outstanding === reopened.bill_amount, 'unallocate reopens the bill to its full outstanding', reopened && reopened.outstanding);

  // ── Phase 6: AI accountant (propose-only, read-only explain) ─────────────
  const aiSvc = require('../src/lib/accounting/ai-accountant')(pool);
  const prop = await aiSvc.proposeVoucher({ voucher_date: '2026-10-26', narration: 'Accrue electricity',
    lines: [{ ledger_id: salesLed.ledger_id, cr_amount: '0', dr_amount: '0' }], rationale: 'test' }, { username: 'ai-bot' }).catch((e) => ({ err: e.message }));
  ok(prop.err && /at least two lines/.test(prop.err), 'AI proposal with too few lines is refused');
  const prop2 = await aiSvc.proposeVoucher({ voucher_date: '2026-10-26', narration: 'Round-off adjustment',
    lines: [{ ledger_id: salesLed.ledger_id, dr_amount: '10' }, { ledger_id: invLed.ledger_id, cr_amount: '10' }], rationale: 'AI noticed a 10 rupee variance' }, { username: 'ai-bot' });
  ok(prop2.status === 'DRAFT' && prop2.requires_human_approval && prop2.source_module === 'acct.ai', 'AI proposes a DRAFT (source acct.ai) requiring human approval', prop2.status);
  const expl = await aiSvc.explainBalance({ ledger_id: invLed.ledger_id, as_of: '2026-10-31' });
  ok(/Inventory/.test(expl.summary) && expl.closing.amount === '5500.00', 'AI explain returns a read-only summary with the real closing', expl.closing.amount);

  const tb6 = await svc.trialBalance({ as_of: '2026-10-31' });
  ok(tb6.totals.closing_dr === tb6.totals.closing_cr, 'trial balance still ties after allocation + AI draft');

  // ── Depreciation chart (WDV + 180-day rule) ──────────────────────────────
  const depr = require('../src/lib/accounting/depreciation')(pool);
  await depr.saveAsset({ name: 'Knitting Machine', block: 'Plant & Machinery', purchase_date: '2024-04-01', cost: 100000, rate_pct: 15, method: 'WDV', opening_wdv: 100000 }, A);
  await depr.saveAsset({ name: 'New Loom', purchase_date: '2027-01-01', cost: 200000, rate_pct: 15, method: 'WDV' }, A);
  const sch = await depr.schedule({ from: '2026-04-01', to: '2027-03-31' });
  const dKM = sch.rows.find((r) => r.asset === 'Knitting Machine');
  ok(dKM && dKM.depreciation === '15000.00' && dKM.closing_wdv === '85000.00', 'WDV 15% on 100,000 opening = 15,000 dep', dKM && dKM.depreciation);
  const dNL = sch.rows.find((r) => r.asset === 'New Loom');
  ok(dNL && dNL.depreciation === '15000.00', 'in-year addition < 180 days gets half rate (7.5% of 200,000)', dNL && dNL.depreciation);
  ok(sch.totals.depreciation === '30000.00', 'depreciation chart totals the block', sch.totals.depreciation);

  // ── Interest on overdue outstanding ──────────────────────────────────────
  const intr = require('../src/lib/accounting/interest')(pool);
  const ires = await intr.compute({ kind: 'RECEIVABLE', as_of: '2027-03-31', rate: 18 });
  ok(ires.rows.length >= 1 && Number(ires.total_interest) > 0, 'interest computed on overdue receivables', `rows=${ires.rows.length} interest=${ires.total_interest}`);

  // Audit trail exists for the main actions.
  const au = await svc.auditTrail({ entity: 'voucher', entity_id: rcp.voucher_id });
  const acts = au.map((a) => a.action);
  ok(['CREATE', 'POST', 'REVERSE'].every((x) => acts.includes(x)), 'audit trail records create/post/reverse', acts.join(','));
  const auPosts = await svc.auditTrail({ action: 'post', limit: 500 });
  ok(auPosts.length > 0 && auPosts.every((a) => a.action === 'POST'), 'audit trail filters by action', `${auPosts.length} POST rows`);

  // Leave the scratch DB clean. Drop acct first (FK ledger->partner), then the public seed rows.
  await pool.query('DROP SCHEMA IF EXISTS acct CASCADE');
  await pool.query(`DELETE FROM public.tax_invoices WHERE invoice_number LIKE 'ZZINV%'`).catch(() => {});
  await pool.query(`DELETE FROM public.cost_entries WHERE entry_id = ANY($1)`, [[weId, jwId]]).catch(() => {});
  await pool.query(`DELETE FROM public.cost_entries WHERE reference_type='ROLL' AND reference_id='90001'`).catch(() => {});
  await pool.query(`DELETE FROM public.dispatch_items WHERE roll_id=90001`).catch(() => {});
  await pool.query(`DELETE FROM public.dispatch_challans WHERE dispatch_number='ZZD1'`).catch(() => {});
  await pool.query(`DELETE FROM public.yarn_lots WHERE grn_id=$1`, [grnId]).catch(() => {});
  await pool.query(`DELETE FROM public.grn WHERE grn_id=$1`, [grnId]).catch(() => {});
  await pool.query(`DELETE FROM public.partners WHERE company_name IN ('ZZ Link Customer','ZZ Supplier Co')`).catch(() => {});
  console.log(fails ? `\nFAILED (${fails})` : '\nAll accounting engine tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('ERR', e.message, e.stack); try { await pool.end(); } catch {} process.exit(1); });
