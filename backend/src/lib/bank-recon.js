// Bank reconciliation.
//
// Payments were recorded but never checked against the bank. That leaves two
// blind spots, and both cost money in the same direction:
//
//   - A receipt keyed into the MES that never actually arrived. The customer's
//     outstanding drops, the credit gate lets the next order through, and
//     nobody is chasing money that was never received.
//   - A credit sitting in the bank with no receipt against it. The customer has
//     paid and is still being chased for it.
//
// Reconciliation is what turns "we think we were paid" into "the bank agrees".
//
// The important decision in this file is that auto-matching is deliberately
// timid. It matches only when exactly one candidate fits; two plausible
// candidates are left for a human. An auto-match that picks the wrong receipt
// is worse than no match at all, because it looks settled — the wrong customer
// gets credited and the right one keeps getting chased.

const crypto = require('crypto');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (s) => String(s == null ? '' : s).trim();

module.exports = (pool) => {

  // ── Accounts ────────────────────────────────────────────────────────────
  async function listAccounts() {
    const r = await pool.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM bank_statement_lines l WHERE l.account_id = a.account_id) AS lines,
              (SELECT MAX(txn_date) FROM bank_statement_lines l WHERE l.account_id = a.account_id) AS last_txn
         FROM bank_accounts a ORDER BY a.is_active DESC, a.account_name`);
    return r.rows.map(x => ({ ...x, opening_balance: r2(x.opening_balance) }));
  }

  async function createAccount({ account_name, bank_name, account_no, ifsc, opening_balance, opening_date }) {
    if (!clean(account_name)) return { error: 'An account name is required', code: 400 };
    const r = await pool.query(
      `INSERT INTO bank_accounts (account_name, bank_name, account_no, ifsc, opening_balance, opening_date)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [clean(account_name), clean(bank_name) || null, clean(account_no) || null,
       clean(ifsc) || null, r2(opening_balance), opening_date || null]);
    return r.rows[0];
  }

  // ── Import ──────────────────────────────────────────────────────────────
  //
  // Rows arrive already parsed (the CSV shape differs per bank, so parsing is
  // the caller's problem). Each needs: txn_date, description, reference,
  // debit, credit, balance.
  //
  // Idempotency deserves the care it gets here. A statement is often
  // re-uploaded — a longer date range, a corrected file, a double click. Two
  // genuinely identical credits on one day are also completely normal. So the
  // hash covers the line's content *plus its occurrence number within this
  // import*: the second identical line hashes differently from the first, but
  // re-importing the same file produces the same two hashes and inserts
  // nothing new.
  function hashRow(row, occurrence) {
    const basis = [
      row.txn_date, r2(row.debit), r2(row.credit),
      clean(row.description).toLowerCase().replace(/\s+/g, ' '),
      clean(row.reference).toLowerCase(),
      occurrence,
    ].join('|');
    return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 64);
  }

  async function importLines(accountId, rows, { by } = {}) {
    if (!Array.isArray(rows) || !rows.length) return { error: 'No rows to import', code: 400 };

    const acct = (await pool.query(`SELECT account_id FROM bank_accounts WHERE account_id=$1`, [accountId])).rows[0];
    if (!acct) return { error: 'Bank account not found', code: 404 };

    const batch = `IMP-${Date.now()}`;
    const seen = new Map();
    const prepared = [];
    const rejected = [];

    for (const [i, row] of rows.entries()) {
      const debit = r2(row.debit);
      const credit = r2(row.credit);
      if (!row.txn_date) { rejected.push({ row: i + 1, why: 'no transaction date' }); continue; }
      if (debit > 0 && credit > 0) { rejected.push({ row: i + 1, why: 'both debit and credit are set' }); continue; }
      if (debit <= 0 && credit <= 0) { rejected.push({ row: i + 1, why: 'neither debit nor credit is set' }); continue; }

      const base = hashRow(row, 0);
      const n = (seen.get(base) || 0);
      seen.set(base, n + 1);
      prepared.push({ ...row, debit, credit, row_hash: hashRow(row, n) });
    }

    let inserted = 0, duplicates = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of prepared) {
        // ON CONFLICT DO NOTHING against the (account, hash) unique index is
        // what makes a re-import a no-op rather than a duplicate.
        const r = await client.query(
          `INSERT INTO bank_statement_lines
             (account_id, txn_date, value_date, description, reference, debit, credit, balance, import_batch, row_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (account_id, row_hash) DO NOTHING
           RETURNING line_id`,
          [accountId, p.txn_date, p.value_date || null, clean(p.description) || null,
           clean(p.reference) || null, p.debit, p.credit,
           p.balance == null ? null : r2(p.balance), batch, p.row_hash]);
        if (r.rows.length) inserted++; else duplicates++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { batch, received: rows.length, inserted, duplicates, rejected, by: by || null };
  }

  // ── Matching ────────────────────────────────────────────────────────────
  //
  // Candidates for one statement credit: active, unmatched payments of the
  // same amount, within a few days either side. Banks post a day or two after
  // the customer says they paid, and a receipt is often keyed on the promised
  // date, so the window is real rather than generous.
  async function candidatesFor(lineId, { days = 5 } = {}) {
    const line = (await pool.query(
      `SELECT * FROM bank_statement_lines WHERE line_id=$1`, [lineId])).rows[0];
    if (!line) return { error: 'Statement line not found', code: 404 };
    if (Number(line.credit) <= 0) {
      // Debits are our own outgoings. They belong on the statement and in the
      // balance, but there is no receipt to match them to.
      return { line, candidates: [], note: 'This is a debit — there is no receipt to match it against.' };
    }

    // Parameters are the date, the amount and the window — the line id itself
    // is not referenced, and passing it made Postgres reject the statement
    // outright ("could not determine data type of parameter $1").
    const r = await pool.query(
      `SELECT p.payment_id, p.receipt_no, p.payment_date, p.amount, p.mode, p.reference, p.bank,
              pt.company_name,
              ABS(p.payment_date - $1::date) AS day_gap
         FROM payments p
         LEFT JOIN partners pt ON pt.partner_id = p.partner_id
        WHERE p.status = 'ACTIVE'
          AND p.amount = $2
          AND p.payment_date BETWEEN $1::date - $3::int AND $1::date + $3::int
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.payment_id = p.payment_id)
        ORDER BY day_gap, p.payment_id`,
      [line.txn_date, r2(line.credit), days]);

    // A shared reference (UTR, cheque number) is the strongest signal there is.
    const ref = clean(line.reference).toLowerCase();
    const desc = clean(line.description).toLowerCase();
    const candidates = r.rows.map(x => {
      const pref = clean(x.reference).toLowerCase();
      const refHit = !!pref && (ref.includes(pref) || pref.includes(ref) || desc.includes(pref));
      return {
        ...x, amount: r2(x.amount), day_gap: Number(x.day_gap),
        reference_match: refHit,
      };
    });
    // Reference hits first, then closest by date.
    candidates.sort((a, b) => (b.reference_match - a.reference_match) || (a.day_gap - b.day_gap));
    return { line, candidates };
  }

  async function match(lineId, paymentId, { by, note, auto = false } = {}) {
    const line = (await pool.query(`SELECT * FROM bank_statement_lines WHERE line_id=$1`, [lineId])).rows[0];
    if (!line) return { error: 'Statement line not found', code: 404 };
    if (Number(line.credit) <= 0) return { error: 'A debit line cannot be matched to a receipt', code: 400 };

    const pay = (await pool.query(
      `SELECT payment_id, amount, status FROM payments WHERE payment_id=$1`, [paymentId])).rows[0];
    if (!pay) return { error: 'Payment not found', code: 404 };
    if (pay.status !== 'ACTIVE') return { error: 'That payment is cancelled', code: 409 };

    // Amounts must agree exactly. A partial or approximate match would make the
    // reconciled total meaningless, which defeats the point of reconciling.
    if (r2(pay.amount) !== r2(line.credit)) {
      return { error: `Amounts differ: statement ${r2(line.credit)}, receipt ${r2(pay.amount)}`, code: 400 };
    }

    try {
      const r = await pool.query(
        `INSERT INTO bank_reconciliation_matches (line_id, payment_id, auto, note, matched_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [lineId, paymentId, !!auto, clean(note) || null, by || null]);
      return { ok: true, match: r.rows[0] };
    } catch (e) {
      // The unique indexes are the real guard; this turns them into an answer.
      if (e.code === '23505') {
        return { error: 'That statement line or that receipt is already matched', code: 409 };
      }
      throw e;
    }
  }

  async function unmatch(lineId, { by } = {}) {
    const r = await pool.query(
      `DELETE FROM bank_reconciliation_matches WHERE line_id=$1 RETURNING match_id`, [lineId]);
    if (!r.rows.length) return { error: 'That line is not matched', code: 404 };
    return { ok: true, unmatched: r.rows.length, by: by || null };
  }

  // Match everything that can be matched without a judgement call.
  //
  // The one-candidate rule is the whole safety property. With two receipts of
  // the same amount in the same week, picking either is a coin flip that looks
  // like a decision, so both are left alone and reported as needing review.
  async function autoMatch(accountId, { days = 5, by } = {}) {
    const open = await pool.query(
      `SELECT line_id FROM bank_statement_lines l
        WHERE l.account_id = $1 AND l.credit > 0
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.line_id = l.line_id)
        ORDER BY l.txn_date, l.line_id`, [accountId]);

    let matched = 0;
    const ambiguous = [];
    const unmatched = [];

    for (const { line_id } of open.rows) {
      const { candidates } = await candidatesFor(line_id, { days });
      if (!candidates.length) { unmatched.push(line_id); continue; }

      // A single reference hit is decisive even when several amounts fit.
      const byRef = candidates.filter(c => c.reference_match);
      const pick = byRef.length === 1 ? byRef[0] : (candidates.length === 1 ? candidates[0] : null);

      if (!pick) { ambiguous.push({ line_id, candidates: candidates.length }); continue; }

      const res = await match(line_id, pick.payment_id, { by, auto: true, note: 'auto-matched' });
      if (res.ok) matched++; else ambiguous.push({ line_id, why: res.error });
    }

    return { matched, ambiguous, unmatched: unmatched.length, reviewed: open.rows.length };
  }

  // ── The reconciliation itself ───────────────────────────────────────────
  async function summary(accountId, { from = null, to = null } = {}) {
    const acct = (await pool.query(`SELECT * FROM bank_accounts WHERE account_id=$1`, [accountId])).rows[0];
    if (!acct) return { error: 'Bank account not found', code: 404 };

    const p = [accountId, from, to];
    const t = (await pool.query(
      `SELECT COUNT(*)::int AS lines,
              COALESCE(SUM(credit),0) AS credits,
              COALESCE(SUM(debit),0)  AS debits,
              COUNT(*) FILTER (WHERE credit > 0)::int AS credit_lines,
              COUNT(*) FILTER (WHERE credit > 0 AND m.match_id IS NOT NULL)::int AS matched_lines,
              COALESCE(SUM(credit) FILTER (WHERE m.match_id IS NOT NULL),0) AS matched_credits
         FROM bank_statement_lines l
         LEFT JOIN bank_reconciliation_matches m ON m.line_id = l.line_id
        WHERE l.account_id=$1
          AND ($2::date IS NULL OR l.txn_date >= $2::date)
          AND ($3::date IS NULL OR l.txn_date <= $3::date)`, p)).rows[0];

    // Receipts on our side with no bank line against them. These are the ones
    // worth looking at first — money we believe we have.
    //
    // Only the dates are parameters: a payment is not tied to a bank account,
    // so accountId has no place in this query. Passing it anyway is what broke
    // the two queries above during testing.
    const unreconciledPayments = (await pool.query(
      `SELECT p.payment_id, p.receipt_no, p.payment_date, p.amount, p.mode, p.reference,
              pt.company_name
         FROM payments p
         LEFT JOIN partners pt ON pt.partner_id = p.partner_id
        WHERE p.status='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.payment_id = p.payment_id)
          AND ($1::date IS NULL OR p.payment_date >= $1::date)
          AND ($2::date IS NULL OR p.payment_date <= $2::date)
        ORDER BY p.payment_date, p.payment_id`, [from, to])).rows
      .map(x => ({ ...x, amount: r2(x.amount) }));

    // Bank credits with no receipt — money that arrived and was never recorded.
    const unreconciledLines = (await pool.query(
      `SELECT l.* FROM bank_statement_lines l
        WHERE l.account_id=$1 AND l.credit > 0
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.line_id = l.line_id)
          AND ($2::date IS NULL OR l.txn_date >= $2::date)
          AND ($3::date IS NULL OR l.txn_date <= $3::date)
        ORDER BY l.txn_date, l.line_id`, p)).rows
      .map(x => ({ ...x, credit: r2(x.credit), debit: r2(x.debit) }));

    // Bank balance from the opening balance and every line, not from the
    // filtered window — a balance is a position, not a period.
    const all = (await pool.query(
      `SELECT COALESCE(SUM(credit),0) c, COALESCE(SUM(debit),0) d
         FROM bank_statement_lines WHERE account_id=$1`, [accountId])).rows[0];
    const bankBalance = r2(Number(acct.opening_balance) + Number(all.c) - Number(all.d));

    const matchedCredits = r2(t.matched_credits);
    const unmatchedReceiptTotal = r2(unreconciledPayments.reduce((s, x) => s + x.amount, 0));
    const unmatchedLineTotal = r2(unreconciledLines.reduce((s, x) => s + x.credit, 0));

    return {
      account: { ...acct, opening_balance: r2(acct.opening_balance) },
      period: { from, to },
      statement: {
        lines: Number(t.lines),
        credits: r2(t.credits),
        debits: r2(t.debits),
        credit_lines: Number(t.credit_lines),
        matched_lines: Number(t.matched_lines),
        matched_credits: matchedCredits,
      },
      bank_balance: bankBalance,
      // The two exception lists, which are the actual output of reconciling.
      unreconciled_receipts: unreconciledPayments,
      unreconciled_lines: unreconciledLines,
      difference: {
        receipts_not_in_bank: unmatchedReceiptTotal,
        bank_not_in_receipts: unmatchedLineTotal,
        net: r2(unmatchedReceiptTotal - unmatchedLineTotal),
      },
      reconciled: unreconciledPayments.length === 0 && unreconciledLines.length === 0,
    };
  }

  async function lines(accountId, { from = null, to = null, state = 'all' } = {}) {
    const r = await pool.query(
      `SELECT l.*, m.match_id, m.payment_id, m.auto, m.matched_by, m.matched_at,
              p.receipt_no, pt.company_name
         FROM bank_statement_lines l
         LEFT JOIN bank_reconciliation_matches m ON m.line_id = l.line_id
         LEFT JOIN payments p  ON p.payment_id = m.payment_id
         LEFT JOIN partners pt ON pt.partner_id = p.partner_id
        WHERE l.account_id = $1
          AND ($2::date IS NULL OR l.txn_date >= $2::date)
          AND ($3::date IS NULL OR l.txn_date <= $3::date)
          AND ($4 = 'all'
               OR ($4 = 'matched'   AND m.match_id IS NOT NULL)
               OR ($4 = 'unmatched' AND m.match_id IS NULL))
        ORDER BY l.txn_date, l.line_id`,
      [accountId, from, to, state]);
    return r.rows.map(x => ({ ...x, debit: r2(x.debit), credit: r2(x.credit) }));
  }

  return { listAccounts, createAccount, importLines, candidatesFor, match, unmatch, autoMatch, summary, lines };
};
