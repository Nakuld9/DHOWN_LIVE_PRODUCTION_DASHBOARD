// Import CIF costing + landed-cost computation.
//
// THE CIF RULE (DHOWN default): the supplier CIF price already includes ocean
// freight + marine insurance. So landed cost = CIF value + import-side (post-CIF)
// expenses. Ocean freight / marine insurance are added back ONLY when the user
// explicitly classifies them ADDITIONAL (a charge outside the CIF contract) — and
// even then the API refuses to add them silently: it returns needs_confirmation
// until the caller confirms. INCLUDED_IN_CIF / NOT_APPLICABLE amounts are never
// added (they are already in CIF or don't exist).
//
// Recoverable IGST is input-tax credit, NOT an inventory cost, so it is excluded
// from landed cost unless flagged non-recoverable. Actual accounting treatment
// remains BUSY's; this exposes clean figures.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

// Pure landed-cost calculation from a cost row. Returns the total + a labelled
// breakdown so the UI can show exactly what was and was not counted.
function computeLanded(cost) {
  const cifInr = num(cost.cif_value_in_inr) || r2(num(cost.cif_value) * num(cost.exchange_rate));
  // Freight/insurance ONLY when ADDITIONAL (outside CIF). This is the double-count guard.
  const addFreight = cost.ocean_freight_treatment === 'ADDITIONAL' ? num(cost.ocean_freight_amount) : 0;
  const addInsurance = cost.marine_insurance_treatment === 'ADDITIONAL' ? num(cost.marine_insurance_amount) : 0;
  // ── GST (ITC) buckets ───────────────────────────────────────────────────────
  // IGST = BoE / inter-state (cost.igst). CGST+SGST = local services (cost.cgst/sgst),
  // PLUS the CHA clearing GST auto-computed at 18% split 9/9 on cha_charges (which are
  // stored ex-GST). Default treatment: recoverable ITC → excluded from landed cost;
  // the recoverable toggle (cost.igst_recoverable) flips ALL GST into cost when off.
  const GST_RATE = 0.18;
  const chaCgst = r2(num(cost.cha_charges) * (GST_RATE / 2));
  const chaSgst = r2(num(cost.cha_charges) * (GST_RATE / 2));
  const igst = r2(num(cost.igst));
  const cgst = r2(num(cost.cgst) + chaCgst);
  const sgst = r2(num(cost.sgst) + chaSgst);
  const gstTotal = r2(igst + cgst + sgst);
  const gstRecoverable = cost.igst_recoverable !== false;   // default true (ITC)
  const gstInCost = gstRecoverable ? 0 : gstTotal;          // folds into cost when not recoverable
  // Remittance/forex charges taken from the actual TT payments (SWIFT, foreign
  // advance-import, FX-conversion, other bank), apportioned to this import. Real cost
  // of remitting for this shipment → part of landed cost.
  const forexCharges = num(cost.payment_forex_charges);
  const importSide =
    num(cost.customs_duty) + num(cost.other_customs_levies) + gstInCost + num(cost.other_taxes) +
    num(cost.port_charges) + num(cost.terminal_charges) + num(cost.cfs_charges) + num(cost.cha_charges) +
    num(cost.documentation_charges) + num(cost.bank_charges) + num(cost.local_transport) + num(cost.other_import_expenses) +
    forexCharges;
  const total = r2(cifInr + addFreight + addInsurance + importSide);
  return {
    cif_value_in_inr: r2(cifInr),
    freight_added: r2(addFreight), insurance_added: r2(addInsurance),
    import_side_expenses: r2(importSide),
    remittance_forex_charges: r2(forexCharges),
    gst: { igst, cgst, sgst, cha_cgst: chaCgst, cha_sgst: chaSgst, total: gstTotal, recoverable: gstRecoverable, in_cost: gstInCost },
    gst_excluded_as_itc: gstRecoverable ? gstTotal : 0,
    igst_excluded_as_itc: cost.igst_recoverable === false ? 0 : r2(num(cost.igst)),
    total_landed_cost: total,
  };
}

module.exports = (pool) => {
  const audit = async (username, action, oldVal, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, old_value, new_value) VALUES ($1,$2,'IMPORTS',$3,$4)`,
      [username || null, action, oldVal ? JSON.stringify(oldVal).slice(0, 4000) : null, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  async function getCosting(importId) {
    const imp = (await pool.query(`SELECT import_id, import_no, incoterm, quantity FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    const cost = (await pool.query(`SELECT * FROM import_costs WHERE import_id=$1`, [importId])).rows[0];
    if (!cost) return { import: imp, cost: null };
    // Actual payments (TTs at their own rates) are authoritative for CIF-in-INR when
    // present — the real blended rate paid, not a single assumed exchange rate.
    const pay = await require('./import-payments')(pool).summary(importId);
    // Actual TT charges (SWIFT/remittance, advance-import, FX-conversion, other bank)
    // are authoritative and flow into landed cost; if no TTs yet, fall back to the
    // cost sheet's manual bank_charges only (avoid double counting when TTs exist).
    const hasPayments = pay.tranches > 0 && pay.total_inr > 0;
    // CIF-in-INR values the WHOLE invoice: the portion already paid at its real TT
    // (blended) rate, the still-outstanding foreign currency at an assumed rate (the
    // cost sheet's rate, else the blended rate). A partial advance therefore never
    // understates the goods value; once fully paid it equals the total actually paid.
    const assumedRate = num(cost.exchange_rate) || pay.blended_rate || 0;
    const cifInrWithPayments = r2(pay.total_inr + num(pay.outstanding_fc) * assumedRate);
    const costForCalc = {
      ...cost,
      ...(hasPayments ? { cif_value_in_inr: cifInrWithPayments, bank_charges: 0 } : {}),
      payment_forex_charges: pay.charges ? pay.charges.total : 0,
    };
    const breakdown = computeLanded(costForCalc);
    breakdown.forex_charge_breakdown = pay.charges || null;
    breakdown.cif_in_inr_source = hasPayments
      ? (num(pay.outstanding_fc) > 0
          ? `paid ${pay.currency} ${pay.total_fc} at actual (blended ₹${pay.blended_rate}) + outstanding ${pay.currency} ${pay.outstanding_fc} at assumed ₹${r2(assumedRate)}`
          : `fully paid — actual (${pay.tranches} TT, blended ₹${pay.blended_rate}/${pay.currency})`)
      : 'assumed exchange rate';
    // Per-kg is on the ACTUAL received quantity once the GRN is complete (what really
    // landed in stock); until then it's on the ordered quantity as an estimate. A
    // partial GRN keeps using the ordered qty so per-kg is not overstated mid-receipt.
    const grnState = await require('./import-grn')(pool).status(importId, imp.quantity);
    const received = num(grnState.received);
    const useReceived = grnState.grn_status === 'COMPLETED' && received > 0;
    const qty = useReceived ? received : num(imp.quantity);
    const perKg = qty > 0 ? r4(breakdown.total_landed_cost / qty) : 0;
    // Estimated vs actual variance (available once both an estimate and the actual exist).
    const est = num(cost.estimated_landed_cost);
    const variance = (cost.is_actual && est > 0) ? {
      estimated: r2(est), actual: r2(breakdown.total_landed_cost),
      variance: r2(breakdown.total_landed_cost - est),
      variance_pct: est > 0 ? r2(((breakdown.total_landed_cost - est) / est) * 100) : 0,
    } : null;
    // Keep the cached columns in step with the live computation, so the costing form
    // and anything reading the stored snapshot never show a stale value. Best-effort,
    // and it also updates the returned cost object so the form shows it on first load.
    // Effective rate to display: the real blended TT rate once payments exist, else the
    // manually-entered assumed rate. Keeps the form's exchange-rate field meaningful.
    const effRate = hasPayments ? pay.blended_rate : num(cost.exchange_rate);
    if (r2(num(cost.cif_value_in_inr)) !== breakdown.cif_value_in_inr
        || r2(num(cost.total_landed_cost)) !== breakdown.total_landed_cost
        || r4(num(cost.landed_cost_per_kg)) !== perKg
        || r4(num(cost.exchange_rate)) !== r4(effRate)) {
      cost.cif_value_in_inr = breakdown.cif_value_in_inr;
      cost.total_landed_cost = breakdown.total_landed_cost;
      cost.landed_cost_per_kg = perKg;
      cost.exchange_rate = effRate;
      try {
        await pool.query(`UPDATE import_costs SET cif_value_in_inr=$2, total_landed_cost=$3, landed_cost_per_kg=$4, exchange_rate=$5, updated_at=NOW() WHERE import_id=$1`,
          [importId, breakdown.cif_value_in_inr, breakdown.total_landed_cost, perKg, effRate]);
      } catch { /* cache refresh is best-effort */ }
    }
    return {
      import: imp, cost, breakdown, variance, payments: pay,
      landed_cost_per_kg: perKg,
      grn_status: grnState.grn_status, received_qty: received,
      per_kg_basis: useReceived ? `actual received quantity (${received} ${imp.unit || 'KG'} from GRN)` : `ordered quantity (${num(imp.quantity)} ${imp.unit || 'KG'}) — finalises to received on GRN completion`,
      note: imp.incoterm === 'CIF'
        ? 'CIF: ocean freight + marine insurance are in the supplier price and are NOT added again unless classified ADDITIONAL.'
        : `Incoterm ${imp.incoterm}: verify which charges the supplier price includes.`,
    };
  }

  // GRN → costing finalisation. Called when an import's GRN is fully received: it
  // recomputes the landed cost on the ACTUAL received quantity, marks the costing
  // ACTUAL, and persists the finalised total + per-kg. Idempotent and best-effort —
  // never blocks the GRN link. Nothing posts to inventory (the stock ledger stays
  // authoritative); this only finalises the import's own cost sheet.
  async function finalizeOnGrn(importId, user) {
    const cur = (await pool.query(`SELECT import_id FROM import_costs WHERE import_id=$1`, [importId])).rows[0];
    if (!cur) return { ok: false, skipped: 'no_cost_row' };
    const cc = await getCosting(importId);
    if (!cc || !cc.breakdown) return { ok: false, skipped: 'no_costing' };
    await pool.query(
      `UPDATE import_costs SET is_actual=true, total_landed_cost=$2, landed_cost_per_kg=$3, updated_at=NOW() WHERE import_id=$1`,
      [importId, cc.breakdown.total_landed_cost, cc.landed_cost_per_kg]);
    await audit(user?.username, 'IMPORT_COSTING_FINALIZED', null,
      { import_id: importId, landed_cost: cc.breakdown.total_landed_cost, per_kg: cc.landed_cost_per_kg, basis: cc.per_kg_basis, grn_status: cc.grn_status });
    return { ok: true, total_landed_cost: cc.breakdown.total_landed_cost, landed_cost_per_kg: cc.landed_cost_per_kg, per_kg_basis: cc.per_kg_basis };
  }

  // Save costing. Refuses to silently add freight/insurance on a CIF shipment.
  async function saveCosting(importId, body, user) {
    const imp = (await pool.query(`SELECT import_id, import_no, incoterm, quantity FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    const b = body || {};
    const oft = b.ocean_freight_treatment || 'INCLUDED_IN_CIF';
    const mit = b.marine_insurance_treatment || 'INCLUDED_IN_CIF';

    // CIF double-count protection: adding freight/insurance ON TOP of a CIF price
    // must be explicitly confirmed.
    if (imp.incoterm === 'CIF' && !b.confirm_additional) {
      const flagged = [];
      if (oft === 'ADDITIONAL' && num(b.ocean_freight_amount) > 0) flagged.push('ocean freight');
      if (mit === 'ADDITIONAL' && num(b.marine_insurance_amount) > 0) flagged.push('marine insurance');
      if (flagged.length) {
        return {
          needs_confirmation: true,
          warning: `CIF shipment detected. ${flagged.join(' and ')} ${flagged.length > 1 ? 'are' : 'is'} normally included in the supplier CIF price. Confirm ${flagged.length > 1 ? 'these are' : 'this is'} an additional charge outside the CIF contract before it is added to landed cost.`,
          fields: flagged,
        };
      }
    }

    const cifValue = num(b.cif_value);
    const xr = num(b.exchange_rate);
    const cifInr = num(b.cif_value_in_inr) || r2(cifValue * xr);
    const row = {
      cif_value: cifValue, invoice_currency: b.invoice_currency || 'USD', exchange_rate: xr, cif_value_in_inr: cifInr,
      ocean_freight_treatment: oft, ocean_freight_amount: num(b.ocean_freight_amount),
      marine_insurance_treatment: mit, marine_insurance_amount: num(b.marine_insurance_amount),
      customs_assessable_value: num(b.customs_assessable_value), customs_duty: num(b.customs_duty),
      other_customs_levies: num(b.other_customs_levies), igst: num(b.igst),
      cgst: num(b.cgst), sgst: num(b.sgst),
      igst_recoverable: b.igst_recoverable !== false, other_taxes: num(b.other_taxes),
      port_charges: num(b.port_charges), terminal_charges: num(b.terminal_charges), cfs_charges: num(b.cfs_charges),
      cha_charges: num(b.cha_charges), documentation_charges: num(b.documentation_charges),
      bank_charges: num(b.bank_charges), local_transport: num(b.local_transport),
      other_import_expenses: num(b.other_import_expenses), is_actual: b.is_actual === true,
    };
    const breakdown = computeLanded(row);
    const qty = num(imp.quantity);
    const perKg = qty > 0 ? r4(breakdown.total_landed_cost / qty) : 0;

    // Snapshot the estimate the first time it is saved (and whenever a non-actual
    // save happens); an ACTUAL save leaves the estimate untouched, so variance is
    // estimate → actual.
    const estLanded = row.is_actual ? 0 : breakdown.total_landed_cost;
    await pool.query(
      `INSERT INTO import_costs (import_id, cif_value, invoice_currency, exchange_rate, cif_value_in_inr,
         ocean_freight_treatment, ocean_freight_amount, marine_insurance_treatment, marine_insurance_amount,
         customs_assessable_value, customs_duty, other_customs_levies, igst, igst_recoverable, other_taxes,
         port_charges, terminal_charges, cfs_charges, cha_charges, documentation_charges, bank_charges,
         local_transport, other_import_expenses, is_actual, total_landed_cost, landed_cost_per_kg, estimated_landed_cost, cgst, sgst, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW())
       ON CONFLICT (import_id) DO UPDATE SET
         cif_value=EXCLUDED.cif_value, invoice_currency=EXCLUDED.invoice_currency, exchange_rate=EXCLUDED.exchange_rate,
         cif_value_in_inr=EXCLUDED.cif_value_in_inr, ocean_freight_treatment=EXCLUDED.ocean_freight_treatment,
         ocean_freight_amount=EXCLUDED.ocean_freight_amount, marine_insurance_treatment=EXCLUDED.marine_insurance_treatment,
         marine_insurance_amount=EXCLUDED.marine_insurance_amount, customs_assessable_value=EXCLUDED.customs_assessable_value,
         customs_duty=EXCLUDED.customs_duty, other_customs_levies=EXCLUDED.other_customs_levies, igst=EXCLUDED.igst,
         igst_recoverable=EXCLUDED.igst_recoverable, other_taxes=EXCLUDED.other_taxes, port_charges=EXCLUDED.port_charges,
         terminal_charges=EXCLUDED.terminal_charges, cfs_charges=EXCLUDED.cfs_charges, cha_charges=EXCLUDED.cha_charges,
         documentation_charges=EXCLUDED.documentation_charges, bank_charges=EXCLUDED.bank_charges,
         local_transport=EXCLUDED.local_transport, other_import_expenses=EXCLUDED.other_import_expenses,
         is_actual=EXCLUDED.is_actual, total_landed_cost=EXCLUDED.total_landed_cost,
         landed_cost_per_kg=EXCLUDED.landed_cost_per_kg,
         estimated_landed_cost=CASE WHEN EXCLUDED.is_actual THEN import_costs.estimated_landed_cost ELSE EXCLUDED.estimated_landed_cost END,
         cgst=EXCLUDED.cgst, sgst=EXCLUDED.sgst,
         updated_at=NOW()`,
      [importId, row.cif_value, row.invoice_currency, row.exchange_rate, row.cif_value_in_inr,
       row.ocean_freight_treatment, row.ocean_freight_amount, row.marine_insurance_treatment, row.marine_insurance_amount,
       row.customs_assessable_value, row.customs_duty, row.other_customs_levies, row.igst, row.igst_recoverable, row.other_taxes,
       row.port_charges, row.terminal_charges, row.cfs_charges, row.cha_charges, row.documentation_charges, row.bank_charges,
       row.local_transport, row.other_import_expenses, row.is_actual, breakdown.total_landed_cost, perKg, estLanded, row.cgst, row.sgst]);
    await audit(user?.username, row.is_actual ? 'IMPORT_COST_ACTUAL' : 'IMPORT_COST_ESTIMATE', { import_no: imp.import_no }, { total_landed_cost: breakdown.total_landed_cost, per_kg: perKg });
    return { ok: true, breakdown, landed_cost_per_kg: perKg };
  }

  return { getCosting, saveCosting, finalizeOnGrn, computeLanded };
};
