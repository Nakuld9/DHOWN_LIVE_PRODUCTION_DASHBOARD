// Auto-invoice a dispatch. When a priced (commercial) FG dispatch is created, we
// raise a DRAFT tax invoice from it — same GST engine the manual Tax Invoice screen
// uses — and link it back via dispatch_challans.invoice_id. It is a DRAFT on
// purpose: a human reviews and ISSUES it, so a wrong GSTIN or place-of-supply never
// goes out unchecked. Idempotent: a dispatch that already has an invoice is skipped,
// and a dispatch with no priced lines (job-work / samples) is not a sale to invoice.

// GST state codes — the first two digits of a GSTIN. Used only to decide INTRA vs
// INTER (CGST+SGST vs IGST) by comparing the customer's GSTIN prefix to our state.
const STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
  'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
  'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
  'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
  'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'daman and diu': '25', 'dadra and nagar haveli': '26', 'maharashtra': '27', 'karnataka': '29',
  'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34',
  'andaman and nicobar islands': '35', 'telangana': '36', 'andhra pradesh': '37', 'ladakh': '38',
};

module.exports = function makeDispatchInvoicer({ pool, taxInvoices }) {
  async function companyStateCode() {
    const r = await pool.query(`SELECT value FROM app_settings WHERE key='state' LIMIT 1`).catch(() => ({ rows: [] }));
    const name = String(r.rows[0]?.value || '').trim().toLowerCase();
    return STATE_CODES[name] || null;
  }

  // Create a DRAFT invoice from a dispatch. Returns {invoice_id, invoice_number} on
  // success, {skipped: reason} when it is not applicable, {error} on failure.
  async function fromDispatch(dispatchId, username) {
    const d = (await pool.query(`SELECT * FROM dispatch_challans WHERE dispatch_id=$1`, [dispatchId])).rows[0];
    if (!d) return { skipped: 'dispatch not found' };
    if (d.invoice_id) return { skipped: 'already invoiced', invoice_id: d.invoice_id };

    const rows = (await pool.query(
      `SELECT item_description, fabric_type, color_name, weight_kg, rate_per_kg, gst_rate
         FROM dispatch_items WHERE dispatch_id=$1`, [dispatchId])).rows;
    const items = rows
      .filter(r => Number(r.rate_per_kg) > 0 && Number(r.weight_kg) > 0)
      .map(r => ({
        item_name: (r.item_description || [r.fabric_type, r.color_name].filter(Boolean).join(' ') || 'Fabric').trim(),
        quantity: Number(r.weight_kg), uom: 'KG',
        rate: Number(r.rate_per_kg), gst_rate: Number(r.gst_rate) || 5, hsn_code: null,
      }));
    if (items.length === 0) return { skipped: 'no priced lines (not a sale)' };

    // Resolve the customer for GSTIN/state (drives INTRA vs INTER).
    let partner = null;
    if (d.partner_id) {
      partner = (await pool.query(
        `SELECT partner_id, company_name, gstin FROM partners WHERE partner_id=$1`, [d.partner_id])).rows[0] || null;
    }
    const gstin = partner?.gstin || null;
    const custPrefix = gstin ? String(gstin).slice(0, 2) : null;
    const ourCode = await companyStateCode();
    // INTER only when we can positively see the customer is in a different state.
    const supply_type = (custPrefix && ourCode && custPrefix !== ourCode) ? 'INTER' : 'INTRA';

    const body = {
      customer_name: d.customer_name,
      partner_id: d.partner_id || null,
      customer_gstin: gstin,
      customer_mobile: d.customer_contact || null,
      supply_type,
      invoice_date: d.dispatch_date || new Date().toISOString().slice(0, 10),
      notes: `Auto-generated from dispatch ${d.dispatch_number}.`,
      created_by: username || 'auto-invoice',
      items,
    };

    const out = await taxInvoices.create(body);
    if (out.badRequest) return { error: out.badRequest };
    const invId = out.row?.invoice_id;
    if (!invId) return { error: 'invoice creation returned no id' };
    await pool.query(`UPDATE dispatch_challans SET invoice_id=$1, updated_at=NOW() WHERE dispatch_id=$2`, [invId, dispatchId]);
    return { invoice_id: invId, invoice_number: out.row.invoice_number, supply_type };
  }

  return { fromDispatch, _STATE_CODES: STATE_CODES };
};
