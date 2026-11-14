// Phase 4 — MES operational events → balanced accounting lines. Pure (no DB),
// unit-tested. Physical quantities stay in the MES stock ledger; these carry the
// GL *valuation* of the same movement so the books reconcile to stock.
//
// Supported events (payload amounts are rupee strings/numbers):
//   GRN_RECEIPT      { value, gst_rate?, intra?, cgst?, sgst?, igst?, party_ledger_id? }
//   JOBWORK_CHARGES  { value, gst_rate?, intra?, cgst?, sgst?, igst?, party_ledger_id? }
//   DISPATCH_COGS    { cost | value }
//   WASTAGE          { cost | value }
const R = require('./rules');
const { gstSplit } = require('./posting-rules');

const P = (v) => R.toPaise(v) || 0;
const S = (p) => R.fromPaise(p);
const EVENTS = ['GRN_RECEIPT', 'JOBWORK_CHARGES', 'DISPATCH_COGS', 'WASTAGE', 'ISSUE_TO_WIP', 'CONVERSION_APPLIED', 'PRODUCTION_OUTPUT'];
// Cost-movement events (no tax) carry a label for the debit leg.
const COST_LABEL = { DISPATCH_COGS: 'Cost of goods sold', WASTAGE: 'Wastage / shortage',
  ISSUE_TO_WIP: 'Yarn issued to WIP', CONVERSION_APPLIED: 'Conversion absorbed', PRODUCTION_OUTPUT: 'Finished goods produced' };

// Resolve the tax split in paise from either explicit amounts or rate+intra.
function taxOf(payload, taxablePaise) {
  if (payload.cgst != null || payload.sgst != null || payload.igst != null) {
    return { cgst: P(payload.cgst), sgst: P(payload.sgst), igst: P(payload.igst) };
  }
  if (payload.gst_rate) return gstSplit(taxablePaise, payload.gst_rate, payload.intra !== false);
  return { cgst: 0, sgst: 0, igst: 0 };
}

// Build balanced lines for one event. `rule` is the active posting policy's rule;
// `sys` maps system-ledger codes to ids; `partyLedgerId` is the resolved
// supplier/job-worker ledger (optional — falls back to the rule's credit code).
function buildEventLines(eventType, payload, rule, sys, partyLedgerId) {
  if (!EVENTS.includes(eventType)) throw new R.AccountingError(`Unknown MES event ${eventType}`, 'ACCT_INVALID');
  if (!rule) throw new R.AccountingError(`No approved posting policy for ${eventType}`, 'ACCT_CONFLICT');
  const id = (code) => { const x = sys[code]; if (!x) throw new R.AccountingError(`System ledger ${code} missing`, 'ACCT_CONFLICT'); return x; };
  const L = [];
  const dr = (ledger, p, n) => { if (p > 0) L.push({ ledger_id: ledger, dr_amount: S(p), cr_amount: '0', narration: n }); };
  const cr = (ledger, p, n) => { if (p > 0) L.push({ ledger_id: ledger, dr_amount: '0', cr_amount: S(p), narration: n }); };

  if (eventType === 'GRN_RECEIPT' || eventType === 'JOBWORK_CHARGES') {
    const taxable = P(payload.value);
    if (taxable <= 0) throw new R.AccountingError(`${eventType}: value must be greater than 0`, 'ACCT_INVALID');
    const { cgst, sgst, igst } = taxOf(payload, taxable);
    const grand = taxable + cgst + sgst + igst;
    const label = eventType === 'GRN_RECEIPT' ? 'Goods received' : 'Job work charges';
    dr(id(rule.debit), taxable, label);
    if (rule.tax_side === 'INPUT') { dr(id('INPUT_CGST'), cgst, 'Input CGST'); dr(id('INPUT_SGST'), sgst, 'Input SGST'); dr(id('INPUT_IGST'), igst, 'Input IGST'); }
    const creditLedger = (rule.party_credit && partyLedgerId) ? partyLedgerId : id(rule.credit);
    cr(creditLedger, grand, rule.party_credit && partyLedgerId ? 'Supplier / job-worker' : 'Goods received not invoiced');
  } else { // cost-movement events (no tax): DISPATCH_COGS, WASTAGE, ISSUE_TO_WIP, CONVERSION_APPLIED, PRODUCTION_OUTPUT
    const cost = P(payload.cost != null ? payload.cost : payload.value);
    if (cost <= 0) throw new R.AccountingError(`${eventType}: cost must be greater than 0`, 'ACCT_INVALID');
    dr(id(rule.debit), cost, COST_LABEL[eventType] || 'Cost movement');
    cr(id(rule.credit), cost, rule.credit.replace(/_/g, ' '));
  }

  // Safety plug (tax rounding) so the journal always ties exactly.
  const d = L.reduce((s, l) => s + P(l.dr_amount), 0);
  const c = L.reduce((s, l) => s + P(l.cr_amount), 0);
  const plug = d - c;
  if (plug > 0) cr(id('GRN_CLEARING'), plug, 'Round off');
  else if (plug < 0) dr(id('GRN_CLEARING'), -plug, 'Round off');

  const d2 = L.reduce((s, l) => s + P(l.dr_amount), 0);
  const c2 = L.reduce((s, l) => s + P(l.cr_amount), 0);
  if (d2 !== c2) throw new R.AccountingError(`${eventType} lines do not balance (Dr ${S(d2)} / Cr ${S(c2)})`, 'ACCT_CONFLICT');
  return L;
}

module.exports = { buildEventLines, taxOf, EVENTS };
