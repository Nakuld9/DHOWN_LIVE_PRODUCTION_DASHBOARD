// Busy-21 CSV sync repository — GRN purchases + dispatch challans for manual
// import into Busy accounting. SQL verbatim from the original inline handlers.
module.exports = (pool) => ({
  grnRows({ from, to }) {
    const conds = ['g.status = \'APPROVED\'']; const params = [];
    if (from) { conds.push(`g.receipt_date >= $${params.length + 1}`); params.push(from); }
    if (to)   { conds.push(`g.receipt_date <= $${params.length + 1}`); params.push(to); }
    return pool.query(`
      SELECT g.grn_number, g.receipt_date, g.supplier_name, g.supplier_invoice,
             yl.lot_number, yl.yarn_type, yl.count AS yarn_count, yl.color,
             yl.net_weight_kg, yl.cones AS boxes_bags, yl.rate_per_kg,
             ROUND((yl.net_weight_kg * yl.rate_per_kg)::NUMERIC, 2) AS amount
      FROM grn g JOIN yarn_lots yl ON yl.grn_id = g.grn_id
      WHERE ${conds.join(' AND ')}
      ORDER BY g.receipt_date, g.grn_number
    `, params);
  },

  dispatchRows({ from, to }) {
    const conds = []; const params = [];
    if (from) { conds.push(`d.dispatch_date >= $${params.length + 1}`); params.push(from); }
    if (to)   { conds.push(`d.dispatch_date <= $${params.length + 1}`); params.push(to); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return pool.query(`
      SELECT d.dispatch_number, d.dispatch_date, d.customer_name, d.dispatch_type,
             di.description, di.weight_kg, di.quantity
      FROM dispatch_challans d
      LEFT JOIN dispatch_items di ON di.dispatch_id = d.dispatch_id
      ${where}
      ORDER BY d.dispatch_date, d.dispatch_number
    `, params);
  },
});
