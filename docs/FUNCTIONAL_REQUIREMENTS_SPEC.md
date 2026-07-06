# DHOWN ERP — Functional Requirements Specification (FRS)
*Version 1.0 — 2026-07-01*
*Every screen, workflow, approval, print format, and business rule.*

---

## 1. Master Data Management

### 1.1 Item Master (`/items`)

**Screen — Item List**
- Table: item_code, item_name, category, UOM, standard_cost, status, actions
- Filters: category, status, search (code/name)
- Actions: New Item, Edit, Deactivate, Print QR Label
- Pagination: 50 per page

**Screen — Item Form (New / Edit)**
- Tab 1 — General: item_code (auto-suggest), item_name, category (dropdown), brand, description, UOM, HSN code, GST rate, standard cost, selling price
- Tab 2 — Stock Control: reorder level, min stock, max stock, preferred warehouse/rack/bin
- Tab 3 — Yarn Attributes (visible if category=YARN): count, composition, shade, yarn type, preferred supplier
- Tab 4 — Fabric Attributes (visible if category=GREIGE_FABRIC or FINISHED_FABRIC): structure, GSM, width, machine type, gauge, dia, feeders, stitch length, process route
- Tab 5 — Spare Attributes (visible if category=SPARES): OEM part number, compatible machine, rack/bin, warranty months

**Business Rules**
- item_code is unique, auto-generated as `{CATEGORY_PREFIX}-{YYYYMM}-{SEQ}` if left blank
- Cannot deactivate if stock > 0
- Cannot delete; deactivate only

**Print**
- QR Label (60×40mm): item_code, item_name, category, UOM, QR code

---

### 1.2 Business Partner Master (`/partners`)

**Screen — Partner List**
- Table: partner_code, company_name, roles (chips), city, gstin, rating, is_active
- Filters: role, city, state, active/inactive
- Actions: New Partner, Edit, View Ledger, Deactivate

**Screen — Partner Form (New / Edit)**
- Tab 1 — Company: partner_code (auto), company_name, short_name, GSTIN, PAN, TAN, IEC, CIN, MSME number, MSME category, notes
- Tab 2 — Roles: checkboxes for SUPPLIER / CUSTOMER / KNITTING_SUB / DYE_HOUSE / FINISHING_HOUSE / TRANSPORTER / AGENT
- Tab 3 — Financial: payment_terms (days), credit_limit, credit_days, rating (1-5 stars)
- Tab 4 — Addresses: primary / billing / shipping / GST addresses with separate GSTINs
- Tab 5 — Contacts: name, designation, mobile, email, WhatsApp, mark primary
- Tab 6 — Bank: bank name, branch, account no, IFSC, account type, mark default

**Business Rules**
- GSTIN validated against format `[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]`
- Cannot deactivate if open purchase orders or outstanding balance exists
- A partner can have multiple roles

---

### 1.3 Location Master (`/locations`)

**Screen — Warehouse / Rack / Bin tree**
- Left panel: collapsible tree of Warehouse → Rack → Bin
- Right panel: selected node details + item list at that location
- Actions: Add Warehouse, Add Rack (under selected warehouse), Add Bin (under selected rack)

**Business Rules**
- Bin code must be unique within rack
- Cannot delete locations with stock; mark inactive instead

---

### 1.4 Document Series (`/admin/doc-series`)

**Screen — Series list**
- Table: series_code, prefix, zero_pad, current_seq, fin_year, reset_yearly, last_reset
- Inline edit: prefix, zero_pad
- Action: Reset Sequence (ADMIN only, requires confirmation)
- Preview column shows what the next generated number will look like

---

### 1.5 Other Masters (`/admin/masters`)

**Sub-pages (tabs)**
- UOM: code, name, active toggle
- HSN Codes: code, description, GST rate
- Tax Rates: code, CGST%, SGST%, IGST%
- Departments: code, name, head user
- Cost Centres: code, name, linked department
- Financial Years: label, start/end date, mark active, mark closed

---

## 2. Procurement (Purchase)

### 2.1 Purchase Requisition (`/purchase/requisitions`)
*(future — stub page now, full in Phase 2)*

**Workflow:** OPERATOR creates PR → SUPERVISOR approves → ADMIN raises PO

---

### 2.2 Purchase Order (`/purchase/orders`)
*(future — stub page now, full in Phase 2)*

---

### 2.3 Goods Receipt Note — GRN (`/grn`) ✅ exists — extend
*Existing page already built. ERP extension:*
- Add partner_id picker (replaces free-text vendor_name — both saved)
- Add warehouse_id picker on GRN header
- Link yarn lots to item_id from Item Master
- On approval: auto-post stock_ledger entry (IN, warehouse_id, qty, unit_cost)

---

## 3. Production

### 3.1 Rolls (`/rolls`) ✅ exists — extend
*ERP extension:*
- Roll form: add fabric_type item picker (links to item_fabric_attrs)
- On roll approve: set roll_uuid, post stock_ledger (IN, GREIGE_STORE, 1 roll)
- Show roll_uuid as scannable QR (alongside existing display roll_id)

### 3.2 Assignments (`/assignments`) ✅ exists

### 3.3 Batching (`/batching`) ✅ exists — extend
*ERP extension:*
- Batch form: fabric_type picker (links item_id)
- On batch create: post stock_ledger (TRANSFER, rolls OUT of GREIGE_STORE, batch IN to BATCH_HOLD)

---

## 4. Subcontracting (Job Work)

### 4.1 Dispatch Challan (`/challans`) ✅ exists — extend
*ERP extension:*
- Add partner_id picker (DYE_HOUSE or FINISHING_HOUSE)
- On challan: post stock_ledger (OUT from BATCH_HOLD to TRANSIT)

### 4.2 Receipt (`/receipts`) ✅ exists — extend
*ERP extension:*
- On receipt approve: post stock_ledger (IN from TRANSIT to SEMI_FINISHED or FG_STORE)

---

## 5. Warehouse

### 5.1 Yarn Store (`/yarn-store`) ✅ exists — extend
*ERP extension:*
- Show item_id linked lots with item master details
- Bin-level stock view when bin_id is set

### 5.2 Greige Store (`/greige-store`) ✅ exists

### 5.3 Finished Goods (`/finished-goods`) ✅ exists — extend
*ERP extension:*
- Add item_id column; link to item_fabric_attrs for GSM/structure

---

## 6. Dispatch

### 6.1 Dispatch Challans (`/dispatch`) ✅ exists — extend
*ERP extension:*
- Add customer partner_id picker
- On dispatch: post stock_ledger (OUT from FG_STORE)
- Generate PDF delivery challan (print engine, Phase 1)

---

## 7. Quality & Finishing

### 7.1 Finishing & QA (`/finishing`) ✅ exists

---

## 8. Costing

### 8.1 Costing (`/costing`) ✅ exists — extend
*ERP extension (Phase 1):*
- Rate Master: link rates to item_id from Item Master
- Cost entries: populate item_id and partner_id from doc FKs

---

## 9. Reports

### 9.1 Inventory Reports (`/inventory-reports`) ✅ exists

### 9.2 Partner Ledger (`/reports/partner-ledger`) — Phase 2
- Select partner + date range
- Show all GRNs, challans, dispatches, payments

### 9.3 Stock Statement (`/reports/stock-statement`) — Phase 1
- All items with current stock by warehouse, as of date
- Source: stock_ledger running total

### 9.4 GST Reports (`/reports/gst`) — Phase 2
- GSTR-1 (outward supplies), GSTR-2 (inward supplies)

---

## 10. Traceability

### 10.1 Traceability (`/traceability`) ✅ exists
*ERP extension:*
- After roll_uuid added: link QR on physical roll to `/traceability?uuid={uuid}` URL

---

## 11. Admin

### 11.1 Users (`/admin/users`) ✅ exists
*ERP extension:*
- Add department_id and cost_centre_id to user profile
- Show in user list

### 11.2 Audit Log (`/admin/audit`) ✅ exists

### 11.3 Process Routes (`/admin/process-routes`) — Phase 1
- Drag-to-reorder step list per route
- Mark steps as internal/external/optional
- Assign department per step

---

## 12. Print Engine (Phase 1)

All print outputs are HTML rendered to PDF via `puppeteer` (or printable HTML popup in interim).

| Document | Template key | Trigger |
|---|---|---|
| GRN Print | `GRN_PRINT` | GRN approved |
| Yarn Issue Slip | `YARN_ISSUE_SLIP` | Issue approved |
| Delivery Challan | `DELIVERY_CHALLAN` | Dispatch created |
| QR Label (roll) | `QR_LABEL_ROLL` | Roll approved |
| QR Label (lot) | `QR_LABEL_YARN_LOT` | Lot created |
| Batch Slip | `BATCH_SLIP` | Batch created |
| Subcontract Challan | `SC_CHALLAN` | Challan created |

---

## 13. Notification Engine (Phase 2)

Channels: WhatsApp (CallMeBot), in-app toast, email (future).

| Rule | Trigger | Recipients |
|---|---|---|
| Low yarn stock | yarn_lot balance < reorder_level | ADMIN, SUPERVISOR |
| Roll approved | supervisor approves roll | OPERATOR who created |
| QA failed | finishing_records qa_status=FAIL | SUPERVISOR, ADMIN |
| Batch dispatched | challan created | Subcontractor primary contact |
| Overdue GRN | GRN in PENDING > 7 days | ADMIN |

---

## 14. Integration Points

| System | Direction | Data | Phase |
|---|---|---|---|
| BUSY 21 | Export CSV | Production data, yarn consumption | ✅ exists (manual) |
| Odoo (future) | Bidirectional | Partners, PO, invoices | Phase 3 |
| Angel One (project_titan) | N/A | Separate system | N/A |
| DC (Data Collector) | In | Counter data via COM3/TCP | ✅ exists |

---

## 15. Approval Workflows

| Document | Create role | Approve role | Auto-action on approve |
|---|---|---|---|
| Roll | OPERATOR | SUPERVISOR | Generate QR, post greige stock IN |
| GRN | OPERATOR | SUPERVISOR | Post yarn stock IN |
| Yarn Issue | OPERATOR | SUPERVISOR | Deduct yarn lot stock |
| Batch | SUPERVISOR | SUPERVISOR | Post transfer to batch hold |
| Subcontract Challan | SUPERVISOR | SUPERVISOR | Post stock OUT to transit |
| Subcontract Receipt | SUPERVISOR | SUPERVISOR | Post stock IN from transit |
| Dispatch | SUPERVISOR | ADMIN | Post FG stock OUT |

---

## 16. Business Rules Summary

1. **No negative stock** — enforced at API level for yarn lots; extend to stock_ledger
2. **Soft-delete only** — all master data: `is_active = FALSE`, never `DELETE`
3. **Document numbers never reused** — even after cancellation; doc_series sequences only increment
4. **All writes audited** — `audit_logs` entry for every INSERT/UPDATE on business tables
5. **GSTIN uniqueness** — one GSTIN per partner (secondary addresses can have their own)
6. **Process route immutability** — once a roll progresses past a step, that step cannot be voided without ADMIN override
7. **Cost entries auto-generated** — manual cost entries only by ADMIN
8. **FY boundary** — documents dated in a closed FY are rejected at the API
