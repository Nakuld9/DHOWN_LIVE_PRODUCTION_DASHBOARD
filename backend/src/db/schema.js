// Schema bootstrap — creates/ensures tables + seeds the default admin.
// Called once at server start (see server.listen in server.js).

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../../config/database");

// Seed the 'admin' user only if it does not already exist. The initial password
// comes from ADMIN_DEFAULT_PASSWORD; if that is unset we generate a random one
// and print it ONCE at startup — we never fall back to a known weak default.
// Rotate later with: node scripts/set-admin-password.js
async function seedDefaultAdmin() {
  try {
    // deleted_at IS NULL matters: a soft-deleted 'admin' must not stop a
    // usable one being created, or a mis-click would lock everyone out.
    const existing = await pool.query(
      `SELECT id FROM users WHERE username = 'admin' AND deleted_at IS NULL`);
    if (existing.rows.length === 0) {
      const generated = !process.env.ADMIN_DEFAULT_PASSWORD;
      const password = process.env.ADMIN_DEFAULT_PASSWORD || crypto.randomBytes(9).toString("base64url");
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO users (username, full_name, password_hash, role)
         VALUES ('admin', 'System Administrator', $1, 'SUPER_ADMIN')`,
        [hash]
      );
      if (generated) {
        console.log(`Default admin created. One-time password: ${password}  (change it now — this is shown only once)`);
      } else {
        console.log("Default admin created from ADMIN_DEFAULT_PASSWORD.");
      }
    }
  } catch (err) {
    console.error("Seed admin error:", err.message);
  }
}

async function ensureProductionHistory() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS production_history (
        id            BIGSERIAL     PRIMARY KEY,
        machine_id    VARCHAR(20)   NOT NULL,
        period_type   VARCHAR(10)   NOT NULL,
        period_start  TIMESTAMPTZ   NOT NULL,
        period_end    TIMESTAMPTZ   NOT NULL,
        shift         VARCHAR(2)    NOT NULL DEFAULT '',
        record_date   DATE          NOT NULL,
        hour_bucket   SMALLINT      NOT NULL DEFAULT -1,
        counter_start NUMERIC(12,0) NOT NULL DEFAULT 0,
        counter_end   NUMERIC(12,0) NOT NULL DEFAULT 0,
        production_kg NUMERIC(10,4) NOT NULL DEFAULT 0,
        rpm_avg       NUMERIC(6,2)  NOT NULL DEFAULT 0,
        sample_count  INT           NOT NULL DEFAULT 1,
        created_at    TIMESTAMPTZ   DEFAULT NOW(),
        updated_at    TIMESTAMPTZ   DEFAULT NOW(),
        CONSTRAINT chk_period_type CHECK (period_type IN ('HOURLY','SHIFT','DAILY')),
        UNIQUE(machine_id, period_type, record_date, hour_bucket, shift)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_hist_machine_date ON production_history(machine_id, record_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_hist_period_date  ON production_history(period_type, record_date)`);
    // operator_assignments is hammered by LATERAL joins (machine_id + status='ACTIVE')
    // across alerts / command-center / work-center / active-operators.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_oa_machine_status  ON operator_assignments(machine_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_oa_status_assigned ON operator_assignments(status, assigned_at DESC)`);
    console.log("production_history table ready");
  } catch (err) {
    console.error("ensureProductionHistory error:", err.message);
  }
}

async function ensureMaintenanceSchema() {
  try {
    // Spare parts master
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spare_parts (
        id            BIGSERIAL     PRIMARY KEY,
        part_name     VARCHAR(200)  NOT NULL,
        sku           VARCHAR(100)  UNIQUE,
        category      VARCHAR(100)  DEFAULT 'GENERAL',
        unit          VARCHAR(20)   DEFAULT 'pcs',
        min_stock     NUMERIC(10,2) DEFAULT 0,
        current_stock NUMERIC(10,2) DEFAULT 0,
        location      VARCHAR(100),
        notes         TEXT,
        created_at    TIMESTAMPTZ   DEFAULT NOW(),
        updated_at    TIMESTAMPTZ   DEFAULT NOW()
      )
    `);
    // Spare parts stock movements
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spare_part_movements (
        id            BIGSERIAL     PRIMARY KEY,
        part_id       BIGINT        NOT NULL REFERENCES spare_parts(id),
        movement_type VARCHAR(20)   NOT NULL CHECK (movement_type IN ('RECEIVED','CONSUMED','ADJUSTMENT','RETURNED')),
        quantity      NUMERIC(10,2) NOT NULL,
        reference     VARCHAR(200),
        notes         TEXT,
        created_by    VARCHAR(50),
        created_at    TIMESTAMPTZ   DEFAULT NOW()
      )
    `);
    // Maintenance work orders
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maintenance_work_orders (
        id                BIGSERIAL     PRIMARY KEY,
        machine_id        VARCHAR(20)   NOT NULL REFERENCES machines(machine_id),
        title             VARCHAR(200)  NOT NULL,
        description       TEXT,
        work_order_type   VARCHAR(30)   DEFAULT 'BREAKDOWN' CHECK (work_order_type IN ('BREAKDOWN','PREVENTIVE','ROUTINE','CALIBRATION','REPLACEMENT','INSPECTION','OTHER')),
        priority          VARCHAR(10)   DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        status            VARCHAR(20)   DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
        assigned_to       VARCHAR(100),
        reported_by       VARCHAR(100),
        completed_by      VARCHAR(100),
        opened_at         TIMESTAMPTZ   DEFAULT NOW(),
        started_at        TIMESTAMPTZ,
        completed_at      TIMESTAMPTZ,
        downtime_hours    NUMERIC(8,2)  DEFAULT 0,
        total_cost        NUMERIC(12,2) DEFAULT 0,
        resolution_notes  TEXT,
        created_at        TIMESTAMPTZ   DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   DEFAULT NOW()
      )
    `);
    // Work order parts usage
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wo_parts_used (
        id              BIGSERIAL     PRIMARY KEY,
        wo_id           BIGINT        NOT NULL REFERENCES maintenance_work_orders(id),
        part_id         BIGINT        NOT NULL REFERENCES spare_parts(id),
        quantity        NUMERIC(10,2) NOT NULL,
        unit_cost       NUMERIC(10,2) DEFAULT 0,
        total_cost      NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
        notes           TEXT,
        created_at      TIMESTAMPTZ   DEFAULT NOW()
      )
    `);
    // Needle & sinker change log — a high-frequency knitting consumable, tracked
    // per machine so we get exact needle/sinker costing. total_cost is derived so
    // it can never drift from the quantities × rates that produced it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS needle_sinker_changes (
        id                BIGSERIAL     PRIMARY KEY,
        machine_id        VARCHAR(20)   NOT NULL REFERENCES machines(machine_id),
        change_date       DATE          NOT NULL DEFAULT CURRENT_DATE,
        needles_qty       INTEGER       NOT NULL DEFAULT 0,
        sinkers_qty       INTEGER       NOT NULL DEFAULT 0,
        needle_unit_cost  NUMERIC(10,2) NOT NULL DEFAULT 0,
        sinker_unit_cost  NUMERIC(10,2) NOT NULL DEFAULT 0,
        total_cost        NUMERIC(12,2) GENERATED ALWAYS AS
                            (needles_qty * needle_unit_cost + sinkers_qty * sinker_unit_cost) STORED,
        reason            VARCHAR(120),
        notes             TEXT,
        changed_by        VARCHAR(100),
        created_at        TIMESTAMPTZ   DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nsc_machine ON needle_sinker_changes(machine_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nsc_date ON needle_sinker_changes(change_date)`);
    // Link a change to the exact spare parts consumed (machine-exact costing). The
    // "secondary" line is a sinker on single-bed machines and a dial needle on
    // double-bed (IL/RB) — secondary_kind records which.
    await pool.query(`ALTER TABLE needle_sinker_changes ADD COLUMN IF NOT EXISTS secondary_kind VARCHAR(10) NOT NULL DEFAULT 'SINKER'`);
    await pool.query(`ALTER TABLE needle_sinker_changes ADD COLUMN IF NOT EXISTS primary_part_id BIGINT`);
    await pool.query(`ALTER TABLE needle_sinker_changes ADD COLUMN IF NOT EXISTS secondary_part_id BIGINT`);

    // Multi-line needle-change document: a change on a machine is a SET of parts
    // (several needle butt types + sinkers), not one needle. The header groups the
    // lines; each line is a CONSUMED movement tagged with needle_change_id + machine.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS needle_change (
        id           BIGSERIAL    PRIMARY KEY,
        machine_id   VARCHAR(20)  NOT NULL REFERENCES machines(machine_id),
        change_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
        reason       VARCHAR(120),
        notes        TEXT,
        changed_by   VARCHAR(100),
        created_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS needle_change_id BIGINT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_spm_ncid ON spare_part_movements(needle_change_id)`);

    // Automated payment-reminder log — one row per reminder sent, so a customer is
    // never reminded more than once per cooldown window.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_reminder_log (
        id           BIGSERIAL   PRIMARY KEY,
        partner_id   INT         NOT NULL,
        phone        VARCHAR(20),
        amount_rs    NUMERIC(14,2),
        overdue_days INT,
        template     VARCHAR(60),
        status       VARCHAR(20) DEFAULT 'SENT',
        sent_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prl_partner ON payment_reminder_log(partner_id, sent_at)`);

    // Preventive-maintenance auto-scheduling: remember the last due-date we raised a
    // work order for, so the watcher raises exactly one WO per due cycle.
    await pool.query(`ALTER TABLE maintenance_schedule ADD COLUMN IF NOT EXISTS last_wo_raised DATE`).catch(() => {});

    // A change is either a FULL_BED replacement (starts a new needle-life cycle) or a
    // BREAKAGE repair (individual needles replaced mid-cycle, added to the open cycle).
    await pool.query(`ALTER TABLE needle_change ADD COLUMN IF NOT EXISTS change_type VARCHAR(10) NOT NULL DEFAULT 'BREAKAGE'`);

    // Needle-life cycle: from one full-bed fit to the next. The actual needle cost per
    // kg is (set cost + breakage costs during the cycle) / kg produced in that window.
    // Kg comes from production_history between started_on and ended_on.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS needle_life_cycle (
        id                BIGSERIAL    PRIMARY KEY,
        machine_id        VARCHAR(20)  NOT NULL REFERENCES machines(machine_id),
        started_on        DATE         NOT NULL,
        ended_on          DATE,
        opening_change_id BIGINT,
        closing_change_id BIGINT,
        set_cost          NUMERIC(14,2) DEFAULT 0,
        breakage_cost     NUMERIC(14,2) DEFAULT 0,
        kgs_produced      NUMERIC(14,2),
        cost_per_kg       NUMERIC(12,4),
        created_at        TIMESTAMPTZ  DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nlc_machine ON needle_life_cycle(machine_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_nlc_open ON needle_life_cycle(machine_id) WHERE ended_on IS NULL`);

    // The set of spare parts each machine normally uses (its needle butts + sinker).
    // default_qty is the full-set count so a change pre-loads the whole set in one click.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_part (
        id           BIGSERIAL   PRIMARY KEY,
        machine_id   VARCHAR(20) NOT NULL REFERENCES machines(machine_id),
        part_id      BIGINT      NOT NULL REFERENCES spare_parts(id),
        default_qty  INTEGER,
        position     INT         DEFAULT 0,
        UNIQUE (machine_id, part_id)
      )
    `);

    // Convertible machines: a machine can run in more than one gauge (e.g. SJ 20G⇄28G),
    // each config with its own part set. machine_config holds the configs; a part set
    // line belongs to a config (config_id) or to the machine directly (NULL = the only
    // set, for non-convertible machines). One config per machine is active at a time.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_config (
        id          BIGSERIAL   PRIMARY KEY,
        machine_id  VARCHAR(20) NOT NULL REFERENCES machines(machine_id),
        label       VARCHAR(40) NOT NULL,
        gauge       INTEGER,
        is_active   BOOLEAN     NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (machine_id, label)
      )
    `);
    await pool.query(`ALTER TABLE machine_part ADD COLUMN IF NOT EXISTS config_id BIGINT`);
    // Which bed a part feeds: CYLINDER | DIAL | SINKER. Lets Needle Capacity auto-derive
    // cylinder_needles / dial_needles / sinker_count from the ACTIVE config's part set.
    await pool.query(`ALTER TABLE machine_part ADD COLUMN IF NOT EXISTS bed VARCHAR(10)`);
    // The old UNIQUE(machine_id, part_id) blocks the same part in two configs; widen it.
    await pool.query(`ALTER TABLE machine_part DROP CONSTRAINT IF EXISTS machine_part_machine_id_part_id_key`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_machine_cfg_part ON machine_part (machine_id, COALESCE(config_id, 0), part_id)`);

    // Needle capacity per machine — how many needles a full set is. Single-bed
    // machines (SJ, TV) use cylinder only; double-bed (IL interlock, RB rib) also
    // carry a dial bed. Stored per machine because it depends on gauge + diameter
    // and the exact spec count, which the mill knows better than any formula.
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS cylinder_needles INTEGER`);
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS dial_needles INTEGER`);
    // Sinkers are the single-jersey (SJ/TV) second bed, kept in their own column so
    // dial needles (IL/RB) and sinkers are never conflated. Migrate any single-bed
    // values previously parked in dial_needles into sinker_count.
    await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS sinker_count INTEGER`);
    await pool.query(`UPDATE machines
                         SET sinker_count = dial_needles, dial_needles = NULL
                       WHERE UPPER(machine_type) NOT IN ('IL','RB','DJ')
                         AND dial_needles IS NOT NULL AND sinker_count IS NULL`);

    // Spare-part purchase cost + issue-to-machine. A RECEIVED movement is a purchase
    // (unit_cost, supplier); a CONSUMED movement can be tagged with the machine it was
    // issued to, so spend rolls up per machine. total_cost is derived from qty × rate.
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2)`);
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS supplier VARCHAR(120)`);
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS machine_id VARCHAR(20)`);
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2)
                        GENERATED ALWAYS AS (quantity * COALESCE(unit_cost,0)) STORED`).catch(() => {});
    // GST rate on the purchase line. unit_cost/total_cost stay the BASE (ex-GST)
    // value — that is the stock/needle cost, since input GST is claimed as ITC. The
    // GST amount and grand total are derived from this rate for the receipt document.
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) DEFAULT 18`);
    // Costed stock on the part itself: latest buy price + moving-average cost.
    await pool.query(`ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS last_unit_cost NUMERIC(12,2)`);
    await pool.query(`ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(12,2)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_spm_machine ON spare_part_movements(machine_id)`);

    // Spare goods-receipt document: one header, many part lines. Each line is a
    // RECEIVED movement tagged with grn_id, so stock/cost stay driven by movements
    // while purchases are grouped into an editable document (GRN-style navigator).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spare_grn (
        id          BIGSERIAL     PRIMARY KEY,
        grn_no      VARCHAR(30)   UNIQUE,
        grn_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
        supplier    VARCHAR(120),
        reference   VARCHAR(120),
        notes       TEXT,
        created_by  VARCHAR(50),
        created_at  TIMESTAMPTZ   DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE spare_part_movements ADD COLUMN IF NOT EXISTS grn_id BIGINT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_spm_grn ON spare_part_movements(grn_id)`);

    // Add cost/parts columns to existing maintenance_records
    await pool.query(`ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS work_order_id BIGINT`);
    await pool.query(`ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS parts_used TEXT`);

    console.log("Maintenance schema ready");
  } catch (err) {
    console.error("ensureMaintenanceSchema error:", err.message);
  }
}

async function ensureUsersSchema() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(100)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
    console.log("Users schema ready");
  } catch (err) { console.error("ensureUsersSchema error:", err.message); }
}

async function ensureOperatorsSchema() {
  try {
    // worker_type: Operator/Helper/Supervisor/Master/Driver — drives the
    // auto-generated code prefix (OP/HP/SV/MS/DR) in the operators service.
    await pool.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS worker_type VARCHAR(20) DEFAULT 'OPERATOR'`);
    await pool.query(`UPDATE operators SET worker_type = 'OPERATOR' WHERE worker_type IS NULL`);
    // Wage fields drive payroll: DAILY rate × attendance days, or flat MONTHLY.
    await pool.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS wage_type VARCHAR(10) DEFAULT 'DAILY'`);
    await pool.query(`ALTER TABLE operators ADD COLUMN IF NOT EXISTS wage_rate NUMERIC(12,2) DEFAULT 0`);
    console.log("Operators schema ready");
  } catch (err) { console.error("ensureOperatorsSchema error:", err.message); }
}

async function ensurePurchaseOrdersSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        po_id         SERIAL PRIMARY KEY,
        po_number     VARCHAR(30) UNIQUE NOT NULL,
        partner_id    INTEGER,
        supplier_name VARCHAR(200),
        order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
        expected_date DATE,
        status        VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        payment_terms VARCHAR(100),
        notes         TEXT,
        total_amount  NUMERIC(14,2) DEFAULT 0,
        created_by    VARCHAR(100),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        po_item_id   SERIAL PRIMARY KEY,
        po_id        INTEGER NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
        item_id      INTEGER,
        item_name    VARCHAR(200),
        description  TEXT,
        quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
        uom          VARCHAR(20) DEFAULT 'KG',
        rate         NUMERIC(14,2) DEFAULT 0,
        amount       NUMERIC(14,2) DEFAULT 0,
        received_qty NUMERIC(14,3) DEFAULT 0,
        created_at   TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id)`);
    await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_mobile VARCHAR(20)`);
    console.log("Purchase orders schema ready");
  } catch (err) { console.error("ensurePurchaseOrdersSchema error:", err.message); }
}

async function ensureSalesOrdersSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        so_id         SERIAL PRIMARY KEY,
        so_number     VARCHAR(30) UNIQUE NOT NULL,
        partner_id    INTEGER,
        customer_name VARCHAR(200),
        order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
        delivery_date DATE,
        status        VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        payment_terms VARCHAR(100),
        notes         TEXT,
        total_amount  NUMERIC(14,2) DEFAULT 0,
        created_by    VARCHAR(100),
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_order_items (
        so_item_id     SERIAL PRIMARY KEY,
        so_id          INTEGER NOT NULL REFERENCES sales_orders(so_id) ON DELETE CASCADE,
        item_id        INTEGER,
        item_name      VARCHAR(200),
        description    TEXT,
        quantity       NUMERIC(14,3) NOT NULL DEFAULT 0,
        uom            VARCHAR(20) DEFAULT 'KG',
        rate           NUMERIC(14,2) DEFAULT 0,
        amount         NUMERIC(14,2) DEFAULT 0,
        dispatched_qty NUMERIC(14,3) DEFAULT 0,
        created_at     TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_so_items_so ON sales_order_items(so_id)`);
    console.log("Sales orders schema ready");
  } catch (err) { console.error("ensureSalesOrdersSchema error:", err.message); }
}

async function ensureProductionPlansSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS production_plans (
        plan_id         SERIAL PRIMARY KEY,
        plan_number     VARCHAR(30) UNIQUE NOT NULL,
        item_id         INTEGER,
        item_name       VARCHAR(200),
        target_qty_kg   NUMERIC(14,3) NOT NULL DEFAULT 0,
        produced_qty_kg NUMERIC(14,3) DEFAULT 0,
        machine_id      VARCHAR(30),
        so_id           INTEGER,
        so_number       VARCHAR(30),
        priority        VARCHAR(10) DEFAULT 'MEDIUM',
        planned_start   DATE,
        planned_end     DATE,
        status          VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
        notes           TEXT,
        created_by      VARCHAR(100),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )`);
    // plan_type: MTO (make-to-order, against a sales order) or MTS (make-to-stock).
    await pool.query(`ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS plan_type VARCHAR(4) DEFAULT 'MTS'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_plans_status ON production_plans(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_plans_machine ON production_plans(machine_id)`);
    console.log("Production plans schema ready");
  } catch (err) { console.error("ensureProductionPlansSchema error:", err.message); }
}

async function ensurePayrollSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        run_id      SERIAL PRIMARY KEY,
        run_number  VARCHAR(30) UNIQUE NOT NULL,
        period_from DATE NOT NULL,
        period_to   DATE NOT NULL,
        status      VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        total_net   NUMERIC(14,2) DEFAULT 0,
        notes       TEXT,
        created_by  VARCHAR(100),
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payroll_items (
        item_id       SERIAL PRIMARY KEY,
        run_id        INTEGER NOT NULL REFERENCES payroll_runs(run_id) ON DELETE CASCADE,
        operator_id   INTEGER,
        operator_code VARCHAR(20),
        operator_name VARCHAR(200),
        worker_type   VARCHAR(20),
        wage_type     VARCHAR(10) DEFAULT 'DAILY',
        wage_rate     NUMERIC(12,2) DEFAULT 0,
        days_present  NUMERIC(6,1) DEFAULT 0,
        gross_amount  NUMERIC(14,2) DEFAULT 0,
        overtime      NUMERIC(14,2) DEFAULT 0,
        bonus         NUMERIC(14,2) DEFAULT 0,
        deductions    NUMERIC(14,2) DEFAULT 0,
        advance       NUMERIC(14,2) DEFAULT 0,
        net_amount    NUMERIC(14,2) DEFAULT 0,
        notes         TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(run_id)`);
    console.log("Payroll schema ready");
  } catch (err) { console.error("ensurePayrollSchema error:", err.message); }
}

async function ensureAlertAcksSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_alert_acks (
        id           SERIAL PRIMARY KEY,
        machine_id   VARCHAR(30),
        ack_by       VARCHAR(30),
        message_text TEXT,
        created_at   TIMESTAMP DEFAULT NOW()
      )`);
    console.log("Alert acks schema ready");
  } catch (err) { console.error("ensureAlertAcksSchema error:", err.message); }
}

async function ensureTaxInvoicesSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tax_invoices (
        invoice_id       SERIAL PRIMARY KEY,
        invoice_number   VARCHAR(30) UNIQUE NOT NULL,
        invoice_date     DATE NOT NULL DEFAULT CURRENT_DATE,
        partner_id       INTEGER,
        customer_name    VARCHAR(200),
        customer_gstin   VARCHAR(20),
        customer_address TEXT,
        customer_state   VARCHAR(60),
        place_of_supply  VARCHAR(60),
        supply_type      VARCHAR(10) DEFAULT 'INTRA',
        so_id            INTEGER,
        so_number        VARCHAR(30),
        status           VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        taxable_value    NUMERIC(14,2) DEFAULT 0,
        cgst_amount      NUMERIC(14,2) DEFAULT 0,
        sgst_amount      NUMERIC(14,2) DEFAULT 0,
        igst_amount      NUMERIC(14,2) DEFAULT 0,
        total_tax        NUMERIC(14,2) DEFAULT 0,
        round_off        NUMERIC(8,2)  DEFAULT 0,
        grand_total      NUMERIC(14,2) DEFAULT 0,
        notes            TEXT,
        created_by       VARCHAR(100),
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tax_invoice_items (
        line_id       SERIAL PRIMARY KEY,
        invoice_id    INTEGER NOT NULL REFERENCES tax_invoices(invoice_id) ON DELETE CASCADE,
        item_id       INTEGER,
        item_name     VARCHAR(200),
        hsn_code      VARCHAR(20),
        quantity      NUMERIC(14,3) NOT NULL DEFAULT 0,
        uom           VARCHAR(20) DEFAULT 'KG',
        rate          NUMERIC(14,2) DEFAULT 0,
        taxable_value NUMERIC(14,2) DEFAULT 0,
        gst_rate      NUMERIC(5,2) DEFAULT 0,
        cgst_amount   NUMERIC(14,2) DEFAULT 0,
        sgst_amount   NUMERIC(14,2) DEFAULT 0,
        igst_amount   NUMERIC(14,2) DEFAULT 0,
        line_total    NUMERIC(14,2) DEFAULT 0
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tax_inv_items_inv ON tax_invoice_items(invoice_id)`);
    await pool.query(`ALTER TABLE tax_invoices ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(20)`);
    console.log("Tax invoices schema ready");
  } catch (err) { console.error("ensureTaxInvoicesSchema error:", err.message); }
}

async function ensureCollectorRollSchema() {
  try {
    // Last-seen cumulative roll (doff) count per machine — lets /api/live-data detect
    // each green-lamp roll-complete pulse and auto cut+open the next roll.
    await pool.query(`ALTER TABLE machine_live_data ADD COLUMN IF NOT EXISTS rolls_counter INTEGER DEFAULT 0`);
    // Distinguish machine-cut rolls from hand-created ones.
    await pool.query(`ALTER TABLE rolls ADD COLUMN IF NOT EXISTS source VARCHAR(10) DEFAULT 'MANUAL'`);
    console.log("collector roll schema ready (machine_live_data.rolls_counter, rolls.source)");
  } catch (err) {
    console.error("ensureCollectorRollSchema error:", err.message);
  }
}

// WhatsApp AI CRM (Phase 1) — conversations, messages, AI audit, leads, follow-ups.
// See docs/WHATSAPP_CRM_DESIGN.md. partners/items/sales_orders stay the source of truth.
async function ensureWaCrmSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_conversations (
        conversation_id BIGSERIAL PRIMARY KEY,
        phone           VARCHAR(20) UNIQUE NOT NULL,
        display_name    VARCHAR(120),
        partner_id      INT,
        lead_id         BIGINT,
        ai_mode         VARCHAR(10) NOT NULL DEFAULT 'SUGGEST',  -- OFF | SUGGEST | AUTO
        assigned_to     VARCHAR(60),
        unread_count    INT NOT NULL DEFAULT 0,
        last_message    TEXT,
        last_message_at TIMESTAMP,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS wa_messages (
        message_id      BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES wa_conversations(conversation_id) ON DELETE CASCADE,
        direction       VARCHAR(3) NOT NULL,          -- IN | OUT
        wa_message_id   VARCHAR(120),
        msg_type        VARCHAR(20) NOT NULL DEFAULT 'text',
        body            TEXT,
        media_id        VARCHAR(120),
        media_mime      VARCHAR(80),
        caption         TEXT,
        sent_by         VARCHAR(60),                  -- MES user for OUT
        ai_generated    BOOLEAN NOT NULL DEFAULT FALSE,
        status          VARCHAR(20) DEFAULT 'received',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_wa_messages_conv ON wa_messages(conversation_id, created_at DESC);
      -- Meta redelivers any webhook event it did not get a timely 200 for, so the
      -- same wamid can arrive several times. This constraint is what actually
      -- guarantees one row per message — the application check races under
      -- concurrent retries. Partial because our own outbound rows have no wamid
      -- until Meta replies, and several NULLs must remain legal.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_wamid
        ON wa_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
      -- Every inbound wamid we have already handled, whichever path handled it.
      -- wa_messages alone is not enough: staff alert-acknowledgements are never
      -- stored there, so a redelivered staff reply would acknowledge twice and
      -- send the supervisor a second confirmation.
      -- Consent (Meta Business Messaging policy + India DPDP Act 2023).
      -- Purpose matters: a customer who messages us gives implied permission for
      -- SERVICE replies, but marketing needs explicit opt-in, and either can be
      -- withdrawn. One boolean would conflate all three and be wrong.
      CREATE TABLE IF NOT EXISTS wa_consent (
        consent_id   BIGSERIAL PRIMARY KEY,
        phone        VARCHAR(20) UNIQUE NOT NULL,
        partner_id   INT,
        status       VARCHAR(20) NOT NULL DEFAULT 'IMPLIED', -- IMPLIED | OPTED_IN | OPTED_OUT
        marketing_ok BOOLEAN NOT NULL DEFAULT FALSE,
        source       VARCHAR(40),          -- INBOUND_MESSAGE | STAFF | IMPORT | CUSTOMER_REPLY
        proof_ref    TEXT,                 -- wamid / document reference for the evidence trail
        granted_at   TIMESTAMP,
        revoked_at   TIMESTAMP,
        revoke_reason TEXT,
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- Append-only: this is the evidence a regulator or Meta would ask for.
      CREATE TABLE IF NOT EXISTS wa_consent_log (
        log_id     BIGSERIAL PRIMARY KEY,
        phone      VARCHAR(20) NOT NULL,
        action     VARCHAR(30) NOT NULL,   -- IMPLIED | OPT_IN | OPT_OUT | BLOCKED_SEND
        purpose    VARCHAR(20),
        detail     TEXT,
        actor      VARCHAR(60),            -- username, 'CUSTOMER' or 'SYSTEM'
        proof_ref  TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_wa_consent_log_phone ON wa_consent_log(phone, created_at DESC);
      -- Credential lifecycle (CRIT-08). Stores REFERENCES and expiry only —
      -- never a secret value. The point is to know what expires when, so token
      -- expiry stops being an unscheduled outage.
      CREATE TABLE IF NOT EXISTS integration_credentials (
        cred_id     BIGSERIAL PRIMARY KEY,
        provider    VARCHAR(40) UNIQUE NOT NULL,
        env_var     VARCHAR(60),
        label       VARCHAR(120),
        expires_at  TIMESTAMP,
        rotated_at  TIMESTAMP,
        rotated_by  VARCHAR(60),
        notes       TEXT,
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- Distributed job locks (CRIT-06). Scheduled work runs on in-process
      -- timers, so a second instance would duplicate every job. A lease here
      -- means exactly one instance runs each job, and a crashed holder's lease
      -- simply expires rather than blocking forever.
      CREATE TABLE IF NOT EXISTS job_locks (
        job_name     VARCHAR(60) PRIMARY KEY,
        locked_by    VARCHAR(80),
        locked_until TIMESTAMP,
        last_run_at  TIMESTAMP,
        last_status  VARCHAR(20),
        last_error   TEXT
      );
      -- Durable inbound queue (CRIT-01). The webhook persists the raw envelope
      -- and acks Meta immediately; a worker processes it afterwards. Previously
      -- media download, vision and two LLM calls ran inline AFTER the ack, so a
      -- crash or deploy mid-processing lost the customer's message permanently —
      -- Meta had already been told we had it and would never redeliver.
      CREATE TABLE IF NOT EXISTS wa_webhook_events (
        event_id     BIGSERIAL PRIMARY KEY,
        payload      JSONB NOT NULL,
        status       VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING|WORKING|DONE|DEAD
        attempts     INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
        locked_by    VARCHAR(80),
        last_error   TEXT,
        received_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_wa_events_claim
        ON wa_webhook_events(status, next_attempt_at) WHERE status = 'PENDING';
      CREATE INDEX IF NOT EXISTS idx_wa_events_dead
        ON wa_webhook_events(received_at DESC) WHERE status = 'DEAD';
      CREATE TABLE IF NOT EXISTS wa_processed_events (
        wa_message_id VARCHAR(120) PRIMARY KEY,
        handled_by    VARCHAR(20),
        queue_event_id BIGINT,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- Which queue event claimed this wamid. A RETRY of the same event must be
      -- allowed through the duplicate guard, otherwise the retry silently drops
      -- the customer's message and the queue's purpose is defeated.
      ALTER TABLE wa_processed_events ADD COLUMN IF NOT EXISTS queue_event_id BIGINT;
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS local_file VARCHAR(200);
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS ai_description TEXT;
      -- Delivery truth from Meta's status callbacks. Without these an outbound
      -- row stays optimistically 'sent' forever, so a quotation that never
      -- reached the customer still reads as delivered to the sales team.
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS read_at      TIMESTAMP;
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS failed_at    TIMESTAMP;
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS error_code   VARCHAR(20);
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS error_title  TEXT;
      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS pricing_category VARCHAR(30);
      -- The 24-hour customer service window: free-form replies are only allowed
      -- within 24h of the customer's last inbound message. Outside it Meta
      -- rejects anything that is not an approved template.
      ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS window_expires_at TIMESTAMP;
      CREATE TABLE IF NOT EXISTS wa_ai_actions (
        action_id       BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT,
        request_text    TEXT,
        interpretation  JSONB,
        tools_called    JSONB,
        response_text   TEXT,
        auto_sent       BOOLEAN NOT NULL DEFAULT FALSE,
        approved_by     VARCHAR(60),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS crm_leads (
        lead_id       BIGSERIAL PRIMARY KEY,
        phone         VARCHAR(20),
        name          VARCHAR(120),
        company       VARCHAR(160),
        city          VARCHAR(80),
        business_type VARCHAR(80),
        required_fabric VARCHAR(160),
        approx_qty    VARCHAR(60),
        score         VARCHAR(10) DEFAULT 'WARM',     -- HOT | WARM | COLD
        status        VARCHAR(20) NOT NULL DEFAULT 'NEW',
        source        VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP',
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- Prospective-buyer / exhibition-lead fields + sample dispatch tracking.
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS contact_person  VARCHAR(120);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS phone2          VARCHAR(20);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS address         TEXT;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS state           VARCHAR(80);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS pin             VARCHAR(12);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS rate_quoted     VARCHAR(80);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS remarks         TEXT;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sample_status   VARCHAR(20) DEFAULT 'TO_SEND';  -- TO_SEND | SENT | NOT_REQUIRED
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sample_note     TEXT;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sample_sent_date DATE;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS sample_docket   VARCHAR(80);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_to     VARCHAR(60);
      CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source);
      CREATE INDEX IF NOT EXISTS idx_crm_leads_sample ON crm_leads(sample_status);
      -- Phase 2: digital shade-card library. Stock/price are NOT stored here —
      -- they are read live from MES at send time so nothing goes stale.
      CREATE TABLE IF NOT EXISTS shade_cards (
        card_id       BIGSERIAL PRIMARY KEY,
        product       VARCHAR(120) NOT NULL,
        construction  VARCHAR(120),
        gsm           VARCHAR(40),
        composition   VARCHAR(160),
        width         VARCHAR(40),
        finish        VARCHAR(80),
        shades        TEXT,
        moq_kg        NUMERIC(12,2),
        lead_time_days INT,
        file_name     VARCHAR(200),
        mime_type     VARCHAR(80),
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_by    VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- Phase 3: quotations with a price-approval gate, and draft sales orders.
      -- The AI can never set or change a rate: it may only draft at the rate the
      -- customer was previously billed. Anything else waits for a manager.
      CREATE TABLE IF NOT EXISTS wa_quotes (
        quote_id        BIGSERIAL PRIMARY KEY,
        quote_no        VARCHAR(30) UNIQUE,
        conversation_id BIGINT,
        partner_id      INT,
        customer_name   VARCHAR(160),
        product         VARCHAR(120),
        shade           VARCHAR(80),
        gsm             VARCHAR(40),
        quantity_kg     NUMERIC(14,2) NOT NULL DEFAULT 0,
        rate            NUMERIC(14,2),
        rate_source     VARCHAR(20),                 -- HISTORICAL | MANAGER | NONE
        gst_rate        NUMERIC(5,2)  NOT NULL DEFAULT 5,
        supply_type     VARCHAR(10)   NOT NULL DEFAULT 'INTRA',
        taxable_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
        cgst_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        sgst_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        igst_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        round_off       NUMERIC(10,2) NOT NULL DEFAULT 0,
        grand_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_terms   VARCHAR(120),
        credit_flag     VARCHAR(30),                 -- OK | CREDIT_APPROVAL_REQUIRED
        credit_note     TEXT,
        status          VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
        -- DRAFT | PENDING_PRICE_APPROVAL | APPROVED | SENT | REJECTED | CONVERTED
        created_by      VARCHAR(60),
        approved_by     VARCHAR(60),
        approved_at     TIMESTAMP,
        notes           TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS wa_quote_approvals (
        approval_id  BIGSERIAL PRIMARY KEY,
        quote_id     BIGINT NOT NULL,
        action       VARCHAR(20) NOT NULL,           -- APPROVE | REJECT | EDIT_PRICE
        old_rate     NUMERIC(14,2),
        new_rate     NUMERIC(14,2),
        reason       TEXT,
        acted_by     VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS wa_draft_orders (
        draft_id        BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT,
        quote_id        BIGINT,
        partner_id      INT,
        customer_name   VARCHAR(160),
        product         VARCHAR(120),
        shade           VARCHAR(80),
        gsm             VARCHAR(40),
        quantity_kg     NUMERIC(14,2) NOT NULL DEFAULT 0,
        rate            NUMERIC(14,2),
        grand_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
        delivery_terms  VARCHAR(160),
        payment_terms   VARCHAR(120),
        status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        -- PENDING | CONFIRMED | REJECTED
        so_number       VARCHAR(30),
        created_by      VARCHAR(60),
        confirmed_by    VARCHAR(60),
        confirmed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- widen for 'CREDIT_APPROVAL_REQUIRED' on installs created before this change
      ALTER TABLE wa_quotes ALTER COLUMN credit_flag TYPE VARCHAR(30);
      -- Phase 5: pipeline (§13), opportunity engine (§20), conversation summaries.
      ALTER TABLE crm_leads        ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(30) NOT NULL DEFAULT 'New Lead';
      ALTER TABLE crm_leads        ADD COLUMN IF NOT EXISTS score_points INT;
      ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(30) NOT NULL DEFAULT 'New Lead';
      ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS first_response_secs INT;
      -- Customer category (§5). Free text so the office can use its own labels
      -- (A/B/C, Regular/Premium, …) rather than a scheme imposed by the code.
      ALTER TABLE partners ADD COLUMN IF NOT EXISTS customer_category VARCHAR(40);
      ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS score VARCHAR(10);
      ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS score_points INT;
      -- Channel a conversation arrived on: WHATSAPP (default, existing rows) or WEB
      -- (the public "Chat with us" widget). Lets the CRM inbox show both together.
      ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(12) NOT NULL DEFAULT 'WHATSAPP';
      -- Web-chat visitors are keyed by a synthetic phone (web:session) that is
      -- longer than a real phone number, so widen the column (metadata-only change).
      ALTER TABLE wa_conversations ALTER COLUMN phone TYPE VARCHAR(64);
      ALTER TABLE crm_leads         ALTER COLUMN phone TYPE VARCHAR(64);
      CREATE TABLE IF NOT EXISTS sales_opportunities (
        opportunity_id BIGSERIAL PRIMARY KEY,
        partner_id     INT,
        conversation_id BIGINT,
        kind           VARCHAR(30) NOT NULL,          -- REORDER_DUE | QUOTE_NO_RESPONSE
        title          VARCHAR(200),
        detail         TEXT,
        value_hint     NUMERIC(14,2),
        status         VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN | ACTIONED | DISMISSED
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        actioned_by    VARCHAR(60),
        actioned_at    TIMESTAMP
      );
      -- Authorised customer price list (§8 "price already authorized for the
      -- customer"). This is the firm rate a manager has agreed; it outranks
      -- historical billing when a quote is priced. Only SUPERVISOR+ may write it.
      CREATE TABLE IF NOT EXISTS customer_prices (
        price_id    BIGSERIAL PRIMARY KEY,
        partner_id  INT NOT NULL,
        product     VARCHAR(120) NOT NULL,
        shade       VARCHAR(80),
        gsm         VARCHAR(40),
        rate        NUMERIC(14,2) NOT NULL,
        valid_from  DATE NOT NULL DEFAULT CURRENT_DATE,
        valid_to    DATE,
        approved_by VARCHAR(60),
        notes       TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_customer_prices_lookup ON customer_prices(partner_id, is_active);
      -- Rolling conversation summary (§23) — a snapshot of what the thread is
      -- about, so a salesperson picking it up later doesn't reread everything.
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        summary_id      BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        summary         TEXT NOT NULL,
        facts           JSONB,
        message_count   INT,
        generated_by    VARCHAR(60),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_conv_summaries ON conversation_summaries(conversation_id, created_at DESC);
      -- Stock reservations (HIGH-02). Availability was a live SUM, so two
      -- salespeople quoting the same lot both saw it free and the mill oversold.
      -- SOFT = quoted, expires with the quote. HARD = confirmed order, held until
      -- dispatch. Available-to-promise = physical − hard − unexpired soft.
      CREATE TABLE IF NOT EXISTS stock_reservations (
        reservation_id BIGSERIAL PRIMARY KEY,
        fabric_type  VARCHAR(120),
        color_name   VARCHAR(80),
        gsm          VARCHAR(40),
        quantity_kg  NUMERIC(14,3) NOT NULL,
        hold_type    VARCHAR(10) NOT NULL DEFAULT 'SOFT',   -- SOFT | HARD
        ref_type     VARCHAR(20),                            -- QUOTE | ORDER | MANUAL
        ref_id       VARCHAR(40),
        partner_id   INT,
        conversation_id BIGINT,
        status       VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | RELEASED | CONSUMED
        expires_at   TIMESTAMP,
        created_by   VARCHAR(60),
        released_by  VARCHAR(60),
        released_at  TIMESTAMP,
        release_reason TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_active
        ON stock_reservations(fabric_type, color_name) WHERE status = 'ACTIVE';
      CREATE INDEX IF NOT EXISTS idx_reservations_ref
        ON stock_reservations(ref_type, ref_id) WHERE status = 'ACTIVE';

      -- Value-banded approval (HIGH-05). A 5,000 and a 50,00,000 order needed the
      -- same single approval; escalation by value did not exist.
      CREATE TABLE IF NOT EXISTS approval_matrix (
        rule_id     BIGSERIAL PRIMARY KEY,
        doc_type    VARCHAR(20) NOT NULL,        -- QUOTE | ORDER | DISCOUNT | CREDIT
        min_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
        max_value   NUMERIC(14,2),
        required_role VARCHAR(20) NOT NULL,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS approval_requests (
        request_id  BIGSERIAL PRIMARY KEY,
        doc_type    VARCHAR(20) NOT NULL,
        doc_id      VARCHAR(40) NOT NULL,
        reason      VARCHAR(40),                 -- VALUE_BAND | CREDIT_LIMIT | NO_PRICE | DISCOUNT
        detail      TEXT,
        value       NUMERIC(14,2),
        required_role VARCHAR(20),
        status      VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
        requested_by VARCHAR(60),
        decided_by  VARCHAR(60),
        decided_at  TIMESTAMP,
        decision_note TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_approval_pending
        ON approval_requests(status, created_at DESC) WHERE status = 'PENDING';
      -- Quote revisions (HIGH-12). A quote was a single mutable row, so
      -- "send me a revised rate" had nowhere to go and the price history of a
      -- negotiation was overwritten each time.
      CREATE TABLE IF NOT EXISTS wa_quote_revisions (
        revision_id  BIGSERIAL PRIMARY KEY,
        quote_id     BIGINT NOT NULL,
        revision_no  INT NOT NULL,
        rate         NUMERIC(14,2),
        quantity_kg  NUMERIC(14,2),
        grand_total  NUMERIC(14,2),
        unit_cost    NUMERIC(14,2),
        margin_pct   NUMERIC(6,2),
        rate_source  VARCHAR(20),
        status       VARCHAR(30),
        reason       TEXT,
        created_by   VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_quote_revisions ON wa_quote_revisions(quote_id, revision_no DESC);
      ALTER TABLE wa_quotes ADD COLUMN IF NOT EXISTS revision_no INT NOT NULL DEFAULT 1;
      ALTER TABLE wa_quotes ADD COLUMN IF NOT EXISTS valid_until DATE;
      ALTER TABLE wa_quotes ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2);
      ALTER TABLE wa_quotes ADD COLUMN IF NOT EXISTS margin_pct NUMERIC(6,2);
      -- Payments (Phase 2). Outstanding was derived from invoice STATUS alone,
      -- so a part-payment could not be represented at all: an invoice was either
      -- fully unpaid or fully paid, and ageing was therefore approximate.
      CREATE TABLE IF NOT EXISTS payments (
        payment_id   BIGSERIAL PRIMARY KEY,
        receipt_no   VARCHAR(30) UNIQUE,
        partner_id   INT NOT NULL,
        amount       NUMERIC(14,2) NOT NULL,
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        mode         VARCHAR(20),            -- CASH | CHEQUE | NEFT | RTGS | UPI
        reference    VARCHAR(80),            -- cheque no / UTR
        bank         VARCHAR(80),
        notes        TEXT,
        status       VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | CANCELLED
        created_by   VARCHAR(60),
        cancelled_by VARCHAR(60),
        cancelled_at TIMESTAMP,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_payments_partner ON payments(partner_id, payment_date DESC);

      -- One payment can settle several invoices, and one invoice can be settled
      -- by several payments — hence a join table rather than a column.
      CREATE TABLE IF NOT EXISTS payment_allocations (
        allocation_id BIGSERIAL PRIMARY KEY,
        payment_id   BIGINT NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
        invoice_id   INT NOT NULL,
        amount       NUMERIC(14,2) NOT NULL,
        allocated_by VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON payment_allocations(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_alloc_payment ON payment_allocations(payment_id);

      -- The balance views used to be defined here. They now live in
      -- ensureFinancialViews(), which runs after the credit-note tables exist,
      -- because a CREATE OR REPLACE that drops a column errors and would abort
      -- the rest of this block.
      CREATE TABLE IF NOT EXISTS crm_followups (
        followup_id     BIGSERIAL PRIMARY KEY,
        partner_id      INT,
        lead_id         BIGINT,
        conversation_id BIGINT,
        note            TEXT NOT NULL,
        due_date        DATE,
        assigned_to     VARCHAR(60),
        status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_by      VARCHAR(60),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- kind lets the auto-scanner recognise its own follow-ups and avoid
      -- raising the same one twice while it is still open. Declared after the
      -- CREATE so a fresh install does not ALTER a table that does not exist yet.
      ALTER TABLE crm_followups ADD COLUMN IF NOT EXISTS kind VARCHAR(30) NOT NULL DEFAULT 'MANUAL';
      ALTER TABLE crm_followups ADD COLUMN IF NOT EXISTS quote_no VARCHAR(30);
    `);
  } catch (err) {
    console.error("ensureWaCrmSchema error:", err.message);
  }
}

// Dispatch logistics: transporters, e-way bills, proof of delivery, and sales
// returns with credit notes.
//
// Moving goods worth more than the state threshold without a valid e-way bill is
// a seizure-and-penalty risk, so the bill number and its validity have to live on
// the dispatch rather than in someone's WhatsApp. Returns matter for the same
// reason payments did: without a credit note a returned roll leaves the customer
// still owing money for goods sitting back in our warehouse.
//
// Runs after ensureWaCrmSchema — it redefines v_invoice_balances, which needs the
// credit-note tables to exist first.
async function ensureLogisticsSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transporters (
        transporter_id   SERIAL PRIMARY KEY,
        name             VARCHAR(120) NOT NULL,
        -- GSTIN, or the 15-char Transporter ID issued to those not registered
        -- under GST. One or the other is required to generate an e-way bill.
        gstin            VARCHAR(20),
        transporter_code VARCHAR(20),
        contact_person   VARCHAR(80),
        mobile           VARCHAR(20),
        address          TEXT,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_by       VARCHAR(60),
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS transporters_name_uq ON transporters (LOWER(name));

      -- Transport details belong on the dispatch, not only on the e-way bill:
      -- a below-threshold consignment still travels on a vehicle with an LR.
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS transporter_id INT REFERENCES transporters(transporter_id);
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS lr_number      VARCHAR(40);
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS lr_date        DATE;
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(20);
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS distance_km    INT;
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS invoice_id     INT;
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';
      -- GST Rule 55 (goods movement) + job-work challan fields.
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS consignee_gstin  VARCHAR(20);
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS ship_to_address  TEXT;
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS place_of_supply  VARCHAR(60);
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS jobwork_return_status   VARCHAR(16);  -- PENDING|PARTIAL|RECEIVED
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS jobwork_expected_return DATE;
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS jobwork_returned_date   DATE;
      ALTER TABLE dispatch_challans ADD COLUMN IF NOT EXISTS jobwork_return_notes    TEXT;
      ALTER TABLE dispatch_items    ADD COLUMN IF NOT EXISTS hsn_code         VARCHAR(12);

      CREATE TABLE IF NOT EXISTS eway_bills (
        eway_id         BIGSERIAL PRIMARY KEY,
        eway_no         VARCHAR(20) NOT NULL,
        dispatch_id     INT,
        invoice_id      INT,
        partner_id      INT,
        doc_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
        distance_km     INT NOT NULL DEFAULT 0,
        transport_mode  VARCHAR(20),
        transporter_id  INT REFERENCES transporters(transporter_id),
        vehicle_number  VARCHAR(20),
        lr_number       VARCHAR(40),
        generated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        -- 1 day per 200 km of approximate distance, minimum one day.
        valid_until     TIMESTAMP NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        cancelled_at    TIMESTAMP,
        cancelled_by    VARCHAR(60),
        cancel_reason   TEXT,
        notes           TEXT,
        created_by      VARCHAR(60),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- The same e-way number must not be recorded twice, but a cancelled one
      -- may be superseded, so only live bills are constrained.
      CREATE UNIQUE INDEX IF NOT EXISTS eway_bills_no_uq
        ON eway_bills (eway_no) WHERE status <> 'CANCELLED';
      CREATE INDEX IF NOT EXISTS eway_bills_dispatch_idx ON eway_bills (dispatch_id);

      -- Part-B updates. A vehicle breakdown or transhipment mid-journey means a
      -- new vehicle against the same e-way bill, and the trail has to survive.
      CREATE TABLE IF NOT EXISTS eway_vehicle_updates (
        update_id      BIGSERIAL PRIMARY KEY,
        eway_id        BIGINT NOT NULL REFERENCES eway_bills(eway_id) ON DELETE CASCADE,
        vehicle_number VARCHAR(20) NOT NULL,
        from_place     VARCHAR(80),
        reason         VARCHAR(40),
        updated_by     VARCHAR(60),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Proof of delivery. Short/damaged receipt is recorded here rather than
      -- being argued about later, and it is what a return is checked against.
      CREATE TABLE IF NOT EXISTS delivery_proofs (
        pod_id         BIGSERIAL PRIMARY KEY,
        dispatch_id    INT NOT NULL,
        received_by    VARCHAR(80),
        received_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        condition      VARCHAR(20) NOT NULL DEFAULT 'OK',
        shortage_kg    NUMERIC(12,3) NOT NULL DEFAULT 0,
        remarks        TEXT,
        photo_file     VARCHAR(255),
        recorded_by    VARCHAR(60),
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_proofs_dispatch_uq ON delivery_proofs (dispatch_id);

      CREATE TABLE IF NOT EXISTS sales_returns (
        return_id      BIGSERIAL PRIMARY KEY,
        return_number  VARCHAR(30) NOT NULL UNIQUE,
        return_date    DATE NOT NULL DEFAULT CURRENT_DATE,
        partner_id     INT,
        invoice_id     INT,
        dispatch_id    INT,
        reason         VARCHAR(40),
        detail         TEXT,
        -- SALEABLE goes back to sellable stock; REWORK and SCRAP do not, so the
        -- two must be distinguished at the point the goods are received back.
        disposition    VARCHAR(20) NOT NULL DEFAULT 'SALEABLE',
        total_qty      NUMERIC(12,3) NOT NULL DEFAULT 0,
        taxable_value  NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_value    NUMERIC(14,2) NOT NULL DEFAULT 0,
        status         VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        created_by     VARCHAR(60),
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sales_return_items (
        line_id       BIGSERIAL PRIMARY KEY,
        return_id     BIGINT NOT NULL REFERENCES sales_returns(return_id) ON DELETE CASCADE,
        item_id       INT,
        item_name     VARCHAR(200),
        hsn_code      VARCHAR(20),
        lot_number    VARCHAR(60),
        roll_id       VARCHAR(40),
        quantity      NUMERIC(12,3) NOT NULL,
        uom           VARCHAR(20),
        rate          NUMERIC(12,2) NOT NULL DEFAULT 0,
        gst_rate      NUMERIC(5,2) NOT NULL DEFAULT 0,
        taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
        line_total    NUMERIC(14,2) NOT NULL DEFAULT 0
      );

      -- A credit note is the money side of a return. It is allocated against
      -- invoices exactly the way a payment is, so the two cannot disagree.
      CREATE TABLE IF NOT EXISTS credit_notes (
        note_id       BIGSERIAL PRIMARY KEY,
        note_number   VARCHAR(30) NOT NULL UNIQUE,
        note_date     DATE NOT NULL DEFAULT CURRENT_DATE,
        partner_id    INT NOT NULL,
        return_id     BIGINT REFERENCES sales_returns(return_id),
        invoice_id    INT,
        reason        VARCHAR(40),
        taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
        tax_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
        amount        NUMERIC(14,2) NOT NULL,
        status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        cancelled_at  TIMESTAMP,
        cancelled_by  VARCHAR(60),
        notes         TEXT,
        created_by    VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS credit_note_allocations (
        alloc_id      BIGSERIAL PRIMARY KEY,
        note_id       BIGINT NOT NULL REFERENCES credit_notes(note_id) ON DELETE CASCADE,
        invoice_id    INT NOT NULL,
        amount        NUMERIC(14,2) NOT NULL,
        allocated_by  VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS credit_note_alloc_invoice_idx ON credit_note_allocations (invoice_id);

      -- rolls.roll_id is the printed roll number, a varchar, not a serial. This
      -- was declared INT first; the cast is safe because the column is unused on
      -- any install created before the correction.
      ALTER TABLE sales_return_items ALTER COLUMN roll_id TYPE VARCHAR(40) USING roll_id::varchar;
    `);
  } catch (err) {
    console.error("ensureLogisticsSchema error:", err.message);
  }
}

// Roll-level lot allocation, shade continuity and quarantine.
//
// stock_reservations already holds quantity against a fabric/colour/GSM, which is
// enough to stop the same kilos being promised twice. It is not enough to ship.
// Two rolls of "the same" colour from different dye batches do not match on the
// cutting table, and a customer who receives a garment panel in two shades sends
// the whole consignment back. So allocation has to name actual rolls, and record
// which dye lot they came from.
//
// Quarantine lives on the roll rather than in a separate status because the
// question asked at allocation time is always "can this roll go out", and that
// must be answerable without a join that someone will forget to write.
async function ensureAllocationSchema() {
  try {
    await pool.query(`
      ALTER TABLE rolls ADD COLUMN IF NOT EXISTS quarantine_status VARCHAR(20) NOT NULL DEFAULT 'NONE';
      ALTER TABLE rolls ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;
      ALTER TABLE rolls ADD COLUMN IF NOT EXISTS quarantined_at   TIMESTAMP;
      ALTER TABLE rolls ADD COLUMN IF NOT EXISTS quarantined_by   VARCHAR(60);
      CREATE INDEX IF NOT EXISTS rolls_quarantine_idx ON rolls (quarantine_status)
        WHERE quarantine_status <> 'NONE';

      -- Every change of quarantine state, kept because "who released this roll
      -- back to sellable stock and why" is the first question after a claim.
      CREATE TABLE IF NOT EXISTS roll_quarantine_log (
        log_id      BIGSERIAL PRIMARY KEY,
        roll_id     VARCHAR(40) NOT NULL,
        from_status VARCHAR(20),
        to_status   VARCHAR(20) NOT NULL,
        reason      TEXT,
        defect_type VARCHAR(60),
        changed_by  VARCHAR(60),
        changed_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS roll_quarantine_log_roll_idx ON roll_quarantine_log (roll_id);

      CREATE TABLE IF NOT EXISTS lot_allocations (
        allocation_id  BIGSERIAL PRIMARY KEY,
        ref_type       VARCHAR(20) NOT NULL,
        ref_id         VARCHAR(40),
        partner_id     INT,
        fabric_type    VARCHAR(100),
        color_name     VARCHAR(80),
        gsm            NUMERIC(8,2),
        requested_kg   NUMERIC(12,3) NOT NULL DEFAULT 0,
        allocated_kg   NUMERIC(12,3) NOT NULL DEFAULT 0,
        lot_count      INT NOT NULL DEFAULT 0,
        -- TRUE when the quantity could not be met from a single dye lot. It is a
        -- commercial decision, not a technical one, so it is recorded and
        -- surfaced rather than silently accepted.
        shade_risk     BOOLEAN NOT NULL DEFAULT FALSE,
        shade_approved_by VARCHAR(60),
        shade_approved_at TIMESTAMP,
        status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        notes          TEXT,
        created_by     VARCHAR(60),
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        released_at    TIMESTAMP,
        released_by    VARCHAR(60)
      );
      CREATE INDEX IF NOT EXISTS lot_allocations_ref_idx ON lot_allocations (ref_type, ref_id);
      CREATE INDEX IF NOT EXISTS lot_allocations_partner_idx ON lot_allocations (partner_id);

      CREATE TABLE IF NOT EXISTS lot_allocation_rolls (
        line_id       BIGSERIAL PRIMARY KEY,
        allocation_id BIGINT NOT NULL REFERENCES lot_allocations(allocation_id) ON DELETE CASCADE,
        roll_id       VARCHAR(40) NOT NULL,
        batch_id      INT,
        weight_kg     NUMERIC(12,3) NOT NULL DEFAULT 0,
        -- Released state is carried on the line, not looked up from the parent
        -- allocation, so the uniqueness rule below can be a plain index
        -- predicate. An index predicate cannot contain a subquery.
        released_at   TIMESTAMP
      );
      -- A roll is a physical object: it can be committed to exactly one live
      -- allocation. Enforced here rather than in code, because two operators
      -- allocating at once is exactly when a code-level check loses the race.
      CREATE UNIQUE INDEX IF NOT EXISTS lot_allocation_rolls_live_uq
        ON lot_allocation_rolls (roll_id) WHERE released_at IS NULL;
    `);
  } catch (err) {
    console.error("ensureAllocationSchema error:", err.message);
  }
}

// Unit conversions.
//
// Fabric is knitted and stocked in kilograms but frequently ordered in metres,
// and garment buyers think in pieces. Converting between them is not a constant:
// a metre of 180 GSM fabric at 150 cm weighs a quite different amount from a
// metre of 240 GSM at 110 cm. A single global KG->MTR factor would misprice
// every order that used it, so conversions are per item, and the kg/metre pair
// is derived from the item's own GSM and width rather than typed in.
async function ensureUomSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS uom_conversions (
        conversion_id BIGSERIAL PRIMARY KEY,
        -- NULL item_id is a genuinely universal ratio (a dozen is twelve
        -- pieces). Anything that depends on the fabric must name the item.
        item_id       INT,
        from_uom      VARCHAR(20) NOT NULL,
        to_uom        VARCHAR(20) NOT NULL,
        factor        NUMERIC(18,8) NOT NULL,
        notes         TEXT,
        created_by    VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uom_conversions_factor_positive CHECK (factor > 0),
        CONSTRAINT uom_conversions_not_identity   CHECK (from_uom <> to_uom)
      );
      -- One factor per direction per item. Two different answers to the same
      -- question is how a quote and its invoice end up disagreeing.
      CREATE UNIQUE INDEX IF NOT EXISTS uom_conversions_item_uq
        ON uom_conversions (item_id, from_uom, to_uom) WHERE item_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uom_conversions_global_uq
        ON uom_conversions (from_uom, to_uom) WHERE item_id IS NULL;
    `);
  } catch (err) {
    console.error("ensureUomSchema error:", err.message);
  }
}

// Every foreign key gets a supporting index.
//
// Postgres indexes the PARENT side of a foreign key automatically (it must, to
// enforce uniqueness) but never the CHILD side. So without this, every delete or
// key update on a parent sequentially scans the whole child table to check for
// references — and joins along that key have no index either. 53 columns were in
// that state.
//
// This is written as a rule rather than a list on purpose. A hardcoded list goes
// stale the moment someone adds a foreign key, and the next audit reports the
// same finding again. Iterating pg_constraint means any key added later is
// indexed on the next boot without anyone remembering to.
//
// Only the LEADING column of an index helps: an index on (a, b) does nothing for
// a lookup on b, so coverage is checked against indkey[0].
//
// Plain CREATE INDEX rather than CONCURRENTLY. At these volumes (largest child
// table is a few hundred rows) it is instantaneous. CONCURRENTLY cannot run
// inside a transaction and can leave an invalid index behind on failure; if a
// table ever grows large enough for the write lock to matter, build that one
// index by hand with CONCURRENTLY and this will simply skip it.
async function ensureForeignKeyIndexes() {
  try {
    const missing = await pool.query(`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col
        FROM pg_constraint c
        JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND c.connamespace = 'public'::regnamespace
         AND NOT EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum)
       ORDER BY 1, 2`);

    let made = 0;
    for (const { child, col } of missing.rows) {
      // Postgres truncates identifiers at 63 bytes; collisions there would be
      // silent, so the name is shortened deliberately rather than by accident.
      let name = `${child}_${col}_fkidx`;
      if (name.length > 63) name = `${child.slice(0, 28)}_${col.slice(0, 24)}_fkidx`;
      try {
        await pool.query(`CREATE INDEX IF NOT EXISTS "${name}" ON "${child}" ("${col}")`);
        made++;
      } catch (e) {
        console.error(`[schema] index ${name} failed: ${e.message}`);
      }
    }
    if (made) console.log(`[schema] created ${made} foreign-key index(es)`);
  } catch (err) {
    console.error('ensureForeignKeyIndexes error:', err.message);
  }
}

// Knitting structure library, and three live-data columns.
//
// Both were created by hand-run migration_*.js scripts and never added to any
// ensure*() function, so they existed on the original install and NOWHERE else.
// A fresh tenant got a Knitting Library page with no table behind it.
//
// Found by comparing the two databases' schema fingerprints — which is precisely
// what the fingerprint was added for, and it paid for itself immediately.
async function ensureKnittingSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knitting_structures (
        id                TEXT PRIMARY KEY,
        structure_name    TEXT NOT NULL,
        -- SJ = single jersey, DJ = double jersey. Constrained because the
        -- feeder/cam editors branch on it.
        machine_type      TEXT NOT NULL CHECK (machine_type IN ('SJ','DJ')),
        fabric_code       VARCHAR(50),
        gsm               NUMERIC,
        cylinder_tracks   INTEGER,
        dial_tracks       INTEGER,
        feed_repeat       INTEGER,
        needle_repeat     INTEGER,
        category          TEXT,
        tags              JSONB DEFAULT '[]'::jsonb,
        description       TEXT,
        yarn_repeat_count INTEGER,
        yarns             JSONB DEFAULT '[]'::jsonb,
        feeder_data       JSONB DEFAULT '[]'::jsonb,
        cam_data          JSONB DEFAULT '{}'::jsonb,
        needle_data       JSONB DEFAULT '{}'::jsonb,
        images            JSONB DEFAULT '[]'::jsonb,
        is_favourite      BOOLEAN DEFAULT FALSE,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Separate from the CREATE: fabric_types must exist first, and on an install
    // that already has the table this is the only part that would be missing.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'knitting_structures'::regclass AND contype = 'f'
        ) AND EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name='fabric_types'
        ) THEN
          ALTER TABLE knitting_structures
            ADD CONSTRAINT knitting_structures_fabric_code_fkey
            FOREIGN KEY (fabric_code) REFERENCES fabric_types(code)
            ON UPDATE CASCADE ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Counters the live-data ingest writes. Added by a hand-run script on the
    // original install only, so a second tenant's dashboard had nowhere to put
    // shift working time.
    await pool.query(`
      ALTER TABLE machine_live_data ADD COLUMN IF NOT EXISTS work_time     VARCHAR(20);
      ALTER TABLE machine_live_data ADD COLUMN IF NOT EXISTS working_hours VARCHAR(20);
      ALTER TABLE machine_live_data ADD COLUMN IF NOT EXISTS total_minutes TEXT;
    `);
  } catch (err) {
    console.error('ensureKnittingSchema error:', err.message);
  }
}

// Referential integrity on the money tables.
//
// tax_invoices, payments, sales_returns, credit_notes and lot_allocations were
// created with partner_id and invoice_id as plain integers. Nothing stopped a
// payment pointing at a deleted customer, or a credit note at an invoice that
// never existed — and because outstanding is computed from those joins, an
// orphan does not error, it just quietly drops out of a balance.
//
// Every one of these is ON DELETE RESTRICT, deliberately. Financial history is
// not something to cascade away: if a customer has invoices, the correct answer
// to "delete this customer" is no. The line-item tables already CASCADE from
// their own parent (an invoice's lines go with the invoice), which is the one
// place cascading is right.
//
// Each constraint is added only if absent, so this is a no-op on a database that
// already has it, and it is safe to re-run. Supporting indexes are created
// alongside: an unindexed foreign key makes every parent delete scan the child.
async function ensureFinancialConstraints() {
  const FKS = [
    // child, column, parent, parent column
    ['tax_invoices',            'partner_id',  'partners',           'partner_id'],
    ['payments',                'partner_id',  'partners',           'partner_id'],
    ['payment_allocations',     'invoice_id',  'tax_invoices',       'invoice_id'],
    ['sales_returns',           'partner_id',  'partners',           'partner_id'],
    ['sales_returns',           'invoice_id',  'tax_invoices',       'invoice_id'],
    ['sales_returns',           'dispatch_id', 'dispatch_challans',  'dispatch_id'],
    ['credit_notes',            'partner_id',  'partners',           'partner_id'],
    ['credit_notes',            'invoice_id',  'tax_invoices',       'invoice_id'],
    ['credit_note_allocations', 'invoice_id',  'tax_invoices',       'invoice_id'],
    ['lot_allocations',         'partner_id',  'partners',           'partner_id'],
    ['lot_allocation_rolls',    'roll_id',     'rolls',              'roll_id'],
    ['eway_bills',              'dispatch_id', 'dispatch_challans',  'dispatch_id'],
    ['eway_bills',              'invoice_id',  'tax_invoices',       'invoice_id'],
    ['eway_bills',              'partner_id',  'partners',           'partner_id'],
    ['delivery_proofs',         'dispatch_id', 'dispatch_challans',  'dispatch_id'],
  ];

  for (const [child, col, parent, pcol] of FKS) {
    const name = `${child}_${col}_fk`;
    try {
      // Index first. Adding it after the constraint would leave a window where
      // a parent delete scans the whole child table.
      await pool.query(`CREATE INDEX IF NOT EXISTS ${child}_${col}_idx ON ${child} (${col})`);

      const has = await pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`, [name, child]);
      if (has.rows.length) continue;

      // Refuse rather than fail loudly if the data would not support it — an
      // orphan means something upstream is already wrong and deserves a look,
      // not a crashed boot.
      const orphans = await pool.query(
        `SELECT COUNT(*)::int n FROM ${child} c
          WHERE c.${col} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.${pcol} = c.${col})`);
      if (orphans.rows[0].n > 0) {
        console.error(`[schema] ${name} NOT added — ${orphans.rows[0].n} orphan row(s) in ${child}.${col}`);
        continue;
      }

      await pool.query(
        `ALTER TABLE ${child} ADD CONSTRAINT ${name}
         FOREIGN KEY (${col}) REFERENCES ${parent}(${pcol}) ON DELETE RESTRICT`);
      console.log(`[schema] added ${name}`);
    } catch (err) {
      console.error(`[schema] ${name} failed:`, err.message);
    }
  }
}

// The single source of truth for what a customer owes.
//
// Defined last, on its own, because both views depend on tables created by two
// different ensure* steps — payments from the CRM schema, credit notes from the
// logistics one. Defining them alongside either breaks a fresh install, and
// defining them twice fails outright: CREATE OR REPLACE VIEW cannot drop a
// column, so the second definition errors and aborts everything after it.
// ── Order lines carry their weight ─────────────────────────────────────────
//
// Orders and invoices record a quantity and a unit, but everything downstream
// — stock, allocation, dispatch, costing — is measured in kilograms. A line
// ordered in metres or pieces therefore could not be allocated against stock
// without someone converting it in their head, which is exactly where a wrong
// number gets introduced.
//
// quantity_kg holds the converted figure and uom_basis records HOW it was
// derived, so a number nobody can explain later is not possible. Both are
// nullable on purpose: a line whose fabric has no GSM recorded cannot be
// converted, and storing a guess would be worse than storing nothing.
async function ensureOrderLineWeights() {
  try {
    for (const t of ['sales_order_items', 'tax_invoice_items']) {
      await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC(14,3)`);
      await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS uom_basis VARCHAR(30)`);
    }
    console.log('Order line weights ready');
  } catch (err) {
    console.error('ensureOrderLineWeights error:', err.message);
  }
}

// ── Complaints ─────────────────────────────────────────────────────────────
//
// The one business process with no home in the system. A customer rings up
// about barre in a lot, or a short delivery, and it lived in somebody's head or
// a WhatsApp thread. Nothing recorded it, nothing chased it, and nothing could
// answer "how often does this happen with this shade" — which is the question
// that actually improves the cloth.
//
// A complaint links to the documents it is about (invoice, dispatch, roll, lot)
// so quality can trace it back to a machine and a batch, and to the sales return
// or credit note it produced, so the money side is not a separate story.
async function ensureComplaintsSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        complaint_id   BIGSERIAL PRIMARY KEY,
        complaint_no   VARCHAR(40) UNIQUE,
        partner_id     INTEGER REFERENCES partners(partner_id) ON DELETE RESTRICT,
        raised_on      DATE NOT NULL DEFAULT CURRENT_DATE,
        source         VARCHAR(20),        -- WHATSAPP | PHONE | EMAIL | VISIT | OTHER
        category       VARCHAR(30),        -- QUALITY | SHORTAGE | WRONG_ITEM | DAMAGE | DELAY | BILLING | OTHER
        severity       VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
        summary        VARCHAR(300) NOT NULL,
        detail         TEXT,

        -- What it is about. All optional: a complaint often arrives before
        -- anyone has worked out which dispatch it refers to, and refusing to
        -- record it until then is how complaints go unrecorded.
        invoice_id     INTEGER,
        dispatch_id    INTEGER,
        roll_id        VARCHAR(60),        -- roll_id is VARCHAR in this schema
        lot_number     VARCHAR(60),
        machine_id     VARCHAR(20),

        status         VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        assigned_to    VARCHAR(60),
        due_date       DATE,

        root_cause     TEXT,
        resolution     TEXT,
        resolution_type VARCHAR(20),       -- REPLACE | CREDIT_NOTE | DISCOUNT | REWORK | NO_ACTION
        return_id      BIGINT,             -- if it became a sales return
        credit_note_id BIGINT,

        created_by     VARCHAR(60),
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_by    VARCHAR(60),
        resolved_at    TIMESTAMP,
        closed_at      TIMESTAMP,
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS ix_complaints_status  ON complaints (status);
      CREATE INDEX IF NOT EXISTS ix_complaints_partner ON complaints (partner_id);
      CREATE INDEX IF NOT EXISTS ix_complaints_open    ON complaints (due_date) WHERE status IN ('OPEN','INVESTIGATING');

      -- The audit trail. Who said what, and when the state changed — a
      -- complaint that was "resolved" with no record of by whom or how is not
      -- resolved, it is closed.
      CREATE TABLE IF NOT EXISTS complaint_events (
        event_id     BIGSERIAL PRIMARY KEY,
        complaint_id BIGINT NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
        kind         VARCHAR(20) NOT NULL,   -- NOTE | STATUS | ASSIGN | LINK
        note         TEXT,
        from_status  VARCHAR(20),
        to_status    VARCHAR(20),
        created_by   VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_complaint_events ON complaint_events (complaint_id, created_at);
    `);
    console.log('Complaints schema ready');
  } catch (err) {
    console.error('ensureComplaintsSchema error:', err.message);
  }
}

// ── Timestamps everywhere ──────────────────────────────────────────────────
//
// 39 tables had no created_at or updated_at, including machines, dispatch_items
// and machine_downtime. "When did this change?" was unanswerable for them, which
// matters most exactly when something has gone wrong and you are trying to work
// out what happened in what order.
//
// created_at defaults to NOW() so new rows are stamped from here on. Existing
// rows get NULL rather than a fabricated date — pretending every historical row
// was created at the moment of this migration would be worse than admitting the
// information was never captured.
async function ensureTimestamps() {
  let added = 0;
  try {
    const missing = (await pool.query(`
      SELECT t.table_name FROM information_schema.tables t
       WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
            WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema
              AND c.column_name IN ('created_at','updated_at','timestamp'))
       ORDER BY 1`)).rows;

    for (const { table_name } of missing) {
      await pool.query(
        `ALTER TABLE "${table_name}" ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
      await pool.query(
        `ALTER TABLE "${table_name}" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
      added++;
    }

    // A table with created_at but no updated_at is the more dangerous case,
    // because it looks fine. `rolls` was exactly that, and two dispatch paths
    // wrote `UPDATE rolls SET ... updated_at = NOW()` — so every greige dispatch
    // and every greige dispatch-cancel threw "column updated_at does not exist"
    // and rolled back. Nothing in the schema check caught it because the table
    // did have a timestamp; only writing one found it.
    const halfDone = (await pool.query(`
      SELECT t.table_name FROM information_schema.tables t
       WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
         AND EXISTS (SELECT 1 FROM information_schema.columns c
            WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema
              AND c.column_name = 'created_at')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
            WHERE c.table_name = t.table_name AND c.table_schema = t.table_schema
              AND c.column_name = 'updated_at')
       ORDER BY 1`)).rows;

    for (const { table_name } of halfDone) {
      await pool.query(`ALTER TABLE "${table_name}" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
      added++;
    }
    if (added) console.log(`Timestamps: added to ${added} table(s)`);
  } catch (err) {
    console.error('ensureTimestamps error:', err.message);
  }
}

// ── Busy production export ──────────────────────────────────────────────────
//
// Pushes each shift's production into Busy as a stock-in, shift by shift. Busy
// is the book of accounts and holds the aggregate figure; the MES keeps the roll
// detail. The output is therefore aggregated by (date, shift, fabric), but the
// bookkeeping underneath is at the ROLL level — because the one thing that must
// never happen is the same production reaching Busy twice, which double-stocks
// the ledger.
//
// So every roll that has been pushed is recorded by its id. An export picks up
// only rolls not yet pushed, aggregates them into shift lines, and records each
// roll id in the same transaction. A roll closed AFTER its shift was already
// exported is simply picked up by the next export as a top-up line — correct,
// and impossible to double-count. Voiding a batch releases its rolls so a failed
// Busy import can be re-sent.
async function ensureBusyProductionSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS busy_production_batches (
        batch_id      BIGSERIAL PRIMARY KEY,
        from_date     DATE,
        to_date       DATE,
        roll_count    INTEGER NOT NULL DEFAULT 0,
        total_kg      NUMERIC(14,3) NOT NULL DEFAULT 0,
        line_count    INTEGER NOT NULL DEFAULT 0,
        status        VARCHAR(20) NOT NULL DEFAULT 'EXPORTED',  -- EXPORTED | CONFIRMED | VOIDED
        generated_by  VARCHAR(60),
        generated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        busy_ref      VARCHAR(60),      -- Busy voucher/ref, filled on confirm
        confirmed_by  VARCHAR(60),
        confirmed_at  TIMESTAMP,
        note          TEXT
      );

      CREATE TABLE IF NOT EXISTS busy_production_export_rolls (
        roll_id         VARCHAR(60) PRIMARY KEY,   -- each roll pushed at most once
        batch_id        BIGINT NOT NULL REFERENCES busy_production_batches(batch_id) ON DELETE CASCADE,
        production_date DATE NOT NULL,
        shift           VARCHAR(10),
        fabric_type     VARCHAR(160),
        weight_kg       NUMERIC(12,3) NOT NULL DEFAULT 0,
        exported_at     TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_busy_prod_rolls_batch ON busy_production_export_rolls (batch_id);
    `);
    console.log('Busy production export schema ready');
  } catch (err) {
    console.error('ensureBusyProductionSchema error:', err.message);
  }
}

// ── Fabric 4-point inspection & grading (AI-MES Phase 1) ────────────────────
//
// A header per inspected roll plus one row per defect. The grade is COMPUTED and
// STORED at inspection time (by src/lib/fabric-grade.js) rather than re-derived on
// read, so a report never disagrees with what the inspector saw — but the raw
// inputs (defect lines, length, width, the thresholds used) are all kept, so any
// roll can be re-graded and audited. The A/B cut-offs live in app_settings so the
// mill sets its own line without a code change; sensible 4-point defaults are
// seeded only if absent.
async function ensureFabricInspectionSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fabric_inspection (
        inspection_id      BIGSERIAL PRIMARY KEY,
        roll_id            VARCHAR(40) NOT NULL,
        stage              VARCHAR(20) NOT NULL DEFAULT 'GREIGE',   -- GREIGE | FINISHED
        inspected_length_m NUMERIC(12,3) NOT NULL DEFAULT 0,
        width_mm           NUMERIC(10,2) NOT NULL DEFAULT 0,
        total_points       INTEGER NOT NULL DEFAULT 0,
        points_per_100sqyd NUMERIC(10,2),
        grade              VARCHAR(10) NOT NULL DEFAULT 'UNGRADED',  -- A | B | REJECT | UNGRADED
        a_max_used         NUMERIC(10,2),
        b_max_used         NUMERIC(10,2),
        status             VARCHAR(20) NOT NULL DEFAULT 'FINAL',     -- FINAL | VOID
        inspector          VARCHAR(60),
        notes              TEXT,
        created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS fabric_inspection_roll_idx  ON fabric_inspection (roll_id);
      CREATE INDEX IF NOT EXISTS fabric_inspection_grade_idx ON fabric_inspection (grade);
      CREATE INDEX IF NOT EXISTS fabric_inspection_date_idx  ON fabric_inspection (created_at);

      CREATE TABLE IF NOT EXISTS fabric_inspection_defect (
        id            BIGSERIAL PRIMARY KEY,
        inspection_id BIGINT NOT NULL REFERENCES fabric_inspection(inspection_id) ON DELETE CASCADE,
        defect_type   VARCHAR(60),
        size_inches   NUMERIC(6,2) NOT NULL DEFAULT 0,
        is_hole       BOOLEAN NOT NULL DEFAULT FALSE,
        count         INTEGER NOT NULL DEFAULT 1,
        points        INTEGER NOT NULL DEFAULT 0,       -- per single occurrence (max 4)
        position_m    NUMERIC(12,3),
        notes         TEXT,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fabric_inspection_defect_hdr_idx ON fabric_inspection_defect (inspection_id);
      -- For a table created by an earlier build before created_at was added.
      ALTER TABLE fabric_inspection_defect ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    `);

    // Grading thresholds — points per 100 sq yd. Seed the 4-point defaults only
    // if the keys are absent, so a mill's own edited cut-offs are never overwritten.
    await pool.query(`
      INSERT INTO app_settings (key, value)
      SELECT k, v FROM (VALUES ('fabric_grade_a_max','40'), ('fabric_grade_b_max','80')) AS s(k,v)
      WHERE NOT EXISTS (SELECT 1 FROM app_settings a WHERE a.key = s.k)
    `);

    console.log('Fabric 4-point inspection schema ready');
  } catch (err) {
    console.error('ensureFabricInspectionSchema error:', err.message);
  }
}

// ── AI agent fleet — shared action log (AI-MES Phase 2) ─────────────────────
//
// Every agent turn is recorded here, immutably: who asked, which agent answered,
// the plan it made, the tools it actually called (with their results), the answer,
// and a grounding-confidence score. This is the accountability spine of the AI
// layer — "what did the AI look at to say that" must always be answerable. It is
// the general-purpose sibling of wa_ai_actions (which stays WhatsApp-specific).
async function ensureAiAgentsSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_actions (
        action_id    BIGSERIAL PRIMARY KEY,
        agent        VARCHAR(40) NOT NULL,
        username     VARCHAR(60),
        question     TEXT,
        plan         JSONB,
        tools_used   JSONB,
        answer       TEXT,
        confidence   NUMERIC(4,2),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_agent_actions_agent_idx ON ai_agent_actions (agent, created_at DESC);
    `);
    console.log('AI agent actions schema ready');
  } catch (err) {
    console.error('ensureAiAgentsSchema error:', err.message);
  }
}

// ── AI approvals queue — agent WRITE actions (AI-MES Phase 2) ────────────────
//
// The gate that lets an agent DO something. A write tool never mutates directly:
// it produces a PROPOSAL that lands here as PENDING. The owning role approves,
// and only then is the tool's execute() run — via the same service a human would
// use. The payload it will run with is frozen at propose time and kept, so
// "what exactly was approved" is answerable. Truly irreversible actions
// (ledgers, prices, invoices, money, permissions) get NO write tool at all, so
// they can never reach this queue — safety by construction, not by policy.
async function ensureAiApprovalsSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_approvals (
        approval_id   BIGSERIAL PRIMARY KEY,
        agent         VARCHAR(40),
        tool          VARCHAR(60) NOT NULL,
        summary       TEXT,                         -- human-readable "what this will do"
        payload       JSONB,                        -- frozen args the execute() will run with
        required_role VARCHAR(20) NOT NULL,         -- who may approve
        proposed_by   VARCHAR(60),                  -- who asked the agent
        status        VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING|REJECTED|EXECUTED|FAILED
        decided_by    VARCHAR(60),
        decided_at    TIMESTAMP,
        reason        TEXT,
        result        JSONB,
        executed_at   TIMESTAMP,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_approvals_status_idx ON ai_approvals (status, created_at DESC);
    `);
    console.log('AI approvals schema ready');
  } catch (err) {
    console.error('ensureAiApprovalsSchema error:', err.message);
  }
}

// CAPA — corrective / preventive action tickets. Raised from quality findings
// (a bad Pareto, a failing machine) so a fix has an owner and a status. Kept
// deliberately small: a ticket, not a workflow engine.
async function ensureCapaSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS capa (
        capa_id      BIGSERIAL PRIMARY KEY,
        capa_number  VARCHAR(30) UNIQUE,
        title        TEXT NOT NULL,
        severity     VARCHAR(10) NOT NULL DEFAULT 'MEDIUM', -- LOW|MEDIUM|HIGH
        source       VARCHAR(30),                           -- QUALITY|MAINTENANCE|MANUAL|AI
        machine_id   VARCHAR(40),
        defect_type  VARCHAR(60),
        description  TEXT,
        status       VARCHAR(20) NOT NULL DEFAULT 'OPEN',   -- OPEN|IN_PROGRESS|CLOSED
        created_by   VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        closed_at    TIMESTAMP,
        closed_by    VARCHAR(60)
      );
      CREATE INDEX IF NOT EXISTS capa_status_idx ON capa (status, created_at DESC);
    `);
    console.log('CAPA schema ready');
  } catch (err) {
    console.error('ensureCapaSchema error:', err.message);
  }
}

// Shade swatches — the colour master behind branded shade cards. A swatch is a
// named/coded colour with its real hex value (optionally a Pantone ref and a
// fabric it applies to). Kept separate from shade_cards (the WhatsApp product
// catalog), which is a product spec sheet, not a colour master.
async function ensureShadeSwatchesSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shade_swatches (
        swatch_id    BIGSERIAL PRIMARY KEY,
        shade_name   VARCHAR(80) NOT NULL,
        shade_code   VARCHAR(40),
        hex          VARCHAR(7) NOT NULL,          -- #RRGGBB
        pantone      VARCHAR(40),
        fabric_type  VARCHAR(60),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_by   VARCHAR(60),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS shade_swatches_active_idx ON shade_swatches (is_active, sort_order);
    `);
    console.log('Shade swatches schema ready');
  } catch (err) {
    console.error('ensureShadeSwatchesSchema error:', err.message);
  }
}

// ── Domain CHECK constraints ───────────────────────────────────────────────
//
// The audit found 15 CHECK constraints across 118 tables: quantities, statuses
// and money were validated almost entirely in JavaScript. That holds only as
// long as every write goes through the app — a manual SQL fix, a future
// service, or a bug in a handler can put a negative invoice or a minus-quantity
// roll straight into the books, and nothing complains until someone reads a
// report that does not add up.
//
// Two rules about how this is applied, both learned the hard way:
//
//   1. It is DATA-AWARE. Every constraint is tested against the existing rows
//      before it is added, and skipped with a warning if they violate it. A
//      constraint that fails at boot would take the whole application down,
//      and the two installations do not hold the same data.
//   2. Balance-like columns are excluded. A bank balance can legitimately be
//      negative — that is an overdraft, not a bug — and so can an opening
//      balance. Constraining them would be wrong, not merely inconvenient.
//
// Signed columns (round_off, variance, margin, adjustments) are excluded for
// the same reason.

const NONNEG_MONEY = /(amount|total|value|price|rate|cost|credit_limit|paid|due|tax|gst|cgst|sgst|igst|freight|discount|salary|wage)/;
const NONNEG_QTY = /(quantity|qty|weight|kg|count|stock|meters|metres|rolls|pieces|units|hours|minutes|cones)$/;
// Legitimately negative, or not a measure at all.
const SIGNED_OK = /(change|delta|diff|adjust|variance|round_off|offset|net_gst|profit|margin|balance)/;

// Domain values that ARE authoritative in code, so the database can enforce the
// same set. Deliberately NOT inferred from existing rows: most of these tables
// hold only a handful of records, and constraining `status` to whatever happens
// to be present today would reject the next legitimate state transition.
const VALUE_DOMAINS = [
  { table: 'sales_returns', column: 'disposition',
    values: ['SALEABLE', 'REWORK', 'SCRAP'] },
  { table: 'sales_returns', column: 'reason',
    values: ['QUALITY', 'SHADE_MISMATCH', 'SHORT_SUPPLY', 'DAMAGED', 'WRONG_ITEM',
             'EXCESS_SUPPLY', 'CUSTOMER_REFUSED', 'OTHER'] },
  { table: 'maintenance_work_orders', column: 'status',
    values: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] },
  { table: 'payments', column: 'status', values: ['ACTIVE', 'CANCELLED'] },
  { table: 'credit_notes', column: 'status', values: ['ACTIVE', 'CANCELLED'] },
  { table: 'complaints', column: 'status',
    values: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'REJECTED', 'CLOSED'] },
  { table: 'complaints', column: 'severity', values: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  { table: 'complaints', column: 'category',
    values: ['QUALITY', 'SHORTAGE', 'WRONG_ITEM', 'DAMAGE', 'DELAY', 'BILLING', 'OTHER'] },
  { table: 'complaints', column: 'resolution_type',
    values: ['REPLACE', 'CREDIT_NOTE', 'DISCOUNT', 'REWORK', 'NO_ACTION'] },
];

async function ensureCheckConstraints() {
  let added = 0, skipped = 0, present = 0;
  const problems = [];

  const addIfClean = async ({ table, name, expr, why }) => {
    try {
      const exists = await pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`, [name, table]);
      if (exists.rows.length) { present++; return; }

      // Would the rows we already have violate it?
      const bad = await pool.query(`SELECT COUNT(*)::int n FROM "${table}" WHERE NOT (${expr})`);
      if (bad.rows[0].n > 0) {
        skipped++;
        problems.push(`${table}: ${bad.rows[0].n} row(s) violate ${why} — constraint not added`);
        return;
      }
      await pool.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expr})`);
      added++;
    } catch (e) {
      skipped++;
      problems.push(`${table}.${name}: ${e.message.slice(0, 90)}`);
    }
  };

  try {
    // Retire names from the first version of this function, which used a single
    // underscore between table and column and so could not be parsed back into
    // a field name for the error message. Dropping them here means the rename
    // applies instead of leaving two constraints saying the same thing.
    // Filtered in JavaScript rather than with SQL LIKE: the pattern needs a
    // literal underscore, and escaping one through LIKE silently matched
    // everything, which left 178 duplicate constraints behind on the first
    // attempt. A regex here has no escaping to get wrong.
    const all = await pool.query(`
      SELECT c.conname, t.relname FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype='c' AND n.nspname='public'`);
    const stale = all.rows.filter(r =>
      /^ck_.*_(nonneg|valid)$/.test(r.conname) && !r.conname.includes('__'));
    for (const r of stale) {
      await pool.query(`ALTER TABLE "${r.relname}" DROP CONSTRAINT IF EXISTS "${r.conname}"`).catch(() => {});
    }
    if (stale.length) console.log(`CHECK constraints: retired ${stale.length} old-style name(s)`);

    // ── Non-negative money and quantities ────────────────────────────────
    const cols = (await pool.query(`
      SELECT c.table_name, c.column_name, c.data_type
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND c.data_type IN ('numeric','integer','bigint','double precision','real','smallint')`)).rows;

    for (const c of cols) {
      const col = c.column_name;
      if (/_id$/.test(col) || SIGNED_OK.test(col)) continue;
      if (!NONNEG_MONEY.test(col) && !NONNEG_QTY.test(col)) continue;
      await addIfClean({
        table: c.table_name,
        // `__` separates table from column: single underscores appear inside
        // both, so ck_tax_invoices_grand_total_nonneg cannot be split reliably.
        name: `ck_${c.table_name}__${col}_nonneg`.slice(0, 63),
        // NULL passes: a CHECK is only violated by a definite false, and an
        // unknown quantity is a different problem from a negative one.
        expr: `"${col}" >= 0`,
        why: `${col} >= 0`,
      });
    }

    // ── Value domains ───────────────────────────────────────────────────
    for (const d of VALUE_DOMAINS) {
      const has = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
        [d.table, d.column]);
      if (!has.rows.length) continue;
      const list = d.values.map(v => `'${v}'`).join(',');
      await addIfClean({
        table: d.table,
        name: `ck_${d.table}__${d.column}_valid`.slice(0, 63),
        expr: `"${d.column}" IS NULL OR "${d.column}" IN (${list})`,
        why: `${d.column} in (${d.values.join(', ')})`,
      });
    }

    console.log(`CHECK constraints: ${added} added, ${present} already present, ${skipped} skipped`);
    // Skips are data problems worth seeing, not noise to bury.
    problems.forEach(p => console.warn('  [check] ' + p));
  } catch (err) {
    console.error('ensureCheckConstraints error:', err.message);
  }
}

// ── Soft delete ────────────────────────────────────────────────────────────
//
// Applied to configuration and master tables that the API hard-deletes, where
// a mis-click is unrecoverable except from a nightly dump. This is not
// hypothetical: a stray DELETE removed the admin user on 2026-08-06 and the
// only way back was an hourly backup that happened to exist.
//
// Deliberately NOT applied everywhere:
//   - partners, items, operators, machines have no DELETE endpoint at all.
//     They are deactivated with is_active, so they are already recoverable.
//   - tax_invoices, sales_orders, payments, dispatch_challans all carry a
//     status column with a CANCELLED state, which is soft delete with better
//     semantics — a cancelled invoice must stay visible and numbered.
//   - Transactional tables (rolls, batches, yarn_lots) are hard-deleted from
//     dozens of read sites; adding a filter to all of them is a large change
//     with real risk of missing one, which would silently hide live data.
const SOFT_DELETE_TABLES = [
  { table: 'users',                pk: 'id',     label: 'User',              name: 'username' },
  { table: 'fabric_types',         pk: 'code',   label: 'Fabric type',       name: 'code' },
  { table: 'knitting_structures',  pk: 'id',     label: 'Knitting structure',name: 'structure_name' },
  { table: 'spare_parts',          pk: 'id',     label: 'Spare part',        name: 'part_name' },
  { table: 'data_collectors',      pk: 'dc_id',  label: 'Data collector',    name: 'machine_id' },
];

async function ensureSoftDelete() {
  try {
    for (const { table } of SOFT_DELETE_TABLES) {
      await pool.query(`
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(60);
      `);
      // Every read filters on this, so it earns an index.
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ix_${table}_not_deleted ON ${table} (deleted_at) WHERE deleted_at IS NULL`);
    }

    // A plain UNIQUE constraint counts deleted rows, so a soft-deleted user
    // would hold its username for ever and it could never be recreated. The
    // constraint is replaced with a partial unique index that ignores deleted
    // rows — the name is free again the moment the row goes to trash.
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username_live
        ON users (username) WHERE deleted_at IS NULL;

      ALTER TABLE spare_parts DROP CONSTRAINT IF EXISTS spare_parts_sku_key;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_spare_parts_sku_live
        ON spare_parts (sku) WHERE deleted_at IS NULL;
    `);

    console.log('Soft delete ready');
  } catch (err) {
    console.error('ensureSoftDelete error:', err.message);
  }
}

// ── Bank reconciliation ────────────────────────────────────────────────────
//
// Payments were recorded but never checked against the bank. Nothing proved a
// receipt keyed into the MES actually arrived, and nothing surfaced money that
// landed in the account with no receipt against it. Both are how a mill ends up
// chasing a customer who has already paid.
//
// Three tables: our own accounts, imported statement lines, and the matches
// between a line and a payment.
async function ensureBankReconSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        account_id      SERIAL PRIMARY KEY,
        account_name    VARCHAR(120) NOT NULL,
        bank_name       VARCHAR(120),
        account_no      VARCHAR(40),
        ifsc            VARCHAR(20),
        -- The balance the statement starts from, so a bank balance can be
        -- computed rather than typed in and trusted.
        opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        opening_date    DATE,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        line_id      BIGSERIAL PRIMARY KEY,
        account_id   INTEGER NOT NULL REFERENCES bank_accounts(account_id) ON DELETE CASCADE,
        txn_date     DATE NOT NULL,
        value_date   DATE,
        description  TEXT,
        reference    VARCHAR(120),
        -- Exactly one of these is non-zero. Kept as two columns because that is
        -- how every bank exports, and converting to a signed amount on import
        -- is where sign errors get introduced.
        debit        NUMERIC(14,2) NOT NULL DEFAULT 0,
        credit       NUMERIC(14,2) NOT NULL DEFAULT 0,
        balance      NUMERIC(14,2),
        import_batch VARCHAR(60),
        -- Idempotency. Re-importing the same statement must not double the
        -- book. The hash covers the line's content AND its occurrence number
        -- within that content: two identical 10,000 NEFT credits on the same
        -- day are legitimate and must both survive, but importing that file
        -- twice must not produce four.
        row_hash     VARCHAR(64) NOT NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT bank_line_one_side CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_line_hash
        ON bank_statement_lines (account_id, row_hash);
      CREATE INDEX IF NOT EXISTS ix_bank_line_account_date
        ON bank_statement_lines (account_id, txn_date);

      CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
        match_id    BIGSERIAL PRIMARY KEY,
        line_id     BIGINT NOT NULL REFERENCES bank_statement_lines(line_id) ON DELETE CASCADE,
        payment_id  BIGINT NOT NULL REFERENCES payments(payment_id) ON DELETE RESTRICT,
        auto        BOOLEAN NOT NULL DEFAULT false,
        note        TEXT,
        matched_by  VARCHAR(60),
        matched_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      -- A statement line settles one payment and a payment appears once on the
      -- statement. Without both of these, one bank credit could be used to
      -- "prove" several receipts, which is exactly the error reconciliation
      -- exists to catch.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_match_line    ON bank_reconciliation_matches (line_id);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_match_payment ON bank_reconciliation_matches (payment_id);

      -- Host-to-host (H2H) statement ingestion, Phase A (read-only).
      -- Per-account: what statement file format the bank sends and, optionally, a
      -- local folder the file is dropped into for automatic pickup. No credential
      -- lives here; an SFTP adapter (later) reads creds from .env, never the DB.
      ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS statement_format VARCHAR(16);  -- MT940 | CAMT053 | CSV
      ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS inbox_dir        TEXT;         -- local folder polled for new files
      ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS csv_mapping      JSONB;        -- column map for CSV banks

      -- Every ingested file, for idempotency (a re-dropped file is a no-op) and an
      -- honest audit trail of what was read and when. The content hash is the guard.
      CREATE TABLE IF NOT EXISTS bank_statement_files (
        file_id      BIGSERIAL PRIMARY KEY,
        account_id   INTEGER NOT NULL REFERENCES bank_accounts(account_id) ON DELETE CASCADE,
        filename     TEXT,
        format       VARCHAR(16),
        content_hash VARCHAR(64) NOT NULL,
        source       VARCHAR(16) NOT NULL DEFAULT 'UPLOAD',  -- UPLOAD | FOLDER | SFTP
        rows_parsed  INTEGER NOT NULL DEFAULT 0,
        rows_new     INTEGER NOT NULL DEFAULT 0,
        duplicates   INTEGER NOT NULL DEFAULT 0,
        rejected     INTEGER NOT NULL DEFAULT 0,
        auto_matched INTEGER NOT NULL DEFAULT 0,
        status       VARCHAR(16) NOT NULL DEFAULT 'OK',       -- OK | ERROR
        error        TEXT,
        ingested_by  VARCHAR(60),
        ingested_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_file_hash ON bank_statement_files (account_id, content_hash);
      CREATE INDEX IF NOT EXISTS ix_bank_file_account ON bank_statement_files (account_id, ingested_at DESC);

      -- ── Outbound payments (H2H Phase B) — DRAFT-ONLY ─────────────────────────
      -- The MES GENERATES a bank-uploadable payment file; it never sends money. A
      -- human releases the file to the bank, where maker-checker approves the debit.
      -- A beneficiary must be APPROVED (verified bank details) before it can be paid.
      CREATE TABLE IF NOT EXISTS bank_beneficiaries (
        beneficiary_id   BIGSERIAL PRIMARY KEY,
        partner_id       INTEGER REFERENCES partners(partner_id),
        beneficiary_name VARCHAR(140) NOT NULL,
        account_no       VARCHAR(40)  NOT NULL,
        ifsc             VARCHAR(20)  NOT NULL,
        bank_name        VARCHAR(120),
        swift            VARCHAR(20),
        email            VARCHAR(160),
        approved         BOOLEAN NOT NULL DEFAULT false,
        approved_by      VARCHAR(60),
        approved_at      TIMESTAMP,
        is_active        BOOLEAN NOT NULL DEFAULT true,
        created_by       VARCHAR(60),
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (account_no, ifsc)
      );
      CREATE INDEX IF NOT EXISTS ix_benef_partner ON bank_beneficiaries (partner_id);

      CREATE TABLE IF NOT EXISTS bank_payment_batches (
        batch_id      BIGSERIAL PRIMARY KEY,
        batch_no      VARCHAR(40) UNIQUE NOT NULL,
        from_account_id INTEGER REFERENCES bank_accounts(account_id),
        value_date    DATE,
        currency      VARCHAR(8) NOT NULL DEFAULT 'INR',
        total_amount  NUMERIC(16,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(12) NOT NULL DEFAULT 'NEFT',   -- NEFT | RTGS | IMPS
        status        VARCHAR(12) NOT NULL DEFAULT 'DRAFT'    -- DRAFT | GENERATED | RELEASED | CANCELLED
                        CHECK (status IN ('DRAFT','GENERATED','RELEASED','CANCELLED')),
        file_format   VARCHAR(12),                            -- PAIN001 | CSV
        file_name     VARCHAR(160),
        file_data     TEXT,                                   -- generated file (never transmitted by the MES)
        remarks       TEXT,
        created_by    VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        generated_at  TIMESTAMP,
        released_by   VARCHAR(60),
        released_at   TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS ix_paybatch_status ON bank_payment_batches (status, created_at DESC);

      CREATE TABLE IF NOT EXISTS bank_payment_lines (
        line_id       BIGSERIAL PRIMARY KEY,
        batch_id      BIGINT NOT NULL REFERENCES bank_payment_batches(batch_id) ON DELETE CASCADE,
        beneficiary_id BIGINT REFERENCES bank_beneficiaries(beneficiary_id),
        partner_id    INTEGER REFERENCES partners(partner_id),
        amount        NUMERIC(16,2) NOT NULL CHECK (amount > 0),
        purpose       VARCHAR(140),
        reference     VARCHAR(60),
        invoice_ref   VARCHAR(80),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ix_payline_batch ON bank_payment_lines (batch_id);
    `);
    console.log('Bank reconciliation schema ready');
  } catch (err) {
    console.error('ensureBankReconSchema error:', err.message);
  }
}

async function ensureFinancialViews() {
  try {
    await pool.query(`

      -- Redefined to net credit notes off the invoice as well as payments.
      -- Without this a returned consignment would leave the customer showing as
      -- owing money for goods that are back in our warehouse, and the credit
      -- gate would block them for it.
      --
      -- CREATE OR REPLACE VIEW can only append columns, never rename or reorder
      -- them, so "allocated" keeps its position and meaning (everything applied
      -- to the invoice) while "paid" and "credited" are added at the end to
      -- break that down. Reordering here would fail on an existing install.
      CREATE OR REPLACE VIEW v_invoice_balances AS
        SELECT ti.invoice_id, ti.invoice_number, ti.partner_id, ti.invoice_date,
               ti.grand_total,
               COALESCE(al.allocated, 0) + COALESCE(cn.credited, 0) AS allocated,
               ti.grand_total - COALESCE(al.allocated, 0) - COALESCE(cn.credited, 0) AS balance,
               (ti.invoice_date + (COALESCE(p.credit_days,0) || ' days')::interval)::date AS due_date,
               GREATEST(0, (CURRENT_DATE - (ti.invoice_date + (COALESCE(p.credit_days,0) || ' days')::interval)::date))::int AS days_overdue,
               COALESCE(al.allocated, 0)                  AS paid,
               COALESCE(cn.credited, 0)                   AS credited
          FROM tax_invoices ti
          LEFT JOIN partners p ON p.partner_id = ti.partner_id
          LEFT JOIN (
            SELECT pa.invoice_id, SUM(pa.amount) AS allocated
              FROM payment_allocations pa
              JOIN payments pm ON pm.payment_id = pa.payment_id AND pm.status = 'ACTIVE'
             GROUP BY pa.invoice_id
          ) al ON al.invoice_id = ti.invoice_id
          LEFT JOIN (
            SELECT ca.invoice_id, SUM(ca.amount) AS credited
              FROM credit_note_allocations ca
              JOIN credit_notes cnn ON cnn.note_id = ca.note_id AND cnn.status = 'ACTIVE'
             GROUP BY ca.invoice_id
          ) cn ON cn.invoice_id = ti.invoice_id
         WHERE ti.status <> 'CANCELLED';

      CREATE OR REPLACE VIEW v_partner_outstanding AS
        SELECT partner_id,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009), 0)                                   AS outstanding,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009 AND days_overdue > 0), 0)               AS overdue,
               COUNT(*) FILTER (WHERE balance > 0.009)                                                     AS open_invoices,
               COALESCE(MAX(days_overdue) FILTER (WHERE balance > 0.009), 0)                               AS oldest_overdue_days,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009 AND days_overdue = 0), 0)               AS current_amt,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009 AND days_overdue BETWEEN 1 AND 30), 0)  AS bucket_1_30,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009 AND days_overdue BETWEEN 31 AND 60), 0) AS bucket_31_60,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009 AND days_overdue BETWEEN 61 AND 90), 0) AS bucket_61_90,
               COALESCE(SUM(balance) FILTER (WHERE balance > 0.009 AND days_overdue > 90), 0)              AS bucket_90_plus
          FROM v_invoice_balances
         GROUP BY partner_id;
    `);
  } catch (err) {
    console.error("ensureFinancialViews error:", err.message);
  }
}

// Baseline reference data.
//
// The tables below are what the application needs before anyone can do anything
// at all: without a unit of measure an item cannot be created, without a document
// series an invoice cannot be numbered, without a financial year nothing can be
// dated into a period. On the original install they were populated by hand, so a
// second firm's database came up structurally complete and functionally unusable.
//
// Everything here is generic to a knitting mill or statutory — units, GST rates,
// common fabric defects, the standard store layout. Nothing is specific to one
// firm; a firm's own name, address and GSTIN live in app_settings.
//
// Each table is seeded ONLY when it is empty, so this is a no-op on an
// established install and never overwrites anything anyone has edited.
async function ensureReferenceData() {
  const seed = async (table, sql, params = []) => {
    try {
      const c = await pool.query(`SELECT COUNT(*)::int n FROM ${table}`);
      if (c.rows[0].n > 0) return 0;
      await pool.query(sql, params);
      const after = await pool.query(`SELECT COUNT(*)::int n FROM ${table}`);
      console.log(`  seeded ${table}: ${after.rows[0].n} rows`);
      return after.rows[0].n;
    } catch (err) {
      console.error(`  seed ${table} failed:`, err.message);
      return 0;
    }
  };

  try {
    await seed('uom', `
      INSERT INTO uom (code, name) VALUES
        ('KG','Kilogram'),('MTR','Metre'),('PCS','Pieces'),
        ('CONE','Cone'),('ROLL','Roll'),('PKT','Packet'),('SET','Set')`);

    await seed('item_categories', `
      INSERT INTO item_categories (code, name, description) VALUES
        ('YARN','Yarn','Raw material — yarn'),
        ('FABRIC','Fabric','Knitted fabric before processing'),
        ('SPARES','Spares & Accessories','Machine spare parts'),
        ('PACKING','Packing Material','Bags, cartons, labels'),
        ('SERVICES','Services','Job work and external services')`);

    await seed('tax_rates', `
      INSERT INTO tax_rates (code, name, cgst, sgst, igst) VALUES
        ('GST0','Exempt / Nil Rated',0,0,0),
        ('GST5','GST 5%',2.5,2.5,5),
        ('GST12','GST 12%',6,6,12),
        ('GST18','GST 18%',9,9,18)`);

    await seed('defect_types', `
      INSERT INTO defect_types (name, description, sort_order) VALUES
        ('Hole','Physical hole or tear in fabric',1),
        ('Stain','Oil, dye, or dirt stain',2),
        ('Uneven Dyeing','Inconsistent colour/shade across fabric',3),
        ('Slub','Thick/thin yarn irregularity',4),
        ('Missing Yarn','Broken or dropped yarn end',5),
        ('Width Variation','Fabric width out of tolerance',6),
        ('GSM Variation','Weight per square metre out of tolerance',7),
        ('Contamination','Foreign fibre or material in fabric',8),
        ('Needle Line','Knitting needle mark defect',9)`);

    await seed('warehouses', `
      INSERT INTO warehouses (code, name, type) VALUES
        ('YARN-STORE','Yarn Store','INTERNAL'),
        ('GREIGE-STORE','Greige Store','INTERNAL'),
        ('FG-STORE','Finished Goods Store','INTERNAL'),
        ('DYE-HOUSE','Dye House','EXTERNAL'),
        ('FINISHING','Finishing Unit','EXTERNAL'),
        ('TRANSIT','In Transit','TRANSIT')`);

    await seed('doc_series', `
      INSERT INTO doc_series (series_code, prefix, include_year, zero_pad, reset_yearly) VALUES
        ('GRN','GRN',true,4,true), ('LOT','LOT',true,4,true), ('ISS','ISS',true,4,true),
        ('SC','SC',true,4,true),   ('DC','DC',true,4,true),   ('PO','PO',true,4,true),
        ('ITEM','ITM',false,5,false), ('PART','PART',false,5,false)`);

    // Indian financial year runs 1 April to 31 March. Derived from today rather
    // than hardcoded, so a tenant created in any year gets the right periods
    // instead of someone else's.
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const label = (y) => `${y}-${String(y + 1).slice(2)}`;
    await seed('financial_years', `
      INSERT INTO financial_years (label, start_date, end_date, is_active, is_closed) VALUES
        ($1, $2, $3, true,  false),
        ($4, $5, $6, false, false)`,
      [label(startYear),     `${startYear}-04-01`,     `${startYear + 1}-03-31`,
       label(startYear + 1), `${startYear + 1}-04-01`, `${startYear + 2}-03-31`]);
  } catch (err) {
    console.error('ensureReferenceData error:', err.message);
  }
}

module.exports = { seedDefaultAdmin, ensureProductionHistory, ensureMaintenanceSchema, ensureUsersSchema, ensureOperatorsSchema, ensurePurchaseOrdersSchema, ensureSalesOrdersSchema, ensureProductionPlansSchema, ensurePayrollSchema, ensureTaxInvoicesSchema, ensureAlertAcksSchema, ensureCollectorRollSchema, ensureWaCrmSchema, ensureLogisticsSchema, ensureAllocationSchema, ensureUomSchema, ensureFinancialViews, ensureReferenceData, ensureFinancialConstraints, ensureKnittingSchema, ensureBankReconSchema, ensureSoftDelete, SOFT_DELETE_TABLES, ensureComplaintsSchema, ensureOrderLineWeights, ensureBusyProductionSchema, ensureFabricInspectionSchema, ensureAiAgentsSchema, ensureAiApprovalsSchema, ensureCapaSchema, ensureShadeSwatchesSchema, ensureTimestamps, ensureCheckConstraints, ensureForeignKeyIndexes };
