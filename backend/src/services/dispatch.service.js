// Dispatch service — validation, pricing, and post-commit side effects.
// Pricing logic migrated verbatim from the inline handler. nextSeq/numOrNull are
// injected from server.js (shared helpers, used by other modules too).
module.exports = (repo, { nextSeq, numOrNull, autoInvoice }) => ({
  async list(filters) {
    const r = await repo.list(filters);
    return r.rows;
  },

  async get(id) {
    const row = await repo.findById(id);
    if (!row) return { notFound: true };
    return { row };
  },

  async create(body, username) {
    const { customer_name, customer_contact, vehicle_number, dispatch_date, notes, items,
            dispatch_type = 'FG', qc_override_reason,
            consignee_gstin, ship_to_address, place_of_supply, jobwork_expected_return } = body;
    if (!customer_name || !dispatch_date || !Array.isArray(items) || !items.length)
      return { badRequest: 'customer_name, dispatch_date, items[] required' };
    const isJobwork = dispatch_type === 'JOBWORK';

    const dispatch_number = await nextSeq('DC', 'dispatch_challans', 'dispatch_number');
    const total_kg = items.reduce((s, i) => s + parseFloat(i.weight_kg || 0), 0);

    // Optional commercial pricing per line (sale / job-work dispatches)
    const priceLine = (item) => {
      const rate = numOrNull(item.rate_per_kg);
      if (!rate || rate <= 0) return { rate: null, gst: null, taxable: null, gstAmt: null, total: null };
      const w = parseFloat(item.weight_kg || 0);
      const gst = numOrNull(item.gst_rate) ?? 5;
      const taxable = +(w * rate).toFixed(2);
      const gstAmt = +(taxable * gst / 100).toFixed(2);
      return { rate, gst, taxable, gstAmt, total: +(taxable + gstAmt).toFixed(2) };
    };
    const priced = items.map(priceLine);
    const hasPricing = priced.some(p => p.taxable !== null);
    const totTaxable = priced.reduce((s, p) => s + (p.taxable || 0), 0);
    const totGst     = priced.reduce((s, p) => s + (p.gstAmt  || 0), 0);

    const result = await repo.createDispatch({
      dispatch_number, customer_name, customer_contact, vehicle_number, dispatch_date,
      notes, dispatch_type, items, priced, total_kg, hasPricing, totTaxable, totGst, username,
      qc_override_reason, consignee_gstin, ship_to_address, place_of_supply, jobwork_expected_return,
    });
    if (result.badRequest) return result;

    await repo.insertAudit(username, `dispatch=${dispatch_number} customer=${customer_name} kg=${total_kg.toFixed(3)}`);

    // Auto: cost snapshot per FG lot dispatched
    try { await repo.costSnapshot(items, dispatch_date); }
    catch (costErr) { console.error('Dispatch snapshot error:', costErr.message); }

    // stock_ledger: FG OUT on dispatch
    try { await repo.ledgerOut({ dispatch_number, customer_name, total_kg, username }); }
    catch (slErr) { console.error('Ledger dispatch error:', slErr.message); }

    // Auto: raise a DRAFT tax invoice for a priced (commercial) dispatch. Never let
    // an invoicing hiccup fail the dispatch itself — the dispatch is the record of
    // truth; the invoice can be raised manually if this misses.
    // Job-work OUT is NOT a sale — never raise a tax invoice for it.
    if (autoInvoice && hasPricing && !isJobwork && result.row?.dispatch_id) {
      try {
        const inv = await autoInvoice.fromDispatch(result.row.dispatch_id, username);
        if (inv?.invoice_id) result.invoice = { invoice_id: inv.invoice_id, invoice_number: inv.invoice_number, supply_type: inv.supply_type };
      } catch (invErr) { console.error('Auto-invoice error:', invErr.message); }
    }

    return result;
  },

  async remove(id) {
    return repo.removeDispatch(id);
  },

  // Record job-work material returning from the processor.
  async jobworkReturn(id, body, username) {
    const out = await repo.recordJobworkReturn(id, body || {});
    if (out.row) await repo.insertAudit(username, `jobwork-return dispatch=${id} status=${out.row.jobwork_return_status}`).catch(() => {});
    return out;
  },
});
