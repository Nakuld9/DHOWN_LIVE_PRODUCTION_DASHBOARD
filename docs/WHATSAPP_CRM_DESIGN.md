# WhatsApp AI CRM — Design & Phase Plan
*2026-08-05 — approved architecture for the AI-powered WhatsApp sales module.*

## Principle
An AI **business agent** over the MES via **controlled tools** — never raw DB access, never invented stock/price/ETA/financials. The MES database stays the single source of truth.

## Reuse (no duplicate sources of truth)
| Need | Existing MES asset |
|---|---|
| WhatsApp send/receive | `src/lib/alerts.js` (`sendText`, `sendTemplate`, `waPost`), webhook route (verified live) |
| Customers | `partners` + `partner_contacts` (mobile/whatsapp) + `partner_addresses` |
| Products/prices | `items` (Item Master), customer price = last sale price from `dispatch`/`tax_invoice_items` |
| Stock | `stock_ledger`, rolls/greige/FG views (`/api/erp/stock-statement`, inventory-views) |
| Orders | `sales_orders`, `production_plans` |
| Production | machines/rolls/oee (live), subcontract (dye/finish stages) |
| Outstanding | `tax_invoices` (ISSUED − PAID) |
| AI | `src/lib/ai.js` — GLM primary, Groq fallback |
| Realtime | Socket.IO (`io`) already wired |

## Architecture
```
WhatsApp Cloud API → /api/whatsapp/webhook (public, Meta-verified)
  → wa-crm persistence (conversations/messages, phone→partner match, lead auto-create)
  → AI Orchestrator (mode: OFF | SUGGEST | AUTO)
      → Tool/Permission layer (whitelisted functions, RBAC, per-customer isolation)
      → MES data (read) / draft objects (write: lead, follow-up, draft quote/SO)
  → Response Generator → sendText/sendTemplate → WhatsApp
MES UI: /whatsapp-inbox (3-pane) ← REST + Socket.IO push
```

## Database (all self-healing in `schema.js`)
- `wa_conversations` — phone (unique), partner_id?, lead_id?, name, ai_mode (OFF/SUGGEST/AUTO, default SUGGEST), unread_count, last_message, last_message_at, assigned_to, status
- `wa_messages` — conversation_id, direction (IN/OUT), wa_message_id, type (text/image/document/...), body, media_id/media_url/mime/caption, sent_by (user), ai_generated bool, status, created_at
- `wa_ai_actions` — audit: conversation_id, request_text, interpretation, tool_called, params jsonb, result jsonb, response_text, auto_sent bool, approved_by, created_at
- `crm_leads` — phone, name, company, city, business_type, required_fabric, approx_qty, score (HOT/WARM/COLD), status, source 'WHATSAPP'
- `crm_followups` — partner_id/lead_id, conversation_id, note, due_date, assigned_to, status
- Later phases: `shade_cards`, `wa_quotes` + approvals, `sales_opportunities`, `conversation_summaries`

## AI tool layer (`src/lib/wa-tools.js`) — the ONLY AI↔data path
Phase-1 read tools (all take the matched partner context; customer isolation enforced by construction):
`get_customer(phone)`, `get_available_stock(query)`, `get_open_orders(partner_id)`, `get_order_status(order_no)`, `get_outstanding(partner_id)`, `get_last_sale_price(partner_id, item)`
Phase-1 write tools: `create_lead()`, `create_followup()`
Later: `get_shade_card`, `create_draft_quote`, `request_price_approval`, `create_draft_sales_order`, `send_document`, `get_production_status`, `get_dispatch_status`.

## Permission / approval matrix
| Action | AUTO allowed | Needs human |
|---|---|---|
| Product info, shade card, authorized stock, order/dispatch status, FAQs | ✅ (AUTO mode only) | — |
| New price, discount, credit change, payment dispute, big quote, cancellation, complaint, refund, any commercial commitment | ❌ | ALWAYS (SUGGEST → approver) |
| Draft SO / quote creation | draft only | send/confirm requires employee approval |
| Financials to customer | ❌ never | manager-permitted only |
Prompt-injection defence: customer text is data-only; tools are whitelisted per role; AI output to customers passes a filter (no other-customer data — tools are already scoped to the matched partner).

## UI — `/whatsapp-inbox` (Fresh page, JWT users only)
LEFT conversation list (name/company, unread, last msg, lead badge) · CENTER chat (bubbles, send box, AI mode toggle OFF/SUGGEST/AUTO, "AI Suggest" button → editable draft → Send) · RIGHT Customer-360 (Overview: partner details, outstanding, open orders, last order; later tabs: Orders/Quotes/Inventory/Production/Payments/Docs/AI Insights). Realtime via Socket.IO `wa_message` events.

## Phases
1. **Foundation (DONE this phase)** — schema, webhook persistence + partner matching + auto-lead, inbox REST API, 3-pane Inbox UI with send + AI-mode, AI SUGGEST with phase-1 tools, full audit trail.
2. **Media + shade cards (DONE 2026-08-05)** — inbound media downloaded at webhook time to `uploads/wa` (Meta URLs expire); `wa_messages.local_file`; `GET /api/wa/media/:messageId` JWT-gated with `basename()` anti-traversal; UI renders attachments as authenticated blobs (no token in URLs). `shade_cards` library + `get_shade_card` tool (stock read LIVE at lookup, never stored on the card) + one-click send-card tray. Outbound image/document send via multipart upload. *Still open: sending MES-generated quote/invoice PDFs (Phase 3), image understanding (Phase 5).*
3. **Quotations + approvals + draft orders (DONE 2026-08-05)** — `wa_quotes`/`wa_quote_approvals`/`wa_draft_orders`. Price authorisation in `wa-quote.js`: HISTORICAL rate auto-prices, otherwise `PENDING_PRICE_APPROVAL` with rate null (never invented). AI cannot pass a rate; operators have rate stripped server-side; SUPERVISOR+ approve/reject/edit (GST + credit recomputed, logged). Only APPROVED quotes can be sent. Credit gate (§19) holds a quote when outstanding + proposed exceeds the limit. Customer confirmation creates only a DRAFT; an employee confirm creates the real sales order and messages the order number. GST via shared `computeTax`. 14 unit tests.
4. **Production, dispatch, inventory ATP (DONE 2026-08-05)** — `wa-production.js` walks rolls → batches → subcontract (dye/finish) → QA → finished goods → dispatch and infers the current stage from the strongest live signal. **ETAs are never model-computed**: first real committed date wins (subcontract `expected_return_date` → plan `planned_end` → order `delivery_date`), `eta_source` always reported, and `null` when nothing is committed (AI then promises a callback). Order lookup scoped by partner. `get_inventory` separates finished (physical/reserved/available) from greige and WIP-at-vendor. Tools: `get_production_status`, `get_dispatch_status`, `get_inventory`. UI: PRODUCTION tab with stage rail.
5. **Intelligence layer (DONE 2026-08-05)** — `wa-score.js` weighted lead scoring (qty/orders/value/recency/engagement/quotes, minus overdue), stored on conversation + lead; opportunity engine triggers at 1.5x each customer own order gap plus stale-quote follow-ups (internal suggestions only); `/api/wa/dashboard` (§17) incl. avg first-response time; 12-stage pipeline board with server-side validation; deterministic SQL conversation search + min-kg filter + dormant customers (§16); image understanding via `wa-llm.vision` → `wa_messages.ai_description` (§3), which refuses to guess illegible details. New page `/whatsapp-insights`. 12 unit tests. AUTO mode (§14) shipped in Phase 1 and now covers the Phase-4 read tools.
Notes: AUTO replies to customers require the Meta app **Published** + 24-h session rules (template outside window). Current dev-mode limits apply until WhatsApp go-live completes.

---

## Post-phase completion (2026-08-06)
All spec gaps closed except those blocked on Meta. Module ~93/100.

- **Quote PDFs** (`wa-pdf.js`) — approved quotes send as a real PDF with GST breakdown; text fallback if PDF/upload fails. Preview at `GET /quotes/:id/pdf`. Generic `POST /conversations/:id/send-document` for MES docs or uploads (unapproved quotes refused 409).
- **AI Copilot panel (§15)** — `insights.copilot()` builds the summary from MES facts (customer, last billed rate, quantity asked, live stock, quote status), never model prose. Seven recommended actions, each mapping to an existing audited endpoint.
- **Authorised pricing (§8)** — `customer_prices` table = the rate a manager agreed. Rate cascade: MANAGER → AUTHORISED → HISTORICAL → NONE(approval). `get_customer_price` is the only price tool permitted to state a figure.
- **Vision wired into the tool loop (§3)** — `imageDescription` flows into both AI passes, labelled as context not instructions; escalation check scans it too; audit records `image_seen`.
- **Full §22 tool coverage (20/20)** — added `get_customer_price`, `get_product`, `search_products`, `request_price_approval`, `send_document` (last two are request-only; a human acts).
- **All 8 Customer-360 tabs (§25)**, follow-ups (§12), pipeline drag-and-drop (§13), `conversation_summaries` (§23), AI rate limit 20/min per user (§24), Punjabi verified (§21).

### Bugs found by end-to-end testing (worth remembering)
1. Login stores `dhown_token`; six pages read `token`, which nothing sets → `Bearer null`/401 for real logins. Four were pre-existing (AdminMasters, ItemMaster, Partners, StockStatement).
2. `get_last_sale_price` matched a single phrase, so image-derived item strings never matched ledger lines — every such price lookup silently missed. Now token-matched.
3. Quote `partner_id` had to be derived from the conversation server-side, else omitting it skipped the credit check.

### Still open
- **Blocked on Meta**: customer-facing AUTO needs app Published + 24h window + permanent System User token + new SIM. Internal SUGGEST works today.
- Not built: invoice/dispatch PDF templates (quote PDF exists; `send_document` is ready for them), semantic/embedding search (current search is deterministic SQL), voice notes, field-level encryption at rest.
