// Purchase read tools — open purchase orders and overdue ones (suppliers late on
// delivery). Read-only; grounded in purchase_orders.

const CLOSED = `('CLOSED','COMPLETED','CANCELLED','RECEIVED','FULLY RECEIVED')`;
const { nextDocNumber } = require('../../lib/sequences');

module.exports = function registerPurchaseTools(registry, { pool }) {
  // Reuse the real PO service so an approved PO is created exactly as a human's is.
  const poService = require('../../services/purchase-orders.service')(
    require('../../repositories/purchase-orders.repository')(pool), { nextDocNumber });
  // Open POs: not yet closed/received. Summary by supplier + an overdue count.
  registry.register({
    name: 'get_open_purchase_orders',
    description: 'Open purchase orders (not yet received/closed): count, value, by supplier, with an overdue count. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT COALESCE(supplier_name,'(unknown)') AS supplier,
                COUNT(*) AS pos,
                COALESCE(SUM(total_amount),0) AS amount,
                COUNT(*) FILTER (WHERE expected_date IS NOT NULL AND expected_date < CURRENT_DATE) AS overdue
           FROM purchase_orders
          WHERE COALESCE(UPPER(status),'') NOT IN ${CLOSED}
          GROUP BY supplier_name
          ORDER BY amount DESC`)).rows;
      const total_pos = rows.reduce((s, r) => s + Number(r.pos), 0);
      const total_amount = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
      const overdue = rows.reduce((s, r) => s + Number(r.overdue), 0);
      return {
        total_pos, total_amount_rs: total_amount, overdue_pos: overdue,
        by_supplier: rows.map(r => ({ supplier: r.supplier, pos: Number(r.pos), amount_rs: Math.round(Number(r.amount) * 100) / 100, overdue: Number(r.overdue) })),
        note: total_pos === 0 ? 'No open purchase orders.' : undefined,
      };
    },
  });

  // Overdue POs — past their expected delivery date and still open.
  registry.register({
    name: 'get_overdue_purchase_orders',
    description: 'Purchase orders past their expected delivery date and still open (suppliers running late), with days overdue. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT po_number, COALESCE(supplier_name,'(unknown)') AS supplier,
                expected_date, total_amount,
                (CURRENT_DATE - expected_date) AS days_overdue
           FROM purchase_orders
          WHERE COALESCE(UPPER(status),'') NOT IN ${CLOSED}
            AND expected_date IS NOT NULL AND expected_date < CURRENT_DATE
          ORDER BY expected_date ASC LIMIT 50`)).rows;
      return {
        count: rows.length,
        overdue: rows.map(r => ({
          po: r.po_number, supplier: r.supplier,
          amount_rs: Number(r.total_amount || 0), days_overdue: Number(r.days_overdue),
        })),
        note: rows.length === 0 ? 'No purchase order is overdue.' : undefined,
      };
    },
  });

  // ── WRITE tool — draft a purchase order, behind the approvals queue ──────────
  // Proposes only; a SUPERVISOR approval creates the PO via the same service a
  // human uses (its own numbering, one line item).
  registry.register({
    name: 'create_purchase_order',
    description: 'Draft a purchase order for a supplier. Proposes for approval; a SUPERVISOR must approve before it is created. Args: {supplier_name, item_name, quantity, rate?}',
    safe: false,
    minRole: 'OPERATOR',
    approveRole: 'SUPERVISOR',
    propose: async ({ supplier_name, item_name, quantity, rate } = {}) => {
      const sup = String(supplier_name || '').trim();
      const item = String(item_name || '').trim();
      const qty = Number(quantity);
      if (!sup) return { error: 'supplier_name is required' };
      if (!item) return { error: 'item_name is required' };
      if (!(qty > 0)) return { error: 'quantity must be greater than zero' };
      const rt = Number(rate) || 0;
      const amount = Math.round(qty * rt * 100) / 100;
      return {
        summary: `Create PO to ${sup}: ${qty} × ${item}${rt ? ` @ ₹${rt}` : ''}${amount ? ` = ₹${amount}` : ''}`,
        payload: { supplier_name: sup, items: [{ item_name: item, quantity: qty, rate: rt, amount }] },
      };
    },
    execute: async (payload) => {
      const out = await poService.create(payload);
      if (out.badRequest) return { error: out.badRequest };
      return { ok: true, po_id: out.row?.po_id, po_number: out.row?.po_number };
    },
  });
};
