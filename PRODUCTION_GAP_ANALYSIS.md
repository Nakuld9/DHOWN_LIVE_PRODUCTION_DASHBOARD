# Production Gap Analysis — DHOWN MES

**Date:** 2026-08-06 · **Reviewer role:** Chief Enterprise Software Architect (production sign-off)
**Verdict at time of review:** ⛔ NOT APPROVED.
**Status 2026-08-07: every Critical and every High item is CLOSED.** A third Critical
(/api/reports unauthenticated) was found later and closed in `9dd7339` — see addendum 11.
What remains is 40 Medium and 18 Low items, a managed backlog.

Evidence was gathered by querying the live database and probing the running server,
not by reading intentions. Where a finding could be a false positive from static
analysis, it was confirmed empirically and that is noted.

**System size:** 118 tables · 475 routes across 60 route files · 200 backend modules ·
62 frontend pages · 286 automated tests · `server.js` 851 lines.

---

## ⛔ CRITICAL — blocks production sign-off

### C-1. Business data is readable with no authentication
**Confirmed by live probe, not static analysis.** These return real data to an
unauthenticated request on port 4000:

| Endpoint | What leaks |
|---|---|
| `/api/costing/rates` | Yarn purchase prices, labour cost/shift, machine depreciation |
| `/api/costing/summary` | Cost structure |
| `/api/tax-invoices` | Customer invoices, GSTINs, amounts |
| `/api/sales-orders` | Customer orders and pricing |
| `/api/purchase-orders` | Supplier orders and prices |
| `/api/operators`, `/api/attendance` | Employee names, codes, departments — **PII** |
| `/api/settings` | Company configuration |
| `/api/machines`, `/api/rolls`, `/api/batches`, `/api/downtime`, `/api/live-data`, `/api/assignments` | Full production data |

Verified payload sample: `/api/costing/rates` → `"yarn_type":"Cotton 40s","price_per_kg":"180.00","labour_per_shift":"800.00"`.

This is the entire commercial cost base of the business, plus employee PII,
available to anyone who can reach the host — every device on the factory LAN, and
anything past the Cloudflare tunnel that is not covered by the PIN gate.

`/api/public/tenant` and `/api/public/*` are intentionally open and are **not** part
of this finding.

**Fix:** apply `router.use(verifyToken)` to each affected router, then re-run the
probe. Roughly a one-line change per file; the risk is in *finding* them all, which
the probe now does.

### C-2. Disaster recovery is unproven
Backups run nightly with 7-day retention and an off-machine copy, and retention was
deliberately scheduled an hour *after* the backup. But:

- **No restore has ever been performed or documented.** A dump nobody has restored
  is a hypothesis, not a backup.
- No runbook, no documented RPO/RTO, no restore rehearsal.

The business now keeps receivables, credit notes and statutory e-way records in this
database. An unverified restore path is not acceptable at that point.

**Fix:** restore the latest dump into a scratch database, run `npm run test:all`
against it, and write down the steps and elapsed time. Half a day.

---

## 1. Database

**Measured:** 118 tables · 85 FKs · 49 UNIQUE · **15 CHECK** · 0 tables without a primary key.

| Finding | Severity | Detail |
|---|---|---|
| ~~No migration mechanism~~ **CLOSED (addendum 5)** | High | No `schema_migrations`/knex/flyway table. Schema is applied by ~17 idempotent `ensure*()` functions at boot. That has served well (it upgraded VD Knits 71→117 tables cleanly) but there is **no version record, no rollback, and no way to know which server has which schema**. Legacy `migration_*.js` scripts exist but are ad-hoc and unversioned. |
| ~~Core financial tables have zero foreign keys~~ **CLOSED (addendum 4)** | High | `tax_invoices`, `payments`, `sales_returns`, `lot_allocations` → **0 FKs each**. `partner_id`, `invoice_id` are plain integers. Nothing prevents a payment pointing at a deleted customer or a non-existent invoice. Partly introduced by the Phase 2 work. |
| ~~53 FK columns without an index~~ **CLOSED (addendum 6)** | High | Every parent update/delete scans the child. Worst offenders: `stock_ledger`, `dispatch_items`, `items.category_id/uom_id/hsn_id`, `credit_note_allocations.note_id`, `lot_allocation_rolls.allocation_id`. |
| ~~**No soft delete anywhere**~~ **CLOSED (addendum 13)** | Medium | 0 of 118 tables have `deleted_at`/`is_deleted`. Some use `status`/`is_active`, inconsistently. A mis-clicked delete on a partner or item is unrecoverable except from a nightly dump. |
| ~~**Only 15 CHECK constraints**~~ **CLOSED (addendum 15)** | Medium | Domain rules (positive quantities, valid status values, non-negative money) live almost entirely in JavaScript. A direct SQL fix or a future service can violate them silently. |
| ~~**39 tables with no timestamp column**~~ **CLOSED (addendum 18)** | Medium | Includes `machines`, `oee_records`, `finishing_records`, `dispatch_items`. "When did this change?" is unanswerable for them. |
| Money precision | ✅ | **No gaps found.** Zero float/double money columns — all `NUMERIC`. |
| Primary keys | ✅ | **No gaps found.** All 118 tables have one. |
| Duplicate tables | ✅ | **No gaps found.** No redundant/overlapping tables identified. |

---

## 2. Backend

**Measured:** 475 routes · 232 mutating · 60 route files.

| Finding | Severity | Detail |
|---|---|---|
| ~~33 mutating endpoints with no role check~~ **CLOSED (addendum 3)** | High | Includes `POST /users`, `PUT /users/:id`, `PUT /settings`, `PUT /grn/:id/approve`, `DELETE /operators/:id`, `POST /data-collectors`, `DELETE /fabric-types/:code`. Any authenticated user — including an OPERATOR — can create users, change company settings and approve goods receipts. (`/auth/login`, `/auth/logout`, `/live-data` ingest are correctly excluded.) |
| **Inconsistent response envelopes** | Medium | Some endpoints return `{data:[...], total:n}`, others a bare array. The frontend compensates with `d.data \|\| d.partners \|\| (Array.isArray(d) ? d : [])` — a pattern repeated across pages that hides failures (see UI-1). |
| Missing validation | Medium | No schema validation layer (zod/joi). Validation is hand-rolled per handler; newer modules (payments, returns, logistics) validate well, older CRUD routes largely trust the body. |
| Transactions | ✅ | **No gaps found** in the money paths. Payments, returns, allocation and quarantine all use `BEGIN`/`COMMIT` with advisory locks. No multi-write lib module lacks a transaction. |
| ~~Error handling~~ **CLOSED (addendum 22)** | Low | 3 route files have no `try/catch`; the rest are consistent. |
| Retries | ✅ | **No gaps found.** Durable Postgres queue with exponential backoff, dead-letter and stuck-row recovery. |
| Logging | ✅ | **No gaps found.** Structured `observability.js` + audit middleware on every mutating request. |
| **Caching** | Low | None beyond the 60s company-identity cache. Not currently a problem at this load; noted for completeness. |

---

## 3. AI

**Measured:** 20 tools defined, whitelist dispatch enforced (`Unknown tool` rejection).

| Finding | Severity | Detail |
|---|---|---|
| ~~No evaluation harness~~ **CLOSED (addendum 7)** | High | No regression tests for prompts or tool selection. Any prompt edit, model change or fallback switch is shipped blind. The system already silently moved to the Groq fallback when NVIDIA died — nothing measures whether answer quality changed. |
| ~~**No confidence scoring**~~ **CLOSED (addendum 18)** | Medium | The orchestrator cannot say "I am unsure"; every answer is delivered with equal weight. Combined with AUTO mode this is how a wrong answer reaches a customer unflagged. |
| Function permissions | ✅ | **No gaps found.** Whitelist enforced at dispatch. The 4 write-capable tools (`create_draft_quote`, `create_draft_sales_order`, `create_lead`, `create_followup`) are correctly **absent** from `AUTO_SAFE`, so they cannot fire without a human. |
| Prompt injection | ✅ | **No gaps found** at the design level. Customer text, image-derived text and conversation memory are all explicitly labelled as data, and both system prompts state that memory cannot establish price/stock/commitment. |
| Hallucination control | ✅ | **No gaps found.** Answers are constrained to TOOL RESULTS; absent figures must be deferred to the sales team. |
| Conversation memory | ✅ | **No gaps found.** Three-layer (facts → summary → recent turns), bounded, excludes the message being answered. |
| Fallback logic | ✅ | **No gaps found.** NVIDIA → Groq, exercised in production today. |
| ~~Unused tools~~ **N/A — all 22 dispatched; usage now on AI Performance** | Low | `get_last_sale_price`, `get_customer_price`, `search_products`, `send_document`, `request_price_approval` are defined but rarely selected — worth reviewing rather than removing. |

---

## 4. WhatsApp

| Finding | Severity | Detail |
|---|---|---|
| Reactions / interactive messages unhandled | Low | Inbound reactions and button/list replies are ignored. Not used in the current flow. |
| Webhook handlers | ✅ | **No gaps found.** `messages` + `statuses` + `errors` all handled. |
| Delivery tracking | ✅ | **No gaps found.** sent/delivered/read/failed, ordering-safe (a late `sent` cannot downgrade `read`), failures raise a follow-up. |
| Media | ✅ | **No gaps found.** Inbound download + vision description, outbound send. |
| Retry | ✅ | **No gaps found.** Durable queue, backoff, DLQ, stuck recovery, idempotency claim table. |
| 24h window | ✅ | **No gaps found.** Enforced server-side; the client cannot decide a send is legal. |

**Blocked externally, not a code gap:** customer-facing AUTO requires the Meta app to
be Published with a permanent System User token.

---

## 5. CRM

| Finding | Severity | Detail |
|---|---|---|
| ~~Complaint workflow missing~~ **CLOSED (addendum 16)** | Medium | `ESCALATE` regex detects complaints and routes to a human, but there is no complaint record, owner, SLA or resolution trail. |
| Sample-request flow missing | Low | Named in the original spec, never built. |
| Lead stages | ✅ | **No gaps found.** Pipeline with stages, scoring, drag-and-drop. |
| Approval flows | ✅ | **No gaps found.** Value-banded matrix; credit decisions correctly routed to the CREDIT band rather than the order-value band. |
| Automations | ✅ | **No gaps found.** Auto follow-up on no-response, SEND_FAILED follow-ups, consent-aware sending. |

---

## 6. Manufacturing

| Finding | Severity | Detail |
|---|---|---|
| ~~**Quality gate is advisory**~~ **CLOSED (addendum 18)** | Medium | Grade is recorded per roll and quarantine blocks allocation, but nothing prevents dispatching a roll that failed inspection if it was never quarantined. QC and dispatch are linked by convention, not by a constraint. |
| ~~UoM conversion not wired into orders~~ **CLOSED (addendum 21)** | Medium | `uom.js` exists and is correct, but sales orders and invoices still assume kg. A customer ordering in metres is converted by hand. |
| Production workflow | ✅ | **No gaps found.** Roll → batch → dye → finishing → FG → dispatch, with counter-based production capture. |
| Inventory workflow | ✅ | **No gaps found.** GRN → issue → WIP → FG → dispatch, with a stock ledger and reservations. |
| Costing workflow | ✅ | **No gaps found.** FIFO yarn + knitting cost chain live on GRN/issue/roll approval. |
| Dispatch workflow | ✅ | **No gaps found.** Challan → e-way → POD → returns, closed loop. |

---

## 7. UI

| Finding | Severity | Detail |
|---|---|---|
| ~~UI-1. Older pages are unverified~~ **CLOSED (addendum 8)** | High | The last frontend score was 34/100 (June) and was never re-audited. On 2026-08-06, three pages — **PurchaseOrders, SalesOrders, TaxInvoices** — were found to have silently-empty partner dropdowns from a wrong API path, discovered *by accident*. The `d.data \|\| d.partners \|\| []` fallback pattern means a 200-with-HTML failure renders as an empty list with no error. Assume more of this class exists. |
| ~~`/batching` unreachable from navigation~~ **CLOSED (addendum 18)** | Medium | The page is routed and functional but has no sidebar entry — reachable only by typing the URL. |
| ~~QualityInspectionReport.jsx dead code~~ **CLOSED (addendum 22)** | Low | Exists, nothing routes to it. |
| 22 pages with no loading state | Low | Blank flash on slow queries. |
| ~~backend error safety net~~ **CLOSED (addendum 22)** | Low | `Reports`, `VendorStock`, `YarnStore`. |
| Mobile | ✅ | **No gaps found** for the intended scope. Viewport meta present, mobile CSS active, 3 purpose-built mobile routes (`/m/qc`, `/m/pod`, `/m/roll/:id`). The desk pages are not phone-optimised by design. |
| Exports | ✅ | **No gaps found.** Every page has an export or print path. |

---

## 8. Security

| Finding | Severity | Detail |
|---|---|---|
| ~~**Unauthenticated business endpoints**~~ **CLOSED (C-1, commit 4045549)** | **Critical** | Also see addendum 11 — a second unguarded router, /api/reports, was found later and closed in 9dd7339. |
| ~~33 mutating endpoints without RBAC~~ **CLOSED (addendum 3)** | High | See §2. |
| **Secrets in plaintext `.env`** | Medium | Two `.env` files hold DB password, JWT secret, WhatsApp and AI keys. No secrets manager, no rotation policy. Mitigated by single-host deployment and gitignore. |
| ~~Rate limiter IPv6 bypass~~ **CLOSED (addendum 10)** | Low | `keyGenerator: req.user?.username \|\| req.ip` — raw `req.ip` lets an IPv6 client rotate within its /64. Low impact: the fallback only applies to unauthenticated callers and the limiter guards an authenticated route. Warning printed at every boot. |
| No 2FA | Low | Single-factor login. Acceptable for a LAN-scoped factory system; note it if the tunnel is widened. |
| Encryption at rest | Low | None at the database level. |
| Audit logging | ✅ | **No gaps found.** Every mutating `/api` request logged with real username; 730-day retention. |
| Password handling | ✅ | **No gaps found.** No default password in source; admin seed randomised. |

---

## 9. Performance

| Finding | Severity | Detail |
|---|---|---|
| ~~53 unindexed foreign keys~~ **CLOSED (addendum 6)** | High | See §1. The concrete risk is parent deletes and joins on `stock_ledger` and `dispatch_items`. |
| ~~**Never load-tested**~~ CLOSED (addendum 9) | High | No evidence of any load or soak test. Scalability is *unmeasured*, not *proven*. Single Windows host, single Postgres, no connection-pool tuning. |
| N+1 patterns | Medium | `returns.approve()` and `lot-allocation.plan()` query per line/lot in a loop. Correct and transactional, but linear in line count. Fine at current volumes. |
| Retention | ✅ | **No gaps found.** Nightly, scoped to append-only logs, batched deletes, financial tables excluded by design. |
| Memory leaks | ✅ | **No gaps found** identified. Schedulers use bounded intervals; no unbounded in-memory accumulation observed. |

---

## 10. Production readiness

| Finding | Severity | Detail |
|---|---|---|
| ~~**Restore never tested**~~ **CLOSED (C-2)** | **Critical** | Rehearsed into a scratch DB; docs/DISASTER_RECOVERY.md. |
| ~~No runbook / DR document~~ **CLOSED — docs/DISASTER_RECOVERY.md** | High | No documented recovery procedure, RPO/RTO, escalation path or "what to do when the collector stops" guide. |
| ~~**No API documentation**~~ **CLOSED (addendum 17)** | Medium | 475 endpoints, no OpenAPI/Swagger. Onboarding or integration means reading route files. |
| ~~Single point of failure~~ **ACCEPTED & DOCUMENTED (addendum 20)** | Medium | One Windows host runs both instances, Postgres, and the DC ingest. No HA, no failover. A documented accepted risk at this scale — but it should be *documented* as accepted. |
| Monitoring | ✅ | **No gaps found** for scale. Health endpoint, `health-watch`, structured metrics, alert delivery with a fallback recipient. |
| Health checks | ✅ | **No gaps found.** |
| Backups | ✅ (taking) / ⛔ (restoring) | Nightly + 7-day retention + off-machine copy. Restore unproven — see C-2. |
| CI/CD | ✅ | **No gaps found** for this workflow. Pre-commit gate runs 286 tests and is proven to block a real regression. Deployment is manual file copy — acceptable for two instances on one host. |
| ~~Documentation~~ **CLOSED (addendum 20)** | Medium | 4 design docs + `PROJECT_AUDIT.md`/`PROJECT_STATE.md`/`HANDOFF.md`. Missing: runbook, DR, API reference, user manual. |

---

# Final register

## A. Missing screens
| Item | Severity |
|---|---|
| ~~Complaint / customer-issue workflow screen~~ **CLOSED (addendum 16)** | Medium |
| ~~Sidebar entry for `/batching`~~ **CLOSED (addendum 18)** | Medium |
| ~~Credit-note detail/print view~~ **CLOSED (addendum 17)** | Medium |
| ~~Bank reconciliation screen~~ **CLOSED (addendum 12)** | Medium |
| Sample-request tracking | Low |
| ~~Remove dead QualityInspectionReport.jsx~~ **CLOSED (addendum 22)** | Low |

## B. Missing reports
| Item | Severity |
|---|---|
| ~~Customer statement of account (PDF)~~ **CLOSED (addendum 11)** | High |
| ~~GST return-ready summary (GSTR-1 style)~~ **CLOSED (addendum 11)** | High |
| ~~Debtors ageing PDF/Excel export~~ **CLOSED (addendum 17)** | Medium |
| ~~Stock valuation as at a date~~ **CLOSED (addendum 19)** | Medium |
| Shade-lot traceability certificate for a dispatch | Low |

## C. Missing dashboards
| Item | Severity |
|---|---|
| ~~Financial dashboard (receivables, collections, credit exposure)~~ **CLOSED (addendum 11)** | High |
| ~~Compliance dashboard~~ **CLOSED (addendum 17)** | Medium |
| ~~AI performance dashboard~~ **CLOSED (addendum 20)** | Medium |

## D. Missing APIs
| Item | Severity |
|---|---|
| ~~Auth guards on the 14 open endpoints~~ **CLOSED (C-1)** | **Critical** |
| ~~Role guards on 33 mutating endpoints~~ **CLOSED** | High |
| ~~Bank reconciliation endpoints~~ **CLOSED (addendum 12)** | Medium |
| ~~OpenAPI specification~~ **CLOSED (addendum 17)** | Medium |
| ~~UoM conversion wired into sales-order/invoice creation~~ **CLOSED (addendum 21)** | Medium |

## E. Missing AI tools
| Item | Severity |
|---|---|
| ~~AI evaluation harness~~ **CLOSED (addendum 7)** | High |
| ~~`get_payment_status` tool~~ **CLOSED (addendum 17)** | Medium |
| ~~Confidence scoring on every answer~~ **CLOSED (addendum 18)** | Medium |
| ~~`log_complaint` tool~~ **CLOSED (addendum 16)** | Medium |

## F. Missing roles
| Item | Severity |
|---|---|
| ~~**SALES role**~~ **CLOSED (addendum 11)** | High |
| ~~ACCOUNTS role~~ **CLOSED (addendum 14)** | Medium |
| ~~QC role (inspection currently under SUPERVISOR)~~ **CLOSED (addendum 19)** | Low |
| ~~Read-only AUDITOR role~~ **CLOSED (addendum 19)** | Low |

## G. Missing background jobs
✅ **No gaps found.** All eight expected jobs are registered and running: daily backup,
retention, machine alerts, low stock, shift summary, WhatsApp queue worker, follow-up
scanner, health watch.

## H. Missing database tables
| Item | Severity |
|---|---|
| ~~`schema_migrations` — version tracking~~ **CLOSED (addendum 5)** | High |
| ~~`complaints` / `customer_issues`~~ **CLOSED (addendum 16)** | Medium |
| ~~`bank_transactions` + reconciliation link~~ **CLOSED (addendum 12)** | Medium |
| ~~Soft-delete columns across master tables~~ **CLOSED (addendum 13)** | Medium |

## I. Missing settings pages
| Item | Severity |
|---|---|
| ~~Approval-matrix editor~~ **CLOSED (addendum 19)** | Medium |
| ~~Retention-policy viewer~~ **CLOSED (addendum 18)** | Medium |
| ~~Credit-limit / payment-terms bulk management~~ **CLOSED (addendum 20)** | Medium |
| Tenant/branding settings surfaced in the UI | Low |

## J. Missing integrations
| Item | Severity |
|---|---|
| **NIC e-way bill portal** — numbers are typed by hand | Medium |
| GST portal / GSTR filing export | Medium |
| ~~Bank statement import~~ **CLOSED (addendum 12)** | Medium |
| Tally / Busy accounting sync (planned, CSV only) | Medium |
| E-invoice IRN (mandatory above the turnover threshold — **check applicability**) | Medium → Critical if applicable |
| NVIDIA AI endpoint is dead — **cost measured at 38s/call and mitigated with a circuit breaker (addendum 7)**; still worth fixing the key or dropping the integration | Low |

---

# Sign-off position

**Do not approve until C-1 and C-2 are closed.** Both are small pieces of work —
adding `verifyToken` to a handful of routers, and performing one restore rehearsal.
Neither requires new features.

After those two, the system is defensible for production at this scale, with the High
items as a 2–4 week backlog. The engineering foundation is genuinely strong: money
paths are transactional and tested, the audit trail is complete, retention is
conservative, and 286 automated tests gate every commit.

The recurring theme across all ten areas is not missing functionality — it is
**unverified assumptions**: endpoints assumed guarded, backups assumed restorable,
frontends assumed working, capacity assumed sufficient. Every genuine defect found
today was found by *probing the running system* rather than reading the code.


---

# Addendum — 2026-08-06: both Critical items closed

## C-1 closed (commit 4045549)
All fourteen endpoints now return 401 unauthenticated and 200 with a session,
verified by re-running the probe that found them. The guard is applied at router
level so routes added later are protected by default.

Collector ingest was deliberately excluded: `POST /api/live-data` stays on its API
key because collectors hold no JWT, so a router-level guard would have silently
stopped production capture. Verified — 200 with the key, 401 without.

The report's claim that 58 frontend calls would break was **wrong**.
`src/utils/authFetch.js` already installs a global fetch interceptor attaching the
token to every /api request, so pages that set no headers were always covered. I
had begun writing a second interceptor before finding it — the same near-duplication
is how the original gap survived review in the first place.

## C-2 closed (this commit)
First restore rehearsal performed and documented in `docs/DISASTER_RECOVERY.md`.
Dump 1s, restore 3s, exit 0, zero warnings. 118 tables, 2 views, 85 FKs and 243
indexes restored; row counts matched on every key table; sequences ahead of max id;
the restored database accepts writes; and **the full 286-test suite passed against
it**, which is what separates a restored file from a working system.

Measured RTO < 15 minutes. **RPO remains up to 24 hours** — backups are nightly and
a 01:00 failure loses a day. The dump costs one second, so raising the frequency is
cheap if that exposure is unacceptable.

## Sign-off position now
The two blocking items are closed and verified. The High items in the register
remain open as a 2–4 week backlog — most notably 33 mutating endpoints without a
role check, no schema migration mechanism, and no AI evaluation harness.

---

# Addendum 2 — 2026-08-06: RPO closed, TV dashboard credentialed

Both taken on after the Critical items, at the reviewer's discretion.

## Recovery point: 24 hours → ~1 hour (commit c2842c5)

Hourly dumps kept 48h alongside the nightly kept 7 days. A dump costs about a
second here, so the fix for a 24-hour exposure was simply to take more of them.

**Two backup bugs surfaced while doing it, both invisible from the UI:**

1. **The nightly job and the admin screen used different directories.**
   `BACKUP_DIR` was `path.join(__dirname, 'backups')` and `__dirname` there is
   `src/lib`, so nightly dumps landed in `backend/src/lib/backups` while the admin
   screen listed `backend/backups`. The UI showed backups ending 16 July while the
   real ones accumulated where nobody looked — anyone checking would have concluded
   backups had stopped, or restored a three-week-old dump.

2. **Retention had therefore never run.** It swept the wrong directory, so July
   files sat in `backend/backups` indefinitely. They pruned on the first corrected
   run.

Filenames now carry the database name so a second firm cannot write Dhown-named
dumps — chosen deliberately over a new prefix so existing files still match the
retention sweep rather than becoming immortal.

**Cross-tenant leftovers found:** VD Knits' backup folder held two of Dhown's July
dumps, inherited when the fork copied Dhown's tree. VD Knits' sweep would never
have matched them, and Dhown's own sweep had just removed its copies — so these
may have been the last ones. Moved to `DHOWN_BACKUPS\recovered_from_vdknits_folder`
rather than deleted.

## TV dashboard (commit f24023d)

The screen called `/api/dashboard/live` with no token against an endpoint that
already required one, so it had been blank. It now carries a **scoped** long-lived
credential: `verifyToken` restricts `scope:'display'` to the live dashboard and
`/api/public` alone.

Scoping matters because most routers check only that a caller is authenticated — a
plain VIEWER token on a screen in a corridor would also read invoices, costing and
staff records. Minted by an ADMIN from **Settings → Display token**. Verified
blocked from costing, invoices, operators, settings, ageing and even
`/api/dashboard`.

## Position

Both Criticals and both discretionary items are closed. The High backlog is
unchanged: 33 mutating endpoints without a role check, no schema migration
mechanism, no AI evaluation harness, 53 unindexed foreign keys, and no foreign keys
on the core financial tables.

---

# Addendum 3 — 2026-08-06: RBAC closed (commit 2a050cc)

The register's "33 mutating endpoints with no role check" is closed, and working
through it found something worse underneath.

## Several had no authentication at all

Not merely a missing role — unauthenticated **writes** were reaching business
logic. Probed on the running server:

| Request (no token) | Result |
|---|---|
| `POST /api/grn` | 500 from the handler on an empty body |
| `POST /api/data-collectors` | 400 from its validator |
| `POST /api/yarn-issues` | 400 from its validator |

A goods receipt drives stock and the costing chain, so this was the more serious
half. Two GRN routes were explicitly commented *"(public — as in original)"*,
carried forward from the pre-refactor code: `DELETE /:id/lots/:lotId` and
`PUT /:id/approve`.

## Roles assigned

Lowest tier that is still safe, so operator accounts created later can do floor
work without another pass:

| Tier | Endpoints |
|---|---|
| **OPERATOR** | rfid scan, downtime reason, yarn location, assignment release |
| **SUPERVISOR** | master data, goods movements, GRN + approval, yarn issues/returns, alerts, costing Q&A, machine settings |
| **ADMIN** | users, settings, data collectors, opening balances, backups, operator deletion, GRN deletion |

## Mount-point distinction

Routers at a specific path take `router.use(verifyToken)`, so a route added later
is guarded by default. Routers at **bare `/api`** — yarn, rfid, backup — must not:
every `/api` request passes through them, so a router-level guard there would
block `/api/auth/login`. Those take per-route guards.

## Two bugs in the fix itself, caught before shipping

1. The guard was inserted **before** an existing `verifyToken` on some routes.
   `requireRole` reads `req.user`, which `verifyToken` sets — in that order a
   legitimate ADMIN would have been rejected along with everyone else. Reordered
   across 7 files, with an assertion that no wrong-order pair remains.
2. Five routers referenced `requireRole` without `server.js` passing it. That
   threw at boot rather than failing silently.

## Verification

A matrix probe across NONE / OPERATOR / SUPERVISOR / ADMIN on 15 representative
endpoints: every tier gets exactly what it should and nothing more. The two real
SUPERVISOR accounts still reach GRN, rolls, yarn store, batches, downtime,
machines and invoices. 286 tests pass. Deployed to both instances.

## Correctly still without a role check

`/auth/login` and `/auth/supervisor-pin` (public by necessity), `/auth/logout`
(any session may end itself), `/live-data` ingest (collector API key), and the
Meta webhook (its own verification).

## Correction to this report

The original count of 33 included at least one false positive: `/api/opening/x`
exists only in a comment, not as a route. The static scan counted the comment.

---

# Addendum 4 — 2026-08-06: financial foreign keys added (commit 44e1059)

`tax_invoices`, `payments`, `sales_returns`, `lot_allocations` → **0 FKs each** is
closed. Foreign keys across the schema: **85 → 100**.

## Why this one mattered more than it looks

`partner_id` and `invoice_id` were plain integers, so nothing stopped a payment
pointing at a deleted customer. And because outstanding is computed from those
joins, an orphan **does not raise an error — it silently drops out of a balance**.
A customer would simply appear to owe less than they do. That is the worst shape a
data bug can take in this system.

## What was added

15 constraints, all **ON DELETE RESTRICT**. Financial history is not something to
cascade away: if a customer has invoices, the correct answer to "delete this
customer" is no. Line-item tables keep their existing `CASCADE` — an invoice's own
lines going with the invoice is the one place cascading is right.

Checked for orphans on **both** databases before adding: none, so all 15 applied
cleanly on each. The schema step refuses to add a constraint the data would not
support, logging the orphan count rather than crashing the boot.

Each key got a supporting index, created **before** the constraint — an unindexed
foreign key makes every parent delete scan the child, and the register had already
counted 53 of those.

## The half that is easy to skip

A refusal has to read as a decision. Untranslated, a blocked delete surfaces as a
500 carrying *"violates RESTRICT setting of foreign key constraint…"*, which reads
like a crash — and a protection that looks like a bug gets removed by whoever
meets it next. `src/lib/db-errors.js` maps each constraint to a sentence naming
what is blocking it.

Verified through HTTP: deleting an invoice with money allocated now returns
**409 — "Cannot delete: money has been allocated to this invoice"** instead of a
500.

**A bug in that mapper, caught by the test:** Postgres raises `23503` when a row
references something missing, but `23001` (`restrict_violation`) when a delete is
refused by `ON DELETE RESTRICT`. Handling only `23503` would have let every
blocked delete through as a raw 500 — exactly the failure the mapper exists to
prevent.

## Verification

`tests/integrity.e2e.js` — 15 checks: orphan rejection, blocked deletes, the
friendly message, cascade still working on line items, deletion succeeding once
history is cleared, and assertions that all 15 keys exist, are indexed, and none
cascade. Passes on both databases. 301 tests total.

---

# Addendum 5 — 2026-08-06: schema versioning (commit c2e3c8c)

"No migration mechanism — no version record, no rollback, no way to know which
server has which schema" is closed.

## What was built, and what deliberately was not

The `ensure*()` functions are **kept**. They are idempotent, describe the current
shape, and proved themselves bringing VD Knits from 71 to 117 tables on first
boot. Rewriting 118 tables of DDL into a sequential history would be a large,
risky change buying nothing today.

What was missing is what `ensure*()` cannot express or answer:

| | |
|---|---|
| `schema_migrations` | name, checksum, duration, who applied it |
| `migrations/NNNN-name.js` | one-off changes — backfills, type changes, data fixes |
| Per-migration transaction | a failure leaves nothing half-applied; the run stops |
| Checksum drift warning | editing an applied migration is detected |
| Baseline row | the 20 hand-run scripts recorded, not re-run |
| Schema fingerprint | `GET /api/settings/schema` (ADMIN) — compare two servers |

**Rollback is honest:** `down()` exists, but a destructive change is reversed by
restoring a backup, which is rehearsed and timed. An untested `down()` that drops
a column is false confidence, and the README says so.

## The fingerprint paid for itself immediately

Comparing the two databases showed **24 columns present on Dhown and absent on
VD Knits**, zero the other way:

- **`knitting_structures` did not exist at all on VD Knits.** Created by a
  hand-run script on the original install and never added to any `ensure*()`, so a
  fresh tenant had a Knitting Library page with no table behind it.
- **`machine_live_data`** was missing `work_time`, `working_hours` and
  `total_minutes`, which the live-data ingest writes.

Fixed in `ensure*()` rather than as a migration — per the rule in the README,
"this column should exist" is exactly what `ensure*()` is for. Both databases now
report the same fingerprint (`064972b4212ad458`) and Dhown's existing rows are
untouched.

This is the drift the mechanism was added to detect, found within minutes of
having it. It had been latent since the fork.

## A bug in the runner, caught by its own test

The client was released in both the `catch` and the `finally`, so a failed
migration threw *"client has already been released"* and masked the real error.

## Verification

`tests/migrate.e2e.js` — 14 checks: runs exactly once, dry run changes nothing,
drift detection, transactional rollback on failure, not recorded when it fails so
it retries, and the fingerprint tracking schema changes in both directions.
**315 tests total.**

---

# Addendum 6 — 2026-08-06: every foreign key indexed (commit 491f1a4)

"53 FK columns without an index" is closed. Indexes: **243 → 313**. Database
18 MB → 19 MB.

## Why it mattered more after the previous change

Postgres indexes the **parent** side of a foreign key automatically — it must, to
enforce uniqueness — but never the **child** side. So every delete or key update
on a parent sequentially scanned the whole child table looking for references.
The `ON DELETE RESTRICT` keys added in addendum 4 made those checks *more*
frequent, so the two findings compounded.

## Written as a rule, not a list

`ensureForeignKeyIndexes()` iterates `pg_constraint` rather than carrying a
hardcoded list. A list goes stale the moment someone adds a foreign key, and the
next audit reports the same finding again. Any key added later is indexed on the
next boot.

Coverage is judged on `indkey[0]`, because only the **leading** column of an index
helps — an index on `(a, b)` does nothing for a lookup on `b`.

## A judgement call I got wrong first

I initially tried to split these into "transactional, index them" and "small
lookup tables, not worth it". The split was wrong: `partner_addresses`,
`partner_bank` and `partner_contacts` all landed in the second group despite being
read by `partner_id` on every Customer-360 view. At these volumes an index costs a
few KB and an invisible amount of write time, so the simple universal rule beats a
per-table judgement whose reasoning nobody will remember.

## Now an enforced invariant

`tests/integrity.e2e.js` asserts across the **whole schema**: *"no foreign key
anywhere lacks a leading-column index."* A future key without one fails the suite
rather than waiting for an audit to notice.

## Verification

53 created on Dhown, 54 on VD Knits, zero unindexed remaining on either, zero
created on a second boot (idempotent), fingerprints still identical. **316 tests.**

## Noted, not fixed

The schema fingerprint hashes columns and constraints but **not indexes**, so two
servers could differ in indexing and still show the same hash. The "every FK is
indexed" invariant now covers the case that matters; a broader index comparison
would be the thorough version.

---

# Addendum 7 — 2026-08-06: AI evaluation harness (commit edbbcf9)

"No evaluation harness — prompt edits and model changes ship blind" is closed.

## Two tiers, answering different questions

**`tests/ai-guardrails.e2e.js`** — 19 checks, no model call, runs on every commit.
These are the invariants that hold regardless of what the model says on a given
day:

- the tool whitelist rejects a name the model invents
- every advertised tool actually resolves to an implementation
- no state-changing tool sits in `AUTO_SAFE`
- both system prompts still carry their non-negotiable clauses
- the escalation pattern catches money and complaint topics **without**
  over-catching ordinary enquiries (which would make AUTO useless)
- memory carrying an injection attempt is still labelled as data, and included
  **verbatim** rather than sanitised — sanitising would hide what the customer
  actually said

**`evals/`** — grades the model itself. Deliberately **not** in the commit gate:
it costs real API calls and is not deterministic enough to block a commit. Eight
cases test behaviour rather than phrasing, the central check being that **no
figure may appear in a reply that did not come from tool results or from what the
customer said**. Also: no specific delivery date when nothing supplied one,
references carried forward from memory, and refusals for other-customer data,
direct injection, injection planted in history, and discount requests.

Scores against a saved baseline so a prompt or model change can be compared.
**Current: 20/20.**

## What running it actually found

Something worse than anything it was written to catch.

**Every AI call took ~38 seconds.** The dead NVIDIA endpoint *hangs* rather than
refusing, so each call paid its full 45-second socket timeout before falling back
to Groq — which answers in about a second. A WhatsApp AUTO reply makes two calls,
so **a customer waited 85 seconds for an answer**, on every message, for a
provider dead for days.

This was recorded in HANDOFF as "NVIDIA endpoint dead, running on fallback" and
treated as cosmetic. Nobody had measured what it cost.

A circuit breaker now skips the primary after two consecutive failures and retries
after five minutes, so a provider that recovers is picked up automatically and one
that stays down costs nothing. The thresholds are asymmetric on purpose: being
wrong costs one extra fallback call of about a second; being slow costs 38.

Measured end to end through the SUGGEST endpoint:

| Call | Before | After |
|---|---|---|
| 1 | 84,629 ms | 84,629 ms (trips the breaker) |
| 2 | ~85,000 ms | **735 ms** |
| 3 | ~85,000 ms | **748 ms** |

`vision()` shares the same primary and got the same treatment — a customer photo
was paying the identical penalty.

## The lesson

The harness earned its cost before grading a single answer. The finding was not
in the answers at all; it was that measuring anything at all required timing the
calls, and the timing was absurd. **329 tests.**

---

# Addendum 8 — 2026-08-06: frontend sweep (commits d89a896, c43ecdd)

"UI-1. Older pages are unverified" is closed.

## Method

All **54 routes** loaded in a browser with a real session, recording JS errors,
unhandled rejections, and every `/api` response that was non-2xx or returned HTML
where JSON was expected.

## Result

**Zero JS errors. Zero 5xx. One ghost endpoint.**

`/api/erp-items/items` matched no route on four pages — ProductionPlanning,
PurchaseOrders, SalesOrders, TaxInvoices. The routers are mounted at `/api/erp`;
the file name is not part of the path.

The practical effect: **the item picker was empty on every screen where you raise
a purchase order, a sales order, an invoice or a production plan.** Same failure
as the partner dropdowns found earlier, and invisible for the same reason — an
unmatched path returns index.html with status 200, so the fetch "succeeds",
`JSON.parse` throws, and the page's `.catch` swallows it.

That is now two master-data pickers, across seven pages, broken silently.

## The prediction was right, the estimate was not

The register said this was "where I'd expect the most undiscovered bugs". One real
defect across 54 pages is a **better** result than expected — the older pages are
in better shape than the 34/100 June score implied. But the one defect found was
on the four screens where commercial documents are raised, so severity beat count.

## Now guarded

`tests/api-paths.e2e.js` asserts every `/api` prefix the UI references is mounted,
plus a named list of the three that already shipped. In the commit gate.

## Three rounds of my own tooling were wrong

Worth recording, because it is the actual lesson:

1. A static sweep probed every path with **GET** and reported 24 missing endpoints
   — nearly all POST-only routes behaving correctly.
2. Adding method detection still flagged 7, all artefacts: paths passed into a
   helper that supplies the method, and template literals normalised to a
   nonsense id.
3. The first version of the **guard** was vacuous — it treated "something is
   mounted at bare `/api`" as "any path under `/api` is valid", and passed
   happily with the bug deliberately reintroduced. Its reference regex was also
   anchored to a quote character, so template literals — which is how every one
   of these is actually written — never matched. Fixing that took detected
   prefixes from 30 to **62**: the first version was blind to half the frontend.

Only driving the actual pages produced the true finding. **332 tests.**

---

# Addendum 9 — 2026-08-06: load testing

`backend/loadtest/run.js` (`npm run loadtest`) drives the running server over
HTTP — read paths, collector ingest, concurrency past the pool ceiling, and a
correctness scenario where 20 receipts of 10,000 land simultaneously on one
100,000 invoice. No new dependencies; it is plain Node.

**It found a production-stopping defect on the first run.**

20 concurrent receipts took **305,004 ms and all 20 failed.** `pg_stat_activity`
showed one connection *idle in transaction* on `pg_advisory_xact_lock` and nine
`active` on `Lock` — ten advisory locks held against a pool of ten. The cause was
code holding a pool connection while asking for a second one:

- `payments.record()` built its return value with `outstanding: await outstanding(...)`,
  evaluated **before** `finally` released the connection.
- `payments.applyCredit()` did the same.
- `lot-allocation.js` helpers queried the pool directly from inside `commit()`'s transaction.
- `receiptNo()`, `returnNo()`, `creditNoteNo()` each took their own connection
  *mid-transaction, while the advisory lock was held* — the worst of the set.

This was not a payments bug. Once ten requests each held one connection and
waited for another that could never come, **the whole application froze** —
machines, dashboards, collector ingest, everything. Under real load it was a
matter of when, not if.

Fixes: the follow-up reads moved after `client.release()`; a `db` parameter
threaded through the helpers so a transaction's own client is used; `nextInvSeq`
skipped when a client is passed, since it holds its own pool handle.
`config/database.js` raised `max` 10 → 25 and — more importantly — set
`connectionTimeoutMillis`, which was unset, so pool exhaustion waited **forever**
instead of failing fast.

After: **240 ms, 20/20 accepted, exactly 100000 allocated, balance 0.** No
scenario over 1 s at p95, no errors. A regression test in `tests/payments.e2e.js`
asserts both halves — that the receipts finish quickly *and* that the arithmetic
is still exact. **336 tests.**

The lesson is the one addendum 8 already made: this bug was invisible to every
functional test, because at concurrency 1 the code is correct.

---

# Addendum 10 — 2026-08-06: IPv6 rate-limit bypass

Noticed in the boot log while restarting both instances for the load test, not
from a scan: express-rate-limit was warning `ERR_ERL_KEY_GEN_IPV6` on every
start, and had been for some time.

`aiLimiter` in `src/middleware/auth.js` keyed on `req.user?.username || req.ip`.
Over IPv4 that is correct — one address, one budget. Over IPv6 a client is
handed a whole prefix, so it can present a different source address per request
and collect a fresh 20-call budget each time. The cap was decorative against
anyone on IPv6, and each AI call is two LLM round-trips of real quota.

`loginLimiter` and `pinLimiter` were **not** affected — they use the library's
default key generator, which already folds IPv6.

Fixed with `ipKeyGenerator(req.ip)`, which collapses an IPv6 address to its /56
network so the prefix shares one budget; IPv4 passes through untouched, and a
logged-in user is still keyed by username so one person's runaway script cannot
lock out the office behind a shared NAT. Four unit tests in
`test/rate-limit-key.test.js` pin all of it, including that two addresses in one
prefix collide — the assertion the old code fails. Warning gone on both
instances. **340 tests.**

---

# Addendum 11 — 2026-08-07: the last four High items, and a Critical found doing them

**Every High item in this analysis is now closed.** The four remaining were
features rather than defects; building them turned up three real defects and one
Critical, which is the part worth reading.

### SALES role (commit 9e76cfa)
The obvious implementation is wrong. Sales work — quotes, orders, customer
categories — sits behind `SUPERVISOR`, so ranking SALES at 3 makes those routes
answer *and* hands every salesperson authority to approve a GRN, signing stock
into the factory. A ladder cannot tell the two apart. SALES ranks at OPERATOR
level and sales routes opt in explicitly with `requireRole('SUPERVISOR', { also:
['SALES'] })`, greppable by `also`. Not granted: dispatch, price list, payments,
reserving beyond ATP.

Caught doing it: the quote handler silently deletes `body.rate` for unprivileged
callers, so without SALES in that list a salesperson's price would vanish and the
quote would go out at list price with **no error to notice**.

### Statement of account PDF (commit fb7f7a7)
Three fixes were needed before the document could be trusted.

1. **Credit notes were missing from the ledger.** It unioned invoices and
   payments only, while `v_invoice_balances` nets credit notes off. The two
   would diverge the first time a sales return was approved — the statement we
   send disagreeing with what we tell ourselves the customer owes.
2. **The opening balance must be real.** Opening a period at zero tells the
   customer they owe only this period's invoices.
3. **Reconciliation is not `closing === outstanding`.** `v_partner_outstanding`
   sums only balances above zero, so a customer holding an advance shows 0 while
   the ledger correctly closes negative. The identity that holds is
   `closing = Σ(invoice balances) − unapplied payments − unallocated notes`.

### GSTR-1 summary (commit 0e14579)
Rate-wise figures come from line items, not the invoice header — one invoice can
carry 5% and 12% lines and the return wants them apart. `reconciles` checks the
sections add back to the invoice set, because a return that drops an invoice is
accepted by the portal and surfaces months later as a mismatch notice.

Found doing it: **the existing GST Report page has never displayed anything.** It
reads a flat `output_lines` / `output_total_gst` shape; the API returns
`{ output: { lines, taxable, gst } }`. Both tables rendered empty and every KPI
showed an em-dash, silently, for the life of the page.

### Financial dashboard (commit b55554e)
Reads the same views as the credit gate, so it cannot tell a happier story than
the thing that blocks orders. A customer with no credit limit reports `null`
utilisation, not infinity — treating "no limit recorded" as zero would bury the
customers genuinely over theirs.

### ⛔ CRITICAL found while doing the above (commit 9dd7339)
**34 of the 35 handlers on `/api/reports` required no authentication.**
Production records, machine data, operator names and attendance, stock, costing
— served to anyone who could reach the port. Only `/gst-summary` was guarded.

```
GET /api/reports/                        200
GET /api/reports/daily-production-report 200
```

The earlier endpoint sweep missed this router, and it could not have been fixed
in isolation: the download buttons used `window.open()`, which cannot send an
`Authorization` header, so guarding the router would have broken every report
download. The call sites had to move first — `utils/download.js` fetches a blob,
the same pattern as the statement PDF — and only then could the guard go at the
router where a new route is protected by default.

### Also
₹4.1 lakh of fabricated invoices across two leftover `ZZ` test customers was
found sitting in `dhown_mes`, counting toward the debtors total, left by
interrupted test runs. Backed up to `DHOWN_BACKUPS/removed_test_rows_*.json` and
deleted; `integrity.e2e` now fails if test artifacts are ever left behind again.

**184 tests** (140 unit + 12 e2e suites). Frontend production build verified.
Remaining items in this document are Medium and Low.


---

# Addendum 12 — 2026-08-07: bank reconciliation (commit da2d80b)

Payments were recorded but never checked against the bank — the largest
remaining hole in the finance chain. Two blind spots, both costing money the
same way: a receipt keyed in that never arrived (outstanding drops, the credit
gate lets the next order through, nobody chases it), and a bank credit with no
receipt (the customer has paid and is still being chased).

Three tables, import, matching, and a summary whose real output is the two
exception lists.

**Auto-matching is deliberately timid.** It matches only where exactly one
candidate fits; two plausible receipts are left for a human. A wrong auto-match
is worse than none, because it looks settled — the wrong customer is credited
and the right one keeps getting chased. A shared UTR is decisive; a coincidence
of amount and date is not.

**Import is idempotent, which is subtler than it looks.** Statements get
re-uploaded routinely, and two identical ₹10,000 credits on one day are normal.
The row hash covers the line's content *and its occurrence number within the
import*, so re-importing inserts nothing while genuine duplicates both survive.

Two unique indexes carry the guarantee: one line settles one payment, one
payment appears once. Without both, a single bank credit could "prove" several
receipts — the exact error reconciliation exists to catch. Amounts must agree
exactly; a partial match would make the reconciled total meaningless.

Found while testing: two queries passed a parameter they never referenced, which
Postgres rejects outright. Both were caught by the e2e suite before the route
existed.

**210 tests** (140 unit + 13 e2e suites). Verified end to end through the API and
the page against a live scenario, then cleaned up.

---

# Addendum 13 — 2026-08-07: soft delete (commit 444c01d)

Prompted by a real incident: a stray request deleted the admin user and the only
way back was an hourly dump that happened to exist.

**Scope was decided by measuring, and most of the original finding turned out not
to apply.** "0 of 118 tables have soft delete" is true but misleading:

- `partners`, `items`, `operators`, `machines` have **no delete endpoint at all** —
  they are deactivated with `is_active`, so the master data the finding worried
  about was already recoverable.
- `tax_invoices`, `sales_orders`, `payments`, `dispatch_challans` carry a
  `CANCELLED` status, which is soft delete with better semantics: a cancelled
  invoice must stay visible and numbered, not vanish.
- Transactional tables are read from dozens of places (`rolls` 72 sites,
  `subcontract_challans` 43). Filtering all of them risks missing one, and a
  missed filter silently hides live data — worse than the problem being solved.

That leaves the config/master tables the API genuinely hard-deletes: `users`,
`fabric_types`, `knitting_structures`, `spare_parts`, `data_collectors`.

### Two traps, both closed

**A plain UNIQUE constraint counts deleted rows**, so a deleted username or SKU
would be held for ever and could never be reused. Replaced with partial unique
indexes over live rows only. Restoring can then collide with something created
since, so restore catches `23505` and names the clashing field.

**Deleting the last super admin would now lock everyone out permanently** — worse
than before. A hard delete at least let `seedDefaultAdmin()` create a replacement
at the next boot; a soft-deleted row still exists, so the seeder does nothing and
the restore button sits behind the login screen. Refused in `users.service`, with
the seeder ignoring trashed admins as a second line of defence.

### The security half
A deleted user is excluded from login, PIN login, alert recipients, CRM assignees
and the WhatsApp staff check. An account that can still authenticate after being
deleted is a hole, not a convenience. Enrichment JOINs are deliberately **not**
filtered — filtering an inner join would hide a live machine whose fabric type
was deleted.

**234 tests** (140 unit + 14 e2e suites). Verified end to end through the real UI:
deleted a user, watched it leave the list, restored it from Trash.

---

# Addendum 14 — 2026-08-07: ACCOUNTS role (commit 0d37594)

Recording a receipt sat behind SUPERVISOR; cancelling one and approving a credit
note sat behind ADMIN. The day-to-day money work was out of reach of the person
whose job it is, so it was done by an admin or not at all.

Same shape as SALES (addendum 11), for the same reason. ACCOUNTS ranks alongside
OPERATOR and the money routes opt in explicitly with
`requireRole('ADMIN', { also: ['ACCOUNTS'] })`. Ranking it at SUPERVISOR would
hand every accounts clerk the ability to approve a GRN — to sign stock into the
factory. Ranking it at ADMIN would let them create users. Neither is what "can
cancel a receipt" should mean.

**Granted:** record/cancel a receipt, apply credit on account, approve and cancel
a sales return (the credit note is the money half of a return), all of bank
reconciliation, the financial dashboard, GST summary and GSTR-1 — accounts
prepares the return, so gating it at ADMIN meant the person who files it could
not see it.

**Refused:** GRNs, users, sales orders, quotes, price lists, and creating a bank
account (rare and structural — stays ADMIN).

SALES and ACCOUNTS are peers, not a hierarchy, and the tests assert neither can
do the other's job: the separation between the person who agrees a price and the
person who records the money against it.

**240 tests** (146 unit + 14 e2e suites).

---

# Addendum 15 — 2026-08-07: domain CHECK constraints, 18 → 196 (commit 02c40af)

Quantities, money and statuses were validated in JavaScript and nowhere else,
which holds only while every write goes through the app. **178 constraints
added**: non-negative money and quantities across every table that has them,
plus value domains where the allowed set is authoritative in code.

### What is deliberately NOT constrained
- **Balances.** A bank balance can be negative — that is an overdraft, not a
  bug — and so can an opening balance. Constraining them would be *wrong*.
- **Signed columns** (`round_off`, `variance`, `margin`, adjustments).
- **Status sets inferred from data.** Most of these tables hold a handful of
  rows; constraining `status` to whatever is present today would reject the next
  legitimate transition. Only sets declared in code are enforced.

### It is data-aware, by design
Every constraint is tested against existing rows and skipped with a warning if
they violate it. A constraint that fails at boot takes the application down, and
the two installations do not hold the same data. Both now report
`0 added, 178 already present, 0 skipped`.

### Found doing it
`machine_status_log` held a duration of **-0.0000153 minutes**. The end-of-status
update computes `NOW()` in a different statement from the one that set
`start_time`, and the two transaction timestamps can interleave. That value is
summed into OEE and downtime totals. The query now clamps with `GREATEST(0, ...)`
and the stored row was corrected.

### A naming detail that matters
Constraint names use a **double** underscore between table and column
(`ck_tax_invoices__grand_total_nonneg`) so `db-errors` can recover the field and
say *"Grand total cannot be negative"* rather than *"That value is not allowed"*.
The first attempt used a single underscore, which cannot be split reliably — and
the SQL `LIKE` meant to retire those names silently matched nothing, leaving 178
duplicate constraints. The retire step now filters in JavaScript.

**252 tests** (146 unit + 15 e2e suites). The constraint tests write straight to
the database rather than through the app: if a rule exists only in JavaScript,
they fail.

---

# Addendum 16 — 2026-08-07: complaints (commit 9be420f)

Closes four rows that were the same gap seen from four angles: the table, the
workflow, the screen and the AI tool.

This was the only business process running entirely outside the system. A
customer rings about barre in a lot, or a short delivery, and it lived in
someone's head or a WhatsApp thread. Nothing recorded it, nothing chased it, and
nobody could answer *"how often does this happen with this shade"* — the question
that actually improves the cloth.

Two tables: `complaints` and an append-only `complaint_events` trail. A complaint
links to what it is about (invoice, dispatch, roll, lot, machine) so quality can
trace it to a batch, and to the return or credit note it produced so the money
side is not a separate story.

### Three decisions
**An incomplete complaint is accepted.** A customer rarely knows the dispatch
number when they ring, and refusing to record one until every link is known is
precisely how complaints go unrecorded. Only the customer and a one-line summary
are required.

**Resolving requires saying how** — a resolution type and a note. Without that a
complaint gets *closed* rather than *resolved*, and the pattern becomes invisible
to anyone looking for it later.

**The state machine is enforced, not implied by the UI.** `OPEN` cannot jump to
`CLOSED`; a `CLOSED` complaint cannot be reopened (raise a new one, so each
history stays true). The API returns the allowed transitions and the screen
offers only those.

Severity drives an SLA — CRITICAL 1 day, HIGH 3, MEDIUM 7, LOW 14 — because a
critical fault on a running order cannot wait a week. The list is a worklist:
open and overdue first, then by severity.

### The AI tool
`log_complaint` is a write tool, so it is absent from `AUTO_SAFE` and cannot fire
without a human; `ESCALATE` already routes *complain / shikayat / claim* to a
person even in AUTO mode. **Severity is deliberately not taken from the model** —
an upset customer and a critical quality failure read the same in text, so
everything the AI logs starts MEDIUM for a human to triage.

**282 tests** (146 unit + 16 e2e suites). Verified end to end through the UI,
including that clicking *Resolved* with nothing filled in is refused.

---

# Addendum 17 — 2026-08-07: five small items (commit ae1490b)

Closes six rows. Each was small only because the plumbing was built earlier
today — the PDF builder, the download helper, the role grants, `statement()`.

**Compliance Board** (`/compliance`) — four clocks in one place: e-way bills near
or past expiry, dispatches with no POD, returns still in draft, credit notes
raised but never applied. Ordered by consequence, not date. The POD list has a
deliberate grace period: a lorry that left this morning has not failed to
deliver, and listing it trains people to ignore the list.

It does **not** replace `/eway`, which is where bills are raised and cancelled.
Both were called "Compliance"; they are now **E-way Bills** and **Compliance
Board**, because two entries with the same name are worse than either.

**Debtors ageing export** (`GET /api/wa/ageing.xlsx`) — with a bold total row,
because the first thing anyone does is sum it, and a hand-summed column is a
column that disagrees with the dashboard.

**Credit-note PDF** — the list existed, the document did not. Figures are carried
from the note, never recomputed, so it cannot disagree with the ledger. A
cancelled note is stamped CANCELLED.

**`get_payment_status`** — read-only, but deliberately **not** in `AUTO_SAFE`,
matching the existing `get_outstanding`. A balance quoted to a customer becomes a
number they hold us to, and money should pass a human before it goes out.

**OpenAPI** (`GET /api/openapi.json`) — generated by walking the mounted Express
routers at runtime, so it cannot claim a deleted endpoint or miss one added
today: the two ways an API document becomes worse than none. **403 paths, 72
tags.** Request and response bodies are not inferred and are deliberately not
guessed at.

**307 tests** (146 unit + 17 e2e suites). The document tests check the bytes —
a workbook must carry the PK zip signature and a PDF must start `%PDF-`, so a
200 carrying an error page fails.

---

# Addendum 18 — 2026-08-07: Medium batch (commits 28766da, 8045f88)

Seven rows closed. **A real production bug was found doing it.**

### ⚠️ `rolls` had no `updated_at`, and dispatch wrote to it
Adding timestamps to the 39 tables that had none turned up something worse:
`rolls` had `created_at` but **no `updated_at`**, while two dispatch paths run
`UPDATE rolls SET ... updated_at = NOW()`. Every greige dispatch and every greige
dispatch-cancel would have thrown `column updated_at does not exist` and rolled
back.

Nothing caught it because the table *did* have a timestamp — a "does this table
have timestamps" check passes on exactly this shape. Only writing one found it.
The fix now covers both shapes: tables with neither column, and tables with
`created_at` but no `updated_at`. **52 tables.** The test asserts `updated_at`
exists on every table the code writes it to.

Existing rows get NULL rather than a fabricated `created_at` — pretending every
historical row was created at the moment of this migration would be worse than
admitting the information was never captured.

### Quality gate — now a check, not a convention
Dispatch refuses a roll whose latest inspection failed, naming the actual defect
(*"failed inspection (grade C, HOLES, major)"*). Refusing outright would strand
legitimate dispatches — a customer accepting a B-grade lot at an agreed discount
is normal here — so there is an override requiring a **written reason that lands
in the audit log**. What is removed is the silent case, not the ability to decide.
A roll nobody has inspected still dispatches freely: this does not mandate
inspection, it stops a *recorded* failure being ignored.

### AI confidence scoring
Not a probability from the model — a model asked to score its own certainty will
say 0.95 about something it invented. What is measured is how well grounded the
answer is: tools that returned nothing or errored, empty results, no tools at
all, hedging language, a very short answer to a detailed question. Below 0.6 it
**blocks AUTO send**; it never blocks a human, who sees the score and the reasons.
Both are recorded in `wa_ai_actions`.

### Also
Retention viewer (`/retention`) — the endpoints existed with no screen, so the
only way to see what the nightly job would delete was to call the API by hand.
`/batching` had a route and a page but no menu entry.

### Noted, not fixed
`dispatch_items.roll_id` is **INTEGER** while `rolls.roll_id` is **VARCHAR**, so
no foreign key is possible between them and roll ids must be numeric strings.
Changing a column type on a live table is its own piece of work.

**321 tests** (146 unit + 18 e2e suites).

---

# Addendum 19 — 2026-08-07: approval-matrix editor, stock valuation (commit e62b1b5)

### Approval matrix (`/approval-matrix`)
The bands were seeded from code and editable only by SQL. The editing is the
easy part; the value is that a band set can be wrong in two ways the live lookup
**hides**:

- **Overlap** — two bands match one value. `requiredRole()` does
  `ORDER BY min_value DESC LIMIT 1`, so it picks one and looks decisive. A 5-lakh
  order could need a supervisor or a super admin depending on which row was
  written first.
- **Gap** — no band matches and the lookup falls through to hardcoded defaults,
  so the screen shows one policy while the system applies another.

Every write is validated against the whole set, overlaps are refused, and the
read reports coverage before rows. A *"what would happen"* box asks the same code
the system asks — the policy as **applied**, including when two bands match.
Retiring deactivates rather than deletes: an approval granted last month was
granted under the band as it stood then.

### Stock valuation (`/stock-valuation`)
"As at a date" needs history, and the only history is `stock_ledger`, which is
recent. A report quietly returning a near-zero valuation for last March — because
the ledger had no rows then — would be a confidently wrong number in a document
someone shows their accountant.

So **today** is valued from the live stock tables (what every stock screen reads).
A **past date** is reconstructed by rolling that position back through ledger
movements since, and the response carries the ledger's coverage plus a `reliable`
flag. Where coverage does not reach, the screen says so *above* the figure.

The **basis is shown against every line**, not in a footnote: yarn at its actual
purchase rate per lot; greige and finished goods at the average yarn rate with
**no conversion cost included** — a floor, not a true cost. Presenting them as one
clean total without saying so would overstate the stock.

**351 tests** (146 unit + 19 e2e suites).

---

# Addendum 20 — 2026-08-07: AI performance, credit terms, runbook (commit 4cfa740)

### AI performance (`/ai-performance`)
`wa_ai_actions` had recorded every run since the CRM went in and **nothing read
it**. Now: tool usage and failures, intent mix, confidence distribution,
auto-sent vs held-for-human, and daily volume so a change after a prompt edit is
visible rather than inferred. It measures *behaviour*, not quality — quality is
what the eval harness is for. Runs predating confidence scoring are excluded from
the average rather than counted as certain, and tools the model has never chosen
are listed.

### Credit limits and terms (`/credit-terms`)
**No customer on this installation has a credit limit set**, so the credit gate
has nothing to enforce for anyone. The screen leads with that number, because a
limit of zero is *"no limit recorded"*, not *"no credit allowed"* — treated as
different states throughout.

Bulk edits validate the whole batch before writing any of it: a half-applied
change across a credit book is worse than a rejected one, because nobody can tell
which half landed. An omitted field is left alone rather than zeroed —
`COALESCE` is on the parameter, not the column — so a blank box cannot wipe an
existing term. Audited.

### Runbook (`docs/RUNBOOK.md`)
First checks in order, then symptoms: nobody can log in, a machine stopped
reporting, the disk is filling, Postgres is down, everything hangs, a page shows
empty tables. Each carries the diagnosis that actually applies here — including
the two incidents this system has had (the deleted admin, the pool deadlock).

### Single point of failure — accepted and documented
The finding's own stated fix was that it "should be *documented* as accepted".
`docs/RUNBOOK.md` now records it as a decision: one host, no HA, mitigated by
backup quality rather than redundancy (nightly + hourly dumps, off-machine copy,
rehearsed restore, ~1h RPO), with what would change the calculation — a second
site, MES-gated dispatch, or WhatsApp becoming the primary customer channel.
Secrets in plaintext `.env` and the manual NIC/GST portal steps are recorded the
same way.

**378 tests** (146 unit + 20 e2e suites).

---

# Addendum 21 — 2026-08-07: UoM conversion wired into orders (commit 5622fa5)

Orders are taken in whatever unit the customer buys in — metres for a garment
house, pieces for a job worker, kilograms for most. Everything downstream is in
kilograms: stock, allocation, dispatch, costing. Those two were bridged by
someone doing the sum in their head, which is exactly where a wrong number enters
and is not noticed until the delivery is weighed.

`sales_order_items` and `tax_invoice_items` now carry `quantity_kg` and
`uom_basis`, resolved on write through the existing `uom` library.

### Three rules, in order
**It never guesses.** `uom.convert()` already refuses without a defensible basis
— an explicit per-item factor, real physics from GSM and width, measured roll
history, or a genuinely universal ratio — and that refusal is passed straight
through rather than softened into a plausible-looking number.

**An unconvertible line does not block the order.** Refusing to take an order
because a fabric has no GSM recorded would push it back into a WhatsApp thread,
which is worse than one line with an unknown weight. The line is stored null,
counted, and the warning is returned *on the result* — the person taking the
order needs to see it now, not in a log.

**The basis is recorded.** *"84.2 kg"* is worth little; *"84.2 kg,
DERIVED_FROM_GSM"* can be checked. `NATIVE`, `ITEM_FACTOR`, `DERIVED_FROM_GSM`,
`AVG_ROLL_WEIGHT` and `UNIVERSAL` stay distinguishable after the fact.

Tax figures on invoices are deliberately untouched — they were computed from the
quantity as billed, and recomputing from a converted weight would change the
invoice total.

**403 tests** (146 unit + 21 e2e suites), including the arithmetic: 500 m at
180 gsm and 150 cm is 135 kg.

# Addendum 19 — 2026-08-12: QC + read-only AUDITOR roles (commit c2b9ccb)

Both Low rows in section F closed. The two roles have opposite shapes and the
risks are opposite, so neither is a simple new rung on the ladder.

### QC — an operator who owns the quality gate, and nothing else
QC ranks *with* OPERATOR, not above it, and opts into three specific
SUPERVISOR-gated decisions via `requireRole(..., { also: ['QC'] })`: releasing
or holding a roll in quarantine (`POST /api/allocations/quarantine/:rollId`) and
creating/updating a quality inspection. It gains no other supervisor authority —
**GRN approval and roll-into-stock approval stay SUPERVISOR-only**, keeping the
inspector who passes fabric separate from the supervisor who signs stock in.

### AUDITOR — read everything, write nothing
A rank cannot express this: any rank high enough to read the books is high enough
to edit them. So it is split. AUDITOR keeps VIEWER's rank (earns no write power
from the ladder) but `requireRole` grants it a blanket pass for safe methods, so
it reaches the ACCOUNTS/ADMIN-gated **reports a plain VIEWER is refused**. The
write half is enforced once, centrally: `auditorWriteBlock` (wired into the
global `apiAuthGate` after auth) refuses every unsafe method for the role, so no
future route can forget it. The read-pass is proven never to leak to a write.

This is the role to hand a CA or an external auditor — unlike VIEWER, it exposes
finance. VIEWER's description was corrected to "operational modules" to keep that
distinction honest.

Both roles are registered in the user-service validator and the User Management
UI (colour + permission line). Covered by `tests/roles.e2e.js` (16 assertions).
Full gate still green: 146 unit + 22 e2e suites pass.
