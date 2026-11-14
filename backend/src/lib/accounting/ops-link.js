// Operations -> Accounting link.
//
// Bridges MES operational documents to the accounting ledger WITHOUT creating a
// second book while Busy is still the record: by default everything lands as a
// DRAFT voucher ("shadow" mode) for reconciliation. Flip ACCT_OPS_LINK_MODE=POST
// (or pass mode:'POST') only after cutover from Busy.
//
// Party master is reused: each MES partner maps to exactly one acct ledger
// (acct.ledgers.partner_id -> public.partners). Item/GST amounts come from the
// MES tax invoice, which already computed them.
const R = require('./rules');
const { salesInvoiceLines } = require('./posting-rules');

const DEFAULT_MODE = () => (String(process.env.ACCT_OPS_LINK_MODE || 'DRAFT').toUpperCase() === 'POST' ? 'POST' : 'DRAFT');

module.exports = (pool) => {
  const svc = require('./service')(pool);

  async function cid() { return svc.companyId(); }

  async function sysLedgers() {
    const c = await cid();
    const rows = (await pool.query(
      `SELECT code, ledger_id FROM acct.ledgers WHERE company_id=$1 AND code = ANY($2)`,
      [c, ['SALES', 'PURCHASE', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST', 'ROUND_OFF']])).rows;
    return Object.fromEntries(rows.map((r) => [r.code, r.ledger_id]));
  }

  // Find (or create) the acct ledger for a MES partner. kind: DEBTOR | CREDITOR.
  async function ensurePartyLedger(partnerId, kind = 'DEBTOR') {
    const c = await cid();
    const existing = (await pool.query(`SELECT ledger_id FROM acct.ledgers WHERE company_id=$1 AND partner_id=$2`, [c, partnerId])).rows[0];
    if (existing) return existing.ledger_id;
    const p = (await pool.query(`SELECT partner_id, partner_code, company_name, gstin FROM public.partners WHERE partner_id=$1`, [partnerId])).rows[0];
    if (!p) throw new R.AccountingError(`Partner ${partnerId} not found`, 'ACCT_NOT_FOUND');
    const groupCode = kind === 'CREDITOR' ? 'SUNDRY_CREDITORS' : 'SUNDRY_DEBTORS';
    const g = (await pool.query(`SELECT group_id FROM acct.account_groups WHERE company_id=$1 AND code=$2`, [c, groupCode])).rows[0];
    const base = (p.company_name || `Partner ${partnerId}`).trim();
    const gstin = p.gstin ? String(p.gstin).trim().toUpperCase() : null;
    // UNIQUE(company,name): if the name is taken (e.g. same party as a debtor
    // and a creditor), disambiguate with the partner code / id.
    for (const name of [base, `${base} (${p.partner_code || p.partner_id})`, `${base} [#${partnerId}]`]) {
      try {
        const row = (await pool.query(
          `INSERT INTO acct.ledgers (company_id, name, group_id, ledger_type, partner_id, gstin, state_code, created_by)
           VALUES ($1,$2,$3,'PARTY',$4,$5,$6,'ops-link') RETURNING ledger_id`,
          [c, name, g.group_id, partnerId, gstin, gstin ? gstin.slice(0, 2) : null])).rows[0];
        await pool.query(`INSERT INTO acct.audit_log (company_id, entity, entity_id, action, actor, detail) VALUES ($1,'ledger',$2,'PARTY_SYNC','ops-link',$3)`,
          [c, row.ledger_id, JSON.stringify({ partner_id: partnerId, name })]);
        return row.ledger_id;
      } catch (e) { if (e.code !== '23505') throw e; /* name clash — try next */ }
    }
    throw new R.AccountingError(`Could not create a ledger for ${base}`, 'ACCT_CONFLICT');
  }

  // Ensure every active partner has a Sundry Debtors ledger (customers). Idempotent.
  async function syncParties({ kind = 'DEBTOR' } = {}) {
    const partners = (await pool.query(`SELECT partner_id FROM public.partners WHERE COALESCE(is_active,true)=true`)).rows;
    let created = 0, existing = 0;
    for (const p of partners) {
      const had = (await pool.query(`SELECT 1 FROM acct.ledgers WHERE company_id=$1 AND partner_id=$2`, [await cid(), p.partner_id])).rows[0];
      await ensurePartyLedger(p.partner_id, kind);
      if (had) existing++; else created++;
    }
    return { partners: partners.length, created, existing };
  }

  // Post (or shadow-draft) one MES sales tax invoice as a Sales voucher.
  async function postSalesInvoice(invoiceId, { mode } = {}, user) {
    const m = (mode || DEFAULT_MODE()).toUpperCase();
    const inv = (await pool.query(`SELECT * FROM public.tax_invoices WHERE invoice_id=$1`, [invoiceId])).rows[0];
    if (!inv) throw new R.AccountingError(`Invoice ${invoiceId} not found`, 'ACCT_NOT_FOUND');
    if (['CANCELLED', 'DRAFT'].includes(String(inv.status || '').toUpperCase())) {
      throw new R.AccountingError(`Invoice ${inv.invoice_number} is ${inv.status} — only an issued invoice posts to the ledger`, 'ACCT_STATE');
    }
    if (!inv.partner_id) throw new R.AccountingError(`Invoice ${inv.invoice_number} has no linked customer (partner_id) to map to a ledger`, 'ACCT_INVALID');
    const party = await ensurePartyLedger(inv.partner_id, 'DEBTOR');
    const sys = await sysLedgers();
    const lines = salesInvoiceLines(inv, sys, party);
    const draft = await svc.createDraft({
      voucher_type: 'SALES', voucher_date: (inv.invoice_date instanceof Date ? inv.invoice_date.toISOString().slice(0, 10) : String(inv.invoice_date).slice(0, 10)),
      party_ledger_id: party, reference_no: inv.invoice_number, reference_date: inv.invoice_date,
      narration: `Sales — ${inv.customer_name || ''} (${inv.invoice_number})`.trim(),
      source_module: 'mes.sales_invoice', source_ref: String(invoiceId),
      idempotency_key: `SINV:${invoiceId}`, lines,
    }, user || { username: 'ops-link' });

    const canPost = m === 'POST' && ['DRAFT', 'VALIDATED', 'APPROVED'].includes(draft.status);
    if (draft.idempotent_replay && !canPost) {
      return { invoice: inv.invoice_number, voucher: draft, mode: m, action: 'already_linked', status: draft.status };
    }
    if (m === 'POST') {
      const v = await svc.validateVoucher(draft.voucher_id, user || { username: 'ops-link' });
      if (!v.ok) return { invoice: inv.invoice_number, voucher: v.voucher, mode: m, action: 'validation_failed', errors: v.errors };
      const posted = await svc.postVoucher(draft.voucher_id, user || { username: 'ops-link' });
      return { invoice: inv.invoice_number, voucher: posted, mode: m, action: 'posted', voucher_no: posted.voucher_no };
    }
    return { invoice: inv.invoice_number, voucher: draft, mode: m, action: 'drafted', status: 'DRAFT' };
  }

  // Bulk: link all issued sales invoices in a date range not already linked.
  async function syncSalesInvoices({ from, to, mode } = {}, user) {
    const c = await cid();
    const p = []; const w = [`status NOT IN ('CANCELLED','DRAFT')`, `partner_id IS NOT NULL`];
    if (from) { p.push(from); w.push(`invoice_date >= $${p.length}`); }
    if (to) { p.push(to); w.push(`invoice_date <= $${p.length}`); }
    const invs = (await pool.query(`SELECT invoice_id FROM public.tax_invoices WHERE ${w.join(' AND ')} ORDER BY invoice_date, invoice_id`, p)).rows;
    const out = { total: invs.length, linked: 0, already: 0, failed: 0, details: [] };
    for (const r of invs) {
      // Skip ones already linked (idempotent create would replay, but avoid the work).
      const done = (await pool.query(`SELECT 1 FROM acct.vouchers WHERE company_id=$1 AND idempotency_key=$2`, [c, `SINV:${r.invoice_id}`])).rows[0];
      if (done) { out.already++; continue; }
      try { const res = await postSalesInvoice(r.invoice_id, { mode }, user); out.linked++; out.details.push({ invoice: res.invoice, action: res.action, voucher_no: res.voucher_no }); }
      catch (e) { out.failed++; out.details.push({ invoice_id: r.invoice_id, error: e.message }); }
    }
    return out;
  }

  return { ensurePartyLedger, syncParties, postSalesInvoice, syncSalesInvoices, DEFAULT_MODE };
};
