// Import Tracking & Control Tower — schema (self-ensuring, like audit.js /
// busy-bridge.js). Creates only the NEW import tables; suppliers, materials, POs,
// GRN, inventory, warehouses, users all remain the existing masters (referenced
// by FK, never duplicated).
//
// CIF is DHOWN's default import Incoterm: the supplier CIF price already includes
// ocean freight + marine insurance, so those are NEVER auto-added again — the cost
// model starts from CIF and adds only import-side (post-CIF) expenses.

let ensured = false;

module.exports = (pool) => {
  async function ensure() {
    if (ensured) return;
    await pool.query(`
      -- ── Import master (one per imported consignment, linked to an existing PO) ──
      CREATE TABLE IF NOT EXISTS imports (
        import_id        BIGSERIAL PRIMARY KEY,
        import_no        TEXT UNIQUE NOT NULL,               -- IMP-2026-000001
        purchase_order_id INTEGER REFERENCES purchase_orders(po_id),
        supplier_id      INTEGER REFERENCES partners(partner_id),
        material_id      INTEGER REFERENCES items(item_id),
        warehouse_id     INTEGER REFERENCES warehouses(warehouse_id),
        country_of_origin TEXT,
        proforma_invoice_number TEXT,
        commercial_invoice_number TEXT,
        invoice_date     DATE,
        quantity         NUMERIC(16,3) DEFAULT 0 CHECK (quantity >= 0),
        unit             TEXT DEFAULT 'KG',
        currency         TEXT DEFAULT 'USD',
        unit_price       NUMERIC(16,4) DEFAULT 0 CHECK (unit_price >= 0),
        invoice_value    NUMERIC(18,2) DEFAULT 0 CHECK (invoice_value >= 0),
        incoterm         TEXT NOT NULL DEFAULT 'CIF'
                           CHECK (incoterm IN ('CIF','CFR','FOB','EXW','DDP','DAP','CIP','FCA','CPT')),
        port_of_loading  TEXT,
        transshipment_port TEXT,
        port_of_discharge TEXT,
        final_destination TEXT DEFAULT 'Ludhiana',
        shipping_line    TEXT,
        freight_forwarder TEXT,
        cha              TEXT,
        booking_number   TEXT,
        bl_number        TEXT,
        etd              DATE,
        original_eta     DATE,
        current_eta      DATE,
        actual_departure DATE,
        actual_arrival   DATE,
        status           TEXT NOT NULL DEFAULT 'PLANNED',
        priority         TEXT DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
        remarks          TEXT,
        created_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_imports_po       ON imports(purchase_order_id);
      CREATE INDEX IF NOT EXISTS idx_imports_supplier ON imports(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_imports_material  ON imports(material_id);
      CREATE INDEX IF NOT EXISTS idx_imports_warehouse ON imports(warehouse_id);
      CREATE INDEX IF NOT EXISTS idx_imports_status   ON imports(status);
      CREATE INDEX IF NOT EXISTS idx_imports_eta      ON imports(current_eta);
      CREATE INDEX IF NOT EXISTS idx_imports_bl       ON imports(bl_number);

      -- ── Cost master (1:1 with import). CIF value is the STARTING point; only
      --    import-side (post-CIF) expenses are added. Freight/insurance treatment
      --    is recorded so CIF-included charges are never double-counted. ──
      CREATE TABLE IF NOT EXISTS import_costs (
        import_id        BIGINT PRIMARY KEY REFERENCES imports(import_id) ON DELETE CASCADE,
        cif_value        NUMERIC(18,2) DEFAULT 0 CHECK (cif_value >= 0),
        invoice_currency TEXT DEFAULT 'USD',
        exchange_rate    NUMERIC(16,6) DEFAULT 0 CHECK (exchange_rate >= 0),
        cif_value_in_inr NUMERIC(18,2) DEFAULT 0 CHECK (cif_value_in_inr >= 0),
        -- Freight/insurance treatment (CIF double-count protection).
        ocean_freight_treatment   TEXT DEFAULT 'INCLUDED_IN_CIF'
                           CHECK (ocean_freight_treatment IN ('INCLUDED_IN_CIF','ADDITIONAL','NOT_APPLICABLE')),
        ocean_freight_amount      NUMERIC(18,2) DEFAULT 0 CHECK (ocean_freight_amount >= 0),
        marine_insurance_treatment TEXT DEFAULT 'INCLUDED_IN_CIF'
                           CHECK (marine_insurance_treatment IN ('INCLUDED_IN_CIF','ADDITIONAL','NOT_APPLICABLE')),
        marine_insurance_amount   NUMERIC(18,2) DEFAULT 0 CHECK (marine_insurance_amount >= 0),
        -- Import-side expenses (added to CIF to reach landed cost).
        customs_assessable_value  NUMERIC(18,2) DEFAULT 0 CHECK (customs_assessable_value >= 0),
        customs_duty     NUMERIC(18,2) DEFAULT 0 CHECK (customs_duty >= 0),
        other_customs_levies NUMERIC(18,2) DEFAULT 0 CHECK (other_customs_levies >= 0),
        igst             NUMERIC(18,2) DEFAULT 0 CHECK (igst >= 0),
        igst_recoverable BOOLEAN DEFAULT true,   -- ITC recoverable → NOT part of inventory cost
        other_taxes      NUMERIC(18,2) DEFAULT 0 CHECK (other_taxes >= 0),
        port_charges     NUMERIC(18,2) DEFAULT 0 CHECK (port_charges >= 0),
        terminal_charges NUMERIC(18,2) DEFAULT 0 CHECK (terminal_charges >= 0),
        cfs_charges      NUMERIC(18,2) DEFAULT 0 CHECK (cfs_charges >= 0),
        cha_charges      NUMERIC(18,2) DEFAULT 0 CHECK (cha_charges >= 0),
        documentation_charges NUMERIC(18,2) DEFAULT 0 CHECK (documentation_charges >= 0),
        bank_charges     NUMERIC(18,2) DEFAULT 0 CHECK (bank_charges >= 0),
        local_transport  NUMERIC(18,2) DEFAULT 0 CHECK (local_transport >= 0),
        other_import_expenses NUMERIC(18,2) DEFAULT 0 CHECK (other_import_expenses >= 0),
        -- Estimated vs actual: is this the estimate or the finalised actual?
        is_actual        BOOLEAN DEFAULT false,
        total_landed_cost NUMERIC(18,2) DEFAULT 0 CHECK (total_landed_cost >= 0),
        estimated_landed_cost NUMERIC(18,2) DEFAULT 0 CHECK (estimated_landed_cost >= 0),
        landed_cost_per_kg NUMERIC(16,4) DEFAULT 0 CHECK (landed_cost_per_kg >= 0),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE import_costs ADD COLUMN IF NOT EXISTS estimated_landed_cost NUMERIC(18,2) DEFAULT 0;
      -- Recoverable GST buckets on import-side invoices (ITC): CGST+SGST for local
      -- services (e.g. CHA), IGST for customs (BoE) / inter-state. 'igst' col already
      -- holds the BoE IGST. CHA's CGST+SGST (18% split 9/9) is auto-computed on top.
      ALTER TABLE import_costs ADD COLUMN IF NOT EXISTS cgst NUMERIC(18,2) DEFAULT 0 CHECK (cgst >= 0);
      ALTER TABLE import_costs ADD COLUMN IF NOT EXISTS sgst NUMERIC(18,2) DEFAULT 0 CHECK (sgst >= 0);

      -- ── Shipments (one import may have several) ──
      CREATE TABLE IF NOT EXISTS import_shipments (
        shipment_id      BIGSERIAL PRIMARY KEY,
        import_id        BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        booking_number   TEXT,
        shipping_line    TEXT,
        forwarder        TEXT,
        vessel_id        BIGINT,
        voyage_number    TEXT,
        master_bl        TEXT,
        house_bl         TEXT,
        bl_number        TEXT,
        port_of_loading  TEXT,
        transshipment_port TEXT,
        port_of_discharge TEXT,
        etd              DATE,
        eta              DATE,
        actual_departure DATE,
        actual_arrival   DATE,
        status           TEXT DEFAULT 'PLANNED',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_import_shipments_import ON import_shipments(import_id);
      CREATE INDEX IF NOT EXISTS idx_import_shipments_booking ON import_shipments(booking_number);
      -- Partial shipments: one import may ship in several parts. Each shipment
      -- carries its own quantity; received/rejected fill in from GRN later.
      ALTER TABLE import_shipments ADD COLUMN IF NOT EXISTS quantity     NUMERIC(16,3) DEFAULT 0;
      ALTER TABLE import_shipments ADD COLUMN IF NOT EXISTS received_qty NUMERIC(16,3) DEFAULT 0;
      ALTER TABLE import_shipments ADD COLUMN IF NOT EXISTS rejected_qty NUMERIC(16,3) DEFAULT 0;

      -- ── Containers (one shipment may have several) ──
      CREATE TABLE IF NOT EXISTS import_containers (
        container_id     BIGSERIAL PRIMARY KEY,
        shipment_id      BIGINT NOT NULL REFERENCES import_shipments(shipment_id) ON DELETE CASCADE,
        container_number TEXT,
        container_type   TEXT,
        seal_number      TEXT,
        gross_weight     NUMERIC(16,3) DEFAULT 0 CHECK (gross_weight >= 0),
        net_weight       NUMERIC(16,3) DEFAULT 0 CHECK (net_weight >= 0),
        package_count    INTEGER DEFAULT 0 CHECK (package_count >= 0),
        cargo_description TEXT,
        current_location TEXT,
        current_status   TEXT DEFAULT 'PLANNED',
        original_eta     DATE,
        current_eta      DATE,
        actual_arrival   DATE,
        release_date     DATE,
        delivery_date    DATE,
        last_tracking_update TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_import_containers_shipment ON import_containers(shipment_id);
      -- Only ONE active row per container number (soft-deleted rows excluded).
      CREATE UNIQUE INDEX IF NOT EXISTS uq_import_container_active
        ON import_containers(container_number) WHERE deleted_at IS NULL AND container_number IS NOT NULL;

      -- ── Status history (append-only trail of import status transitions) ──
      CREATE TABLE IF NOT EXISTS import_status_history (
        id               BIGSERIAL PRIMARY KEY,
        import_id        BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        from_status      TEXT,
        to_status        TEXT NOT NULL,
        changed_by       TEXT,
        is_override      BOOLEAN DEFAULT false,
        remarks          TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_status_hist_import ON import_status_history(import_id);

      -- ── Tracking events (from provider sync or manual entry) ──
      CREATE TABLE IF NOT EXISTS import_tracking_events (
        event_id         BIGSERIAL PRIMARY KEY,
        import_id        BIGINT REFERENCES imports(import_id) ON DELETE CASCADE,
        shipment_id      BIGINT REFERENCES import_shipments(shipment_id) ON DELETE CASCADE,
        container_id     BIGINT REFERENCES import_containers(container_id) ON DELETE CASCADE,
        event_type       TEXT NOT NULL,
        event_status     TEXT,
        event_timestamp  TIMESTAMPTZ,
        location         TEXT,
        latitude         NUMERIC(9,6),
        longitude        NUMERIC(9,6),
        source           TEXT DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AIS','SHIPPING_LINE','FORWARDER','PROVIDER')),
        provider         TEXT,
        provider_event_id TEXT,
        remarks          TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_track_import ON import_tracking_events(import_id);
      CREATE INDEX IF NOT EXISTS idx_import_track_shipment ON import_tracking_events(shipment_id);
      CREATE INDEX IF NOT EXISTS idx_import_track_container ON import_tracking_events(container_id);

      -- ── Import ↔ existing GRN link (non-invasive). The GRN and its received
      --    quantities/inventory stay authoritative in the existing grn/yarn_lots/
      --    stock_ledger; this only records which GRN fulfils which import/shipment.
      CREATE TABLE IF NOT EXISTS import_grn_links (
        id           BIGSERIAL PRIMARY KEY,
        import_id    BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        shipment_id  BIGINT REFERENCES import_shipments(shipment_id) ON DELETE SET NULL,
        grn_id       INTEGER NOT NULL REFERENCES grn(grn_id) ON DELETE CASCADE,
        linked_by    TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (import_id, grn_id)
      );
      CREATE INDEX IF NOT EXISTS idx_import_grn_import ON import_grn_links(import_id);
      CREATE INDEX IF NOT EXISTS idx_import_grn_shipment ON import_grn_links(shipment_id);
      CREATE INDEX IF NOT EXISTS idx_import_grn_grn ON import_grn_links(grn_id);

      -- ── Customs (1:1). No government API is claimed — these are recorded by the
      --    CHA / accounts team from the actual Bill of Entry. ──
      CREATE TABLE IF NOT EXISTS import_customs (
        import_id        BIGINT PRIMARY KEY REFERENCES imports(import_id) ON DELETE CASCADE,
        boe_number       TEXT,
        boe_date         DATE,
        customs_status   TEXT DEFAULT 'NOT_FILED'
                           CHECK (customs_status IN ('NOT_FILED','FILED','UNDER_ASSESSMENT','EXAMINATION','DUTY_PAID','OUT_OF_CHARGE','RELEASED')),
        assessable_value NUMERIC(18,2) DEFAULT 0 CHECK (assessable_value >= 0),
        customs_duty     NUMERIC(18,2) DEFAULT 0 CHECK (customs_duty >= 0),
        igst             NUMERIC(18,2) DEFAULT 0 CHECK (igst >= 0),
        other_taxes      NUMERIC(18,2) DEFAULT 0 CHECK (other_taxes >= 0),
        duty_payment_date DATE,
        examination_status TEXT,
        out_of_charge_date DATE,
        cha              TEXT,
        remarks          TEXT,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Documents (many per import). File bytes stored as base64 text (imports
      --    have few, small docs); consistent with how the app already holds small
      --    files. status MISSING/UPLOADED/VERIFIED/REJECTED. ──
      CREATE TABLE IF NOT EXISTS import_documents (
        document_id      BIGSERIAL PRIMARY KEY,
        import_id        BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        doc_type         TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'UPLOADED'
                           CHECK (status IN ('MISSING','UPLOADED','VERIFIED','REJECTED')),
        file_name        TEXT,
        mime_type        TEXT,
        file_data        TEXT,               -- base64
        uploaded_by      TEXT,
        uploaded_at      TIMESTAMPTZ,
        verified_by      TEXT,
        verified_at      TIMESTAMPTZ,
        remarks          TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_documents_import ON import_documents(import_id);

      -- ── Post-port logistics legs (many per import; optional per shipment) ──
      CREATE TABLE IF NOT EXISTS import_logistics (
        leg_id           BIGSERIAL PRIMARY KEY,
        import_id        BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        shipment_id      BIGINT REFERENCES import_shipments(shipment_id) ON DELETE SET NULL,
        transporter      TEXT,
        vehicle_number   TEXT,
        driver           TEXT,
        lr_number        TEXT,
        dispatch_date    DATE,
        expected_delivery DATE,
        actual_delivery  DATE,
        freight          NUMERIC(18,2) DEFAULT 0 CHECK (freight >= 0),
        warehouse_id     INTEGER REFERENCES warehouses(warehouse_id),
        status           TEXT DEFAULT 'PLANNED',
        pod_file_name    TEXT,
        remarks          TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_logistics_import ON import_logistics(import_id);
      CREATE INDEX IF NOT EXISTS idx_import_logistics_shipment ON import_logistics(shipment_id);
      CREATE INDEX IF NOT EXISTS idx_import_logistics_warehouse ON import_logistics(warehouse_id);

      -- ── ETA history (spec §22) — every ETA change is preserved, so the full
      --    original→current progression is auditable. ──
      CREATE TABLE IF NOT EXISTS import_eta_history (
        id           BIGSERIAL PRIMARY KEY,
        import_id    BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        shipment_id  BIGINT REFERENCES import_shipments(shipment_id) ON DELETE SET NULL,
        old_eta      DATE,
        new_eta      DATE,
        delay_days   INTEGER,
        source       TEXT DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AIS','SHIPPING_LINE','FORWARDER','PROVIDER')),
        changed_by   TEXT,
        remarks      TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_eta_hist_import ON import_eta_history(import_id);
      CREATE INDEX IF NOT EXISTS idx_import_eta_hist_shipment ON import_eta_history(shipment_id);

      -- ── Exceptions (spec §23-24) — auto-detected + human-managed. ──
      CREATE TABLE IF NOT EXISTS import_exceptions (
        exception_id     BIGSERIAL PRIMARY KEY,
        import_id        BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        shipment_id      BIGINT REFERENCES import_shipments(shipment_id) ON DELETE SET NULL,
        container_id     BIGINT REFERENCES import_containers(container_id) ON DELETE SET NULL,
        exception_type   TEXT NOT NULL,
        severity         TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
        description      TEXT,
        owner            TEXT,
        status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DISMISSED')),
        auto_detected    BOOLEAN DEFAULT true,
        resolution       TEXT,
        acknowledged_at  TIMESTAMPTZ,
        resolved_at      TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_exc_import ON import_exceptions(import_id);
      CREATE INDEX IF NOT EXISTS idx_import_exc_shipment ON import_exceptions(shipment_id);
      CREATE INDEX IF NOT EXISTS idx_import_exc_container ON import_exceptions(container_id);
      CREATE INDEX IF NOT EXISTS idx_import_exc_status ON import_exceptions(status);
      -- One ACTIVE auto-detected exception per (import, type) — reconciled each scan.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_import_exc_active
        ON import_exceptions(import_id, exception_type)
        WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') AND auto_detected = true;
      -- Dedup: the same provider event never lands twice.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_import_track_provider
        ON import_tracking_events(provider, provider_event_id)
        WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

      -- ── Vessel master (spec §9). One row per ship; referenced by shipments.
      --    Position is NEVER stored here — a vessel's "last known position" is
      --    derived live from real tracking events (manual or provider), so the map
      --    can only ever plot coordinates that actually exist. No fake coords. ──
      CREATE TABLE IF NOT EXISTS import_vessels (
        vessel_id      BIGSERIAL PRIMARY KEY,
        vessel_name    TEXT NOT NULL,
        imo_number     TEXT,                    -- 7-digit IMO (permanent hull id)
        mmsi           TEXT,                    -- 9-digit AIS id
        call_sign      TEXT,
        flag           TEXT,
        vessel_type    TEXT,
        operator       TEXT,
        gross_tonnage  NUMERIC(14,2) DEFAULT 0 CHECK (gross_tonnage >= 0),
        built_year     INTEGER,
        remarks        TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_import_vessels_name ON import_vessels(vessel_name);
      -- Only ONE active vessel per IMO number (soft-deleted rows excluded).
      CREATE UNIQUE INDEX IF NOT EXISTS uq_import_vessel_imo
        ON import_vessels(imo_number) WHERE deleted_at IS NULL AND imo_number IS NOT NULL;
      -- import_shipments.vessel_id references it; index the FK leading column.
      CREATE INDEX IF NOT EXISTS idx_import_shipments_vessel ON import_shipments(vessel_id);

      -- ── Busy posting readiness (spec §33) — MES NEVER writes to Busy's proprietary
      --    .BDS; the live partner API is pending. These columns only record that a
      --    human posted the import voucher in Busy, and its reference, so the MES
      --    side knows what is reconciled. Set solely by an explicit operator action. ──
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS busy_posted_ref TEXT;
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS busy_posted_at  TIMESTAMPTZ;
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS busy_posted_by  TEXT;

      -- Advance / down payment made at booking (from the PI). Recorded here; the
      -- Busy advance voucher is drafted for the human to post (MES never writes Busy).
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS advance_amount    NUMERIC(18,2) DEFAULT 0 CHECK (advance_amount >= 0);
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS advance_currency  TEXT;
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS advance_paid_date DATE;
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS advance_busy_ref  TEXT;
      ALTER TABLE imports ADD COLUMN IF NOT EXISTS created_via       TEXT;   -- e.g. 'AI_DOC_INTAKE'

      -- ── Import payments (spec §35) — advance + balance TTs, EACH at its own
      --    exchange rate (from the bank TT advice; advance & final differ). A single
      --    payment may cover 2-3 containers/imports whose shipments arrive separately,
      --    so a payment is STANDALONE and ALLOCATED across imports (many-to-many). The
      --    INR cost of an import is the SUM of its allocations' actual INR — the real
      --    blended rate paid, never a single assumed rate. Busy posts the entry. ──
      CREATE TABLE IF NOT EXISTS import_payments (
        payment_id     BIGSERIAL PRIMARY KEY,
        kind           TEXT NOT NULL DEFAULT 'ADVANCE' CHECK (kind IN ('ADVANCE','BALANCE','OTHER')),
        supplier_id    INTEGER REFERENCES partners(partner_id),   -- beneficiary
        amount_fc      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_fc >= 0),   -- foreign currency
        currency       TEXT DEFAULT 'USD',
        exchange_rate  NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK (exchange_rate >= 0),
        amount_inr     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_inr >= 0),
        bank_charges   NUMERIC(18,2) DEFAULT 0 CHECK (bank_charges >= 0),
        tt_reference   TEXT,
        tt_date        DATE,
        invoice_ref    TEXT,               -- invoice/PI the TT quotes
        bank           TEXT,
        busy_ref       TEXT,
        remarks        TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_import_payments_supplier ON import_payments(supplier_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_import_payment_ttref
        ON import_payments(tt_reference) WHERE tt_reference IS NOT NULL;   -- one row per TT

      -- Per-payment bank/forex charges, itemised (each TT carries its own). These are
      -- real costs of the remittance and flow into landed cost, apportioned to the
      -- imports the payment funds. 'bank_charges' remains any OTHER bank charge.
      ALTER TABLE import_payments ADD COLUMN IF NOT EXISTS swift_charges          NUMERIC(18,2) DEFAULT 0 CHECK (swift_charges >= 0);          -- remittance / SWIFT
      ALTER TABLE import_payments ADD COLUMN IF NOT EXISTS advance_import_charges NUMERIC(18,2) DEFAULT 0 CHECK (advance_import_charges >= 0); -- foreign advance import charges
      ALTER TABLE import_payments ADD COLUMN IF NOT EXISTS fx_conversion_charges  NUMERIC(18,2) DEFAULT 0 CHECK (fx_conversion_charges >= 0);  -- foreign currency conversion charges

      -- Allocation of a payment across one or more imports (splits an advance that
      -- covers several containers). Import INR cost = SUM(allocated_inr) here.
      CREATE TABLE IF NOT EXISTS import_payment_allocations (
        id             BIGSERIAL PRIMARY KEY,
        payment_id     BIGINT NOT NULL REFERENCES import_payments(payment_id) ON DELETE CASCADE,
        import_id      BIGINT NOT NULL REFERENCES imports(import_id) ON DELETE CASCADE,
        allocated_fc   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (allocated_fc >= 0),
        allocated_inr  NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (allocated_inr >= 0),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (payment_id, import_id)
      );
      CREATE INDEX IF NOT EXISTS idx_import_payalloc_payment ON import_payment_allocations(payment_id);
      CREATE INDEX IF NOT EXISTS idx_import_payalloc_import  ON import_payment_allocations(import_id);
    `);
    ensured = true;
  }

  return { ensure };
};
