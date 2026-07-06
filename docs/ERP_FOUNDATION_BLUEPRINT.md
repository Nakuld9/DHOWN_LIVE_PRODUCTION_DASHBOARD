# DHOWN ERP Foundation Blueprint
*Version 1.0 — Generated from audit 2026-07-01*
*This document is a permanent reference. Update it as the ERP evolves.*

---

## What exists today (MES baseline)

### Backend
- Single file: `backend/server.js` (5,333 lines)
- Stack: Node.js + Express + PostgreSQL 18 + Socket.IO
- Auth: JWT + ROLE_HIERARCHY (VIEWER→OPERATOR→SUPERVISOR→ADMIN→SUPER_ADMIN)
- Document numbering: two ad-hoc helpers (`nextSeq`, `nextInvSeq`) — must be unified

### Database — existing tables
| Table | Purpose |
|---|---|
| machines | 18 knitting machines, live data |
| operators | Factory workers |
| rolls | Core production unit (VARCHAR roll_id) |
| assignments | Operator ↔ Machine daily assignment |
| machine_live_data | Real-time counter data from DC |
| machine_downtime | Downtime events |
| machine_status_log | Status history |
| rfid_events | RFID scan log |
| audit_logs | All write actions |
| users | Login accounts with roles |
| fabric_types | Partial fabric master (code, name, desc only) |
| operator_attendance | RFID-derived attendance |
| maintenance_records | Ad-hoc maintenance log |
| maintenance_schedule | PM schedule |
| shift_handovers | Shift notes |
| grn | Goods Receipt Notes |
| yarn_lots | Yarn lot per GRN |
| yarn_lot_movements | Stock ledger per lot |
| yarn_issues | Yarn issue slips |
| yarn_issue_items | Line items per issue |
| batches | Greige batches for dyeing |
| batch_rolls | Rolls in a batch |
| subcontract_challans | Dyeing/finishing challans |
| subcontract_receipts | Receipt after processing |
| finishing_records | QA data per receipt |
| finished_goods | FG stock |
| dispatch_challans | Dispatch documents |
| dispatch_items | FG lots in a dispatch |
| cost_rates | Yarn/labour/machine rates |
| cost_entries | Auto cost events |
| cost_snapshots | Daily cost summaries |

### Frontend — 33 pages, 21 components
All in React. Sidebar grouped: SHOP FLOOR / WAREHOUSE / MANAGEMENT / ADMIN.

### Critical gaps vs ERP blueprint
1. **No Item Master** — fabric_type, yarn_type, color are free text everywhere
2. **No Business Partner Master** — vendor_name, customer_name are free text
3. **No Warehouse/Rack/Bin master** — location is a free-text field
4. **Two document numbering helpers** — not configurable, not auditable
5. **No Process Route engine** — workflow is hardcoded in server.js
6. **No print engine** — PDFs generated ad-hoc with pdfkit
7. **No attachment engine** — qr_image stored as base64 TEXT (will bloat DB)
8. **Roll UUID vs display number** — roll_id is both (single field, auto-generated)
9. **No financial year / number series config**
10. **No HSN/GST/tax tables**

---

## Architecture Decision Record

### ADR-001: Extend, do not rewrite
All existing routes, tables, and components remain unchanged. ERP adds new tables and new pages alongside existing ones.

### ADR-002: Master Data as additive FK columns
Existing free-text columns (vendor_name, fabric_type, yarn_type, color_name) are kept for backward compatibility. New FK columns (`item_id`, `partner_id`) are added alongside them. Views and new code use the FK; old code continues to work.

### ADR-003: Unified document numbering table
Replace `nextSeq` + `nextInvSeq` with a single `doc_series` table. Old number sequences are migrated in. All existing document numbers remain valid.

### ADR-004: Roll UUID
Add `roll_uuid UUID DEFAULT gen_random_uuid()` to `rolls`. The existing `roll_id` VARCHAR stays as the display number. Traceability uses UUID internally; UI shows roll_id.

### ADR-005: Attachments as filesystem references
Store file paths in an `attachments` table, not base64 in DB. Existing `qr_image` TEXT columns remain but new QR/label generation writes to `/uploads/qr/`.

### ADR-006: Process routes as DB config
Add `process_routes` + `process_route_steps` tables. Existing hardcoded flow (Greige→Batch→Challan→FG) becomes the default route, created by migration.

---

## Core Engines — Implementation Order

| # | Engine | DB tables | Status |
|---|---|---|---|
| E1 | Role & Permission | users (extend) | ✅ exists — extend |
| E2 | Audit Trail | audit_logs (extend) | ✅ exists — extend |
| E3 | Document Numbering | doc_series | 🔴 build |
| E4 | Master Data — Items | items, item_yarn_attrs, item_fabric_attrs, item_spare_attrs | 🔴 build |
| E5 | Master Data — Partners | partners, partner_roles, partner_addresses, partner_contacts, partner_bank | 🔴 build |
| E6 | Master Data — Locations | warehouses, racks, bins | 🔴 build |
| E7 | Master Data — Other | uom, hsn_codes, tax_rates, departments, cost_centres, financial_years | 🔴 build |
| E8 | Process Route | process_routes, process_route_steps | 🔴 build |
| E9 | Inventory Movement | stock_ledger (unified) | 🔴 build |
| E10 | Print Engine | print_templates | 🔴 build |
| E11 | Attachment Engine | attachments | 🔴 build |
| E12 | Notification Engine | notification_rules, notification_log | 🔴 build |
| E13 | QR & Barcode | extend attachments | 🔴 build |
