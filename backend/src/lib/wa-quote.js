// Quotation decision logic — pure functions, no DB, no side effects (unit-tested).
//
// Two guardrails from the spec:
//  §8  The AI may NEVER set or change a price. A quote can only auto-draft at the
//      rate this customer was already billed; anything else needs a manager.
//  §19 Before a large order, compare credit limit against outstanding + the
//      proposed value and flag when approval is required.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Decide the rate for a quote.
//  - manager-supplied rate always wins and is recorded as MANAGER.
//  - otherwise the customer's own last billed rate is authorised (HISTORICAL).
//  - no history and no manager rate -> NONE, quote must go for approval.
// Any manager rate that differs from history is still MANAGER (a human chose it),
// but we report `differs_from_history` so the UI can show what changed.
function decideRate({ managerRate, authorisedRate, lastRate } = {}) {
  const mgr = Number(managerRate);
  const auth = Number(authorisedRate);
  const last = Number(lastRate);
  if (Number.isFinite(mgr) && mgr > 0) {
    return {
      rate: r2(mgr),
      rate_source: 'MANAGER',
      needs_approval: false,
      differs_from_history: Number.isFinite(last) && last > 0 ? r2(mgr) !== r2(last) : null,
    };
  }
  // An authorised price list entry outranks history: it is the rate a manager
  // has already agreed with this customer.
  if (Number.isFinite(auth) && auth > 0) {
    return {
      rate: r2(auth),
      rate_source: 'AUTHORISED',
      needs_approval: false,
      differs_from_history: Number.isFinite(last) && last > 0 ? r2(auth) !== r2(last) : null,
    };
  }
  if (Number.isFinite(last) && last > 0) {
    return { rate: r2(last), rate_source: 'HISTORICAL', needs_approval: false, differs_from_history: false };
  }
  return { rate: null, rate_source: 'NONE', needs_approval: true, differs_from_history: null };
}

// §19 credit safety. Returns OK or CREDIT_APPROVAL_REQUIRED with a readable note.
// A zero/absent credit limit means "not configured" — we don't block on it, but we
// say so rather than implying the customer is clear.
function checkCredit({ creditLimit, outstanding, orderValue } = {}) {
  const limit = Number(creditLimit) || 0;
  const out = Number(outstanding) || 0;
  const val = Number(orderValue) || 0;
  const exposure = r2(out + val);

  if (limit <= 0) {
    return { flag: 'OK', exposure, note: 'No credit limit configured for this customer.' };
  }
  if (exposure > limit) {
    return {
      flag: 'CREDIT_APPROVAL_REQUIRED',
      exposure,
      note: `Credit limit ${limit}. Outstanding ${r2(out)} + proposed ${r2(val)} = ${exposure}, which exceeds the limit.`,
    };
  }
  return { flag: 'OK', exposure, note: `Within credit limit (${exposure} of ${limit}).` };
}

// Overall quote status given the two gates above.
function quoteStatus({ rateSource, creditFlag } = {}) {
  if (rateSource === 'NONE') return 'PENDING_PRICE_APPROVAL';
  if (creditFlag === 'CREDIT_APPROVAL_REQUIRED') return 'PENDING_PRICE_APPROVAL';
  return 'APPROVED';
}

module.exports = { decideRate, checkCredit, quoteStatus, r2 };
