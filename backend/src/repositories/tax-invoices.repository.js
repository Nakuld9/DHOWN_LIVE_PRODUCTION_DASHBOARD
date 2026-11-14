// Tax Invoices repository — tax_invoices (header) + tax_invoice_items.
// Tax is computed in the service; the repo persists the fully-computed
// header totals and lines atomically.
module.exports = (pool) => {
  const weigh = require('../lib/line-weights')(pool);
  return {
  async list({ status, from, to } = {}) {
    const params = []; const conds = [];
    if (status) { conds.push(`status = $${params.length + 1}`); params.push(status); }
    if (from)   { conds.push(`invoice_date >= $${params.length + 1}`); params.push(from); }
    if (to)     { conds.push(`invoice_date <= $${params.length + 1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return pool.query(`SELECT * FROM tax_invoices ${where} ORDER BY created_at DESC`, params);
  },

  async findById(id) {
    const hd = await pool.query(`SELECT * FROM tax_invoices WHERE invoice_id = $1`, [id]);
    if (!hd.rows.length) return null;
    const items = await pool.query(`SELECT * FROM tax_invoice_items WHERE invoice_id = $1 ORDER BY line_id`, [id]);
    return { ...hd.rows[0], items: items.rows };
  },

  findStatus(id) { return pool.query(`SELECT status FROM tax_invoices WHERE invoice_id = $1`, [id]); },

  // header + computed lines + computed totals (all from the service)
  async insert(invoiceNumber, hdr, lines, totals) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const h = await client.query(
        `INSERT INTO tax_invoices
           (invoice_number, invoice_date, partner_id, customer_name, customer_gstin,
            customer_address, customer_state, place_of_supply, supply_type, so_id, so_number,
            taxable_value, cgst_amount, sgst_amount, igst_amount, total_tax, round_off, grand_total,
            notes, created_by, customer_mobile)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [invoiceNumber, hdr.invoice_date || new Date().toISOString().slice(0, 10),
         hdr.partner_id || null, hdr.customer_name || null, hdr.customer_gstin || null,
         hdr.customer_address || null, hdr.customer_state || null, hdr.place_of_supply || null,
         hdr.supply_type || 'INTRA', hdr.so_id || null, hdr.so_number || null,
         totals.taxable, totals.cgst, totals.sgst, totals.igst, totals.tax, totals.round_off, totals.grand,
         hdr.notes || null, hdr.created_by || null, hdr.customer_mobile || null]
      );
      const invId = h.rows[0].invoice_id;

      // Same resolution as sales orders: the invoice is the document the
      // customer weighs the delivery against, so a line billed in metres
      // should carry the kilograms it represents and the basis for it.
      // Tax figures are NOT touched — they were computed in the service from
      // the quantity as billed, and recomputing them here from a converted
      // weight would change the invoice total.
      const weights = await weigh.resolveAll(lines);

      for (const [i, L] of lines.entries()) {
        const w = weights.lines[i] || { quantity_kg: null, uom_basis: null };
        await client.query(
          `INSERT INTO tax_invoice_items
             (invoice_id, item_id, item_name, hsn_code, quantity, uom, rate, taxable_value,
              gst_rate, cgst_amount, sgst_amount, igst_amount, line_total, quantity_kg, uom_basis)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [invId, L.item_id || null, L.item_name || null, L.hsn_code || null, L.quantity, L.uom || 'KG',
           L.rate, L.taxable_value, L.gst_rate, L.cgst_amount, L.sgst_amount, L.igst_amount, L.line_total,
           w.quantity_kg, w.uom_basis]
        );
      }
      await client.query('COMMIT');
      const row = await this.findById(invId);
      return { ...row, uom_warnings: weights.warnings, total_kg: weights.total_kg,
               unresolved_lines: weights.unresolved };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  setStatus(id, status) {
    return pool.query(`UPDATE tax_invoices SET status=$1, updated_at=NOW() WHERE invoice_id=$2 RETURNING *`, [status, id]);
  },

  async remove(id) {
    await pool.query(`DELETE FROM tax_invoices WHERE invoice_id=$1`, [id]);
    return { ok: true };
  },
  };
};
