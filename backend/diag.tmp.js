require('dotenv').config({ quiet: true });
const pool = require('./config/database');

(async () => {
  for (const t of ['wa_ai_actions', 'uom_conversions', 'uom_master', 'sales_order_items', 'tax_invoice_items']) {
    const c = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
    if (!c.rows.length) { console.log(`=== ${t}: MISSING`); continue; }
    const n = await pool.query(`SELECT COUNT(*)::int n FROM "${t}"`);
    console.log(`=== ${t} (${n.rows[0].n} rows)`);
    console.log('   ', c.rows.map(r => r.column_name).join(', '));
  }
  const u = await pool.query(`SELECT * FROM uom_conversions LIMIT 5`).catch(() => ({ rows: [] }));
  console.log('\nuom_conversions sample:', JSON.stringify(u.rows));
  const p = await pool.query(
    `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE credit_limit > 0)::int with_limit,
            COUNT(*) FILTER (WHERE credit_days > 0)::int with_days FROM partners`);
  console.log('partners:', JSON.stringify(p.rows[0]));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
