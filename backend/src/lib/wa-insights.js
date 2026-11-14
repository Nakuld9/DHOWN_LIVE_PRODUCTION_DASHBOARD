// Sales intelligence (§17), lead scoring (§18), opportunity engine (§20) and
// conversation search (§16). Every figure is aggregated from MES/CRM tables.

const { scoreLead, reorderDue } = require('./wa-score');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {

  // ── §17 dashboard ────────────────────────────────────────────────────
  async function dashboard() {
    const [today, leads, quotes, orders, followups, unanswered, response, topCust, topFabric, topShade, lost, repeat] = await Promise.all([
      pool.query(`SELECT COUNT(*) n FROM wa_messages WHERE direction='IN' AND created_at::date = CURRENT_DATE`),
      pool.query(`SELECT COUNT(*) n, COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) today FROM crm_leads`),
      pool.query(`SELECT COUNT(*) n,
                         COUNT(*) FILTER (WHERE status IN ('SENT','CONVERTED')) sent,
                         COUNT(*) FILTER (WHERE status='CONVERTED')             converted,
                         COALESCE(SUM(grand_total) FILTER (WHERE status='CONVERTED'),0) won_value
                    FROM wa_quotes`),
      pool.query(`SELECT COUNT(*) n, COALESCE(SUM(grand_total),0) v FROM wa_draft_orders WHERE status='CONFIRMED'`),
      pool.query(`SELECT COUNT(*) n FROM crm_followups WHERE status='PENDING'`),
      // A chat is unanswered when its most recent message came from the customer.
      pool.query(`SELECT COUNT(*) n FROM wa_conversations c
                   WHERE EXISTS (SELECT 1 FROM wa_messages m WHERE m.conversation_id=c.conversation_id)
                     AND (SELECT direction FROM wa_messages m WHERE m.conversation_id=c.conversation_id
                           ORDER BY created_at DESC LIMIT 1) = 'IN'`),
      pool.query(`SELECT ROUND(AVG(first_response_secs)/60.0,1) mins FROM wa_conversations WHERE first_response_secs IS NOT NULL`),
      pool.query(`SELECT p.company_name, COUNT(*) msgs
                    FROM wa_conversations c JOIN partners p ON p.partner_id=c.partner_id
                    JOIN wa_messages m ON m.conversation_id=c.conversation_id
                   GROUP BY p.company_name ORDER BY msgs DESC LIMIT 5`),
      pool.query(`SELECT product, COUNT(*) n FROM wa_quotes WHERE product IS NOT NULL
                   GROUP BY product ORDER BY n DESC LIMIT 5`),
      pool.query(`SELECT shade, COUNT(*) n FROM wa_quotes WHERE shade IS NOT NULL
                   GROUP BY shade ORDER BY n DESC LIMIT 5`),
      pool.query(`SELECT COUNT(*) n FROM wa_quotes WHERE status IN ('REJECTED')
                    OR (status='SENT' AND created_at < NOW() - INTERVAL '30 days')`),
      pool.query(`SELECT COUNT(*) n FROM sales_opportunities WHERE kind='REORDER_DUE' AND status='OPEN'`),
    ]);

    const q = quotes.rows[0];
    const sent = Number(q.sent) || 0;
    return {
      enquiries_today: Number(today.rows[0].n),
      leads_total: Number(leads.rows[0].n),
      leads_today: Number(leads.rows[0].today),
      quotes_total: Number(q.n),
      quotes_sent: sent,
      orders_converted: Number(q.converted),
      conversion_pct: sent > 0 ? round2((Number(q.converted) / sent) * 100) : 0,
      whatsapp_sales_value: round2(q.won_value),
      confirmed_orders: Number(orders.rows[0].n),
      confirmed_value: round2(orders.rows[0].v),
      pending_followups: Number(followups.rows[0].n),
      unanswered_chats: Number(unanswered.rows[0].n),
      avg_response_mins: response.rows[0].mins ? Number(response.rows[0].mins) : null,
      top_customers: topCust.rows,
      top_products: topFabric.rows,
      top_shades: topShade.rows,
      lost_enquiries: Number(lost.rows[0].n),
      potential_repeat_orders: Number(repeat.rows[0].n),
    };
  }

  // ── §18 scoring ──────────────────────────────────────────────────────
  // Recomputes every conversation's score from live data and stores it on the lead.
  async function rescoreAll() {
    const convs = (await pool.query(`SELECT conversation_id, partner_id, lead_id FROM wa_conversations`)).rows;
    const out = [];
    for (const c of convs) {
      const s = await scoreConversation(c);
      // Store on the conversation so known customers (which have no lead row)
      // are scored too, and mirror onto the lead when there is one.
      await pool.query(`UPDATE wa_conversations SET score=$1, score_points=$2 WHERE conversation_id=$3`,
        [s.score, s.points, c.conversation_id]);
      if (c.lead_id) {
        await pool.query(`UPDATE crm_leads SET score=$1, score_points=$2 WHERE lead_id=$3`,
          [s.score, s.points, c.lead_id]);
      }
      out.push({ conversation_id: c.conversation_id, ...s });
    }
    return out;
  }

  async function scoreConversation(c) {
    const msgs = await pool.query(
      `SELECT COUNT(*) n FROM wa_messages WHERE conversation_id=$1 AND direction='IN'`, [c.conversation_id]);

    // Largest quantity discussed on this chat. Quotes are the firm signal; when
    // none has been raised yet we fall back to the biggest "N kg" the customer
    // actually typed, so a live 1000 kg enquiry still scores as demand (§18).
    const qty = await pool.query(
      `SELECT COALESCE(MAX(quantity_kg),0) q, COUNT(*) c FROM wa_quotes WHERE conversation_id=$1`, [c.conversation_id]);
    let requestedQty = Number(qty.rows[0].q);
    if (!requestedQty) {
      const said = await pool.query(
        `SELECT body FROM wa_messages
          WHERE conversation_id=$1 AND direction='IN' AND body ~* '[0-9][0-9,.]*\\s*kg'
          ORDER BY created_at DESC LIMIT 20`, [c.conversation_id]);
      for (const row of said.rows) {
        for (const m of String(row.body).matchAll(/(\d[\d,\.]*)\s*kg/gi)) {
          const n = Number(String(m[1]).replace(/,/g, ''));
          if (Number.isFinite(n)) requestedQty = Math.max(requestedQty, n);
        }
      }
    }

    let hist = { orders: 0, value: 0, days: null, overdue: 0 };
    if (c.partner_id) {
      const h = await pool.query(
        `SELECT COUNT(*) orders,
                COALESCE(SUM(total_amount),0) value,
                MAX(order_date) last_order
           FROM sales_orders WHERE partner_id=$1`, [c.partner_id]);
      const o = await pool.query(
        `SELECT COALESCE(overdue,0) due FROM v_partner_outstanding WHERE partner_id=$1`, [c.partner_id]);
      hist = {
        orders: Number(h.rows[0].orders),
        value: Number(h.rows[0].value),
        days: h.rows[0].last_order
          ? Math.round((Date.now() - new Date(h.rows[0].last_order).getTime()) / 86400000) : null,
        overdue: Number(o.rows[0].due),
      };
    }

    return scoreLead({
      requestedQty,
      ordersCount: hist.orders,
      totalValue: hist.value,
      daysSinceLastOrder: hist.days,
      messagesIn: Number(msgs.rows[0].n),
      quotesCount: Number(qty.rows[0].c),
      overdueAmount: hist.overdue,
    });
  }

  // ── §20 opportunity engine ───────────────────────────────────────────
  // Internal suggestions only — nothing is messaged to a customer automatically.
  async function scanOpportunities() {
    const created = [];

    // Reorder due, judged against each customer's own ordering rhythm.
    const cust = (await pool.query(
      `SELECT p.partner_id, p.company_name,
              COUNT(so.so_id) orders,
              MAX(so.order_date) last_order,
              (MAX(so.order_date) - MIN(so.order_date))::int span
         FROM partners p JOIN sales_orders so ON so.partner_id = p.partner_id
        GROUP BY p.partner_id, p.company_name
       HAVING COUNT(so.so_id) >= 2`)).rows;

    for (const c of cust) {
      const since = Math.round((Date.now() - new Date(c.last_order).getTime()) / 86400000);
      const avgGap = Number(c.span) / Math.max(1, Number(c.orders) - 1);
      const r = reorderDue({ avgGapDays: avgGap, daysSinceLastOrder: since, ordersCount: Number(c.orders) });
      if (!r.due) continue;

      const dup = await pool.query(
        `SELECT 1 FROM sales_opportunities
          WHERE partner_id=$1 AND kind='REORDER_DUE' AND status='OPEN' LIMIT 1`, [c.partner_id]);
      if (dup.rows.length) continue;

      const conv = await pool.query(
        `SELECT conversation_id FROM wa_conversations WHERE partner_id=$1 LIMIT 1`, [c.partner_id]);
      const ins = await pool.query(
        `INSERT INTO sales_opportunities (partner_id, conversation_id, kind, title, detail)
         VALUES ($1,$2,'REORDER_DUE',$3,$4) RETURNING *`,
        [c.partner_id, conv.rows[0]?.conversation_id || null,
         `Reorder opportunity: ${c.company_name}`, r.reason]);
      created.push(ins.rows[0]);
    }

    // Quotes sent with no customer reply since.
    const stale = (await pool.query(
      `SELECT q.quote_id, q.quote_no, q.conversation_id, q.partner_id, q.grand_total, q.created_at
         FROM wa_quotes q
        WHERE q.status='SENT' AND q.created_at < NOW() - INTERVAL '3 days'
          AND NOT EXISTS (
            SELECT 1 FROM wa_messages m
             WHERE m.conversation_id = q.conversation_id AND m.direction='IN'
               AND m.created_at > q.created_at)`)).rows;

    for (const s of stale) {
      const dup = await pool.query(
        `SELECT 1 FROM sales_opportunities
          WHERE kind='QUOTE_NO_RESPONSE' AND status='OPEN' AND detail LIKE $1 LIMIT 1`, [`%${s.quote_no}%`]);
      if (dup.rows.length) continue;
      const ins = await pool.query(
        `INSERT INTO sales_opportunities (partner_id, conversation_id, kind, title, detail, value_hint)
         VALUES ($1,$2,'QUOTE_NO_RESPONSE',$3,$4,$5) RETURNING *`,
        [s.partner_id, s.conversation_id, `Follow up quote ${s.quote_no}`,
         `Quote ${s.quote_no} was sent and the customer has not replied since.`, s.grand_total]);
      created.push(ins.rows[0]);
    }

    return created;
  }

  // ── §15 AI copilot summary ───────────────────────────────────────────
  // Built from MES facts, not model prose, so every line is verifiable. The
  // suggested actions are derived from what the conversation actually shows.
  async function copilot(conversationId) {
    const c = (await pool.query(
      `SELECT * FROM wa_conversations WHERE conversation_id=$1`, [conversationId])).rows[0];
    if (!c) return null;

    const [msgs, quotes, drafts] = await Promise.all([
      pool.query(`SELECT body, ai_description, direction, created_at FROM wa_messages
                   WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 12`, [conversationId]),
      pool.query(`SELECT quote_no, status, quantity_kg, rate, grand_total, product, shade
                    FROM wa_quotes WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 3`, [conversationId]),
      pool.query(`SELECT draft_id, status, product, quantity_kg FROM wa_draft_orders
                   WHERE conversation_id=$1 AND status='PENDING'`, [conversationId]),
    ]);

    const inbound = msgs.rows.filter(m => m.direction === 'IN');
    const lastIn = inbound[0]?.body || inbound[0]?.ai_description || null;

    // What are they asking for? Largest quantity + product words they used.
    let askedQty = null;
    for (const m of inbound) {
      for (const g of String(m.body || '').matchAll(/(\d[\d,\.]*)\s*kg/gi)) {
        const n = Number(String(g[1]).replace(/,/g, ''));
        if (Number.isFinite(n)) askedQty = Math.max(askedQty || 0, n);
      }
    }

    const facts = [];
    let stock = null, lastPrice = null, finance = null;

    if (c.partner_id) {
      const [p, fin, lp] = await Promise.all([
        pool.query(`SELECT company_name, credit_limit FROM partners WHERE partner_id=$1`, [c.partner_id]),
        pool.query(`SELECT COALESCE(outstanding,0) outstanding, COALESCE(open_invoices,0) unpaid
                      FROM v_partner_outstanding WHERE partner_id=$1`, [c.partner_id]),
        pool.query(`SELECT item_desc, ABS(unit_cost) rate, txn_date FROM stock_ledger
                     WHERE partner_id=$1 AND movement_type='OUT' AND unit_cost IS NOT NULL
                     ORDER BY txn_date DESC LIMIT 1`, [c.partner_id]),
      ]);
      finance = { ...fin.rows[0], company: p.rows[0]?.company_name, credit_limit: p.rows[0]?.credit_limit };
      lastPrice = lp.rows[0] || null;
      facts.push(`Customer: ${p.rows[0]?.company_name || c.display_name || c.phone}`);
      if (lastPrice) facts.push(`Last billed rate: Rs.${round2(lastPrice.rate)}/kg (${lastPrice.item_desc})`);
      if (Number(fin.rows[0].outstanding) > 0) {
        facts.push(`Outstanding: Rs.${round2(fin.rows[0].outstanding)} across ${fin.rows[0].unpaid} invoice(s)`);
      }
    } else {
      facts.push(`New lead — not yet a registered customer (${c.phone})`);
    }

    if (askedQty) facts.push(`Asking for about ${askedQty} kg`);

    // Live stock for whatever product words appear in the recent messages.
    const words = inbound.map(m => m.body || '').join(' ');
    if (words.trim()) {
      const s = await pool.query(
        `SELECT fabric_type, color_name,
                COALESCE(SUM(weight_kg) FILTER (WHERE status IN ('AVAILABLE','IN_STOCK')),0) available
           FROM finished_goods
          WHERE $1 ILIKE '%'||fabric_type||'%' OR $1 ILIKE '%'||color_name||'%'
          GROUP BY fabric_type, color_name
          HAVING COALESCE(SUM(weight_kg) FILTER (WHERE status IN ('AVAILABLE','IN_STOCK')),0) > 0
          ORDER BY available DESC LIMIT 3`, [words]);
      stock = s.rows;
      for (const r of stock) facts.push(`Stock: ${r.fabric_type} ${r.color_name} — ${round2(r.available)} kg available`);
    }

    if (quotes.rows.length) {
      const q = quotes.rows[0];
      facts.push(`Latest quote ${q.quote_no}: ${q.status.replace(/_/g, ' ')}${q.rate ? ` @ Rs.${Number(q.rate)}/kg` : ' (rate pending)'}`);
    }
    if (drafts.rows.length) facts.push(`${drafts.rows.length} draft order(s) awaiting confirmation`);

    // Recommended actions (§15) — only ones that make sense right now.
    const actions = [];
    actions.push({ key: 'CHECK_STOCK', label: 'CHECK STOCK' });
    if (c.partner_id) actions.push({ key: 'CHECK_OUTSTANDING', label: 'CHECK OUTSTANDING' });
    if (askedQty && !quotes.rows.some(q => ['APPROVED', 'SENT'].includes(q.status))) {
      actions.push({ key: 'PREPARE_QUOTE', label: 'PREPARE QUOTE' });
    }
    if (quotes.rows.some(q => q.status === 'APPROVED')) {
      actions.push({ key: 'CREATE_DRAFT_ORDER', label: 'CREATE DRAFT ORDER' });
    }
    actions.push({ key: 'SEND_SHADE_CARD', label: 'SEND SHADE CARD' });
    if (c.partner_id) actions.push({ key: 'CHECK_PRODUCTION', label: 'CHECK PRODUCTION' });
    actions.push({ key: 'CREATE_FOLLOWUP', label: 'CREATE FOLLOW-UP' });

    const out = {
      summary: facts,
      last_customer_message: lastIn,
      asked_qty_kg: askedQty,
      stock, finance, last_price: lastPrice,
      quotes: quotes.rows, pending_drafts: drafts.rows,
      actions,
    };

    // Persist a snapshot (§23) so the thread has a written history of what it was
    // about at each point. Best-effort: a failure here must never break the panel.
    try {
      await pool.query(
        `INSERT INTO conversation_summaries (conversation_id, summary, facts, message_count, generated_by)
         VALUES ($1,$2,$3,$4,'SYSTEM')`,
        [conversationId, facts.join('\n'),
         JSON.stringify({ asked_qty_kg: askedQty, stock, last_price: lastPrice }),
         msgs.rows.length]);
    } catch (e) { console.error('[wa summary]', e.message); }

    return out;
  }

  // Summary history for a conversation.
  async function summaries(conversationId, limit = 10) {
    const r = await pool.query(
      `SELECT * FROM conversation_summaries WHERE conversation_id=$1
        ORDER BY created_at DESC LIMIT $2`, [conversationId, limit]);
    return r.rows;
  }

  // ── §16 conversation search ──────────────────────────────────────────
  // Keyword/token search over message bodies with optional filters. Kept
  // deterministic (SQL) rather than embedding-based so results are explainable.
  async function search({ q, days, minQty } = {}) {
    const tokens = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const params = [];
    let where = `WHERE 1=1`;

    if (tokens.length) {
      const conds = tokens.map((t) => { params.push(`%${t}%`); return `m.body ILIKE $${params.length}`; });
      where += ` AND (${conds.join(' OR ')})`;
    }
    if (days) { params.push(Number(days)); where += ` AND m.created_at > NOW() - ($${params.length} || ' days')::interval`; }

    const r = await pool.query(
      `SELECT m.message_id, m.conversation_id, m.body, m.created_at, m.direction,
              c.phone, c.display_name, p.company_name
         FROM wa_messages m
         JOIN wa_conversations c ON c.conversation_id = m.conversation_id
         LEFT JOIN partners p ON p.partner_id = c.partner_id
         ${where}
        ORDER BY m.created_at DESC LIMIT 100`, params);

    let rows = r.rows;
    if (minQty) {
      // "enquiries above 500 kg" — pull the number out of the message text.
      const min = Number(minQty);
      rows = rows.filter(x => {
        const m = String(x.body || '').match(/(\d[\d,\.]*)\s*kg/i);
        return m && Number(m[1].replace(/,/g, '')) >= min;
      });
    }
    return { count: rows.length, results: rows };
  }

  // Customers with no order in N days (for "who hasn't reordered in 60 days").
  async function dormant(days = 60) {
    const r = await pool.query(
      `SELECT p.partner_id, p.company_name, MAX(so.order_date) last_order,
              (CURRENT_DATE - MAX(so.order_date))::int days_since
         FROM partners p JOIN sales_orders so ON so.partner_id=p.partner_id
        GROUP BY p.partner_id, p.company_name
       HAVING (CURRENT_DATE - MAX(so.order_date))::int >= $1
        ORDER BY days_since DESC LIMIT 50`, [Number(days) || 60]);
    return r.rows;
  }

  return { dashboard, rescoreAll, scoreConversation, scanOpportunities, search, dormant, copilot, summaries };
};
