// Document vouchers — Sales / Purchase (and their returns) entered from item
// lines. The GST tax engine computes CGST/SGST/IGST from each line (intra vs
// inter from party vs company state), builds the balanced accounting lines, and
// stores the invoice body in acct.voucher_items. Posting still goes through the
// one authoritative service (createDraft -> validate -> post).
const R = require('./rules');
const { computeDocument, documentVoucherLines } = require('./posting-rules');

const DOC_TYPES = ['SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN', 'CREDIT_NOTE', 'DEBIT_NOTE'];
// Sale-side documents post to Sales + Output GST; everything else to Purchase + Input GST.
// A CREDIT_NOTE is sale-side (against a customer); a DEBIT_NOTE is purchase-side.
const SALE_SIDE = new Set(['SALES', 'SALES_RETURN', 'CREDIT_NOTE']);

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

  async function resolveIntra(partyLedgerId, bodyIntra) {
    if (bodyIntra !== undefined && bodyIntra !== null) return !!bodyIntra;
    const c = await cid();
    const co = (await pool.query(`SELECT state_code FROM acct.companies WHERE company_id=$1`, [c])).rows[0];
    const pl = (await pool.query(`SELECT state_code, gstin FROM acct.ledgers WHERE ledger_id=$1 AND company_id=$2`, [partyLedgerId, c])).rows[0];
    if (!pl) throw new R.AccountingError('Party ledger not found', 'ACCT_NOT_FOUND');
    const pState = pl.state_code || (pl.gstin ? pl.gstin.slice(0, 2) : null);
    if (!co?.state_code || !pState) return true; // unknown -> assume intra
    return co.state_code === pState;
  }

  async function writeItems(voucherId, items) {
    await pool.query(`DELETE FROM acct.voucher_items WHERE voucher_id=$1`, [voucherId]);
    for (const it of items) {
      await pool.query(
        `INSERT INTO acct.voucher_items (voucher_id, line_no, item_id, item_name, hsn_code, quantity, uom, rate, discount_pct,
           taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [voucherId, it.line_no, it.item_id, it.item_name, it.hsn_code, it.quantity, it.uom, it.rate, it.discount_pct,
         it.taxable_value, it.gst_rate, it.cgst_amount, it.sgst_amount, it.igst_amount, it.line_total]);
    }
  }

  function check(body) {
    if (!DOC_TYPES.includes(body.voucher_type)) throw new R.AccountingError(`Document type must be one of ${DOC_TYPES.join(', ')}`, 'ACCT_INVALID');
    if (!body.party_ledger_id) throw new R.AccountingError('Select the party (customer/supplier) account', 'ACCT_INVALID');
  }

  async function build(body) {
    check(body);
    const intra = await resolveIntra(body.party_ledger_id, body.intra);
    const comp = computeDocument({ lines: body.items || [], intra, round: body.round !== false });
    const sys = await sysLedgers();
    const missing = (SALE_SIDE.has(body.voucher_type) ? ['SALES'] : ['PURCHASE']).filter((k) => !sys[k]);
    if (missing.length) throw new R.AccountingError(`System ledger ${missing.join(', ')} missing`, 'ACCT_CONFLICT');
    const lines = documentVoucherLines(body.voucher_type, comp.totals, sys, body.party_ledger_id, body.reference_no);
    return { comp, lines, intra };
  }

  async function create(body, user) {
    const { comp, lines, intra } = await build(body);
    const draft = await svc.createDraft({
      voucher_type: body.voucher_type, voucher_date: body.voucher_date, party_ledger_id: body.party_ledger_id,
      reference_no: body.reference_no || null, reference_date: body.reference_date || null,
      narration: body.narration || null, source_module: 'acct.document', idempotency_key: body.idempotency_key || null, lines,
    }, user);
    if (!draft.idempotent_replay) await writeItems(draft.voucher_id, comp.items);
    return { ...(await svc.getVoucher(draft.voucher_id)), intra, computed: comp.totals };
  }

  async function update(id, body, user) {
    const cur = await svc.getVoucher(id);
    if (!['DRAFT', 'VALIDATED', 'APPROVED'].includes(cur.status)) {
      throw new R.AccountingError(`A ${cur.status} document cannot be edited — reverse it and enter a fresh one`, 'ACCT_STATE');
    }
    const { comp, lines } = await build({ ...body, voucher_type: body.voucher_type || cur.voucher_type, party_ledger_id: body.party_ledger_id || cur.party_ledger_id });
    await svc.updateVoucher(id, {
      voucher_date: body.voucher_date, party_ledger_id: body.party_ledger_id, reference_no: body.reference_no,
      reference_date: body.reference_date, narration: body.narration, lines,
    }, user);
    await writeItems(id, comp.items);
    return svc.getVoucher(id);
  }

  // Preview totals without saving (for the UI's live tax display cross-check).
  async function preview(body) {
    const intra = await resolveIntra(body.party_ledger_id, body.intra);
    const comp = computeDocument({ lines: body.items || [], intra, round: body.round !== false });
    return { intra, items: comp.items.map(({ _p, ...rest }) => rest), totals: (({ _p, ...rest }) => rest)(comp.totals) };
  }

  return { create, update, preview, DOC_TYPES };
};
