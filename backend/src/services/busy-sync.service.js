// Busy-21 CSV sync service — builds the Busy-compatible CSV text (verbatim).
module.exports = (repo) => ({
  async grnCsv({ from, to }) {
    const r = await repo.grnRows({ from, to });
    const header = 'Date,Voucher No,Party Name,Party Invoice,Lot No,Item,Count,Colour,Qty (kg),Pkg,Rate/kg,Amount';
    const lines = r.rows.map(row =>
      [row.receipt_date?.toISOString?.().slice(0, 10) || row.receipt_date,
       row.grn_number, `"${row.supplier_name}"`, row.supplier_invoice || '',
       row.lot_number, `"${row.yarn_type || ''}"`, row.yarn_count || '', row.color || '',
       row.net_weight_kg, row.boxes_bags || 0, row.rate_per_kg || 0, row.amount || 0].join(',')
    );
    return { filename: `busy_grn_${Date.now()}.csv`, csv: [header, ...lines].join('\n') };
  },

  async dispatchCsv({ from, to }) {
    const r = await repo.dispatchRows({ from, to });
    const header = 'Date,Challan No,Party Name,Type,Item,Qty,Weight (kg)';
    const lines = r.rows.map(row =>
      [row.dispatch_date?.toISOString?.().slice(0, 10) || row.dispatch_date,
       row.dispatch_number, `"${row.customer_name}"`, row.dispatch_type || 'FG',
       `"${row.description || ''}"`, row.quantity || 1, row.weight_kg || 0].join(',')
    );
    return { filename: `busy_dispatch_${Date.now()}.csv`, csv: [header, ...lines].join('\n') };
  },
});
