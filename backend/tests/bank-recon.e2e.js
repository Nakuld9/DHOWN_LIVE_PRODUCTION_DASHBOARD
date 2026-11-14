// Bank reconciliation.
//
// The dangerous failure here is not a crash — it is a confident wrong match.
// A statement credit matched to the wrong receipt looks reconciled, credits the
// wrong customer, and leaves the right one being chased. So most of what is
// asserted below is about what the system REFUSES to do: it will not match two
// receipts to one credit, will not match across differing amounts, and will not
// guess when two candidates are equally plausible.
//
//   node tests/bank-recon.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const bank = require('../src/lib/bank-recon')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZBNK' + Date.now().toString().slice(-6);
const D = (offset) => {   // a date offset from a fixed base, as YYYY-MM-DD
  const d = new Date('2026-05-10T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

let acct, pid;

(async () => {
  pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ Bank Test') RETURNING partner_id`,
    [TAG])).rows[0].partner_id;

  const mkPayment = async (amount, date, reference) => (await pool.query(
    `INSERT INTO payments (receipt_no, partner_id, amount, payment_date, mode, reference, status)
     VALUES ($1,$2,$3,$4,'NEFT',$5,'ACTIVE') RETURNING payment_id`,
    [`${TAG}-${Math.random().toString(36).slice(2, 7)}`, pid, amount, date, reference || null]
  )).rows[0].payment_id;

  try {
    const a = await bank.createAccount({
      account_name: 'ZZ Test Current A/c', bank_name: 'HDFC',
      account_no: '00112233', opening_balance: 100000, opening_date: D(-1),
    });
    acct = a.account_id;
    ok(!!acct, 'a bank account can be created');

    console.log('\nImport is idempotent');
    const statement = [
      { txn_date: D(0), description: 'NEFT CR SUNDARAM TEX', reference: 'UTR111', credit: 50000, debit: 0, balance: 150000 },
      { txn_date: D(1), description: 'NEFT CR ANOTHER MILL', reference: 'UTR222', credit: 25000, debit: 0, balance: 175000 },
      { txn_date: D(2), description: 'YARN SUPPLIER PAYMENT', reference: 'UTR333', credit: 0, debit: 40000, balance: 135000 },
      // Two identical credits on one day — legitimate, and the classic trap.
      { txn_date: D(3), description: 'NEFT CR TWIN', reference: '', credit: 10000, debit: 0, balance: 145000 },
      { txn_date: D(3), description: 'NEFT CR TWIN', reference: '', credit: 10000, debit: 0, balance: 155000 },
    ];
    const imp1 = await bank.importLines(acct, statement, { by: 'test' });
    ok(imp1.inserted === 5, 'all five lines import', `inserted ${imp1.inserted}`);

    const imp2 = await bank.importLines(acct, statement, { by: 'test' });
    ok(imp2.inserted === 0 && imp2.duplicates === 5,
      're-importing the same statement inserts nothing', `inserted ${imp2.inserted}, dupes ${imp2.duplicates}`);
    const total = (await pool.query(
      `SELECT COUNT(*)::int n FROM bank_statement_lines WHERE account_id=$1`, [acct])).rows[0].n;
    ok(total === 5, 'and the two identical credits both survived', `${total} lines`);

    console.log('\nBad rows are rejected, not guessed at');
    const bad = await bank.importLines(acct, [
      { txn_date: null, description: 'no date', credit: 100, debit: 0 },
      { txn_date: D(4), description: 'both sides', credit: 100, debit: 100 },
      { txn_date: D(4), description: 'neither side', credit: 0, debit: 0 },
    ], { by: 'test' });
    ok(bad.inserted === 0 && bad.rejected.length === 3,
      'a row with no date, or both/neither of debit and credit, is rejected',
      JSON.stringify(bad.rejected.map(r => r.why)));

    console.log('\nMatching refuses what it should');
    const payExact = await mkPayment(50000, D(0), 'UTR111');
    const lines = await bank.lines(acct);
    const line50 = lines.find(l => l.credit === 50000);
    const lineDebit = lines.find(l => l.debit === 40000);

    const wrongAmount = await bank.match(line50.line_id, await mkPayment(999, D(0)), { by: 'test' });
    ok(wrongAmount.code === 400, 'a receipt of a different amount is refused', wrongAmount.error);

    const debitMatch = await bank.match(lineDebit.line_id, payExact, { by: 'test' });
    ok(debitMatch.code === 400, 'a debit line cannot be matched to a receipt', debitMatch.error);

    const cancelled = await mkPayment(50000, D(0));
    await pool.query(`UPDATE payments SET status='CANCELLED' WHERE payment_id=$1`, [cancelled]);
    const cancMatch = await bank.match(line50.line_id, cancelled, { by: 'test' });
    ok(cancMatch.code === 409, 'a cancelled receipt cannot be matched', cancMatch.error);

    console.log('\nA good match, and the uniqueness that protects it');
    const good = await bank.match(line50.line_id, payExact, { by: 'test' });
    ok(good.ok === true, 'an exact same-amount receipt matches');

    const twice = await bank.match(line50.line_id, await mkPayment(50000, D(0)), { by: 'test' });
    ok(twice.code === 409, 'a second receipt cannot be matched to the same bank credit', twice.error);

    // The other direction: one receipt must not "prove" two bank credits.
    const dupLine = (await bank.lines(acct)).find(l => l.credit === 10000 && !l.match_id);
    await pool.query(`UPDATE bank_statement_lines SET credit=50000 WHERE line_id=$1`, [dupLine.line_id]);
    const reuse = await bank.match(dupLine.line_id, payExact, { by: 'test' });
    ok(reuse.code === 409, 'and one receipt cannot be matched to two bank credits', reuse.error);
    await pool.query(`UPDATE bank_statement_lines SET credit=10000 WHERE line_id=$1`, [dupLine.line_id]);

    console.log('\nUnmatching');
    const un = await bank.unmatch(line50.line_id, { by: 'test' });
    ok(un.ok === true, 'a match can be undone');
    ok((await bank.unmatch(line50.line_id, { by: 'test' })).code === 404,
      'and undoing it twice is a 404, not a silent success');

    console.log('\nAuto-match will not guess');
    // Two receipts of 10,000 near the twin credits: genuinely ambiguous.
    await mkPayment(10000, D(3));
    await mkPayment(10000, D(3));
    await mkPayment(25000, D(1), 'UTR222');     // unambiguous, and reference matches
    await bank.match(line50.line_id, payExact, { by: 'test' });   // re-match the 50k

    const auto = await bank.autoMatch(acct, { by: 'test' });
    ok(auto.matched === 1, 'exactly the unambiguous line is auto-matched', `matched ${auto.matched}`);
    ok(auto.ambiguous.length === 2,
      'the two identical credits are left for a human, not guessed',
      JSON.stringify(auto.ambiguous.map(a => a.candidates)));

    const after = await bank.lines(acct, { state: 'matched' });
    ok(after.some(l => l.credit === 25000 && l.auto === true),
      'the auto-matched line is flagged as auto, not as a human decision');

    console.log('\nThe reconciliation itself');
    const s = await bank.summary(acct);
    // opening 100000 + credits (50000+25000+10000+10000) - debits 40000
    ok(s.bank_balance === 155000,
      'bank balance is opening plus credits less debits', `got ${s.bank_balance}`);
    ok(s.statement.matched_lines === 2, 'two lines are reconciled', `got ${s.statement.matched_lines}`);
    ok(s.unreconciled_lines.length === 2,
      'the twin credits show as bank money with no receipt', `${s.unreconciled_lines.length}`);
    ok(s.difference.bank_not_in_receipts === 20000,
      'and their value is reported', `got ${s.difference.bank_not_in_receipts}`);
    ok(s.unreconciled_receipts.some(p => p.amount === 999),
      'a receipt with no bank line shows as money we think we have');
    ok(s.reconciled === false, 'the account is correctly not reported as reconciled');

    console.log('\nCandidate ranking');
    const twinLine = s.unreconciled_lines[0];
    const cand = await bank.candidatesFor(twinLine.line_id);
    ok(cand.candidates.length === 2, 'both plausible receipts are offered', `${cand.candidates.length}`);
    ok(cand.candidates.every(c => c.amount === 10000), 'and only same-amount receipts are offered');

    const debitCand = await bank.candidatesFor(lineDebit.line_id);
    ok(debitCand.candidates.length === 0 && /debit/i.test(debitCand.note || ''),
      'a debit offers no candidates and says why');

  } finally {
    if (acct) {
      await pool.query(
        `DELETE FROM bank_reconciliation_matches WHERE line_id IN
           (SELECT line_id FROM bank_statement_lines WHERE account_id=$1)`, [acct]).catch(() => {});
      await pool.query(`DELETE FROM bank_statement_lines WHERE account_id=$1`, [acct]).catch(() => {});
      await pool.query(`DELETE FROM bank_accounts WHERE account_id=$1`, [acct]).catch(() => {});
    }
    if (pid) {
      await pool.query(`DELETE FROM payments WHERE partner_id=$1`, [pid]).catch(() => {});
      await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
    }
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
