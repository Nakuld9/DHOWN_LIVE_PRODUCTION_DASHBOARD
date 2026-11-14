// Financial dashboard.
//
// A dashboard is believed. If it disagrees with the credit gate — the thing
// that actually blocks an order — the operator trusts the dashboard and the
// mill ships to someone it should not have. So the checks here are mostly
// agreement checks: the totals must equal what the same views tell the gate,
// and the parts must sum to the whole.
//
//   node tests/financial.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const fin = require('../src/lib/financial-dashboard')(pool);
const pay = require('../src/lib/payments')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TAG = 'ZZFIN' + Date.now().toString().slice(-6);

(async () => {
  // Two customers: one inside its limit, one deliberately over it.
  const mk = async (name, limit) => (await pool.query(
    `INSERT INTO partners (partner_code, company_name, credit_limit, credit_days)
     VALUES ($1,$2,$3,30) RETURNING partner_id`,
    [TAG + name, 'ZZ Fin ' + name, limit])).rows[0].partner_id;

  const inLimit = await mk('A', 500000);
  const overLimit = await mk('B', 50000);
  const noLimit = await mk('C', 0);

  const mkInvoice = async (pid, total, daysAgo) => (await pool.query(
    `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
     VALUES ($1,$2,CURRENT_DATE - $3::int,$4,'ISSUED') RETURNING invoice_id`,
    ['ZZFIN-' + Math.random().toString(36).slice(2, 9), pid, daysAgo, total])).rows[0].invoice_id;

  try {
    await mkInvoice(inLimit, 100000, 10);     // within terms
    await mkInvoice(overLimit, 120000, 75);   // well over its 50k limit, overdue
    await mkInvoice(noLimit, 30000, 5);

    const before = await fin.overview({});

    console.log('\nReceivables agree with the credit gate');
    // Sum what the gate would see for these three, and check the dashboard
    // moved by exactly that much.
    let gateSum = 0;
    for (const pid of [inLimit, overLimit, noLimit]) {
      gateSum += (await pay.outstanding(pid)).outstanding;
    }
    ok(gateSum === 250000, 'the three test customers owe 250000 by the gate', `got ${gateSum}`);

    ok(before.receivables.outstanding >= 250000,
      'the dashboard total includes them', `got ${before.receivables.outstanding}`);

    const ag = before.receivables.ageing;
    const bucketSum = r2(ag.current + ag.d1_30 + ag.d31_60 + ag.d61_90 + ag.d90_plus);
    ok(bucketSum === before.receivables.outstanding,
      'the ageing buckets sum to the outstanding total', `${bucketSum} vs ${before.receivables.outstanding}`);
    ok(r2(before.receivables.overdue + before.receivables.not_overdue) === before.receivables.outstanding,
      'overdue and not-overdue sum to the total');

    console.log('\nCredit exposure');
    const over = before.exposure.over_limit.find(x => x.partner_id === overLimit);
    ok(!!over, 'a customer past its credit limit is listed');
    ok(over && over.utilisation === 240, 'utilisation is outstanding against limit', over ? `${over.utilisation}%` : '');
    ok(!before.exposure.over_limit.some(x => x.partner_id === inLimit),
      'a customer inside its limit is not');
    const nl = before.exposure.top_debtors.find(x => x.partner_id === noLimit);
    ok(nl && nl.utilisation === null,
      'a customer with no limit set reports null utilisation, not infinity',
      nl ? String(nl.utilisation) : 'missing');
    ok(before.exposure.top_debtors.length <= 10, 'top debtors is capped at ten');
    ok(before.exposure.top_debtors.every((x, i, a) => i === 0 || a[i - 1].outstanding >= x.outstanding),
      'and is sorted by who owes most');

    console.log('\nCollections');
    const paid = await pay.record({ partner_id: inLimit, amount: 40000, mode: 'NEFT', created_by: 'fintest' });
    ok(paid.payment, 'a receipt is recorded');
    const today = new Date().toISOString().slice(0, 10);
    // Ask the DB for its own date — the server runs in IST and Node's
    // toISOString is UTC, so near midnight the two disagree.
    const pgToday = (await pool.query(`SELECT CURRENT_DATE::text d`)).rows[0].d;
    const after = await fin.overview({ from: pgToday, to: pgToday });
    ok(after.collections.received >= 40000,
      'the receipt appears in the period collections', `got ${after.collections.received}`);
    ok(r2(after.collections.applied + after.collections.on_account) === after.collections.received,
      'applied plus on-account equals money received',
      `${after.collections.applied} + ${after.collections.on_account} vs ${after.collections.received}`);
    ok(after.collections.by_mode.some(m => m.mode === 'NEFT'),
      'collections are broken down by mode');
    ok(r2(after.collections.by_mode.reduce((s, m) => s + m.amount, 0)) === after.collections.received,
      'the mode breakdown sums to the total');

    ok(after.receivables.outstanding === r2(before.receivables.outstanding - 40000),
      'receivables fall by exactly what was collected',
      `${before.receivables.outstanding} -> ${after.receivables.outstanding}`);

    // The date window must actually filter.
    const none = await fin.overview({ from: '2099-01-01', to: '2099-12-31' });
    ok(none.collections.received === 0, 'a period with no receipts collects nothing');
    ok(none.receivables.outstanding === after.receivables.outstanding,
      'but receivables are a position, not a period — unchanged by the window');

    console.log('\nTrend');
    ok(after.trend.length === 12, 'twelve months of trend', `${after.trend.length}`);
    ok(after.trend.every(m => /^\d{4}-\d{2}$/.test(m.month)), 'each point is a YYYY-MM month');
    ok(after.trend[11].month === pgToday.slice(0, 7), 'the last point is the current month', after.trend[11].month);
    ok(after.trend.every(m => m.invoiced >= 0 && m.collected >= 0), 'no negative months');

  } finally {
    const ids = [inLimit, overLimit, noLimit];
    await pool.query(`DELETE FROM payment_allocations WHERE payment_id IN (SELECT payment_id FROM payments WHERE partner_id = ANY($1))`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM payments WHERE partner_id = ANY($1)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM tax_invoices WHERE partner_id = ANY($1)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM partners WHERE partner_id = ANY($1)`, [ids]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
