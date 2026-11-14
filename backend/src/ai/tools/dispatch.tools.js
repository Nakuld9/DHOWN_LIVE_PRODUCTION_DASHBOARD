// Dispatch read tools — sales orders still to ship, orders past their delivery
// date, and what has shipped recently. Read-only; grounded in sales_orders and
// dispatch_challans.

const SO_CLOSED = `('DISPATCHED','COMPLETED','CLOSED','CANCELLED','DELIVERED','FULLY DISPATCHED')`;

module.exports = function registerDispatchTools(registry, { pool }) {
  // Open sales orders — not fully dispatched. Summary by customer + overdue count.
  registry.register({
    name: 'get_open_sales_orders',
    description: 'Sales orders still to ship (not fully dispatched): count, value, by customer, with an overdue-for-delivery count. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT COALESCE(customer_name,'(unknown)') AS customer,
                COUNT(*) AS orders,
                COALESCE(SUM(total_amount),0) AS amount,
                COUNT(*) FILTER (WHERE delivery_date IS NOT NULL AND delivery_date < CURRENT_DATE) AS overdue
           FROM sales_orders
          WHERE COALESCE(UPPER(status),'') NOT IN ${SO_CLOSED}
          GROUP BY customer_name
          ORDER BY amount DESC`)).rows;
      const total_orders = rows.reduce((s, r) => s + Number(r.orders), 0);
      const total_amount = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
      const overdue = rows.reduce((s, r) => s + Number(r.overdue), 0);
      return {
        total_orders, total_amount_rs: total_amount, overdue_orders: overdue,
        by_customer: rows.map(r => ({ customer: r.customer, orders: Number(r.orders), amount_rs: Math.round(Number(r.amount) * 100) / 100, overdue: Number(r.overdue) })),
        note: total_orders === 0 ? 'No open sales orders.' : undefined,
      };
    },
  });

  // Orders past their delivery date and still open — late to ship.
  registry.register({
    name: 'get_overdue_deliveries',
    description: 'Sales orders past their delivery date and still open (late to ship), with days overdue. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT so_number, COALESCE(customer_name,'(unknown)') AS customer,
                delivery_date, total_amount,
                (CURRENT_DATE - delivery_date) AS days_overdue
           FROM sales_orders
          WHERE COALESCE(UPPER(status),'') NOT IN ${SO_CLOSED}
            AND delivery_date IS NOT NULL AND delivery_date < CURRENT_DATE
          ORDER BY delivery_date ASC LIMIT 50`)).rows;
      return {
        count: rows.length,
        overdue: rows.map(r => ({
          order: r.so_number, customer: r.customer,
          amount_rs: Number(r.total_amount || 0), days_overdue: Number(r.days_overdue),
        })),
        note: rows.length === 0 ? 'No delivery is overdue.' : undefined,
      };
    },
  });

  // What has shipped recently (default 7 days).
  registry.register({
    name: 'get_recent_dispatches',
    description: 'Dispatches in the last N days — count and total weight shipped. Args: {days?: number (default 7)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = Number(days) > 0 ? Number(days) : 7;
      const row = (await pool.query(
        `SELECT COUNT(*) AS dispatches, COALESCE(SUM(total_weight_kg),0) AS kg
           FROM dispatch_challans
          WHERE dispatch_date >= (CURRENT_DATE - $1::int)
            AND COALESCE(UPPER(status),'') <> 'CANCELLED'`, [d])).rows[0];
      return {
        period_days: d,
        dispatches: Number(row.dispatches),
        kg: Math.round(Number(row.kg) * 100) / 100,
        note: Number(row.dispatches) === 0 ? 'No dispatches in this period.' : undefined,
      };
    },
  });
};
