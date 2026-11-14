// Resolving order and invoice lines to kilograms.
//
// Orders are taken in whatever unit the customer buys in — metres for a garment
// house, pieces for a job worker, kilograms for most. Everything downstream is
// in kilograms: stock, allocation, dispatch, costing. Until now the two were
// bridged by someone doing the sum in their head, which is precisely where a
// wrong number enters and is not noticed until the delivery is weighed.
//
// Three rules, in order of importance:
//
//   1. NEVER guess. uom.convert() already refuses when it has no defensible
//      basis, and that refusal is passed straight through rather than being
//      softened into a plausible-looking number.
//   2. A line that cannot be converted does NOT block the order. Refusing to
//      take an order because a fabric has no GSM recorded would push the order
//      back into a WhatsApp thread, which is worse than an order with one
//      unresolved line. It is stored with a null weight and reported.
//   3. Record the basis. "84.2 kg" is worth little on its own; "84.2 kg,
//      derived from GSM and width" can be checked and argued with.

module.exports = (pool) => {
  const uom = require('./uom')(pool);

  const norm = (u) => String(u || 'KG').trim().toUpperCase();

  // Resolve one line. Always returns an object — never throws — because a
  // conversion problem is information about the line, not a failure of the
  // request that contains it.
  async function resolveLine(line) {
    const unit = norm(line.uom);
    const qty = Number(line.quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
      return { quantity_kg: null, uom_basis: null, warning: null };
    }
    if (unit === 'KG') {
      return { quantity_kg: Math.round(qty * 1000) / 1000, uom_basis: 'NATIVE', warning: null };
    }

    const out = await uom.convert({
      item_id: line.item_id || null, from_uom: unit, to_uom: 'KG', quantity: qty,
    });

    if (out.ok) {
      return { quantity_kg: out.quantity, uom_basis: out.basis, warning: null };
    }
    return {
      quantity_kg: null,
      uom_basis: null,
      // Named so the operator knows which line, and told what would fix it.
      warning: `${line.item_name || 'A line'} is in ${unit} and could not be converted to kg: ${out.error}`,
    };
  }

  // Resolve a whole document. Returns the lines in the same order, plus the
  // warnings collected — the caller surfaces them rather than this deciding
  // whether they matter.
  async function resolveAll(lines) {
    const resolved = [];
    const warnings = [];
    for (const l of Array.isArray(lines) ? lines : []) {
      const r = await resolveLine(l);
      resolved.push(r);
      if (r.warning) warnings.push(r.warning);
    }
    return {
      lines: resolved,
      warnings,
      // Useful for planning: the total weight of what COULD be resolved, with
      // the count of what could not, so a partial total is never mistaken for
      // a complete one.
      total_kg: Math.round(resolved.reduce((s, r) => s + (r.quantity_kg || 0), 0) * 1000) / 1000,
      unresolved: resolved.filter(r => r.quantity_kg === null).length,
    };
  }

  return { resolveLine, resolveAll };
};
