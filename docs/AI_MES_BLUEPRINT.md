# AI-Native MES — Implementation Blueprint (Fabric Manufacturing)

**Planning document. No code. For review and approval before any build.**

A complete architecture and phased build plan for an AI-native Manufacturing Execution
System for a **knitted-fabric manufacturer** — yarn → knitting → dyeing/finishing (job-work)
→ finished fabric → dispatch — with an AI-agent layer that acts through a governed tool
boundary, and the exact order in which Claude Code should implement it.

> **Business model (confirmed).** Greige fabric is **knitted in-house**; **dyeing and
> finishing are job-work (subcontracted)** — greige goes out on a challan and dyed/finished
> fabric comes back; the mill sells **both greige and finished fabric**. There is **no
> cutting/sewing/garment stage**.

> **Grounding decision:** this blueprint **extends the running DHOWN MES**, which already
> implements this exact flow. Status is marked throughout: **[EXISTS]** built & running ·
> **[EXTEND]** present, needs widening · **[NEW]** net-new.

---

## 1. Executive summary

Build an **AI-native MES** that runs a knitted-fabric mill end to end and reaches the shop
floor, the office, and the customer through the same governed data core.

You are far from zero. The running **DHOWN MES** already implements the core fabric
lifecycle: yarn stores, in-house knitting with live machine counters, subcontract dyeing
("Dye House") via challan out/in, fabric inventory, sales/CRM with a WhatsApp AI, dispatch,
FIFO knit costing, backups, and auto-starting services. **Because the business is
fabric-only, there is no missing lifecycle** — the real work is not new stages but a
deeper, AI-native layer on top of what runs today.

The strategic bet: AI is **infrastructure, not a feature**. Every module exposes a small
set of governed tools; agents reason over those tools; every state-changing action passes
the same checks (permissions, validation, approval) whether a human or an agent initiates
it. *Humans and agents share one governed path* — that symmetry is what makes automation
safe.

**Where the real value is added (not new lifecycle stages)**
- **[EXTEND]** A **fleet of role-scoped AI agents** (production, inventory, quality,
  maintenance, costing, purchase, sales, dispatch, job-work) — up from today's single
  customer-service agent.
- **[NEW/EXTEND]** **Fabric quality & grading** — a proper 4-point inspection system, shade
  approval, GSM/width/shrinkage, defect Pareto. This is where a fabric mill wins or loses
  margin.
- **[EXTEND]** **Job-work material tracking & reconciliation** — greige sent to the dye
  house vs. dyed fabric returned, process loss/gain, WIP value sitting at the vendor, ageing.
- **[EXTEND]** **Planning / MRP-lite for yarn**, and **role dashboards**.
- **[NEW]** Later: **vision-based fabric defect detection** on the inspection table.

> **Reuse, don't reinvent.** The core fabric flow already works. Implementation is
> *extension under test* — mostly the AI layer, quality/grading, and job-work depth — not a
> rewrite and not a new manufacturing lifecycle.

---

## 2. Business process analysis

A knitted-fabric mill is a chain of transformations where the *unit of tracking changes
shape*: yarn (kg / cones) → greige fabric (rolls / kg, at a GSM) → dyed & finished fabric
(rolls / kg, by shade lot). The MES follows that identity as it changes — and follows
material **out to job-workers and back**.

### Manufacturing processes

| Stage | Transformation | Tracking unit | Status |
|---|---|---|---|
| Yarn intake | Yarn received & stored by lot / count / shade | kg, cones, lot | EXISTS |
| Production planning | Demand → yarn requirement → knit schedule | orders, kg | EXTEND |
| Knitting (in-house) | Yarn → greige rolls on circular machines | rolls, kg, GSM | EXISTS |
| Greige inspection | Grade greige (GSM, dia, defects) | rolls, defects | EXTEND |
| Dyeing (job-work) | Greige out → dyed fabric in, by shade lot | dye lot, kg, challan | EXISTS |
| Finishing (job-work) | Compacting / calendering out → in | kg, challan | EXTEND |
| Finished inspection | 4-point grade, shade, GSM, width, shrinkage | rolls, defects, grade | NEW |
| Fabric packing & grading | Roll / thaan, roll label, A/B grade | rolls, kg | EXTEND |
| Finished goods & dispatch | Store greige & finished; allocate; ship | rolls, kg | EXISTS |
| Costing | Yarn + knit conversion + job charges + overhead | ₹ / kg | EXISTS / EXTEND |

*Greige is itself a sellable finished good — the flow can exit to dispatch after knitting,
or continue to dyeing/finishing.*

### Master data
- **Products** — fabric qualities as the catalog: a **greige quality** and a **finished
  quality** (colour/shade applied), each with GSM, diameter/gauge, composition. No garment
  styles.
- **Partners** — one entity with role flags: **customers**, **yarn suppliers**, and
  **job-workers** (dye houses, finishers). GSTIN, credit terms, addresses. [EXISTS]
- **Materials** — yarn (count, ply, blend, shade), greige fabric, finished fabric.
- **Machines** — circular knitting machines only (dia, gauge, feeders, kg-per-counter);
  no in-house dye/finish machines (that's the vendor's). [EXISTS]
- **Operators & departments** — knitting operators, shifts; no piece-rate sewing.
- **Warehouses & locations** — yarn store, greige store, finished store, and a logical
  **"at job-worker"** location. [EXISTS]
- **Fabric recipe** *(replaces BOM)* — yarn(s) + blend ratio + target GSM/dia/gauge → a
  greige quality; consumption = kg yarn per kg fabric with wastage%. [NEW/EXTEND]
- **Process route** *(replaces routing)* — knit → (dye) → (finish); which stages a quality
  goes through, and which are job-work. No operation/SAM.
- **Quality parameters & defect types** — GSM, width, shrinkage, shade, GSM tolerance; a
  fabric defect taxonomy (holes, slubs, needle lines, shade bands, contamination) for the
  4-point system.

### Transactions and how they connect

Each transaction links to the next by a **document reference chain**, so a finished roll
traces back to its greige roll and its yarn lot, and material is accountable even while it
sits at a job-worker.

| Transaction | Creates | Consumes / references | Downstream effect |
|---|---|---|---|
| Purchase order (yarn) | Commitment to supplier | Yarn requirement | Expected receipt; costing input |
| Material receipt (GRN) | Yarn stock in + FIFO cost layer | PO | Stock ledger; payable |
| Yarn issue | Yarn out to knitting WIP | Knit work order | WIP valuation; consumption |
| Knit production entry | Greige roll | Work order, machine, operator | Yield, OEE, greige stock |
| Greige inspection | Grade / hold / reject | Roll | Gates dyeing or greige sale |
| Subcontract challan **out** | Greige (or dyed) sent to job-worker | Rolls, job-worker | Material now "at vendor" |
| Subcontract challan **in** | Dyed / finished fabric returned | Challan out, shade lot | Finished stock; process loss/gain |
| Job-work charge | Payable to job-worker | Challan in | Costing (dye/finish charge) |
| Fabric inspection (4-point) | Grade (A/B) + defect log | Roll | Sellable grade; reject/rework |
| Stock transfer | Move between stores/locations | Stock ledger | Availability by location |
| Sales order | Demand (greige or finished) | Customer, quality | Allocation; dispatch |
| Dispatch | Goods out | Sales order, FG stock | Proforma record; BUSY invoice |
| Costing roll-up | Cost per kg / per roll | All of the above | Margin; pricing feedback |

---

## 3. Complete MES module hierarchy

Modules are vertical slices — each owns its data, governed tools, and UI.

| Domain | Modules | Status |
|---|---|---|
| **Core** | Auth · Users · Roles & permissions · Audit log · Settings/tenant · Notifications | EXISTS |
| **Master data** | Fabric qualities (greige/finished) · Partners · Yarn & fabric materials · Fabric recipe · Process route · Knitting machines · Operators · Warehouses & locations · Quality parameters · Defect types | EXTEND |
| **Planning** | Demand consolidation · Yarn requirement (MRP-lite) · Knitting capacity & schedule · Production orders | EXTEND |
| **Knitting** | Work orders · Machine allocation · Roll production · Downtime · Live counters · Yield | EXISTS |
| **Job-work (dye & finish)** | Subcontract challans (out/in) · Shade approval · Job-worker ledger · Material-at-vendor tracking · Process loss/gain · Job charges | EXISTS / EXTEND |
| **Fabric quality & grading** | Yarn/incoming · Greige inspection · Finished 4-point inspection · Shade · Defects · Grading (A/B) · Rejection/rework · CAPA | NEW / EXTEND |
| **Inventory** | Yarn / greige / finished stores · Stock ledger · Batches & lots · Transfers · Issue & return · At-vendor stock · Valuation (FIFO) | EXISTS |
| **Maintenance** | Breakdown log · Preventive schedule · Work orders · Spare parts · Machine history | EXISTS |
| **Procurement** | Requisitions · Yarn purchase orders · GRN · Supplier ledger · Approvals matrix | EXISTS |
| **Sales & CRM** | Customers · Quotes · Sales orders (greige/finished) · WhatsApp CRM · Complaints · Follow-ups | EXISTS |
| **Dispatch** | Allocation · Dispatch note · POD · Returns · E-way (via BUSY) | EXISTS |
| **Costing & finance** | Fabric costing (yarn + knit + job charges + overhead) · Payroll · Proforma invoice (record) · Receipts · Bank rec | EXTEND |
| **AI layer** | Tool registry · Agent runtime · Memory · Guardrails · Approvals queue · AI action log · Performance | EXTEND |
| **Integration** | BUSY sync · WhatsApp Cloud API · IoT ingest · Model providers | EXTEND |
| **Analytics** | Role dashboards · OEE · Reports · Exports | EXTEND |

---

## 4. System architecture

Keep the proven stack and harden it; don't chase novelty. Every choice is justified against
shop-floor reality: intermittent connectivity, non-technical operators, a single on-prem
server, a long maintenance life.

| Concern | Recommendation | Why |
|---|---|---|
| Backend | **Node.js + Express**, layered (routes → controllers → services → repositories) | In production and understood; layering keeps the AI tool layer honest (tools call services, never the DB) |
| Frontend | **React SPA** served by backend; installable PWA | One build per tenant; offline-tolerant shop-floor screens; runtime tenant identity, no fork |
| Database | **PostgreSQL 18** — single source of truth | Transactional integrity for stock/costing; constraints, JSONB, window functions |
| Auth | **JWT** + global `/api` auth gate with public allow-list | A new route is protected on mount; per-route guards leak |
| APIs | REST, resource-oriented, versioned; OpenAPI generated | Simple, cacheable, debuggable; a fixed surface the AI tool layer wants |
| Background jobs | **In-process scheduler + durable DB queue** with advisory locks | Survives restart, no extra broker on one box |
| Real-time | **WebSocket (Socket.IO)** | Push for live knitting counters; SSE fallback |
| File storage | **Local filesystem** now, S3-compatible interface later | On-prem reality; abstract behind a storage service |
| Caching | In-memory short-TTL for identity/config; DB otherwise | Add Redis only at horizontal scale |
| Search | Postgres full-text + trigram initially | Defer Elastic/Meilisearch until volume demands |
| Notifications | In-app + WhatsApp + email, one dispatch service | Agents and humans notify the same way |
| AI infra | **Provider-abstracted** gateway + tool registry + agent runtime | Never bound to one vendor; models chosen per task |
| Logging/monitoring | Structured logs + health endpoints + metrics counters | Add Grafana/Prometheus at maturity |
| Backup | Daily + hourly `pg_dump`, retained + off-box | Recovery point ~1h; absolute-path tooling |
| Deployment | On-prem service + Cloudflare tunnel | Auto-start services + tunnel proven |

> **Architectural principle — one governed core, many surfaces.** Web UI, WhatsApp, and AI
> agents are all *clients* of the same service layer. No surface gets a private path to the
> database — which is what makes agent automation auditable and safe.

---

## 5. Database architecture

Organise tables by **role**, not just domain — role dictates the rules.

| Class | Purpose | Mutability | Examples |
|---|---|---|---|
| **Master** | The nouns of the business | Editable, versioned; soft-delete only | fabric_qualities, partners, yarn_materials, recipes, process_routes, machines, operators, quality_params, defect_types |
| **Transaction** | Events that happen once | Editable while draft; **locked** once posted | purchase_orders, grn, sales_orders, knit_work_orders, roll_production, subcontract_challans, fabric_inspections, dispatches |
| **Ledger** | Append-only running balances | **Immutable** — corrections are reversing entries | stock_ledger, cost_layers, partner_ledger, jobwork_ledger |
| **Audit** | Who changed what, when | **Immutable**, append-only | audit_log, ai_action_log, approval_log |
| **AI** | Agent memory, actions, guardrails | Append-only actions; editable memory summaries | ai_conversations, ai_messages, ai_actions, ai_approvals, ai_tool_calls, ai_performance |
| **Integration** | Sync state with external systems | Editable status, immutable payload | busy_export_batches, busy_export_rolls, wa_webhook_events, iot_readings |
| **Config** | Tenant + system settings | Editable, audited | app_settings, approval_matrix, number_series, feature_flags |

**Key entities**
- **Fabric quality** — the catalog noun: greige and finished qualities with GSM, dia/gauge,
  composition, and default recipe & process route.
- **Recipe** — yarn(s) + blend ratio → a greige quality; consumption kg-per-kg + wastage%.
- **Process route** — the ordered stages a quality passes (knit → dye → finish) and which
  are job-work.
- **Roll** — the changing unit of tracking: greige roll → (after job-work) finished roll,
  each carrying parent lineage back to the yarn lot.
- **Subcontract challan** — greige/dyed fabric out to a job-worker and the return, with
  quantities both ways so **process loss/gain** is measured and material at the vendor is
  visible.
- **Stock ledger** — append-only in/out per item×location×lot (including the "at-vendor"
  location); the *only* truth for stock.
- **Cost layers (FIFO)** — priced yarn layers; issues consume oldest first; job charges add
  on at challan-in.
- **AI action** — every agent action recorded immutably.

> **Immutability rule** — anything financial or physical-stock is ledger-immutable. Never
> edit a posted movement or cost layer; post a *reversing* entry. This keeps costing and
> inventory reconcilable and stops any actor (human or AI) rewriting history.

---

## 6. Manufacturing data flow

```
Sales order (greige or finished)
  ↓
Production planning        (consolidate demand, explode recipe → yarn need)
  ↓
Yarn requirement           (need vs on-hand vs on-order)
  ↓
Purchase / issue           (buy shortfalls; issue yarn to knitting)
  ↓
Knitting                   (greige rolls) → Greige inspection
  ↓                              ↘ (greige can exit to dispatch here)
Dyeing (job-work out/in)   → Shade approval
  ↓
Finishing (job-work out/in)
  ↓
Finished inspection (4-point grade)
  ↓
Finished goods (greige and/or finished)
  ↓
Dispatch                   (allocate to order; proof of delivery)
  ↓
Costing roll-up            (yarn + knit conversion + job charges + overhead → ₹/kg)
```

**Per-stage detail**

| Stage | Input | Processing | Output/records | Approval | Exceptions |
|---|---|---|---|---|---|
| Planning | Sales orders, forecast | Explode recipe, net yarn vs stock, size knit capacity | Production orders; yarn requirement | Plan sign-off | Capacity short → schedule/split |
| Yarn issue | Work order, recipe | Reserve & issue by FIFO lot | Stock-out ledger; WIP layer | Store keeper | Shortage → hold; substitute count |
| Knitting | Yarn issue, machine, program | Run; count via collector; log downtime | Greige rolls; OEE; yield | Roll approval | Off-GSM → quarantine |
| Greige inspection | Greige rolls | Check GSM/dia/defects; grade | Grade; hold/pass | QC | Off-spec → hold; sell as B-grade |
| Dyeing (job-work) | Greige rolls | Challan out → dye house → challan in by shade lot | Dyed fabric; challan; loss/gain | Shade approval | Shade fail → redye/reject; overdue at vendor |
| Finishing (job-work) | Dyed fabric | Challan out → finisher → challan in | Finished fabric; challan | — | Finish defect → rework |
| Finished inspection | Finished rolls | 4-point defect count; shade; width; shrinkage | Grade (A/B); defect log | Final QC | AQL/points fail → downgrade/reject |
| Dispatch | FG stock, sales order | Allocate, pack-out (rolls/thaan), POD | Dispatch note; FG-out ledger | Dispatch auth | Short → back-order |
| Costing | All consumption & charges | Yarn FIFO + knit conversion + job charges + overhead | Cost/kg; margin | — | Variance → investigate |

---

## 7. AI architecture

AI-native means the intelligence sits **inside** the governed core, reasoning over the same
tools humans use — not a chatbot with its own database key. Four layers:

```
Model gateway    (provider-abstracted; routes each task to the right model — §18)
  ↓
Agent runtime    (role-scoped agents; plan → call tools → synthesise; guardrails per turn)
  ↓
Tool registry    (the ONLY way AI touches data — typed, permissioned, audited — §9)
  ↓
Service layer + database   (same services the UI uses; no private AI path)
```

**Non-negotiable properties**
- **No raw SQL for the model** — it emits *tool calls*, never queries. (Already the pattern.)
- **Read is free; write is gated** — read tools run immediately; write tools produce a *proposal* (§10).
- **Every turn leaves a trace** — prompt, tools, model, tokens, latency, outcome logged.
- **Memory is data, not authority** — memory can inform an answer but never *establish a fact or price* (already tested).
- **Provider-independent** — a task can run on any provider; an outage/price change is a config switch (§18).

---

## 8. AI-agent architecture

A fleet of **role-scoped agents**, each with a narrow data scope, a fixed toolset, and an
escalation path. A lightweight *router* classifies intent and dispatches; a *management
agent* composes across the others (read-only) for executives.

| Agent | Purpose | Data scope | Auto | Needs approval | Triggered by |
|---|---|---|---|---|---|
| Management | Cross-domain insight | Read-all (aggregates) | Explain, summarise, forecast | — | Chat; daily brief |
| Production (knitting) | Explain & improve output | Orders, WO, roll entries, OEE | Diagnose shortfall, suggest reschedule | Reprioritise WO; release order | Below-target alert; chat |
| Inventory | Stock health & replenishment | Yarn/greige/finished + at-vendor, ledger | Low-stock & shortage forecast | Create requisition; transfer | Reorder point; plan run |
| Job-work | Material out at dye/finish | Challans, jobwork ledger | Overdue-at-vendor detection, loss/gain trends | Chase / reconcile a challan | Return overdue; loss spike |
| Quality | Defect & shade trends, grading | Inspections, defects | 4-point Pareto, root-cause hypotheses | Open CAPA; hold a lot/shade | Reject spike; shade fail |
| Maintenance | Knit-machine uptime & PM | Machines, downtime, spares | PM-due, MTBF trends | Raise maintenance WO; order spare | Breakdown; PM schedule |
| Costing | Margin & variance per kg | Cost layers, cost sheets | Fabric cost build, variance analysis | Publish a cost/price | New quality; margin query |
| Sales/CRM | Customer conversations | Customers, quotes, orders | Draft replies (SUGGEST), status answers | Send message; create quote/order | WhatsApp inbound; follow-up |
| Purchase | Yarn procurement | Suppliers, PO, GRN | Compare quotes, flag delays | Create/approve PO | Requisition; shortage |
| Dispatch | Shipping readiness | FG stock, orders, dispatch | Readiness check, short detection | Create dispatch; allocate stock | Order due; FG threshold |
| Customer service | External (WhatsApp) | That customer's data only | Answer status, share catalogue | Any commitment (price, date) | Customer message |

> **Security restriction on every agent** — an agent's data scope is enforced by **the tools
> it is granted, not by prompt instructions**. The customer-service agent physically cannot
> read another customer's orders because it holds no tool that returns them. Prompts are not
> a security boundary; the tool registry is.

**Build order (Phase 2).** Don't build all ten at once. Customer-service already exists.
Build the daily shop-floor agents first, the composite one last:

1. **Production** — the most-asked question ("how much / why low")
2. **Inventory** — stock & shortage
3. **Job-work** — material at dye/finish, overdue, loss/gain
4. **Quality** — 4-point trends (rests on Phase 1 data)
5. **Maintenance** — uptime, PM
6. **Costing** — margin per kg
7. **Purchase** — yarn procurement
8. **Dispatch** — shipping readiness
9. **Management** — *last*, because it only composes across the agents above (read-only)

Each agent = its tools (read first, then gated writes) + runtime wiring + guardrail tests,
before moving to the next. The generalised **tool registry + agent runtime + approvals queue
+ AI action log** are built once, up front, then every agent plugs into them.

---

## 9. AI tool layer

The tool registry is the contract between model and business. Each tool is typed, permissioned,
and audited. Read tools return data; write tools return a *proposal*, never a mutation.

| Tool | Purpose | Input | Output | Permission | Approval |
|---|---|---|---|---|---|
| `get_production_summary` | Knit output vs target | date, machine/shift | totals, variance | Production+ | read |
| `get_order_status` | Where an order is | order id | stage, %, ETA | Sales/Prod | read |
| `get_inventory` | Stock (incl. at-vendor) | item, location | qty, value | Store+ | read |
| `get_machine_status` | Live/idle/down + OEE | machine | state, OEE | Prod/Maint | read |
| `get_jobwork_status` | Greige out vs returned, overdue | job-worker/challan | balance, ageing | Prod/Store | read |
| `get_fabric_quality` | 4-point/defect/shade report | range, quality | grade, defects | Quality+ | read |
| `get_costing` | Fabric cost / margin per kg | quality/order | breakdown | Costing/Mgmt | read |
| `create_purchase_requisition` | Propose a yarn buy | item, qty, need-by | draft PR | Purchase | approve |
| `create_work_order` | Release knitting | quality, qty | draft WO | Production | approve |
| `create_subcontract_challan` | Send greige to job-work | rolls, job-worker | draft challan | Prod/Store | approve |
| `raise_maintenance_wo` | Log a repair need | machine, issue | draft WO | Maintenance | approve |
| `open_capa` | Start corrective action | defect, lot | draft CAPA | Quality | approve |
| `draft_customer_reply` | Compose a WhatsApp answer | conversation | draft text | Sales | approve to send |

> **Proven pattern** — the current WhatsApp AI already runs on exactly this shape (a
> whitelisted `wa-tools` layer between model and DB, model choosing tools, never SQL). This
> section generalises it across the whole MES.

---

## 10. AI safety & approval architecture

One path for every state change, human or agent:

```
AI analyses → AI recommends (typed proposal) → Permission & validation check
→ Human approves (the right role) → System executes (same service) → Action logged (immutable)
```

| Class | Examples | Rule |
|---|---|---|
| **AUTO** (safe) | Reads; alerts; drafts; internal notes; SUGGEST-mode reply drafts | No mutation of stock/money/commitments. Execute and log. |
| **APPROVE** (human) | Purchase requisition, WO release, subcontract challan, maintenance WO, CAPA, sending a message, creating a quote/order, stock transfer | Agent proposes; the owning role approves; then it executes. |
| **NEVER** (off-limits) | Posting/editing a ledger or cost layer; deleting records; changing prices/credit limits directly; issuing an official invoice; altering permissions; moving money; changing security config | Structurally impossible — no tool exists. Human-only. |

**Why this split:** reads/drafts can't harm physical or financial state, so friction there
is pure cost. Anything that commits material, money, or a customer promise carries real
downside, so a human owns it. The truly irreversible never gets a tool at all.

---

## 11. AI chat experience

`user → intent detection → permission check → tool calls → MES data → analysis → grounded
answer` (with a cited proposal if action is implied).

- **Production** — "Why is today's knitting below target?" → summary + machine status +
  downtime → "IL-4 lost 90 min to a yarn-break stop at 11:00; two machines running under
  target RPM."
- **Inventory** — "Enough 30s yarn for the pending orders?" → inventory + recipe explode →
  "Short 140 kg. Want a purchase requisition?" (proposal → approve)
- **Job-work** — "What's stuck at the dye house?" → `get_jobwork_status` → "3 challans
  overdue >7 days; 1,240 kg greige out, 60 kg not yet returned on lot D-318."
- **Quality** — "What's driving rejects this week?" → 4-point Pareto → "62% of points are
  needle lines on greige from IL-1; shade rejections down."
- **Machines** — "Which machines are down?" → live list + reason/duration; offer a maintenance WO.
- **Orders** — "When will order 4471 ship?" → "Dyed, in finishing; ETA Thursday."
- **Costing** — "Cost per kg of this quality?" → yarn + knit + dye/finish charges + overhead;
  flag if margin below threshold.
- **Customer (WhatsApp)** — "Rate for 30s single jersey greige?" → CS agent drafts; human approves.
- **Management** — "How did we do this week?" → composed brief: knit output, OEE, job-work
  turnaround, reject %, dispatch, margin.

---

## 12. Management dashboards

Each role sees a scannable summary first — state encoded in colour and shape — with
drill-downs and an AI-insight strip that explains the *why*.

| Role | KPIs | Views & alerts | AI insight |
|---|---|---|---|
| Managing Director | Knit output, OEE, on-time %, reject %, at-vendor value, dispatch value, margin, cash | Sparkline wall; exceptions only; drill to any stage | "3 orders at risk; ₹8L greige overdue at dye house" |
| Production Manager | Plan vs actual by machine, OEE, greige WIP, downtime | Live machine boards; below-target alerts | Bottleneck & reschedule suggestions |
| Purchase | Open PO, overdue, yarn price trend, supplier OTIF | Shortage list; approvals queue | "Buy 30s now — shortage in 4 days" |
| Stores | Yarn/greige/finished value, at-vendor, low-stock, ageing | Reorder alerts; movement log | Ageing/obsolescence flags |
| Quality | Reject %, 4-point defect Pareto, shade pass, CAPA open | Trend charts; hold list | Root-cause hypotheses |
| Job-work | Greige out vs returned, overdue, loss/gain by vendor | Challan ageing board | "Dye house X: 4% avg loss, 2 overdue" |
| Maintenance | Uptime, MTBF/MTTR, PM compliance, spares | Breakdown feed; PM calendar | PM-due & failure-risk flags |
| Sales | Orders, pipeline, WhatsApp SLA, dues | Conversation inbox; follow-ups | Draft replies; dues nudges |
| Accounts | Receivables, payables, bank rec, GST readiness | Ageing; reconciliation board | Mismatch & overdue flags |
| Supervisor | Shift output, machine efficiency, live counters | Mobile machine board; entry screens | Under-performing machine alerts |

---

## 13. Real-time & IoT

Push, don't poll. A WebSocket layer fans events to whoever is watching; the ingest path is
written so a sensor and a human entry look identical downstream.

| Signal | Source | Path |
|---|---|---|
| Machine counters/RPM | ESP32 collectors [EXISTS] | Device → ingest API (device key) → live table → socket → dashboard |
| Machine up/down | Collector heartbeat | Freshness rule computes online/offline; drives OEE availability |
| Operator entries | Shop-floor tablet/PWA | Same ingest service → same live table → same socket |
| Notifications & AI alerts | Rules/agents | Notification service → in-app + WhatsApp |

> **IoT-ready by design** — keep **one ingest contract** (device-authenticated POST →
> validated reading → live state + ledger). New sensors (power meters, yarn-break detectors,
> a camera on the fabric inspection table) become a new *source* against the same contract,
> not a new pipeline. Buffer at the edge so a network blip never loses a count.

---

## 14. WhatsApp architecture

The customer's channel, wired to the same agents and tools. Inbound path already built and
verified — this generalises it.

```
Customer → WhatsApp → Cloud API → Webhook (HMAC) → Durable queue → CS agent + tools
→ Draft/answer → WhatsApp
```

| Concern | Approach |
|---|---|
| Authentication | HMAC-SHA256 over raw body vs App Secret; *fails closed* if unset. [EXISTS] |
| Customer identification | Match phone → partner; unknown numbers get a limited, no-PII scope |
| Conversation history | Stored, summarised into memory — but memory is *data, never authority* |
| Templates | Approved templates for business-initiated messages (order updates, dues) |
| Human handoff | Per-conversation mode OFF/SUGGEST/AUTO; sensitive topics escalate. [EXISTS] |
| Security & AI permission | CS agent holds only this-customer tools; any commitment needs approval |
| Idempotency | Message-id claim prevents double-processing; durable queue survives restart. [EXISTS] |

---

## 15. BUSY integration

An **integration layer**, not a coupling. The MES owns operations; BUSY stays the book of
record for official GST invoices, e-invoice, and e-way. Data crosses a boundary with
mapping, idempotency, and reconciliation — never a shared database.

| Concern | Design |
|---|---|
| Direction | MES → BUSY: production/finished goods, dispatch/stock. BUSY → MES (future): yarn purchases. Official invoice/e-way generated in BUSY (Webtel/Pinnacle GSP). |
| Mechanism | Shift-level CSV/export now (proven); versioned adapter so a future BUSY API is a swap |
| Mapping | Explicit item/ledger/party maps; no guessing by name |
| Duplicate prevention | Roll/document-level export tracking; a unit exports at most once. [EXISTS] |
| Error handling & retry | Batch status EXPORTED → CONFIRMED → VOIDED; a failed import voids and releases for re-send |
| Reconciliation | Periodic MES-vs-BUSY quantity/value check; surface mismatches, don't auto-correct |
| Audit trail | Every batch, its rows, and its confirmation recorded immutably |

---

## 16. Security

| Layer | Control |
|---|---|
| Authentication | JWT, rate-limited login + supervisor PIN; per-instance secrets so tokens never cross tenants. [EXISTS] |
| RBAC | Role ladder with explicit opt-in (`requireRole(min,{also})`); read-only AUDITOR & scoped QC roles. [EXISTS] |
| Department/plant scope | Row-level scoping keys for multi-unit growth. [EXTEND] |
| API security | Global auth gate with explicit public allow-list; a new route is protected on mount. [EXISTS] |
| AI permissions | Tools carry permissions; agents can't exceed their toolset; writes need approval (§10) |
| Audit logs | Immutable audit + AI-action + approval logs |
| Encryption & secrets | TLS via tunnel; secrets in `.env` only, never in code/git; secrets-manager later. [EXTEND] |
| Backups | Daily+hourly, retained, off-box, restore-tested. [EXISTS] |
| Data isolation | Separate DB per tenant/company; distinct JWT secrets. [EXISTS] |
| File & session | Signed, scoped file access; expiring sessions; forced re-auth on sensitive actions |

---

## 17. Deployment

On-prem first, cloud-portable. `Development → Testing → Staging → Production`.

| Concern | Recommendation |
|---|---|
| Server | Tower/rack with Xeon, ECC RAM, SSD in RAID 1, redundant PSU (e.g. Dell T160). One app per server for isolation. |
| OS | Windows Server or Linux; services auto-start on boot. [EXISTS] (node-windows) |
| Containers | Optional now (single box); adopt Docker/Compose at staging for deterministic promotion |
| Database | PostgreSQL 18, tuned, on SSD array; nightly + hourly dumps off-box |
| Reverse proxy/access | Cloudflare Tunnel per app + Access PIN gate; own domain per tenant. [EXISTS] |
| Monitoring | Health/readiness endpoints + metrics; add Grafana at maturity |
| Disaster recovery | Documented restore drill; keep old box as warm spare during migration; RPO ≈ 1h, RTO < 1 day |

---

## 18. AI model strategy

Never one provider. A **model gateway** maps each *task class* to a model, with fallback.

| Task class | Model tier | Why |
|---|---|---|
| Intent routing, short Q&A, drafts | Fast/cheap (Groq-hosted small, Haiku-class) | High volume, latency-sensitive; cost dominates |
| Complex analysis, planning, multi-tool reasoning | Frontier reasoning (Claude Opus/Sonnet-class, GPT-class) | Correctness & tool-use reliability |
| Vision — fabric defect images, shade, inspection-table camera | Vision model (Claude/Gemini vision, NVIDIA-hosted) | Fabric defect detection & shade grading |
| Bulk/offline (summaries, embeddings) | Cheapest capable / local | Throughput over latency; can run on-prem |

- **Abstraction:** one `callModel(task, messages, tools)` surface; provider chosen by
  task-class config. Current system already runs multi-provider (Groq primary, NVIDIA
  fallback) — generalise it.
- **Resilience:** automatic fallback on error/rate-limit; per-provider budget caps.
- **Cost control:** route by task, cache aggressively, cap tokens, log spend per agent (§23).
- **Portability:** keep prompts and tools provider-neutral so a new model is a config line.

---

## 19. Implementation phases

| Phase | Focus | Key deliverables | Complexity |
|---|---|---|---|
| **0 — Consolidate** | Harden the existing fabric core | Finish go-live (WhatsApp secrets, opening stock); freeze schema conventions; document the tool-layer pattern | Low |
| **1 — Fabric quality & grading** | The margin lever | Greige inspection; finished 4-point inspection + grading (A/B); shade approval; defect taxonomy & Pareto; reject/rework/CAPA | Med-High |
| **2 — AI agent fleet** | The AI-native headline | Tool registry generalised; agent runtime; approvals queue; AI action log; production/inventory/quality/job-work/maintenance agents on existing fabric tools | High |
| **3 — Planning & job-work depth** | Yarn MRP + vendor control | MRP-lite (yarn requirement); knit scheduling; job-work reconciliation (out vs in, loss/gain, ageing, at-vendor valuation) | Med-High |
| **4 — Dashboards & real-time** | Role dashboards + live boards | MD/role dashboards; live machine boards; AI-insight strips | Medium |
| **5 — Advanced AI (vision)** ⏸️ | Automated fabric inspection | Vision defect detection on the inspection table; shade grading assist; management brief; forecasting | High |
| **6 — IoT & predictive** ⏸️ | Sensors + prediction | Expanded sensor ingest (power, yarn-break); predictive maintenance; demand/defect prediction | High |

> **⏸️ Phases 5 & 6 are SUSPENDED (2026-08) — awaiting hardware.** Vision inspection needs a
> camera on the inspection table and labelled defect images; IoT needs sensors. Active scope
> is **Phases 0–4**. These resume once the hardware is procured; nothing else depends on them.

Each phase is *shippable* and rests on tested lower layers. Data model precedes services
precede UI precede agents — an agent is only ever built on tools that already have tests.

---

## 20. Claude Code development methodology

```
Requirements & slice definition (one module at a time)
  ↓ Data model + migration (idempotent ensure-schema)
  ↓ Repository → Service → Controller → Route (the proven layering)
  ↓ Tests alongside (unit for money/logic, e2e for the flow)
  ↓ Frontend screen
  ↓ Governed tools for the module (read first, then gated writes)
  ↓ Agent wiring + approval path
  ↓ Docs + HANDOFF update + commit
```

| Discipline | Practice |
|---|---|
| Build order | Schema → repo → service → controller → route → UI → tools → agent. Never an agent before its tools; never a tool before its service. |
| Don't break the past | Additive migrations only; run the full suite after each significant change; pre-commit test gate blocks regressions |
| Migrations | Idempotent `ensure*` schema at boot + a versioned migration log; additive, reversible where possible |
| Self-review | Re-read the diff for reuse/simplification; check dependencies before large changes; explain architectural changes before making them |
| Git | Logical commits, one concern each; local-first; secrets never committed |
| Errors | Typed exceptions; central error handler; fail closed on anything security-sensitive |
| Docs | Living HANDOFF (next task, known bugs), a project-state snapshot, generated API docs kept current |

---

## 21. Project structure

| Path | Responsibility |
|---|---|
| `backend/src/routes/` | HTTP surface; wiring & guards only — no business logic |
| `backend/src/controllers/` | Request/response shaping; delegates to services |
| `backend/src/services/` | Business logic & transactions — the one place rules live |
| `backend/src/repositories/` | All SQL; the only layer that touches the database |
| `backend/src/db/schema.js` | Idempotent self-healing schema + migration log |
| `backend/src/ai/gateway/` | Provider-abstracted model calls; task-class routing |
| `backend/src/ai/tools/` | The governed tool registry (typed, permissioned, audited) |
| `backend/src/ai/agents/` | Role-scoped agents + runtime + guardrails |
| `backend/src/middleware/` | Auth gate, RBAC, webhook verification, rate limits |
| `backend/src/lib/` | Cross-cutting: costing, backups, notifications, integrations |
| `backend/tests/` | Unit (money/logic) + e2e (flows) + AI-tool/agent tests |
| `frontend/src/pages/` | One screen per module; role-gated nav |
| `frontend/src/components/` | Reused UI (tables, entry forms, dashboards) |
| `docs/` | Architecture, data flow, module specs, risk & safety, roadmap |
| Root ops | Service install/start/restart, migration & access helpers, HANDOFF & project-state |

---

## 22. Testing strategy

| Level | Covers | Gate |
|---|---|---|
| Unit | Money math (GST, payroll, costing per kg), pure logic (FIFO, recipe explode, process loss/gain, 4-point scoring) | Must pass before any commit |
| Integration | Service + repository against a real DB with seeded data & teardown | Per module |
| API | Every endpoint: auth required, role enforced, contract honoured | Per module |
| Frontend | Critical entry flows render & submit; error states show | Per screen |
| End-to-end | A full flow (order → knit → job-work out/in → 4-point → dispatch) | Per phase |
| Security/permission | Every role against every route; unauthenticated probes refused; auditor read-only | Per phase |
| AI tool | Each tool validates input, enforces permission, returns typed output | Per tool |
| AI agent | Guardrails hold (no injection-set prices, no cross-customer reads); write tools produce proposals; escalation fires | Per agent |
| Load | Concurrent shop-floor entries & dashboard sockets at peak shift | Before go-live |
| Failure | Network loss (edge buffering), provider outage (fallback), restart (durable queue) | Before go-live |

**Phase-complete:** its modules' unit + integration + API + permission tests pass, its e2e
flow is green, and the pre-commit gate runs the whole suite clean.

---

## 23. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Poor data modelling | Model entities before code; ledger-immutability; review schema per phase against real documents |
| AI hallucination | Answers grounded only in tool output; cite sources; memory can't establish facts; low-confidence blocks AUTO |
| Unauthorised AI action | No tool = no capability; writes are proposals; NEVER-class actions have no tool at all |
| Inventory inconsistency | Single stock ledger as truth (incl. at-vendor); screens are views; reversing entries not edits |
| Job-work leakage | Challan out/in reconciled; process loss/gain measured; overdue-at-vendor flagged; WIP value visible |
| Accounting sync errors | Idempotent export, explicit mapping, periodic reconciliation, void-and-resend |
| Poor shop-floor usability | Big-touch mobile entry, minimal fields, offline-tolerant PWA, operator testing early |
| Database performance | Indexes on ledger keys, materialised summaries for dashboards, archive cold data |
| Vendor/API dependency | Provider-abstracted gateway with fallback; BUSY behind an adapter; own the data |
| Network failure | Edge buffering for counters; durable queue; retries with backoff |
| Backup failure | Daily+hourly, off-box, and *restore-tested* — an untested backup is a rumour |
| Excessive AI cost | Task-based model routing, caching, token caps, per-agent budget + spend logging, rate limits |
| Change management | Phase-by-phase rollout, run beside existing process, train per role |

---

## 24. MVP recommendation & future roadmap

### MVP — deepen quality & the AI layer on the proven fabric core

**There is no missing manufacturing lifecycle** — the fabric flow (yarn → knit → job-work
dye/finish → dispatch) already runs. So the MVP is not a new stage; it is the two things
that add the most value on top of what exists:

1. **Fabric quality & grading (Phase 1)** — a proper greige + finished **4-point inspection
   and A/B grading** system with shade approval and defect Pareto. For a fabric mill this is
   the direct margin lever: it decides what can be sold as A-grade, catches recurring machine
   faults, and gives the AI real quality data to reason over.
2. **AI agent fleet (Phase 2)** — the "AI-native" headline you asked for: production,
   inventory, **job-work**, quality, and maintenance agents on the existing fabric tools,
   with the approval-first safety model.

- **MVP reuses** — auth, RBAC, inventory ledger, knitting, subcontract challans, procurement,
  sales/CRM, WhatsApp AI, BUSY export, backups, services (all already running).
- **MVP defers** — vision inspection, expanded IoT, and predictive analytics to later phases,
  once the structured quality data exists to train and reason over.

### Future roadmap

```
Consolidate → Fabric quality & grading (4-point) → AI agent fleet
→ Planning & job-work depth → Dashboards & real-time     ← active scope
------------------------------------------------------------------------
⏸️ SUSPENDED (awaiting hardware): Advanced AI (vision) → IoT & predictive
```

> **Recommendation** — approve this blueprint, then commission **Phase 0 (consolidate)** and
> **Phase 1 (fabric 4-point quality & grading)** as the first work order, with the **AI agent
> fleet (Phase 2)** immediately after. Build data model first, tools and agents last, tests
> throughout — and never let an agent act through a path a human couldn't audit.

---

*Planning document. No code has been written. Business is a knitted-fabric manufacturer
(in-house knitting; job-work dyeing & finishing; sells greige and finished fabric).
Grounded in the running DHOWN MES, which already implements this lifecycle; the work is the
AI agent layer, fabric quality/grading, and job-work depth — not a new manufacturing flow.*
