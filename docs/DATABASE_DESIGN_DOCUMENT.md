# DHOWN ERP — Database Design Document (DDD)
*Version 1.0 — 2026-07-01*
*PostgreSQL 18. All migrations additive. No destructive changes.*

---

## Naming Conventions
- Tables: `snake_case`, plural
- PKs: `{table_singular}_id SERIAL` or UUID where noted
- FKs: `{referenced_table_singular}_id`
- Timestamps: `created_at`, `updated_at` (always present)
- Soft delete: `is_active BOOLEAN DEFAULT TRUE` (never hard-delete master data)
- Money: `NUMERIC(15,2)` in INR
- Weight: `NUMERIC(12,3)` in kg
- Percentage: `NUMERIC(7,4)`

---

## PHASE 0-A — Document Numbering Engine

```sql
CREATE TABLE doc_series (
  series_id    SERIAL PRIMARY KEY,
  series_code  VARCHAR(20) UNIQUE NOT NULL,   -- 'GRN','BATCH','SC','DC','ISS','LOT','PO'
  prefix       VARCHAR(20) NOT NULL,
  suffix       VARCHAR(20) DEFAULT '',
  include_year BOOLEAN DEFAULT TRUE,
  include_month BOOLEAN DEFAULT FALSE,
  zero_pad     INTEGER DEFAULT 4,             -- number of digits
  current_seq  INTEGER DEFAULT 0,
  fin_year     VARCHAR(9),                    -- '2025-26'
  reset_yearly BOOLEAN DEFAULT TRUE,
  last_reset   DATE,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);
-- Seed: migrate existing GRN/LOT/ISS/BATCH/SC/DC prefixes
```

---

## PHASE 0-B — Master Data: Items

```sql
CREATE TABLE item_categories (
  category_id   SERIAL PRIMARY KEY,
  code          VARCHAR(30) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  parent_id     INTEGER REFERENCES item_categories(category_id),
  is_active     BOOLEAN DEFAULT TRUE
);
-- Seed: YARN, GREIGE_FABRIC, SEMI_FINISHED, FINISHED_FABRIC,
--       SPARES, CONSUMABLES, CHEMICALS, DYES, PACKING, SERVICES

CREATE TABLE uom (
  uom_id   SERIAL PRIMARY KEY,
  code     VARCHAR(20) UNIQUE NOT NULL,   -- 'KG','MTR','PCS','CONE','ROLL'
  name     VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE hsn_codes (
  hsn_id    SERIAL PRIMARY KEY,
  hsn_code  VARCHAR(20) UNIQUE NOT NULL,
  description TEXT,
  gst_rate  NUMERIC(5,2) DEFAULT 0
);

CREATE TABLE items (
  item_id          SERIAL PRIMARY KEY,
  item_code        VARCHAR(50) UNIQUE NOT NULL,
  item_name        VARCHAR(200) NOT NULL,
  category_id      INTEGER NOT NULL REFERENCES item_categories(category_id),
  brand            VARCHAR(100),
  description      TEXT,
  uom_id           INTEGER REFERENCES uom(uom_id),
  hsn_id           INTEGER REFERENCES hsn_codes(hsn_id),
  gst_rate         NUMERIC(5,2) DEFAULT 0,
  standard_cost    NUMERIC(15,2) DEFAULT 0,
  selling_price    NUMERIC(15,2),
  reorder_level    NUMERIC(12,3) DEFAULT 0,
  min_stock        NUMERIC(12,3) DEFAULT 0,
  max_stock        NUMERIC(12,3),
  barcode          VARCHAR(100),
  qr_code          VARCHAR(200),
  status           VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE/INACTIVE/DISCONTINUED
  is_active        BOOLEAN DEFAULT TRUE,
  created_by       VARCHAR(80),
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- Yarn-specific attributes
CREATE TABLE item_yarn_attrs (
  item_id         INTEGER PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
  count           VARCHAR(30),          -- '40s', '60s'
  composition     VARCHAR(100),         -- '100% Cotton', '60/40 P/C'
  shade           VARCHAR(80),
  yarn_type       VARCHAR(80),          -- 'Carded', 'Combed', 'OE'
  default_partner_id INTEGER,           -- FK to partners (supplier)
  pref_warehouse_id  INTEGER,           -- FK to warehouses
  pref_rack_id       INTEGER
);

-- Fabric-specific attributes
CREATE TABLE item_fabric_attrs (
  item_id          INTEGER PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
  fabric_code      VARCHAR(50),
  structure        VARCHAR(100),         -- 'Single Jersey', 'Rib 1x1', 'Interlock'
  gsm              NUMERIC(8,2),
  finished_gsm     NUMERIC(8,2),
  width_cm         NUMERIC(6,2),
  finished_width_cm NUMERIC(6,2),
  machine_type     VARCHAR(50),
  gauge            VARCHAR(20),
  dia_inches       NUMERIC(6,2),
  feeders          INTEGER,
  stitch_length_mm NUMERIC(6,3),
  process_route_id INTEGER           -- FK to process_routes
);

-- Spare-specific attributes
CREATE TABLE item_spare_attrs (
  item_id           INTEGER PRIMARY KEY REFERENCES items(item_id) ON DELETE CASCADE,
  oem_part_number   VARCHAR(100),
  compatible_machine VARCHAR(200),
  rack_bin          VARCHAR(50),
  warranty_months   INTEGER,
  default_partner_id INTEGER
);
```

---

## PHASE 0-C — Master Data: Business Partners

```sql
CREATE TABLE partners (
  partner_id      SERIAL PRIMARY KEY,
  partner_code    VARCHAR(30) UNIQUE NOT NULL,
  company_name    VARCHAR(200) NOT NULL,
  short_name      VARCHAR(80),
  gstin           VARCHAR(20),
  pan             VARCHAR(20),
  tan             VARCHAR(20),
  iec             VARCHAR(20),
  cin             VARCHAR(30),
  msme_number     VARCHAR(50),
  msme_category   VARCHAR(10),           -- 'MICRO','SMALL','MEDIUM'
  payment_terms   INTEGER DEFAULT 30,    -- days
  credit_limit    NUMERIC(15,2),
  credit_days     INTEGER DEFAULT 0,
  rating          INTEGER CHECK(rating BETWEEN 1 AND 5),
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      VARCHAR(80),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE partner_roles (
  role_id     SERIAL PRIMARY KEY,
  partner_id  INTEGER NOT NULL REFERENCES partners(partner_id),
  role        VARCHAR(50) NOT NULL,
  -- SUPPLIER, CUSTOMER, KNITTING_SUB, DYE_HOUSE, FINISHING_HOUSE, TRANSPORTER, AGENT
  is_primary  BOOLEAN DEFAULT FALSE,
  UNIQUE(partner_id, role)
);

CREATE TABLE partner_addresses (
  address_id   SERIAL PRIMARY KEY,
  partner_id   INTEGER NOT NULL REFERENCES partners(partner_id),
  address_type VARCHAR(30) DEFAULT 'PRIMARY',  -- PRIMARY, BILLING, SHIPPING, GST
  line1        VARCHAR(200),
  line2        VARCHAR(200),
  city         VARCHAR(100),
  state        VARCHAR(100),
  pincode      VARCHAR(10),
  country      VARCHAR(50) DEFAULT 'India',
  gstin        VARCHAR(20),
  is_default   BOOLEAN DEFAULT FALSE
);

CREATE TABLE partner_contacts (
  contact_id   SERIAL PRIMARY KEY,
  partner_id   INTEGER NOT NULL REFERENCES partners(partner_id),
  name         VARCHAR(100) NOT NULL,
  designation  VARCHAR(100),
  mobile       VARCHAR(20),
  email        VARCHAR(100),
  whatsapp     VARCHAR(20),
  is_primary   BOOLEAN DEFAULT FALSE
);

CREATE TABLE partner_bank (
  bank_id      SERIAL PRIMARY KEY,
  partner_id   INTEGER NOT NULL REFERENCES partners(partner_id),
  bank_name    VARCHAR(100),
  branch       VARCHAR(100),
  account_no   VARCHAR(50),
  ifsc         VARCHAR(20),
  account_type VARCHAR(30) DEFAULT 'CURRENT',
  is_default   BOOLEAN DEFAULT FALSE
);
```

---

## PHASE 0-D — Location Master

```sql
CREATE TABLE warehouses (
  warehouse_id   SERIAL PRIMARY KEY,
  code           VARCHAR(20) UNIQUE NOT NULL,
  name           VARCHAR(100) NOT NULL,
  type           VARCHAR(30) DEFAULT 'INTERNAL',  -- INTERNAL, EXTERNAL, TRANSIT
  address        TEXT,
  is_active      BOOLEAN DEFAULT TRUE
);

CREATE TABLE racks (
  rack_id       SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  code          VARCHAR(30) NOT NULL,
  name          VARCHAR(100),
  is_active     BOOLEAN DEFAULT TRUE,
  UNIQUE(warehouse_id, code)
);

CREATE TABLE bins (
  bin_id    SERIAL PRIMARY KEY,
  rack_id   INTEGER NOT NULL REFERENCES racks(rack_id),
  code      VARCHAR(30) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(rack_id, code)
);
-- Seed: Main Warehouse, Yarn Store, Greige Store, FG Store, Dye House (external)
```

---

## PHASE 0-E — Other Masters

```sql
CREATE TABLE financial_years (
  fy_id        SERIAL PRIMARY KEY,
  label        VARCHAR(9) UNIQUE NOT NULL,   -- '2025-26'
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_active    BOOLEAN DEFAULT FALSE,
  is_closed    BOOLEAN DEFAULT FALSE
);

CREATE TABLE departments (
  dept_id   SERIAL PRIMARY KEY,
  code      VARCHAR(20) UNIQUE NOT NULL,
  name      VARCHAR(100) NOT NULL,
  head_user VARCHAR(80),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE cost_centres (
  cc_id     SERIAL PRIMARY KEY,
  code      VARCHAR(20) UNIQUE NOT NULL,
  name      VARCHAR(100) NOT NULL,
  dept_id   INTEGER REFERENCES departments(dept_id),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE tax_rates (
  tax_id    SERIAL PRIMARY KEY,
  code      VARCHAR(20) UNIQUE NOT NULL,
  name      VARCHAR(50) NOT NULL,
  cgst      NUMERIC(5,2) DEFAULT 0,
  sgst      NUMERIC(5,2) DEFAULT 0,
  igst      NUMERIC(5,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);
```

---

## PHASE 0-F — Process Routes

```sql
CREATE TABLE process_routes (
  route_id    SERIAL PRIMARY KEY,
  code        VARCHAR(30) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  item_category VARCHAR(50),   -- which item category uses this route
  is_active   BOOLEAN DEFAULT TRUE,
  created_by  VARCHAR(80),
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE process_route_steps (
  step_id        SERIAL PRIMARY KEY,
  route_id       INTEGER NOT NULL REFERENCES process_routes(route_id) ON DELETE CASCADE,
  step_order     INTEGER NOT NULL,
  step_code      VARCHAR(30) NOT NULL,
  step_name      VARCHAR(100) NOT NULL,
  location_type  VARCHAR(30),        -- INTERNAL, EXTERNAL
  dept_id        INTEGER REFERENCES departments(dept_id),
  generates_document VARCHAR(50),    -- 'CHALLAN','GRN','BATCH_SLIP' etc
  is_optional    BOOLEAN DEFAULT FALSE,
  UNIQUE(route_id, step_order)
);
-- Seed default route: KNIT→GREIGE→BATCH→DYE→SEMI→FINISH→FG→DISPATCH
```

---

## PHASE 0-G — Attachment Engine

```sql
CREATE TABLE attachments (
  attachment_id  SERIAL PRIMARY KEY,
  entity_type    VARCHAR(50) NOT NULL,   -- 'ITEM','PARTNER','GRN','ROLL' etc
  entity_id      VARCHAR(100) NOT NULL,
  file_type      VARCHAR(30),            -- 'QR','LABEL','PHOTO','DOC','PDF'
  file_name      VARCHAR(200),
  file_path      VARCHAR(500),           -- relative to /uploads/
  file_size_kb   INTEGER,
  mime_type      VARCHAR(100),
  uploaded_by    VARCHAR(80),
  created_at     TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);
```

---

## PHASE 1 — Extend existing tables with master data FKs

```sql
-- grn: add partner FK (additive, free-text column stays)
ALTER TABLE grn ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(partner_id);
ALTER TABLE grn ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(warehouse_id);

-- yarn_lots: add item FK
ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES items(item_id);
ALTER TABLE yarn_lots ADD COLUMN IF NOT EXISTS bin_id INTEGER REFERENCES bins(bin_id);

-- yarn_issues: add cost_centre FK
ALTER TABLE yarn_issues ADD COLUMN IF NOT EXISTS cost_centre_id INTEGER REFERENCES cost_centres(cc_id);

-- batches: no change needed — fabric_type stays free text initially

-- subcontract_challans: add partner FK
ALTER TABLE subcontract_challans ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(partner_id);

-- dispatch_challans: add partner FK
ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES partners(partner_id);

-- rolls: add UUID for permanent traceability
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS roll_uuid UUID DEFAULT gen_random_uuid();

-- cost_rates: link to items
ALTER TABLE cost_rates ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES items(item_id);
```

---

## PHASE 1 — Unified Stock Ledger

```sql
CREATE TABLE stock_ledger (
  ledger_id      BIGSERIAL PRIMARY KEY,
  txn_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  txn_time       TIMESTAMP DEFAULT NOW(),
  doc_type       VARCHAR(30) NOT NULL,   -- 'GRN','ISSUE','BATCH','CHALLAN','RECEIPT','DISPATCH'
  doc_id         VARCHAR(100) NOT NULL,  -- reference doc number
  item_id        INTEGER REFERENCES items(item_id),
  item_desc      VARCHAR(200),           -- fallback for unlinked items
  warehouse_id   INTEGER REFERENCES warehouses(warehouse_id),
  rack_id        INTEGER REFERENCES racks(rack_id),
  bin_id         INTEGER REFERENCES bins(bin_id),
  movement_type  VARCHAR(20) NOT NULL,   -- 'IN','OUT','TRANSFER'
  quantity       NUMERIC(12,3) NOT NULL,
  uom_id         INTEGER REFERENCES uom(uom_id),
  unit_cost      NUMERIC(15,2),
  total_cost     NUMERIC(15,2),
  partner_id     INTEGER REFERENCES partners(partner_id),
  notes          TEXT,
  created_by     VARCHAR(80),
  created_at     TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_stock_ledger_doc ON stock_ledger(doc_type, doc_id);
CREATE INDEX idx_stock_ledger_item ON stock_ledger(item_id, txn_date);
CREATE INDEX idx_stock_ledger_wh ON stock_ledger(warehouse_id, txn_date);
```

---

## Migration Strategy

All migrations are in numbered files: `migration_erp_phase0a.js`, `migration_erp_phase0b.js`, etc.
Each file is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
Run order: 0a → 0b → 0c → 0d → 0e → 0f → 0g → 1a → 1b.
Rollback: each migration has a corresponding `rollback_erp_phase0a.js` that drops only the new objects.

---

## Index Strategy

| Table | Index |
|---|---|
| items | item_code, category_id, status |
| partners | partner_code, gstin |
| partner_roles | partner_id, role |
| stock_ledger | doc_type+doc_id, item_id+txn_date, warehouse_id+txn_date |
| process_route_steps | route_id+step_order |
| attachments | entity_type+entity_id |
