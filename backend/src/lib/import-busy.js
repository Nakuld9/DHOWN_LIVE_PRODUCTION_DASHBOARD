// Import → Busy posting readiness (spec §33).
//
// Busy remains the book of accounts and its data file is proprietary (.BDS, NOT
// SQL). MES therefore NEVER writes a voucher into Busy — the live write path only
// becomes possible via the Busy Partner Dev API, which is not yet available.
//
// What this module does instead is READ-ONLY readiness:
//   1. Build a clean, balanced DOUBLE-ENTRY PREVIEW of the import purchase voucher
//      from the finalised (actual) landed cost — the exact heads/amounts a human
//      (or, later, the partner API) would post. It is a PREVIEW, never posted here.
//   2. Track when a human has posted that voucher in Busy manually, by recording
//      the Busy voucher reference against the import, so MES knows what is done.
//
// Costing rules carried through from import-costing.js: recoverable IGST is ITC
// (its own ledger, NOT inventory cost); freight/insurance are only separate lines
// when treated ADDITIONAL (otherwise already inside the CIF value).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

module.exports = (pool) => {
  const costing = require('./import-costing')(pool);

  const audit = async (username, action, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'IMPORTS',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // Build the balanced voucher preview for one import from its cost row.
  async function postingPreview(importId) {
    const imp = (await pool.query(
      `SELECT i.import_id, i.import_no, i.incoterm, i.quantity, i.busy_posted_ref, i.busy_posted_at,
              p.company_name AS supplier, it.item_name AS material
         FROM imports i LEFT JOIN partners p ON p.partner_id=i.supplier_id
         LEFT JOIN items it ON it.item_id=i.material_id
        WHERE i.import_id=$1 AND i.deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    const cost = (await pool.query(`SELECT * FROM import_costs WHERE import_id=$1`, [importId])).rows[0];
    if (!cost) return { import: imp, ready: false, reason: 'No costing entered yet.', lines: [] };

    const b = costing.computeLanded(cost);
    const cifInr = b.cif_value_in_inr;
    const igstAmt = num(cost.igst);
    const igstRecoverable = cost.igst_recoverable !== false;

    // Import-side expenses that go INTO inventory (everything landed except CIF,
    // freight/insurance additions — which get their own lines — and recoverable IGST).
    const inventoryOther =
      num(cost.customs_duty) + num(cost.other_customs_levies) + num(cost.other_taxes) +
      num(cost.port_charges) + num(cost.terminal_charges) + num(cost.cfs_charges) + num(cost.cha_charges) +
      num(cost.documentation_charges) + num(cost.bank_charges) + num(cost.local_transport) + num(cost.other_import_expenses) +
      (igstRecoverable ? 0 : igstAmt);   // non-recoverable IGST is a cost → inventory

    // Debit side (what the import costs / where value lands).
    const dr = [];
    dr.push({ ledger: 'Import Purchases / Inventory', type: 'DR', amount: r2(cifInr), basis: 'CIF value in INR' });
    if (b.freight_added > 0) dr.push({ ledger: 'Ocean Freight (additional)', type: 'DR', amount: b.freight_added, basis: 'freight treated ADDITIONAL (outside CIF)' });
    if (b.insurance_added > 0) dr.push({ ledger: 'Marine Insurance (additional)', type: 'DR', amount: b.insurance_added, basis: 'insurance treated ADDITIONAL (outside CIF)' });
    if (inventoryOther > 0) dr.push({ ledger: 'Import Expenses (landed into inventory)', type: 'DR', amount: r2(inventoryOther), basis: 'customs duty, port/CFS/CHA, docs, bank, local transport' + (igstRecoverable ? '' : ', non-recoverable IGST') });
    if (igstRecoverable && igstAmt > 0) dr.push({ ledger: 'IGST Input Tax Credit (ITC)', type: 'DR', amount: r2(igstAmt), basis: 'recoverable — NOT inventory cost' });

    const drTotal = r2(dr.reduce((s, l) => s + l.amount, 0));
    // Credit side: the whole thing is payable (to supplier + to customs/clearing).
    // Kept as a single clearing credit so the preview balances cleanly; the human
    // splits supplier vs customs vs expense payables when posting in Busy.
    const cr = [{ ledger: 'Sundry Creditors / Import Clearing', type: 'CR', amount: drTotal, basis: `payable — supplier ${imp.supplier || ''} + customs + expenses` }];

    // ── Advance payment vouchers ─────────────────────────────────────────────
    // Each ADVANCE TT allocated to this import posts a payment voucher at booking:
    // DR Advance to Supplier + DR Bank Charges (share) / CR Bank. Kept separate from
    // the purchase voucher (as accounting does it); the advance is knocked off the
    // supplier payable when the purchase is booked.
    const advRows = (await pool.query(
      `SELECT a.allocated_fc, a.allocated_inr, p.amount_fc, p.bank_charges, p.currency,
              p.exchange_rate, p.tt_reference, p.tt_date, p.bank, p.busy_ref
         FROM import_payment_allocations a JOIN import_payments p ON p.payment_id=a.payment_id
        WHERE a.import_id=$1 AND p.kind='ADVANCE' ORDER BY p.tt_date, p.payment_id`, [importId])).rows;
    const advance_vouchers = advRows.map(a => {
      const chgShare = num(a.amount_fc) > 0 ? r2(num(a.bank_charges) * (num(a.allocated_fc) / num(a.amount_fc))) : 0;
      const lines = [
        { ledger: `Advance to Supplier (${imp.supplier || 'supplier'})`, type: 'DR', amount: r2(a.allocated_inr), basis: `${a.currency} ${num(a.allocated_fc)} @ ₹${a.exchange_rate}` },
      ];
      if (chgShare > 0) lines.push({ ledger: 'Bank Charges (Import Remittance)', type: 'DR', amount: chgShare, basis: 'SWIFT + remittance + FX conv GST (share of this allocation)' });
      lines.push({ ledger: `Bank (${a.bank || 'remitting bank'})`, type: 'CR', amount: r2(num(a.allocated_inr) + chgShare), basis: 'amount debited from the account' });
      const drT = r2(lines.filter(l => l.type === 'DR').reduce((s, l) => s + l.amount, 0));
      return { tt_reference: a.tt_reference, tt_date: a.tt_date, bank: a.bank, busy_ref: a.busy_ref || null,
        lines, totals: { debit: drT, credit: drT, balanced: true } };
    });
    const advanceTotalInr = r2(advRows.reduce((s, a) => s + num(a.allocated_inr), 0));

    return {
      import: { import_no: imp.import_no, supplier: imp.supplier, material: imp.material, quantity: num(imp.quantity), incoterm: imp.incoterm },
      ready: cost.is_actual === true,
      is_actual: cost.is_actual === true,
      already_posted: !!imp.busy_posted_ref,
      busy_posted_ref: imp.busy_posted_ref || null,
      busy_posted_at: imp.busy_posted_at || null,
      lines: [...dr, ...cr],
      advance_vouchers, advance_total_inr: advanceTotalInr,
      totals: { debit: drTotal, credit: drTotal, balanced: true, landed_cost: b.total_landed_cost },
      notes: [
        'PREVIEW ONLY — MES does not write to Busy. Post this voucher in Busy manually (or via the partner API once available), then record its reference here.',
        cost.is_actual ? 'Costing is finalised (actual).' : 'Costing is still an ESTIMATE — finalise the actual before posting.',
        igstRecoverable ? 'Recoverable IGST is shown as ITC, not inventory cost.' : 'IGST is flagged non-recoverable and included in inventory cost.',
        advanceTotalInr > 0 ? `Advance already paid: ₹${advanceTotalInr.toLocaleString('en-IN')} across ${advRows.length} TT — post the advance voucher(s) below and knock it off the supplier payable when booking the purchase.` : null,
      ].filter(Boolean),
    };
  }

  // Imports whose actual costing is finalised → posting candidates. Split by whether
  // a Busy reference has already been recorded.
  async function readinessList() {
    const rows = (await pool.query(`
      SELECT i.import_id, i.import_no, p.company_name AS supplier, it.item_name AS material,
             c.total_landed_cost, c.is_actual, i.busy_posted_ref, i.busy_posted_at
        FROM imports i
        JOIN import_costs c ON c.import_id=i.import_id
        LEFT JOIN partners p ON p.partner_id=i.supplier_id
        LEFT JOIN items it ON it.item_id=i.material_id
       WHERE i.deleted_at IS NULL AND c.total_landed_cost > 0
       ORDER BY i.import_id DESC`)).rows;
    const ready = rows.filter(r => r.is_actual && !r.busy_posted_ref);
    const posted = rows.filter(r => r.busy_posted_ref);
    const estimates = rows.filter(r => !r.is_actual && !r.busy_posted_ref);
    return {
      busy_write_available: false,
      reason: 'Busy uses a proprietary .BDS data file (not SQL); the live write path is available only via the Busy Partner Dev API, which is not yet configured. MES never writes to Busy — post manually and record the reference.',
      counts: { ready_to_post: ready.length, awaiting_actual: estimates.length, posted: posted.length },
      ready_to_post: ready.map(clean), awaiting_actual: estimates.map(clean), posted: posted.map(clean),
    };
  }
  const clean = (r) => ({
    import_id: r.import_id, import_no: r.import_no, supplier: r.supplier, material: r.material,
    landed_cost: r2(r.total_landed_cost), is_actual: r.is_actual === true,
    busy_posted_ref: r.busy_posted_ref || null, busy_posted_at: r.busy_posted_at || null,
  });

  // Record (or clear) a human-entered Busy voucher reference. This does NOT post to
  // Busy — it only notes that the operator posted it there, for reconciliation.
  async function recordPosting(importId, ref, user) {
    const imp = (await pool.query(`SELECT import_id, import_no FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    const clear = !ref || !String(ref).trim();
    await pool.query(
      `UPDATE imports SET busy_posted_ref=$2, busy_posted_at=$3, busy_posted_by=$4, updated_at=NOW() WHERE import_id=$1`,
      [importId, clear ? null : String(ref).trim(), clear ? null : new Date().toISOString(), clear ? null : (user?.username || null)]);
    await audit(user?.username, clear ? 'IMPORT_BUSY_UNPOST' : 'IMPORT_BUSY_POST_REF', { import_no: imp.import_no, ref: clear ? null : ref });
    return { ok: true, import_no: imp.import_no, busy_posted_ref: clear ? null : String(ref).trim() };
  }

  return { postingPreview, readinessList, recordPosting };
};
