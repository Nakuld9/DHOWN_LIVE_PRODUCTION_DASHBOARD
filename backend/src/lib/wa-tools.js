// WhatsApp AI CRM — the ONLY path between the LLM and MES data.
//
// Security model (see docs/WHATSAPP_CRM_DESIGN.md §24):
//  * The LLM never sees SQL and never picks a partner_id. Every customer-scoped
//    tool takes its partner_id from `ctx` (resolved from the WhatsApp phone
//    number), NOT from model output — so no prompt can reach another customer's
//    prices, orders, outstanding or invoices.
//  * Tools are whitelisted by name; unknown names are rejected.
//  * Read tools only in this phase; writes are limited to leads/follow-ups.
//  * Every value returned here comes from the MES DB. The model is instructed
//    never to invent stock, price, ETA or financials.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool, { quotes, production } = {}) => {
  // ── customer identity ────────────────────────────────────────────────
  async function get_customer(_args, ctx) {
    if (!ctx.partner_id) {
      return { known: false, phone: ctx.phone, note: 'Not a registered customer — treat as a new lead.' };
    }
    const r = await pool.query(
      `SELECT p.partner_id, p.partner_code, p.company_name, p.payment_terms,
              p.credit_limit, p.credit_days, p.rating,
              a.city, a.state
         FROM partners p
         LEFT JOIN partner_addresses a
                ON a.partner_id = p.partner_id AND a.is_default = true
        WHERE p.partner_id = $1`, [ctx.partner_id]);
    if (!r.rows.length) return { known: false, phone: ctx.phone };
    return { known: true, ...r.rows[0] };
  }

  // Buying history — powers "AI sales memory" (§6). Real orders only.
  async function get_customer_history(_args, ctx) {
    if (!ctx.partner_id) return { known: false, orders: [] };
    const [orders, top] = await Promise.all([
      pool.query(
        `SELECT so_number, order_date, status, total_amount
           FROM sales_orders WHERE partner_id = $1
          ORDER BY order_date DESC LIMIT 5`, [ctx.partner_id]),
      pool.query(
        `SELECT i.item_desc AS item, SUM(ABS(i.quantity)) AS total_qty, COUNT(*) AS times
           FROM stock_ledger i
          WHERE i.partner_id = $1 AND i.movement_type = 'OUT'
          GROUP BY i.item_desc ORDER BY total_qty DESC LIMIT 5`, [ctx.partner_id]),
    ]);
    return { known: true, recent_orders: orders.rows, frequently_bought: top.rows };
  }

  // ── inventory (§11) — physical / reserved / available, never invented ──
  async function get_available_stock({ query } = {}) {
    // The model sends a phrase ("fake cotton lycra black"), but product and shade
    // live in different columns — so match on TOKENS: every word must appear in
    // fabric_type, color_name or color_code. Noise words are dropped.
    const STOP = new Set(['ka', 'ki', 'ke', 'hai', 'kitna', 'stock', 'available', 'aur', 'and', 'the', 'kg']);
    const tokens = String(query || '')
      .toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));

    // Score by how many tokens a row matches (ANY match qualifies) so a question
    // like "black aur navy" returns BOTH shades rather than nothing.
    const hit = (i) =>
      `(CASE WHEN fabric_type ILIKE '%'||$${i + 1}||'%' OR color_name ILIKE '%'||$${i + 1}||'%' OR color_code ILIKE '%'||$${i + 1}||'%' THEN 1 ELSE 0 END)`;
    const score = tokens.length ? tokens.map((_, i) => hit(i)).join(' + ') : '0';

    const r = await pool.query(
      `SELECT fabric_type, color_name, color_code,
              SUM(weight_kg)                                              AS physical_kg,
              SUM(CASE WHEN status = 'RESERVED' THEN weight_kg ELSE 0 END) AS reserved_kg,
              SUM(CASE WHEN status IN ('AVAILABLE','IN_STOCK') THEN weight_kg ELSE 0 END) AS available_kg,
              COUNT(*) AS rolls,
              MAX(${score}) AS match_score
         FROM finished_goods
        GROUP BY fabric_type, color_name, color_code
        HAVING SUM(weight_kg) > 0 AND ($${tokens.length + 1}::int = 0 OR MAX(${score}) > 0)
        ORDER BY match_score DESC, available_kg DESC LIMIT 12`, [...tokens, tokens.length]);
    return {
      matches: r.rows.map(x => ({
        product: x.fabric_type, shade: x.color_name, shade_code: x.color_code,
        physical_kg: round2(x.physical_kg), reserved_kg: round2(x.reserved_kg),
        available_kg: round2(x.available_kg), rolls: Number(x.rolls),
      })),
      note: 'Figures are live MES finished-goods stock in kg.',
    };
  }

  // ── pricing (§7) — the customer's OWN last sale price only ────────────
  async function get_last_sale_price({ item } = {}, ctx) {
    if (!ctx.partner_id) return { known: false, note: 'No customer on record — price must be quoted by sales.' };

    // The model passes a descriptive phrase ("Fake Cotton Lycra 220 GSM Coffee"),
    // which will never substring-match a ledger line like "Fake Cotton Lycra
    // Coffee". Match on TOKENS and rank by how many hit, so the right historical
    // line still wins. Still scoped to this customer's own partner_id.
    const STOP = new Set(['gsm', 'kg', 'ka', 'ki', 'ke', 'rate', 'colour', 'color', 'shade', 'fabric']);
    const tokens = String(item || '').toLowerCase()
      .split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));

    const score = tokens.length
      ? tokens.map((_, i) => `(CASE WHEN item_desc ILIKE '%'||$${i + 2}||'%' THEN 1 ELSE 0 END)`).join(' + ')
      : '0';

    const r = await pool.query(
      `SELECT item_desc, ABS(unit_cost) AS rate, txn_date, ${score} AS match_score
         FROM stock_ledger
        WHERE partner_id = $1 AND movement_type = 'OUT' AND unit_cost IS NOT NULL
          AND (${tokens.length ? `(${score}) > 0` : 'TRUE'})
        ORDER BY match_score DESC, txn_date DESC LIMIT 3`, [ctx.partner_id, ...tokens]);
    return {
      known: r.rows.length > 0,
      last_prices: r.rows.map(x => ({ item: x.item_desc, rate_per_kg: round2(x.rate), date: x.txn_date })),
      note: 'Historical billed rate for THIS customer. New/changed prices need sales approval.',
    };
  }

  // The AUTHORISED rate for this customer, if a manager has set one (§8).
  // Falls back to reporting that no authorised price exists — it never guesses,
  // and it never reads another customer's price list.
  async function get_customer_price({ product, shade } = {}, ctx) {
    if (!ctx.partner_id) return { authorised: false, note: 'No customer on record — sales must quote.' };
    const toks = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const tokens = [...toks(product), ...toks(shade)];
    const score = tokens.length
      ? tokens.map((_, i) => `(CASE WHEN (product||' '||COALESCE(shade,'')) ILIKE '%'||$${i + 2}||'%' THEN 1 ELSE 0 END)`).join(' + ')
      : '0';
    const r = await pool.query(
      `SELECT product, shade, gsm, rate, valid_from, valid_to, ${score} AS match_score
         FROM customer_prices
        WHERE partner_id = $1 AND is_active = true
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
          ${tokens.length ? `AND (${score}) > 0` : ''}
        ORDER BY match_score DESC, valid_from DESC LIMIT 3`, [ctx.partner_id, ...tokens]);
    if (!r.rows.length) {
      return { authorised: false, note: 'No authorised price on file for this customer/product — sales must confirm the rate.' };
    }
    return {
      authorised: true,
      prices: r.rows.map(x => ({ product: x.product, shade: x.shade, gsm: x.gsm, rate_per_kg: round2(x.rate) })),
      note: 'Authorised rate for THIS customer. You may state it.',
    };
  }

  // ── product master (§22) ─────────────────────────────────────────────
  async function search_products({ query } = {}) {
    const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const score = tokens.length
      ? tokens.map((_, i) => `(CASE WHEN (item_name||' '||COALESCE(description,'')||' '||item_code) ILIKE '%'||$${i + 1}||'%' THEN 1 ELSE 0 END)`).join(' + ')
      : '0';
    const r = await pool.query(
      `SELECT item_code, item_name, description, gst_rate, ${score} AS match_score
         FROM items
        WHERE COALESCE(is_active, true) = true ${tokens.length ? `AND (${score}) > 0` : ''}
        ORDER BY match_score DESC, item_name LIMIT 8`, tokens);
    return { products: r.rows.map(x => ({ code: x.item_code, name: x.item_name, description: x.description, gst_rate: x.gst_rate })) };
  }

  async function get_product({ code, name } = {}) {
    const r = await pool.query(
      `SELECT item_code, item_name, description, gst_rate, standard_loss_pct
         FROM items
        WHERE COALESCE(is_active, true) = true
          AND ($1 = '' OR item_code ILIKE $1) AND ($2 = '' OR item_name ILIKE '%'||$2||'%')
        LIMIT 1`, [String(code || '').trim(), String(name || '').trim()]);
    if (!r.rows.length) return { found: false, note: 'No such product in the item master.' };
    return { found: true, ...r.rows[0] };
  }

  // ── orders (§7, §10) ─────────────────────────────────────────────────
  async function get_open_orders(_args, ctx) {
    if (!ctx.partner_id) return { orders: [] };
    const r = await pool.query(
      `SELECT so_number, order_date, delivery_date, status, total_amount
         FROM sales_orders
        WHERE partner_id = $1 AND status NOT IN ('DISPATCHED','CANCELLED','COMPLETED')
        ORDER BY order_date DESC LIMIT 10`, [ctx.partner_id]);
    return { orders: r.rows };
  }

  // Scoped by partner so an order number from another customer returns nothing.
  async function get_order_status({ order_no } = {}, ctx) {
    if (!ctx.partner_id) return { found: false };
    const r = await pool.query(
      `SELECT so_number, order_date, delivery_date, status, total_amount
         FROM sales_orders
        WHERE partner_id = $1 AND so_number ILIKE $2 LIMIT 1`,
      [ctx.partner_id, `%${String(order_no || '').trim()}%`]);
    if (!r.rows.length) return { found: false, note: 'No such order for this customer.' };
    return { found: true, ...r.rows[0] };
  }

  // ── finance (§19) — internal figure; never volunteer to the customer ──
  async function get_outstanding(_args, ctx) {
    if (!ctx.partner_id) return { known: false };
    const r = await pool.query(
      `SELECT COALESCE(outstanding,0) AS outstanding, COALESCE(overdue,0) AS overdue,
              COALESCE(open_invoices,0) AS unpaid_invoices
         FROM v_partner_outstanding WHERE partner_id = $1`, [ctx.partner_id]);
    return {
      known: true,
      outstanding: round2(r.rows[0].outstanding),
      unpaid_invoices: Number(r.rows[0].unpaid_invoices),
      note: 'INTERNAL. Do not state balances to the customer unless sales explicitly asks you to.',
    };
  }

  // ── production & dispatch (§10) ──────────────────────────────────────
  // Always scoped to this chat's customer; ETAs come from real committed MES
  // dates and are null when the factory has not committed one.
  async function get_production_status({ order_no } = {}, ctx) {
    if (!production) return { found: false, error: 'Production tracking unavailable' };
    return production.orderProgress(ctx.partner_id, order_no);
  }

  async function get_dispatch_status({ order_no } = {}, ctx) {
    if (!production) return { found: false, error: 'Dispatch tracking unavailable' };
    return production.dispatchStatus(ctx.partner_id, order_no);
  }

  // §11 — stock across the chain (finished / greige / WIP at vendor).
  async function get_inventory({ query } = {}) {
    if (!production) return { error: 'Inventory unavailable' };
    return production.inventorySummary(query);
  }

  // ── shade cards (§4) ─────────────────────────────────────────────────
  // Finds the card; stock is read LIVE (never stored on the card) so what the
  // AI quotes can't go stale. Sending is done by the caller, not the model.
  async function get_shade_card({ product } = {}) {
    const tokens = String(product || '').toLowerCase()
      .split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const score = tokens.length
      ? tokens.map((_, i) => `(CASE WHEN product ILIKE '%'||$${i + 1}||'%' OR shades ILIKE '%'||$${i + 1}||'%' THEN 1 ELSE 0 END)`).join(' + ')
      : '0';
    const r = await pool.query(
      `SELECT card_id, product, construction, gsm, composition, width, finish, shades,
              moq_kg, lead_time_days, file_name, mime_type, ${score} AS match_score
         FROM shade_cards
        WHERE is_active = true
        ${tokens.length ? `AND (${score}) > 0` : ''}
        ORDER BY match_score DESC, created_at DESC LIMIT 3`, tokens);
    if (!r.rows.length) return { found: false, note: 'No shade card on file for that product.' };

    const card = r.rows[0];
    const stock = await get_available_stock({ query: card.product });
    return {
      found: true,
      card: {
        card_id: card.card_id, product: card.product, construction: card.construction,
        gsm: card.gsm, composition: card.composition, width: card.width, finish: card.finish,
        shades: card.shades, moq_kg: card.moq_kg, lead_time_days: card.lead_time_days,
        has_file: !!card.file_name,
      },
      live_stock: stock.matches,
      note: 'Tell the customer the card is being sent; the system attaches the file.',
    };
  }

  // ── quotations (§8) / draft orders (§9) ──────────────────────────────
  // The AI may only DRAFT. It cannot set a rate (the engine takes the customer's
  // own last billed rate, else the quote goes for manager approval), cannot
  // approve, and cannot send. Nothing here reaches the customer by itself.
  async function create_draft_quote({ product, shade, gsm, quantity_kg } = {}, ctx) {
    if (!quotes) return { created: false, error: 'Quoting not available' };
    if (!quantity_kg || Number(quantity_kg) <= 0) {
      return { created: false, note: 'Ask the customer for the quantity in kg first.' };
    }
    const out = await quotes.createQuote({
      conversation_id: ctx.conversation_id, partner_id: ctx.partner_id,
      product, shade, gsm, quantity_kg,   // NOTE: no rate — never model-supplied
    }, 'AI');
    const q = out.quote;
    return {
      created: true,
      quote_no: q.quote_no,
      status: q.status,
      rate: q.rate,
      rate_source: q.rate_source,
      grand_total: q.grand_total,
      credit_flag: q.credit_flag,
      note: q.status === 'APPROVED'
        ? 'Draft quote ready for a salesperson to review and send. Tell the customer the quotation is being prepared — do NOT quote figures unless they appear here.'
        : 'Price/credit approval required. Tell the customer our sales team will confirm the rate shortly. Do NOT quote any price.',
    };
  }

  async function create_draft_sales_order({ product, shade, gsm, quantity_kg, quote_id } = {}, ctx) {
    if (!quotes) return { created: false, error: 'Ordering not available' };
    const out = await quotes.createDraftOrder({
      conversation_id: ctx.conversation_id, partner_id: ctx.partner_id,
      product, shade, gsm, quantity_kg, quote_id,
    }, 'AI');
    if (out.error) return { created: false, error: out.error };
    return {
      created: true,
      draft_id: out.draft.draft_id,
      note: 'DRAFT order raised for employee confirmation. Tell the customer we are confirming the order and will share the order number shortly. Do NOT state an order number — it does not exist yet.',
    };
  }

  // Ask a manager to set a price (§8). This only raises the request — the AI
  // cannot approve it, and nothing reaches the customer from here.
  async function request_price_approval({ product, shade, gsm, quantity_kg, reason } = {}, ctx) {
    if (!quotes) return { requested: false, error: 'Quoting not available' };
    const out = await quotes.createQuote({
      conversation_id: ctx.conversation_id, partner_id: ctx.partner_id,
      product, shade, gsm, quantity_kg: quantity_kg || 0,
      notes: reason ? `Price approval requested: ${reason}` : 'Price approval requested by AI',
    }, 'AI');
    return {
      requested: true,
      quote_no: out.quote.quote_no,
      status: out.quote.status,
      note: 'PRICE APPROVAL REQUIRED — a manager has been asked to set the rate. Tell the customer sales will confirm shortly. Do NOT quote any figure.',
    };
  }

  // Queue a document for a salesperson to send (§1). The AI never puts a file on
  // the wire itself; this records the intent so the UI can action it.
  async function send_document({ doc_type, note } = {}, ctx) {
    const kind = String(doc_type || '').toUpperCase();
    const ALLOWED = ['SHADE_CARD', 'QUOTE', 'INVOICE', 'CATALOGUE'];
    if (!ALLOWED.includes(kind)) {
      return { queued: false, note: `Unknown document type. Allowed: ${ALLOWED.join(', ')}.` };
    }
    await pool.query(
      `INSERT INTO crm_followups (partner_id, lead_id, conversation_id, note, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,'AI')`,
      [ctx.partner_id || null, ctx.lead_id || null, ctx.conversation_id,
       `Send ${kind.replace('_', ' ').toLowerCase()} to customer${note ? ` — ${note}` : ''}`,
       ctx.assigned_to || null]);
    return {
      queued: true,
      note: 'A salesperson has been asked to send it. Tell the customer it is on its way — do not claim it has already been sent.',
    };
  }

  // ── CRM writes (safe, non-commercial) ────────────────────────────────
  async function create_lead(args = {}, ctx) {
    const r = await pool.query(
      `INSERT INTO crm_leads (phone, name, company, city, business_type, required_fabric, approx_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING lead_id`,
      [ctx.phone, args.name || null, args.company || null, args.city || null,
       args.business_type || null, args.required_fabric || null, args.approx_qty || null]);
    const leadId = r.rows[0].lead_id;
    if (ctx.conversation_id) {
      await pool.query(`UPDATE wa_conversations SET lead_id=$1 WHERE conversation_id=$2 AND lead_id IS NULL`,
        [leadId, ctx.conversation_id]);
    }
    return { lead_id: leadId, created: true };
  }

  async function create_followup({ note, due_date } = {}, ctx) {
    if (!note) return { created: false, error: 'note required' };
    const r = await pool.query(
      `INSERT INTO crm_followups (partner_id, lead_id, conversation_id, note, due_date, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'AI') RETURNING followup_id`,
      [ctx.partner_id || null, ctx.lead_id || null, ctx.conversation_id || null,
       note, due_date || null, ctx.assigned_to || null]);
    return { followup_id: r.rows[0].followup_id, created: true };
  }

  // Record a customer complaint from the conversation.
  //
  // A write tool, so it is deliberately absent from AUTO_SAFE and cannot fire
  // without a human. The ESCALATE pattern in wa-ai.js already contains
  // "complain|shikayat|claim", so a complaint reaches a person even in AUTO
  // mode — this tool exists so that when the person acts, the complaint is
  // logged against the customer instead of living in the chat thread.
  //
  // Severity is not taken from the model. An upset customer and a critical
  // quality failure read the same in text, and letting the AI grade its own
  // input would put the wrong things at the top of the worklist. Everything
  // logged here starts MEDIUM for a human to triage.
  async function log_complaint({ summary, category, detail } = {}, ctx) {
    if (!summary) return { created: false, error: 'summary required' };
    if (!ctx.partner_id) {
      return { created: false, error: 'This chat is not linked to a customer yet — link it first.' };
    }
    const complaints = require('./complaints')(pool);
    const out = await complaints.create({
      partner_id: ctx.partner_id,
      summary: String(summary).slice(0, 300),
      detail: detail || null,
      category: category || 'OTHER',
      severity: 'MEDIUM',
      source: 'WHATSAPP',
    }, { by: 'AI' });
    if (out.error) return { created: false, error: out.error };
    return { created: true, complaint_no: out.complaint.complaint_no, status: out.complaint.status };
  }

  // What this customer owes, and since when — for the collections
  // conversation, which is the most common reason anyone opens a chat.
  //
  // Read-only, but deliberately NOT in AUTO_SAFE — the same call the existing
  // get_outstanding makes. A balance quoted to a customer becomes a number they
  // hold us to, and money should pass a human before it goes out on WhatsApp.
  // ESCALATE already routes payment disputes to a person; this keeps the plain
  // "how much do I owe" answer under the same rule.
  //
  // It reads the same figures the credit gate and Customer-360 use: a chatbot
  // quoting a different outstanding from the receipts screen is worse than one
  // that says nothing at all.
  //
  // The reply is deliberately shaped for a customer, not an operator — buckets
  // and a total, no internal invoice ids or credit limits.
  async function get_payment_status(_args, ctx) {
    if (!ctx.partner_id) return { known: false, note: 'This chat is not linked to a customer yet.' };
    const pay = require('./payments')(pool);
    const o = await pay.outstanding(ctx.partner_id);
    const open = await pay.openInvoices(ctx.partner_id);
    return {
      known: true,
      outstanding: o.outstanding,
      overdue: o.overdue,
      oldest_overdue_days: o.oldest_overdue_days,
      open_invoices: open.slice(0, 10).map(i => ({
        invoice: i.invoice_number, date: i.invoice_date,
        balance: i.balance, days_overdue: i.days_overdue,
      })),
      ageing: o.ageing,
    };
  }

  // ── whitelist + dispatcher ───────────────────────────────────────────
  const TOOLS = {
    get_customer, get_customer_history, get_available_stock, get_last_sale_price,
    get_open_orders, get_order_status, get_outstanding, get_shade_card, get_production_status, get_dispatch_status, get_inventory,
    get_customer_price, get_product, search_products,
    create_draft_quote, create_draft_sales_order,
    request_price_approval, send_document, create_lead, create_followup, log_complaint,
    get_payment_status,
  };

  // Definitions handed to the model (names + purpose only, no SQL).
  const definitions = [
    { name: 'get_payment_status',    description: 'What this customer owes: total outstanding, how much is overdue, and their open invoices. Use for any payment or balance question.', params: {} },
    { name: 'log_complaint',         description: 'Record a customer complaint against this customer. Args: {summary, category, detail}. category is one of QUALITY, SHORTAGE, WRONG_ITEM, DAMAGE, DELAY, BILLING, OTHER.', params: { summary: 'string', category: 'string', detail: 'string' } },
    { name: 'get_customer',          description: 'Identify the customer on this chat (company, terms, city).', params: {} },
    { name: 'get_customer_history',  description: 'This customer\'s recent orders and frequently bought fabrics.', params: {} },
    { name: 'get_available_stock',   description: 'Live finished-goods stock. Args: {query} e.g. "fake cotton lycra black".', params: { query: 'string' } },
    { name: 'get_last_sale_price',   description: 'Rate previously billed to THIS customer. Args: {item}.', params: { item: 'string' } },
    { name: 'get_open_orders',       description: 'This customer\'s open sales orders.', params: {} },
    { name: 'get_order_status',      description: 'Status of one order. Args: {order_no}.', params: { order_no: 'string' } },
    { name: 'get_outstanding',       description: 'INTERNAL: this customer\'s unpaid invoice total.', params: {} },
    { name: 'get_shade_card',       description: 'Find the shade card for a product (with live stock). Args: {product}.', params: { product: 'string' } },
    { name: 'get_customer_price',   description: 'The AUTHORISED rate for this customer if a manager set one. Args: {product,shade}.', params: { product: 'string' } },
    { name: 'search_products',      description: 'Search the item master by name/code. Args: {query}.', params: { query: 'string' } },
    { name: 'get_product',          description: 'One product from the item master. Args: {code} or {name}.', params: { name: 'string' } },
    { name: 'get_production_status', description: 'Where an order is in the factory + real ETA. Args: {order_no} (blank = latest order).', params: { order_no: 'string' } },
    { name: 'get_dispatch_status',  description: 'Recent dispatches for this customer. Args: {order_no}.', params: { order_no: 'string' } },
    { name: 'get_inventory',        description: 'Stock across the chain: finished (physical/reserved/available), greige, WIP at vendor. Args: {query}.', params: { query: 'string' } },
    { name: 'create_draft_quote',  description: 'Draft a quotation (never priced by you, never sent). Args: {product,shade,gsm,quantity_kg}.', params: { quantity_kg: 'number' } },
    { name: 'create_draft_sales_order', description: 'Raise a DRAFT order for employee confirmation when the customer confirms. Args: {product,shade,gsm,quantity_kg,quote_id}.', params: { quantity_kg: 'number' } },
    { name: 'request_price_approval', description: 'Ask a manager to set a rate when none is authorised. Args: {product,shade,gsm,quantity_kg,reason}.', params: { product: 'string' } },
    { name: 'send_document',        description: 'Queue a document for a salesperson to send. Args: {doc_type: SHADE_CARD|QUOTE|INVOICE|CATALOGUE, note}.', params: { doc_type: 'string' } },
    { name: 'create_lead',           description: 'Record a new enquiry. Args: {name,company,city,business_type,required_fabric,approx_qty}.', params: {} },
    { name: 'create_followup',       description: 'Create a sales follow-up task. Args: {note,due_date}.', params: { note: 'string' } },
  ];

  async function call(name, args, ctx) {
    const fn = TOOLS[name];
    if (!fn) return { error: `Unknown tool: ${name}` };   // whitelist enforcement
    try {
      return await fn(args || {}, ctx || {});
    } catch (e) {
      return { error: e.message };
    }
  }

  return { call, definitions, names: Object.keys(TOOLS) };
};
