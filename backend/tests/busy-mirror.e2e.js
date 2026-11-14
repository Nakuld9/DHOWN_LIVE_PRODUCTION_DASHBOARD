// Busy read bridge (Phase 1) — the reconciliation must match Busy's own Trial
// Balance TO THE RUPEE, from a real extract of COMP0004 (DHOWN's own Busy book,
// FY 26-27). The reconcile re-classifies every ledger up the group tree with
// MES's own logic (not trusting the extractor's labels), so this proves the
// extract→ingest pipeline is lossless AND MES classifies identically to Busy.
//
// Pure function, no DB (mirrors tests/bank-payouts.e2e.js style).
//   node tests/busy-mirror.e2e.js

const path = require('path');
const { reconcileExtract, classify, validateExtract } = require('../src/lib/accounting/busy-mirror');
const extract = require('./fixtures/busy-comp0004.json');

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

// Busy's validated control totals for COMP0004 (format/03-accounting-semantics.md).
const BUSY_TB = '36,85,17,703.04'.replace(/,/g, '');          // 368517703.04
const BUSY_NET_PROFIT = '1,23,88,105.18'.replace(/,/g, '');   // 12388105.18

ok(validateExtract(extract).schema === 'busy-mirror/v1', 'fixture is a valid busy-mirror/v1 extract');

const r = reconcileExtract(extract);

// ── the headline: MES TB == Busy TB, to the rupee ─────────────────────────────
ok(r.mes_tb.debit === r.mes_tb.credit, 'MES trial balance is balanced (Dr = Cr)', `Dr ${r.mes_tb.debit} / Cr ${r.mes_tb.credit}`);
ok(r.mes_tb.diff === '0.00', 'MES TB Dr-Cr difference is exactly 0.00', r.mes_tb.diff);
ok(r.mes_tb.debit === String(Number(BUSY_TB).toFixed(2)), 'MES TB total == Busy TB total to the rupee', `${r.mes_tb.debit} vs ${Number(BUSY_TB).toFixed(2)}`);
ok(r.difference.debit === '0.00' && r.difference.credit === '0.00', 'MES vs Busy TB variance is 0.00 on both sides');
ok(r.checks.matches_busy_debit && r.checks.matches_busy_credit, 'reconciliation flags Busy totals as matched');

// ── P&L + Balance Sheet agree, independently re-derived ───────────────────────
ok(r.profit_and_loss.net_profit === String(Number(BUSY_NET_PROFIT).toFixed(2)), 'MES-derived net profit == Busy net profit to the rupee', r.profit_and_loss.net_profit);
ok(r.difference.net_profit === '0.00', 'net-profit variance is 0.00');
ok(r.balance_sheet.diff === '0.00', 'MES balance sheet balances (Assets = Liab+Capital+Profit)', `assets ${r.balance_sheet.assets}`);
ok(r.checks.balance_sheet_balances, 'reconciliation flags the balance sheet as balanced');

// ── independent classification agrees with the extractor on every ledger ──────
ok(r.classification_variances.length === 0, 'no ledger classified differently by MES vs the extractor', `${r.classification_variances.length} variance(s)`);

// ── overall + a spot-check of the classifier itself ───────────────────────────
ok(r.ok === true, 'overall reconciliation OK (all checks pass)');
const byCode = new Map(extract.masters.map((m) => [Number(m.code), { name: m.name, parent_code: Number(m.parent_code || 0) }]));
// code 4 = Sales (primary 123 Sale → Income/PL); code 5 = Purchase (122 → Expense/PL).
const sales = classify(4, byCode);
ok(sales.section === 'PL', 'classifier walks the tree: Sales (code 4) → P&L', `${sales.section}/${sales.nature}`);

// ── breakdown is present ──────────────────────────────────────────────────────
ok(r.breakdown.balance_sheet.length > 0 && r.breakdown.profit_and_loss.length > 0, 'per-primary-group breakdown is present', `${r.breakdown.balance_sheet.length} BS groups, ${r.breakdown.profit_and_loss.length} PL groups`);

console.log(`\nBUSY READ BRIDGE: MES TB = Busy TB = Rs ${r.mes_tb.debit}  (net profit Rs ${r.profit_and_loss.net_profit})`);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
