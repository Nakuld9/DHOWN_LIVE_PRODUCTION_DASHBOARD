// Accounting engine — pure rules (no database). Unit-tested in test/accounting-rules.test.js.
//
// Money is handled as integer paise. Amounts arrive as strings or numbers with
// at most 2 decimal places; anything more precise is rejected rather than
// silently rounded, because a voucher should carry exactly what was entered.

class AccountingError extends Error {
  constructor(message, code = 'ACCT_INVALID', details) {
    super(message);
    this.name = 'AccountingError';
    this.code = code;
    this.details = details;
    this.status = code === 'ACCT_FORBIDDEN' ? 403 : code === 'ACCT_NOT_FOUND' ? 404 : code === 'ACCT_CONFLICT' ? 409 : 400;
  }
}

const MAX_PAISE = 9e15; // well inside Number.MAX_SAFE_INTEGER

// "1,234.50" | 1234.5 | "1234" -> 123450 (integer paise). Returns null for blank.
function toPaise(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = typeof v === 'number' ? String(v) : String(v).replace(/,/g, '').trim();
  if (s === '') return null;
  if (/e/i.test(s)) s = Number(s).toFixed(2); // exponent form from JS numbers
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new AccountingError(`"${v}" is not a valid amount (max 2 decimal places)`, 'ACCT_AMOUNT');
  const p = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  if (p > MAX_PAISE) throw new AccountingError(`Amount ${v} is too large`, 'ACCT_AMOUNT');
  return m[1] ? -p : p;
}

// 123450 -> "1234.50" (string, exact — for NUMERIC columns and API output)
function fromPaise(p) {
  const neg = p < 0;
  const a = Math.abs(p);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const STATES = ['DRAFT', 'VALIDATED', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'];

// Explicit state machine. Editing a VALIDATED/APPROVED draft sends it back to DRAFT.
const TRANSITIONS = {
  DRAFT: ['VALIDATED', 'POSTED', 'CANCELLED'],
  VALIDATED: ['DRAFT', 'APPROVED', 'POSTED', 'CANCELLED'],
  APPROVED: ['DRAFT', 'POSTED', 'CANCELLED'],
  POSTED: ['REVERSED'],
  REVERSED: [],
  CANCELLED: [],
};
function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}
function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AccountingError(`A ${from} voucher cannot move to ${to}`, 'ACCT_STATE');
  }
}

// Normalise raw lines to [{ledger_id, dr, cr, cost_centre_id, narration}] in paise.
// Accepts either {dr_amount, cr_amount} or {side:'DR'|'CR', amount}.
function normaliseLines(lines) {
  if (!Array.isArray(lines)) throw new AccountingError('Voucher lines are required', 'ACCT_LINES');
  const out = [];
  lines.forEach((l, i) => {
    if (!l || (!l.ledger_id && (l.amount == null && l.dr_amount == null && l.cr_amount == null))) return; // blank grid row
    let dr = 0, cr = 0;
    if (l.side) {
      const amt = toPaise(l.amount) || 0;
      if (String(l.side).toUpperCase() === 'DR') dr = amt; else if (String(l.side).toUpperCase() === 'CR') cr = amt;
      else throw new AccountingError(`Line ${i + 1}: side must be DR or CR`, 'ACCT_LINES');
    } else {
      dr = toPaise(l.dr_amount) || 0;
      cr = toPaise(l.cr_amount) || 0;
    }
    out.push({
      line_no: out.length + 1,
      ledger_id: l.ledger_id || null,
      dr, cr,
      cost_centre_id: l.cost_centre_id || null,
      narration: l.narration ? String(l.narration).slice(0, 500) : null,
      _row: i + 1,
    });
  });
  return out;
}

// Structural validation of a voucher's lines. `ledgers` is a Map ledger_id ->
// {ledger_type, is_active, name} (fetched by the caller) for type rules.
function validateLines(voucherType, lines, ledgers = null) {
  const errors = [];
  if (lines.length < 2) errors.push('A voucher needs at least two lines (one debit and one credit).');
  let totDr = 0, totCr = 0;
  for (const l of lines) {
    if (!l.ledger_id) errors.push(`Line ${l._row}: select an account.`);
    if (l.dr < 0 || l.cr < 0) errors.push(`Line ${l._row}: amounts cannot be negative.`);
    if (l.dr > 0 && l.cr > 0) errors.push(`Line ${l._row}: a line is either debit or credit, not both.`);
    if (l.dr === 0 && l.cr === 0) errors.push(`Line ${l._row}: enter a debit or credit amount.`);
    totDr += l.dr; totCr += l.cr;
    if (ledgers && l.ledger_id) {
      const led = ledgers.get(l.ledger_id);
      if (!led) errors.push(`Line ${l._row}: account not found.`);
      else if (!led.is_active) errors.push(`Line ${l._row}: account "${led.name}" is inactive.`);
    }
  }
  if (!lines.some((l) => l.dr > 0)) errors.push('There must be at least one debit line.');
  if (!lines.some((l) => l.cr > 0)) errors.push('There must be at least one credit line.');
  if (totDr !== totCr) errors.push(`Debit (${fromPaise(totDr)}) and credit (${fromPaise(totCr)}) totals do not match — difference ${fromPaise(Math.abs(totDr - totCr))}.`);

  // Voucher-type rules (accounting-mode vouchers).
  if (ledgers && errors.length === 0) {
    const kind = (l) => (ledgers.get(l.ledger_id) || {}).ledger_type;
    const isCashBank = (l) => ['CASH', 'BANK'].includes(kind(l));
    if (voucherType === 'CONTRA' && !lines.every(isCashBank)) {
      errors.push('A Contra voucher may only use Cash and Bank accounts.');
    }
    if (voucherType === 'RECEIPT' && !lines.some((l) => l.dr > 0 && isCashBank(l))) {
      errors.push('A Receipt must debit a Cash or Bank account.');
    }
    if (voucherType === 'PAYMENT' && !lines.some((l) => l.cr > 0 && isCashBank(l))) {
      errors.push('A Payment must credit a Cash or Bank account.');
    }
  }
  return { ok: errors.length === 0, errors, total_dr: totDr, total_cr: totCr };
}

// Swap debits and credits — the body of a reversal voucher.
function reverseLines(lines) {
  return lines.map((l, i) => ({ ...l, line_no: i + 1, dr: l.cr, cr: l.dr }));
}

// Signed balance in paise (Dr positive) -> {amount, side}
function sideOf(paise) {
  if (paise === 0) return { amount: '0.00', side: '' };
  return { amount: fromPaise(Math.abs(paise)), side: paise > 0 ? 'Dr' : 'Cr' };
}

module.exports = {
  AccountingError, toPaise, fromPaise, STATES, TRANSITIONS, canTransition, assertTransition,
  normaliseLines, validateLines, reverseLines, sideOf,
};
