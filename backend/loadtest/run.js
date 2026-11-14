// Load test.
//
// The gap analysis said scalability was "unmeasured, not proven" — so the point
// of this is to produce numbers, not to hit a target. It uses nothing but node's
// own fetch so it can run on the mill's machine without installing anything.
//
// Two kinds of scenario, and the second matters more:
//
//   THROUGHPUT — how fast the read and ingest paths are, and where they bend.
//   CORRECTNESS UNDER CONCURRENCY — whether the money paths still produce the
//   right answer when hit simultaneously. A system that is merely slow can be
//   scheduled around; one that double-allocates a payment under load cannot.
//
//   npm run loadtest
//   npm run loadtest -- --heavy     more iterations

require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE = process.env.LOAD_BASE || 'http://localhost:4000';
const HEAVY = process.argv.includes('--heavy');
const token = jwt.sign({ id: 1, username: 'loadtest', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
});

const pct = (arr, p) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

// Fire `total` requests keeping `concurrency` in flight.
async function drive(label, total, concurrency, makeRequest) {
  const times = [];
  const errors = {};
  let done = 0;
  const started = Date.now();

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (done < total) {
      done++;
      const t0 = Date.now();
      try {
        const res = await makeRequest();
        times.push(Date.now() - t0);
        if (!res.ok) errors[res.status] = (errors[res.status] || 0) + 1;
      } catch (e) {
        times.push(Date.now() - t0);
        const k = (e.message || 'error').slice(0, 40);
        errors[k] = (errors[k] || 0) + 1;
      }
    }
  }));

  const elapsed = (Date.now() - started) / 1000;
  const errCount = Object.values(errors).reduce((a, b) => a + b, 0);
  console.log(
    `  ${label.padEnd(30)} ${String(total).padStart(5)} reqs  c=${String(concurrency).padStart(3)}  ` +
    `${(total / elapsed).toFixed(0).padStart(5)} rps   ` +
    `p50 ${String(pct(times, 0.5)).padStart(5)}ms  p95 ${String(pct(times, 0.95)).padStart(5)}ms  ` +
    `p99 ${String(pct(times, 0.99)).padStart(5)}ms` +
    (errCount ? `   ERRORS ${JSON.stringify(errors)}` : ''));

  return { label, total, concurrency, rps: total / elapsed, p50: pct(times, 0.5), p95: pct(times, 0.95), p99: pct(times, 0.99), errors };
}

(async () => {
  const results = [];
  const N = HEAVY ? 4 : 1;

  console.log('\nREAD PATHS — what the dashboards and screens do all day');
  results.push(await drive('GET /api/machines', 200 * N, 10, () => fetch(BASE + '/api/machines', { headers: H })));
  results.push(await drive('GET /api/dashboard/live', 200 * N, 10, () => fetch(BASE + '/api/dashboard/live', { headers: H })));
  results.push(await drive('GET /api/wa/ageing', 200 * N, 10, () => fetch(BASE + '/api/wa/ageing', { headers: H })));
  results.push(await drive('GET /api/allocation/lots', 200 * N, 10, () => fetch(BASE + '/api/allocation/lots', { headers: H })));

  console.log('\nCOLLECTOR INGEST — 16 machines posting every few seconds');
  const dcKey = process.env.DC_API_KEY;
  const machine = (await pool.query('SELECT machine_id FROM machines LIMIT 1')).rows[0]?.machine_id;
  if (dcKey && machine) {
    let counter = 100000;
    results.push(await drive('POST /api/live-data', 200 * N, 16, () => fetch(BASE + '/api/live-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': dcKey },
      body: JSON.stringify({ machine_id: machine, rpm: 20, status: 'RUNNING', production_counter: counter++ }),
    })));
  } else {
    console.log('  SKIPPED — DC_API_KEY or a machine row is missing');
  }

  console.log('\nCONCURRENCY PRESSURE — beyond the connection pool (default max 10)');
  results.push(await drive('GET /api/wa/ageing', 200 * N, 50, () => fetch(BASE + '/api/wa/ageing', { headers: H })));

  // ── The part that matters ────────────────────────────────────────────────
  console.log('\nCORRECTNESS UNDER CONCURRENCY — money must still add up');
  const tag = 'LOAD' + Date.now().toString().slice(-7);
  const pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name, credit_days) VALUES ($1,'ZZ Load Test',30) RETURNING partner_id`,
    [tag])).rows[0].partner_id;
  const inv = (await pool.query(
    `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
     VALUES ($1,$2,CURRENT_DATE,100000,'ISSUED') RETURNING invoice_id`, ['LT-' + tag, pid])).rows[0].invoice_id;

  try {
    // 20 receipts of 10,000 fired at once against a single 100,000 invoice.
    // Correct behaviour: exactly 100,000 allocated, the rest held on account.
    // A broken lock would over-allocate and the invoice would go negative.
    const CONCURRENT = 20;
    const t0 = Date.now();
    const posts = await Promise.all(Array.from({ length: CONCURRENT }, () =>
      fetch(BASE + '/api/wa/payments', {
        method: 'POST', headers: H,
        body: JSON.stringify({ partner_id: pid, amount: 10000, mode: 'NEFT', reference: tag }),
      }).then(r => r.status).catch(e => 'ERR:' + e.message.slice(0, 20))));
    const ms = Date.now() - t0;

    const bal = (await pool.query(
      `SELECT grand_total, allocated, balance FROM v_invoice_balances WHERE invoice_id=$1`, [inv])).rows[0];
    const over = (await pool.query(
      `SELECT COALESCE(SUM(pa.amount),0) a FROM payment_allocations pa WHERE pa.invoice_id=$1`, [inv])).rows[0].a;

    const okStatuses = posts.filter(s => s === 201).length;
    console.log(`  ${CONCURRENT} simultaneous receipts of 10,000 against one 100,000 invoice — ${ms}ms`);
    console.log(`    accepted            : ${okStatuses}/${CONCURRENT}`);
    console.log(`    allocated to invoice: ${Number(over)}  (must be exactly 100000)`);
    console.log(`    invoice balance     : ${Number(bal.balance)}  (must be exactly 0, never negative)`);

    const correct = Number(over) === 100000 && Number(bal.balance) === 0;
    console.log(`    ${correct ? 'CORRECT — the advisory lock held' : '*** WRONG — over-allocation under load ***'}`);
    results.push({ label: 'concurrent-payments', correct, allocated: Number(over), balance: Number(bal.balance) });
  } finally {
    await pool.query(`DELETE FROM payment_allocations WHERE invoice_id=$1`, [inv]).catch(() => {});
    await pool.query(`DELETE FROM payments WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM tax_invoices WHERE invoice_id=$1`, [inv]).catch(() => {});
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
  }

  // Where did it hurt?
  console.log('\nSLOWEST QUERIES SEEN BY POSTGRES (pg_stat_statements if enabled)');
  try {
    const q = await pool.query(`
      SELECT calls, ROUND(mean_exec_time::numeric,1) AS mean_ms, LEFT(query, 70) AS q
        FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 5`);
    q.rows.forEach(r => console.log(`  ${String(r.mean_ms).padStart(7)}ms  x${String(r.calls).padStart(5)}  ${r.q.replace(/\s+/g, ' ')}`));
  } catch {
    console.log('  pg_stat_statements not enabled — skipped');
  }

  await pool.end();

  const slow = results.filter(r => r.p95 && r.p95 > 1000);
  const errored = results.filter(r => r.errors && Object.keys(r.errors).length);
  console.log('\nSUMMARY');
  console.log(`  scenarios with p95 over 1s : ${slow.length ? slow.map(s => s.label).join(', ') : 'none'}`);
  console.log(`  scenarios with errors      : ${errored.length ? errored.map(s => s.label).join(', ') : 'none'}`);
  process.exit(0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
