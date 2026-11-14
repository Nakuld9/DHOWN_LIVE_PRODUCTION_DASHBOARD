// New agent write tools through the approvals queue: hold_roll (Quality) and
// create_purchase_order (Purchase). Each must PROPOSE only, then execute exactly
// once on a SUPERVISOR approval. ZZ data, torn down.
//
//   node tests/ai-write-tools.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { ensureAiApprovalsSchema, ensureCapaSchema } = require('../src/db/schema');
const { createRegistry } = require('../src/ai/tool-registry');
const makeApprovals = require('../src/ai/approvals');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

(async () => {
  await ensureAiApprovalsSchema();
  await ensureCapaSchema();
  const registry = createRegistry();
  require('../src/ai/tools/quality.tools')(registry, { pool });
  require('../src/ai/tools/purchase.tools')(registry, { pool });
  require('../src/ai/tools/jobwork.tools')(registry, { pool });
  require('../src/ai/tools/inventory.tools')(registry, { pool });
  require('../src/ai/tools/sales.tools')(registry, { pool });
  const approvals = makeApprovals({ pool, registry });

  const MACH = 'ZZWT' + Date.now().toString().slice(-4);
  const ROLL = 'ZZWTR' + Date.now().toString().slice(-5);
  const SUP = 'ZZ Supplier ' + Date.now().toString().slice(-4);
  let holdId, poId, poRow;
  let capaId, capaRow, scId, scRow, trId, trLedgers = [];
  let fuId, fuRow;
  try {
    await pool.query(`INSERT INTO machines (machine_id, machine_name) VALUES ($1,'ZZ WT') ON CONFLICT DO NOTHING`, [MACH]);
    await pool.query(`INSERT INTO rolls (roll_id, machine_id, fabric_type, actual_weight_kg, warehouse_status, quarantine_status, created_at)
                      VALUES ($1,$2,'SJ',24,'IN_STOCK','NONE',NOW())`, [ROLL, MACH]);

    console.log('\nQuality: hold_roll drafts a quarantine, approval applies it');
    const hp = await approvals.propose({ agent: 'quality', toolName: 'hold_roll', args: { roll_id: ROLL, reason: 'shade off' }, user: { role: 'OPERATOR', username: 'qc' } });
    ok(hp.proposed && hp.approval_id, 'hold_roll proposes (no mutation yet)');
    holdId = hp.approval_id;
    ok((await pool.query(`SELECT quarantine_status FROM rolls WHERE roll_id=$1`, [ROLL])).rows[0].quarantine_status === 'NONE', 'roll NOT held yet');
    ok((await approvals.approve(holdId, { role: 'OPERATOR', username: 'x' })).code === 403, 'an operator cannot approve');
    const ha = await approvals.approve(holdId, { role: 'SUPERVISOR', username: 'sup' });
    ok(ha.ok, 'supervisor approval executes');
    ok((await pool.query(`SELECT quarantine_status FROM rolls WHERE roll_id=$1`, [ROLL])).rows[0].quarantine_status === 'QUARANTINED', 'roll is now QUARANTINED');

    console.log('\nPurchase: create_purchase_order drafts a PO, approval creates it');
    const before = Number((await pool.query(`SELECT COUNT(*) n FROM purchase_orders WHERE supplier_name=$1`, [SUP])).rows[0].n);
    const pp = await approvals.propose({ agent: 'purchase', toolName: 'create_purchase_order', args: { supplier_name: SUP, item_name: '30s combed', quantity: 100, rate: 250 }, user: { role: 'OPERATOR', username: 'buyer' } });
    ok(pp.proposed && pp.approval_id, 'create_purchase_order proposes');
    poId = pp.approval_id;
    ok(Number((await pool.query(`SELECT COUNT(*) n FROM purchase_orders WHERE supplier_name=$1`, [SUP])).rows[0].n) === before, 'no PO created yet');
    const pa = await approvals.approve(poId, { role: 'SUPERVISOR', username: 'sup' });
    ok(pa.ok && pa.result && pa.result.po_id, 'approval creates the PO', pa.result?.po_number);
    poRow = pa.result?.po_id;
    ok(Number((await pool.query(`SELECT COUNT(*) n FROM purchase_orders WHERE supplier_name=$1`, [SUP])).rows[0].n) === before + 1, 'the PO now exists');

    console.log('\nValidation');
    ok((await approvals.propose({ agent: 'purchase', toolName: 'create_purchase_order', args: { item_name: 'x', quantity: 1 }, user: { role: 'OPERATOR' } })).error != null, 'PO without supplier is refused at propose');
    ok((await approvals.propose({ agent: 'quality', toolName: 'hold_roll', args: { roll_id: 'NOPE' }, user: { role: 'OPERATOR' } })).error != null, 'holding an unknown roll is refused at propose');

    console.log('\nQuality: open_capa drafts a ticket, approval creates it');
    const cp = await approvals.propose({ agent: 'quality', toolName: 'open_capa', args: { title: 'ZZ shade drift on ' + MACH, severity: 'high', machine_id: MACH, defect_type: 'SHADE' }, user: { role: 'OPERATOR', username: 'qc' } });
    ok(cp.proposed && cp.approval_id, 'open_capa proposes');
    capaId = cp.approval_id;
    const ca = await approvals.approve(capaId, { role: 'SUPERVISOR', username: 'sup' });
    ok(ca.ok && ca.result && ca.result.capa_number, 'approval creates the CAPA', ca.result?.capa_number);
    capaRow = ca.result?.capa_id;
    ok((await pool.query(`SELECT status,severity FROM capa WHERE capa_id=$1`, [capaRow])).rows[0].status === 'OPEN', 'CAPA is OPEN');
    ok((await approvals.propose({ agent: 'quality', toolName: 'open_capa', args: { title: '' }, user: { role: 'OPERATOR' } })).error != null, 'CAPA without a title is refused');

    console.log('\nJob-work: create_subcontract_challan drafts, approval creates it + ledger OUT');
    const VEN = 'ZZ Dyer ' + Date.now().toString().slice(-4);
    const jp = await approvals.propose({ agent: 'jobwork', toolName: 'create_subcontract_challan', args: { vendor_name: VEN, job_type: 'dyeing', weight_kg: 120, roll_count: 5 }, user: { role: 'OPERATOR', username: 'store' } });
    ok(jp.proposed && jp.approval_id, 'create_subcontract_challan proposes');
    scId = jp.approval_id;
    ok(Number((await pool.query(`SELECT COUNT(*) n FROM subcontract_challans WHERE vendor_name=$1`, [VEN])).rows[0].n) === 0, 'no challan created yet');
    const ja = await approvals.approve(scId, { role: 'SUPERVISOR', username: 'sup' });
    ok(ja.ok && ja.result && ja.result.challan_number, 'approval creates the challan', ja.result?.challan_number);
    scRow = ja.result?.challan_id;
    ok(Number((await pool.query(`SELECT sent_weight_kg FROM subcontract_challans WHERE challan_id=$1`, [scRow])).rows[0].sent_weight_kg) === 120, 'challan has the sent weight');
    ok(Number((await pool.query(`SELECT COUNT(*) n FROM stock_ledger WHERE doc_type='SC_CHALLAN' AND doc_id=$1`, [ja.result.challan_number])).rows[0].n) === 1, 'an OUT ledger line was posted');
    ok((await approvals.propose({ agent: 'jobwork', toolName: 'create_subcontract_challan', args: { vendor_name: VEN, job_type: 'BOGUS', weight_kg: 10 }, user: { role: 'OPERATOR' } })).error != null, 'a bad job_type is refused');

    console.log('\nInventory: stock_transfer drafts, approval posts OUT + IN lines');
    const tp = await approvals.propose({ agent: 'inventory', toolName: 'stock_transfer', args: { item_desc: 'ZZ greige lot', quantity: 60, from_location: 'GREIGE-STORE', to_location: 'Dye House' }, user: { role: 'OPERATOR', username: 'store' } });
    ok(tp.proposed && tp.approval_id, 'stock_transfer proposes');
    trId = tp.approval_id;
    const ta = await approvals.approve(trId, { role: 'SUPERVISOR', username: 'sup' });
    ok(ta.ok && ta.result && ta.result.out_ledger_id && ta.result.in_ledger_id, 'approval posts both ledger lines');
    if (ta.result) trLedgers = [ta.result.out_ledger_id, ta.result.in_ledger_id];
    ok(Number((await pool.query(`SELECT COUNT(*) n FROM stock_ledger WHERE doc_id=$1`, [ta.result.doc_id])).rows[0].n) === 2, 'exactly two ledger lines for the transfer');
    ok((await approvals.propose({ agent: 'inventory', toolName: 'stock_transfer', args: { item_desc: 'x', quantity: 5, from_location: 'GREIGE-STORE', to_location: 'NOWHERE' }, user: { role: 'OPERATOR' } })).error != null, 'an unknown destination is refused');

    console.log('\nSales: create_followup drafts a reminder, approval creates it');
    const fp = await approvals.propose({ agent: 'sales', toolName: 'create_followup', args: { note: 'ZZ chase quotation ' + Date.now().toString().slice(-4), due_date: '31-12-2026' }, user: { role: 'OPERATOR', username: 'sales' } });
    ok(fp.proposed && fp.approval_id, 'create_followup proposes with a DD-MM-YYYY date');
    ok(/due 31-12-2026/.test(fp.summary || ''), 'the draft summary shows the date as DD-MM-YYYY', fp.summary);
    fuId = fp.approval_id;
    const fa = await approvals.approve(fuId, { role: 'SUPERVISOR', username: 'sup' });
    ok(fa.ok && fa.result && fa.result.followup_id, 'approval creates the follow-up', String(fa.result?.followup_id));
    fuRow = fa.result?.followup_id;
    const frow = (await pool.query(`SELECT status, kind, to_char(due_date,'YYYY-MM-DD') d FROM crm_followups WHERE followup_id=$1`, [fuRow])).rows[0];
    ok(frow.kind === 'MANUAL', 'follow-up is kind MANUAL');
    ok(frow.d === '2026-12-31', 'DD-MM-YYYY input stored as the correct date', frow.d);
    ok((await approvals.propose({ agent: 'sales', toolName: 'create_followup', args: { note: '' }, user: { role: 'OPERATOR' } })).error != null, 'a follow-up with no note is refused');
    ok((await approvals.propose({ agent: 'sales', toolName: 'create_followup', args: { note: 'x', customer_name: 'ZZ NO SUCH CUSTOMER' }, user: { role: 'OPERATOR' } })).error != null, 'an unknown customer is refused');
    const rel = await approvals.propose({ agent: 'sales', toolName: 'create_followup', args: { note: 'ZZ relative-date test', due_date: 'next week' }, user: { role: 'OPERATOR' } });
    ok(rel.proposed && rel.approval_id, 'a relative due date ("next week") is accepted');
    if (rel.approval_id) await pool.query(`DELETE FROM ai_approvals WHERE approval_id=$1`, [rel.approval_id]).catch(() => {});
    ok((await approvals.propose({ agent: 'sales', toolName: 'create_followup', args: { note: 'x', due_date: 'someday' }, user: { role: 'OPERATOR' } })).error != null, 'a nonsense due date is refused');

  } finally {
    if (poRow) { await pool.query(`DELETE FROM purchase_order_items WHERE po_id=$1`, [poRow]).catch(() => {}); await pool.query(`DELETE FROM purchase_orders WHERE po_id=$1`, [poRow]).catch(() => {}); }
    if (scRow) { await pool.query(`DELETE FROM stock_ledger WHERE doc_type='SC_CHALLAN' AND doc_id=(SELECT challan_number FROM subcontract_challans WHERE challan_id=$1)`, [scRow]).catch(() => {}); await pool.query(`DELETE FROM subcontract_challans WHERE challan_id=$1`, [scRow]).catch(() => {}); }
    if (capaRow) await pool.query(`DELETE FROM capa WHERE capa_id=$1`, [capaRow]).catch(() => {});
    if (fuRow) await pool.query(`DELETE FROM crm_followups WHERE followup_id=$1`, [fuRow]).catch(() => {});
    for (const lid of trLedgers) if (lid) await pool.query(`DELETE FROM stock_ledger WHERE ledger_id=$1`, [lid]).catch(() => {});
    for (const id of [holdId, poId, capaId, scId, trId, fuId]) if (id) await pool.query(`DELETE FROM ai_approvals WHERE approval_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM roll_quarantine_log WHERE roll_id=$1`, [ROLL]).catch(() => {});
    await pool.query(`DELETE FROM rolls WHERE roll_id=$1`, [ROLL]).catch(() => {});
    await pool.query(`DELETE FROM machines WHERE machine_id=$1`, [MACH]).catch(() => {});
  }
  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
