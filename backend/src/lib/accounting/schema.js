// Accounting engine — schema (Phase 1).
//
// Lives in its own PostgreSQL schema `acct` so it is isolated from the MES
// tables: the boot-time auto-constraint scanner (ensureCheckConstraints) only
// touches `public`, and nothing in the MES can accidentally write a journal.
//
// Follows the repo convention: idempotent, additive ensure() run on every boot
// (see migrations/README.md). Reuses public.financial_years, public.partners and
// public.cost_centres rather than duplicating them.
//
// Database-level guarantees (defence in depth — the service layer checks too):
//   * journal_entries / journal_lines / audit_log are append-only (no UPDATE/DELETE)
//   * every journal entry balances (Σdr = Σcr > 0), checked at COMMIT
//   * a journal cannot be written into a CLOSED/LOCKED period
//   * voucher lines can only change while the voucher is DRAFT/VALIDATED
//   * a POSTED voucher can only move to REVERSED, touching nothing else
//   * posted vouchers cannot be deleted

const PRIMARY_GROUPS = [
  // code, name, nature, report, parent_code, sort
  ['CAPITAL', 'Capital Account', 'LIABILITY', 'BS', null, 10],
  ['RESERVES', 'Reserves & Surplus', 'LIABILITY', 'BS', 'CAPITAL', 11],
  ['LOANS_LIAB', 'Loans (Liability)', 'LIABILITY', 'BS', null, 20],
  ['SECURED_LOANS', 'Secured Loans', 'LIABILITY', 'BS', 'LOANS_LIAB', 21],
  ['UNSECURED_LOANS', 'Unsecured Loans', 'LIABILITY', 'BS', 'LOANS_LIAB', 22],
  ['BANK_OD', 'Bank OD / CC Account', 'LIABILITY', 'BS', 'LOANS_LIAB', 23],
  ['CURRENT_LIAB', 'Current Liabilities', 'LIABILITY', 'BS', null, 30],
  ['DUTIES_TAXES', 'Duties & Taxes', 'LIABILITY', 'BS', 'CURRENT_LIAB', 31],
  ['PROVISIONS', 'Provisions / Expenses Payable', 'LIABILITY', 'BS', 'CURRENT_LIAB', 32],
  ['SUNDRY_CREDITORS', 'Sundry Creditors', 'LIABILITY', 'BS', 'CURRENT_LIAB', 33],
  ['SUSPENSE', 'Suspense Account', 'LIABILITY', 'BS', null, 40],
  ['FIXED_ASSETS', 'Fixed Assets', 'ASSET', 'BS', null, 50],
  ['INVESTMENTS', 'Investments', 'ASSET', 'BS', null, 60],
  ['CURRENT_ASSETS', 'Current Assets', 'ASSET', 'BS', null, 70],
  ['STOCK_IN_HAND', 'Stock-in-hand', 'ASSET', 'BS', 'CURRENT_ASSETS', 71],
  ['SUNDRY_DEBTORS', 'Sundry Debtors', 'ASSET', 'BS', 'CURRENT_ASSETS', 72],
  ['CASH_IN_HAND', 'Cash-in-hand', 'ASSET', 'BS', 'CURRENT_ASSETS', 73],
  ['BANK_ACCOUNTS', 'Bank Accounts', 'ASSET', 'BS', 'CURRENT_ASSETS', 74],
  ['LOANS_ADV_ASSET', 'Loans & Advances (Asset)', 'ASSET', 'BS', 'CURRENT_ASSETS', 75],
  ['DEPOSITS_ASSET', 'Deposits (Asset)', 'ASSET', 'BS', 'CURRENT_ASSETS', 76],
  ['MISC_EXP_ASSET', 'Misc. Expenses (Asset)', 'ASSET', 'BS', null, 80],
  ['SALES', 'Sales Accounts', 'INCOME', 'PL', null, 100],
  ['PURCHASE', 'Purchase Accounts', 'EXPENSE', 'PL', null, 110],
  ['DIRECT_INCOME', 'Direct Incomes', 'INCOME', 'PL', null, 120],
  ['DIRECT_EXPENSE', 'Direct Expenses', 'EXPENSE', 'PL', null, 130],
  ['INDIRECT_INCOME', 'Indirect Incomes', 'INCOME', 'PL', null, 140],
  ['INDIRECT_EXPENSE', 'Indirect Expenses', 'EXPENSE', 'PL', null, 150],
];

// code, name, group_code, ledger_type
const SYSTEM_LEDGERS = [
  ['CASH', 'Cash', 'CASH_IN_HAND', 'CASH'],
  ['PROFIT_LOSS', 'Profit & Loss A/c', 'CAPITAL', 'GENERAL'],
  ['ROUND_OFF', 'Round Off', 'INDIRECT_EXPENSE', 'GENERAL'],
  ['SALES', 'Sales', 'SALES', 'GENERAL'],
  ['PURCHASE', 'Purchase', 'PURCHASE', 'GENERAL'],
  ['OUTPUT_CGST', 'Output CGST', 'DUTIES_TAXES', 'TAX'],
  ['OUTPUT_SGST', 'Output SGST', 'DUTIES_TAXES', 'TAX'],
  ['OUTPUT_IGST', 'Output IGST', 'DUTIES_TAXES', 'TAX'],
  ['INPUT_CGST', 'Input CGST', 'DUTIES_TAXES', 'TAX'],
  ['INPUT_SGST', 'Input SGST', 'DUTIES_TAXES', 'TAX'],
  ['INPUT_IGST', 'Input IGST', 'DUTIES_TAXES', 'TAX'],
  // Phase 4 — inventory & manufacturing valuation (physical qty stays in the MES
  // stock ledger; these carry the GL valuation that reconciles to it).
  ['INVENTORY', 'Inventory — Raw Material (Yarn)', 'STOCK_IN_HAND', 'STOCK'],
  ['WIP', 'Work-in-Progress', 'STOCK_IN_HAND', 'STOCK'],
  ['FINISHED_GOODS', 'Finished Goods', 'STOCK_IN_HAND', 'STOCK'],
  ['COGS', 'Cost of Goods Sold', 'DIRECT_EXPENSE', 'GENERAL'],
  ['WASTAGE', 'Wastage & Shortage', 'DIRECT_EXPENSE', 'GENERAL'],
  ['JOBWORK_CHARGES', 'Job Work Charges', 'DIRECT_EXPENSE', 'GENERAL'],
  ['CONVERSION_APPLIED', 'Conversion Cost Absorbed', 'DIRECT_EXPENSE', 'GENERAL'],
  ['GRN_CLEARING', 'Goods Received Not Invoiced', 'CURRENT_LIAB', 'GENERAL'],
];

// code, name, number prefix, requires_approval
const VOUCHER_TYPES = [
  ['SALES', 'Sales', 'SL', false],
  ['SALES_RETURN', 'Sales Return', 'SR', false],
  ['PURCHASE', 'Purchase', 'PU', false],
  ['PURCHASE_RETURN', 'Purchase Return', 'PR', false],
  ['RECEIPT', 'Receipt', 'RC', false],
  ['PAYMENT', 'Payment', 'PY', false],
  ['CONTRA', 'Contra', 'CN', false],
  ['JOURNAL', 'Journal', 'JV', false],
  ['DEBIT_NOTE', 'Debit Note', 'DN', false],
  ['CREDIT_NOTE', 'Credit Note', 'CR', false],
  ['REVERSAL', 'Reversal', 'RV', false],
];

// Default (pre-approved) posting policies for MES operational events. Each is an
// active v1; an operator can supersede with a higher version later. `rule` names
// the ledger roles the engine uses — recorded for audit and future overrides.
// event_type, voucher_type, rule
const DEFAULT_POLICIES = [
  ['GRN_RECEIPT', 'JOURNAL', { debit: 'INVENTORY', tax_side: 'INPUT', credit: 'GRN_CLEARING', party_credit: true,
    desc: 'Goods received: Dr Inventory (+ Input GST) / Cr Supplier (or GRN Clearing) at purchase value.' }],
  ['DISPATCH_COGS', 'JOURNAL', { debit: 'COGS', credit: 'FINISHED_GOODS',
    desc: 'Dispatch / sale cost: Dr Cost of Goods Sold / Cr Finished Goods at cost.' }],
  ['JOBWORK_CHARGES', 'JOURNAL', { debit: 'JOBWORK_CHARGES', tax_side: 'INPUT', credit: 'GRN_CLEARING', party_credit: true,
    desc: 'Job-work billed: Dr Job Work Charges (+ Input GST) / Cr Job-worker (or GRN Clearing).' }],
  ['WASTAGE', 'JOURNAL', { debit: 'WASTAGE', credit: 'INVENTORY',
    desc: 'Wastage / shortage: Dr Wastage & Shortage / Cr Inventory at cost.' }],
  // Manufacturing cost cycle: Raw → WIP → Finished Goods (absorption).
  ['ISSUE_TO_WIP', 'JOURNAL', { debit: 'WIP', credit: 'INVENTORY',
    desc: 'Yarn issued to production: Dr Work-in-Progress / Cr Inventory at FIFO lot cost.' }],
  ['CONVERSION_APPLIED', 'JOURNAL', { debit: 'WIP', credit: 'CONVERSION_APPLIED',
    desc: 'Knitting / conversion cost absorbed into WIP: Dr WIP / Cr Conversion Cost Absorbed.' }],
  ['PRODUCTION_OUTPUT', 'JOURNAL', { debit: 'FINISHED_GOODS', credit: 'WIP',
    desc: 'Finished goods produced: Dr Finished Goods / Cr WIP at accumulated cost.' }],
];

async function ensureAccountingSchema(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Serialise concurrent boots (two firms share one Postgres; each has its own DB,
    // but a restart storm on one DB must not race itself).
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('acct.ensure'))`);
    await c.query(`CREATE SCHEMA IF NOT EXISTS acct`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.companies (
        company_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL,
        gstin        TEXT,
        state_code   TEXT,
        base_currency TEXT NOT NULL DEFAULT 'INR',
        books_begin  DATE,
        is_default   BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_companies_default ON acct.companies(is_default) WHERE is_default`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.periods (
        period_id   SERIAL PRIMARY KEY,
        company_id  UUID NOT NULL REFERENCES acct.companies(company_id),
        fy_id       INTEGER NOT NULL REFERENCES public.financial_years(fy_id),
        period_no   SMALLINT NOT NULL CHECK (period_no BETWEEN 1 AND 12),
        start_date  DATE NOT NULL,
        end_date    DATE NOT NULL,
        status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','LOCKED')),
        changed_by  TEXT,
        changed_at  TIMESTAMPTZ,
        CHECK (end_date >= start_date),
        UNIQUE (company_id, fy_id, period_no)
      )`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.account_groups (
        group_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id  UUID NOT NULL REFERENCES acct.companies(company_id),
        code        TEXT NOT NULL,
        name        TEXT NOT NULL,
        parent_id   UUID REFERENCES acct.account_groups(group_id),
        nature      TEXT NOT NULL CHECK (nature IN ('ASSET','LIABILITY','INCOME','EXPENSE')),
        report      TEXT NOT NULL CHECK (report IN ('BS','PL')),
        sort_order  INTEGER NOT NULL DEFAULT 0,
        is_system   BOOLEAN NOT NULL DEFAULT false,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (parent_id IS NULL OR parent_id <> group_id),
        UNIQUE (company_id, code),
        UNIQUE (company_id, name)
      )`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.ledgers (
        ledger_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id   UUID NOT NULL REFERENCES acct.companies(company_id),
        code         TEXT,
        name         TEXT NOT NULL,
        group_id     UUID NOT NULL REFERENCES acct.account_groups(group_id),
        ledger_type  TEXT NOT NULL DEFAULT 'GENERAL'
                     CHECK (ledger_type IN ('GENERAL','PARTY','BANK','CASH','TAX','STOCK')),
        partner_id   INTEGER REFERENCES public.partners(partner_id),
        gstin        TEXT,
        state_code   TEXT,
        address      TEXT,
        credit_days  INTEGER,
        is_system    BOOLEAN NOT NULL DEFAULT false,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, name)
      )`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_ledgers_code ON acct.ledgers(company_id, code) WHERE code IS NOT NULL`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_ledgers_partner ON acct.ledgers(company_id, partner_id) WHERE partner_id IS NOT NULL`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_ledgers_group ON acct.ledgers(group_id)`);
    // Extra party/ledger master details (migrated from Busy; gstin/state_code/address already above).
    for (const col of ['pan', 'phone', 'email', 'pincode', 'contact', 'whatsapp']) {
      await c.query(`ALTER TABLE acct.ledgers ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }

    // Opening balance per ledger per financial year (Busy-style "opening balance" on the master).
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.ledger_openings (
        company_id  UUID NOT NULL REFERENCES acct.companies(company_id),
        fy_id       INTEGER NOT NULL REFERENCES public.financial_years(fy_id),
        ledger_id   UUID NOT NULL REFERENCES acct.ledgers(ledger_id),
        dr_amount   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (dr_amount >= 0),
        cr_amount   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cr_amount >= 0),
        updated_by  TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (NOT (dr_amount > 0 AND cr_amount > 0)),
        PRIMARY KEY (company_id, fy_id, ledger_id)
      )`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.voucher_types (
        code              TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        prefix            TEXT NOT NULL,
        requires_approval BOOLEAN NOT NULL DEFAULT false,
        is_active         BOOLEAN NOT NULL DEFAULT true
      )`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.voucher_series (
        company_id   UUID NOT NULL REFERENCES acct.companies(company_id),
        fy_id        INTEGER NOT NULL REFERENCES public.financial_years(fy_id),
        voucher_type TEXT NOT NULL REFERENCES acct.voucher_types(code),
        next_no      INTEGER NOT NULL DEFAULT 1 CHECK (next_no >= 1),
        PRIMARY KEY (company_id, fy_id, voucher_type)
      )`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.vouchers (
        voucher_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id      UUID NOT NULL REFERENCES acct.companies(company_id),
        fy_id           INTEGER NOT NULL REFERENCES public.financial_years(fy_id),
        voucher_type    TEXT NOT NULL REFERENCES acct.voucher_types(code),
        voucher_no      TEXT,
        voucher_date    DATE NOT NULL,
        status          TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','VALIDATED','APPROVED','POSTED','REVERSED','CANCELLED')),
        party_ledger_id UUID REFERENCES acct.ledgers(ledger_id),
        reference_no    TEXT,
        reference_date  DATE,
        narration       TEXT,
        source_module   TEXT,
        source_ref      TEXT,
        idempotency_key TEXT,
        reversal_of     UUID REFERENCES acct.vouchers(voucher_id),
        reversed_by_voucher_id UUID REFERENCES acct.vouchers(voucher_id),
        created_by      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        validated_by    TEXT, validated_at TIMESTAMPTZ,
        approved_by     TEXT, approved_at  TIMESTAMPTZ,
        posted_by       TEXT, posted_at    TIMESTAMPTZ,
        reversed_by     TEXT, reversed_at  TIMESTAMPTZ,
        cancelled_by    TEXT, cancelled_at TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (status NOT IN ('POSTED','REVERSED') OR voucher_no IS NOT NULL)
      )`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_vouchers_no ON acct.vouchers(company_id, fy_id, voucher_type, voucher_no) WHERE voucher_no IS NOT NULL`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_vouchers_idem ON acct.vouchers(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_vouchers_reversal ON acct.vouchers(reversal_of) WHERE reversal_of IS NOT NULL`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_vouchers_date ON acct.vouchers(company_id, voucher_date)`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_vouchers_status ON acct.vouchers(company_id, status)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.voucher_lines (
        line_id        BIGSERIAL PRIMARY KEY,
        voucher_id     UUID NOT NULL REFERENCES acct.vouchers(voucher_id) ON DELETE CASCADE,
        line_no        INTEGER NOT NULL,
        ledger_id      UUID NOT NULL REFERENCES acct.ledgers(ledger_id),
        dr_amount      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (dr_amount >= 0),
        cr_amount      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cr_amount >= 0),
        cost_centre_id INTEGER REFERENCES public.cost_centres(cc_id),
        narration      TEXT,
        CHECK ((dr_amount > 0 AND cr_amount = 0) OR (cr_amount > 0 AND dr_amount = 0)),
        UNIQUE (voucher_id, line_no)
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_vlines_ledger ON acct.voucher_lines(ledger_id)`);

    // Document detail (item lines) for Sales/Purchase vouchers. The accounting
    // effect lives in voucher_lines/journal_lines; this is the invoice body.
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.voucher_items (
        item_line_id   BIGSERIAL PRIMARY KEY,
        voucher_id     UUID NOT NULL REFERENCES acct.vouchers(voucher_id) ON DELETE CASCADE,
        line_no        INTEGER NOT NULL,
        item_id        INTEGER,
        item_name      TEXT NOT NULL,
        hsn_code       TEXT,
        quantity       NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
        uom            TEXT,
        rate           NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (rate >= 0),
        discount_pct   NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
        taxable_value  NUMERIC(18,2) NOT NULL DEFAULT 0,
        gst_rate       NUMERIC(6,2) NOT NULL DEFAULT 0,
        cgst_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
        sgst_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
        igst_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
        line_total     NUMERIC(18,2) NOT NULL DEFAULT 0,
        UNIQUE (voucher_id, line_no)
      )`);

    // The immutable general ledger.
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.journal_entries (
        je_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id   UUID NOT NULL REFERENCES acct.companies(company_id),
        voucher_id   UUID NOT NULL UNIQUE REFERENCES acct.vouchers(voucher_id),
        fy_id        INTEGER NOT NULL REFERENCES public.financial_years(fy_id),
        period_id    INTEGER NOT NULL REFERENCES acct.periods(period_id),
        posting_date DATE NOT NULL,
        posted_by    TEXT,
        posted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.journal_lines (
        jl_id          BIGSERIAL PRIMARY KEY,
        je_id          UUID NOT NULL REFERENCES acct.journal_entries(je_id),
        company_id     UUID NOT NULL REFERENCES acct.companies(company_id),
        line_no        INTEGER NOT NULL,
        ledger_id      UUID NOT NULL REFERENCES acct.ledgers(ledger_id),
        posting_date   DATE NOT NULL,
        dr_amount      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (dr_amount >= 0),
        cr_amount      NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cr_amount >= 0),
        cost_centre_id INTEGER REFERENCES public.cost_centres(cc_id),
        narration      TEXT,
        CHECK ((dr_amount > 0 AND cr_amount = 0) OR (cr_amount > 0 AND dr_amount = 0)),
        UNIQUE (je_id, line_no)
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_jl_ledger_date ON acct.journal_lines(company_id, ledger_id, posting_date)`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_jl_date ON acct.journal_lines(company_id, posting_date)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.audit_log (
        audit_id   BIGSERIAL PRIMARY KEY,
        company_id UUID,
        entity     TEXT NOT NULL,
        entity_id  TEXT,
        action     TEXT NOT NULL,
        actor      TEXT,
        at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        detail     JSONB
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_audit_entity ON acct.audit_log(entity, entity_id)`);

    // ── Phase 4: MES auto-post (versioned policies + idempotent outbox) ──────
    // Posting policies are approved + versioned; only the active version of an
    // event type is used to build a voucher. An un-approved event is refused.
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.posting_policies (
        policy_id   BIGSERIAL PRIMARY KEY,
        company_id  UUID NOT NULL,
        event_type  TEXT NOT NULL,
        version     INT  NOT NULL DEFAULT 1,
        voucher_type TEXT NOT NULL DEFAULT 'JOURNAL',
        rule        JSONB NOT NULL,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        approved_by TEXT, approved_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, event_type, version)
      )`);
    // At most one active version per event type.
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_policy_active ON acct.posting_policies(company_id, event_type) WHERE is_active`);

    // The outbox makes a retried MES event impossible to double-post: the unique
    // (company, event_type, source_ref) key means one operational document maps
    // to exactly one outbox row, and the voucher it produces carries the same key.
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.mes_event_outbox (
        outbox_id   BIGSERIAL PRIMARY KEY,
        company_id  UUID NOT NULL,
        event_type  TEXT NOT NULL,
        source_ref  TEXT NOT NULL,
        event_date  DATE,
        payload     JSONB NOT NULL,
        status      TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSED','FAILED','SKIPPED')),
        voucher_id  UUID REFERENCES acct.vouchers(voucher_id),
        attempts    INT  NOT NULL DEFAULT 0,
        last_error  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ,
        UNIQUE (company_id, event_type, source_ref)
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_outbox_status ON acct.mes_event_outbox(company_id, status)`);

    // ── Phase 5: Busy XML migration (batched, dedup-mapped, rollback-able) ───
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.migration_batches (
        batch_id   BIGSERIAL PRIMARY KEY,
        company_id UUID NOT NULL,
        label      TEXT,
        source     TEXT NOT NULL DEFAULT 'busy-xml',
        mode       TEXT NOT NULL DEFAULT 'DRAFT',
        status     TEXT NOT NULL DEFAULT 'IMPORTED'
                     CHECK (status IN ('IMPORTED','ROLLED_BACK')),
        stats      JSONB,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        rolled_back_at TIMESTAMPTZ
      )`);
    // Source→target id map: dedupe + restartability. One target per source entity.
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.migration_map (
        map_id      BIGSERIAL PRIMARY KEY,
        company_id  UUID NOT NULL,
        batch_id    BIGINT REFERENCES acct.migration_batches(batch_id),
        source_type TEXT NOT NULL,
        source_id   TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, source_type, source_id)
      )`);

    // ── Phase 3/4: bill-wise allocation (receipt/payment → specific invoice) ─
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.bill_allocations (
        alloc_id        BIGSERIAL PRIMARY KEY,
        company_id      UUID NOT NULL,
        party_ledger_id UUID NOT NULL REFERENCES acct.ledgers(ledger_id),
        bill_voucher_id   UUID NOT NULL REFERENCES acct.vouchers(voucher_id),
        settle_voucher_id UUID NOT NULL REFERENCES acct.vouchers(voucher_id),
        amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
        created_by      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_alloc_bill ON acct.bill_allocations(company_id, bill_voucher_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_alloc_settle ON acct.bill_allocations(company_id, settle_voucher_id)`);

    // ── Fixed-asset register (Depreciation Chart) ───────────────────────────
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.fixed_assets (
        asset_id      BIGSERIAL PRIMARY KEY,
        company_id    UUID NOT NULL,
        name          TEXT NOT NULL,
        block         TEXT,
        purchase_date DATE NOT NULL,
        cost          NUMERIC(18,2) NOT NULL,
        rate_pct      NUMERIC(6,2) NOT NULL,
        method        TEXT NOT NULL DEFAULT 'WDV' CHECK (method IN ('WDV','SLM')),
        opening_wdv   NUMERIC(18,2),
        disposal_date DATE,
        disposal_value NUMERIC(18,2),
        notes         TEXT,
        created_by    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    // ── Busy read-bridge mirror (Phase 1) ───────────────────────────────────
    // A clearly-tagged, READ-ONLY mirror of Busy's masters + Trial Balance,
    // extracted on Windows from the .bds (ACE OLEDB) and ingested here. It is a
    // snapshot for reconciliation + parallel-run ONLY: it never feeds the native
    // journals/vouchers and Busy stays the statutory book of record. Each import
    // is a full snapshot (history kept); the latest is the current mirror.
    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.busy_imports (
        import_id    BIGSERIAL PRIMARY KEY,
        company_id   UUID NOT NULL,
        source       TEXT NOT NULL DEFAULT 'BUSY',
        source_dir   TEXT,
        fy_db        TEXT,
        db_sha256    TEXT,
        fy_label     TEXT,
        busy_company TEXT,
        busy_gstin   TEXT,
        extracted_at TIMESTAMPTZ,
        filename     TEXT,
        totals       JSONB,
        pnl          JSONB,
        balance_sheet JSONB,
        reconciliation JSONB,
        reconciled_ok BOOLEAN,
        imported_by  TEXT,
        imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (company_id, db_sha256, extracted_at)
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_busy_imports_co ON acct.busy_imports(company_id, imported_at DESC)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.busy_masters (
        import_id    BIGINT NOT NULL REFERENCES acct.busy_imports(import_id) ON DELETE CASCADE,
        company_id   UUID NOT NULL,
        code         INTEGER NOT NULL,
        name         TEXT NOT NULL,
        master_type  SMALLINT NOT NULL,
        is_group     BOOLEAN NOT NULL,
        parent_code  INTEGER NOT NULL DEFAULT 0,
        alias        TEXT,
        print_name   TEXT,
        hsn_code     TEXT,
        PRIMARY KEY (import_id, code)
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS ix_acct_busy_masters_parent ON acct.busy_masters(import_id, parent_code)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS acct.busy_trial_balance (
        import_id    BIGINT NOT NULL REFERENCES acct.busy_imports(import_id) ON DELETE CASCADE,
        company_id   UUID NOT NULL,
        code         INTEGER NOT NULL,
        name         TEXT NOT NULL,
        primary_code INTEGER,
        primary_name TEXT,
        section      TEXT,
        nature       TEXT,
        debit        NUMERIC(18,2) NOT NULL DEFAULT 0,
        credit       NUMERIC(18,2) NOT NULL DEFAULT 0,
        PRIMARY KEY (import_id, code)
      )`);

    // ── Guards ─────────────────────────────────────────────────────────────
    await c.query(`
      CREATE OR REPLACE FUNCTION acct.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'acct.%: % is not allowed — this record is append-only', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'P0001';
      END $$`);
    for (const t of ['journal_entries', 'journal_lines', 'audit_log']) {
      await c.query(`DROP TRIGGER IF EXISTS trg_${t}_immutable ON acct.${t}`);
      await c.query(`CREATE TRIGGER trg_${t}_immutable BEFORE UPDATE OR DELETE ON acct.${t}
                     FOR EACH ROW EXECUTE FUNCTION acct.forbid_mutation()`);
    }

    // Every journal entry must balance — checked at COMMIT so a multi-line
    // insert can complete first.
    await c.query(`
      CREATE OR REPLACE FUNCTION acct.check_je_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE d NUMERIC; k NUMERIC;
      BEGIN
        SELECT COALESCE(SUM(dr_amount),0), COALESCE(SUM(cr_amount),0) INTO d, k
          FROM acct.journal_lines WHERE je_id = NEW.je_id;
        IF d <> k OR d = 0 THEN
          RAISE EXCEPTION 'acct: journal entry % does not balance (Dr % / Cr %)', NEW.je_id, d, k
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$`);
    await c.query(`DROP TRIGGER IF EXISTS trg_jl_balanced ON acct.journal_lines`);
    await c.query(`CREATE CONSTRAINT TRIGGER trg_jl_balanced AFTER INSERT ON acct.journal_lines
                   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION acct.check_je_balanced()`);

    // No journal into a period that is not OPEN.
    await c.query(`
      CREATE OR REPLACE FUNCTION acct.check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE s TEXT;
      BEGIN
        SELECT status INTO s FROM acct.periods WHERE period_id = NEW.period_id;
        IF s IS DISTINCT FROM 'OPEN' THEN
          RAISE EXCEPTION 'acct: period % is % — posting refused', NEW.period_id, COALESCE(s,'missing')
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END $$`);
    await c.query(`DROP TRIGGER IF EXISTS trg_je_period_open ON acct.journal_entries`);
    await c.query(`CREATE TRIGGER trg_je_period_open BEFORE INSERT ON acct.journal_entries
                   FOR EACH ROW EXECUTE FUNCTION acct.check_period_open()`);

    // Voucher lines are editable only while the voucher is a draft.
    await c.query(`
      CREATE OR REPLACE FUNCTION acct.guard_voucher_lines() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE s TEXT; vid UUID;
      BEGIN
        vid := CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;
        SELECT status INTO s FROM acct.vouchers WHERE voucher_id = vid;
        -- s IS NULL: the parent voucher is itself being deleted (cascade) — the
        -- voucher-level guard has already decided that is allowed.
        IF s IS NOT NULL AND s NOT IN ('DRAFT','VALIDATED') THEN
          RAISE EXCEPTION 'acct: voucher is % — its lines cannot be changed', s USING ERRCODE = 'P0001';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END $$`);
    await c.query(`DROP TRIGGER IF EXISTS trg_vlines_guard ON acct.voucher_lines`);
    await c.query(`CREATE TRIGGER trg_vlines_guard BEFORE INSERT OR UPDATE OR DELETE ON acct.voucher_lines
                   FOR EACH ROW EXECUTE FUNCTION acct.guard_voucher_lines()`);
    // Document item lines follow the same draft-only guard.
    await c.query(`DROP TRIGGER IF EXISTS trg_vitems_guard ON acct.voucher_items`);
    await c.query(`CREATE TRIGGER trg_vitems_guard BEFORE INSERT OR UPDATE OR DELETE ON acct.voucher_items
                   FOR EACH ROW EXECUTE FUNCTION acct.guard_voucher_lines()`);

    // A posted voucher may only become REVERSED (and record who/when/which);
    // nothing else about it may change, and it can never be deleted.
    await c.query(`
      CREATE OR REPLACE FUNCTION acct.guard_vouchers() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE allowed TEXT[] := ARRAY['status','reversed_by','reversed_at','reversed_by_voucher_id','updated_at'];
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.status IN ('POSTED','REVERSED') THEN
            RAISE EXCEPTION 'acct: a % voucher cannot be deleted — reverse it instead', OLD.status USING ERRCODE = 'P0001';
          END IF;
          RETURN OLD;
        END IF;
        IF OLD.status IN ('POSTED','REVERSED','CANCELLED') THEN
          IF NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED')
             OR (to_jsonb(NEW) - allowed) <> (to_jsonb(OLD) - allowed) THEN
            RAISE EXCEPTION 'acct: voucher % is % and cannot be modified', OLD.voucher_no, OLD.status USING ERRCODE = 'P0001';
          END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await c.query(`DROP TRIGGER IF EXISTS trg_vouchers_guard ON acct.vouchers`);
    await c.query(`CREATE TRIGGER trg_vouchers_guard BEFORE UPDATE OR DELETE ON acct.vouchers
                   FOR EACH ROW EXECUTE FUNCTION acct.guard_vouchers()`);

    // ── Seed reference data ─────────────────────────────────────────────────
    for (const [code, name, prefix, appr] of VOUCHER_TYPES) {
      await c.query(`INSERT INTO acct.voucher_types (code,name,prefix,requires_approval) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (code) DO NOTHING`, [code, name, prefix, appr]);
    }

    // The default company for this database (one firm per DB in this deployment).
    let co = (await c.query(`SELECT company_id FROM acct.companies WHERE is_default`)).rows[0];
    if (!co) {
      const s = (await c.query(`SELECT key, value FROM public.app_settings WHERE key IN ('company_name','gst_number','state')`)
        .catch(() => ({ rows: [] }))).rows;
      const m = Object.fromEntries(s.map((r) => [r.key, r.value]));
      const gstin = (m.gst_number || '').trim() || null;
      co = (await c.query(
        `INSERT INTO acct.companies (name, gstin, state_code, is_default) VALUES ($1,$2,$3,true) RETURNING company_id`,
        [m.company_name || 'Company', gstin, gstin ? gstin.slice(0, 2) : null])).rows[0];
    }
    const companyId = co.company_id;

    const gid = {};
    for (const [code, name, nature, report, parent, sort] of PRIMARY_GROUPS) {
      const r = await c.query(
        `INSERT INTO acct.account_groups (company_id, code, name, parent_id, nature, report, sort_order, is_system)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (company_id, code) DO UPDATE SET updated_at = acct.account_groups.updated_at
         RETURNING group_id`,
        [companyId, code, name, parent ? gid[parent] : null, nature, report, sort]);
      gid[code] = r.rows[0].group_id;
    }
    for (const [code, name, gcode, type] of SYSTEM_LEDGERS) {
      await c.query(
        `INSERT INTO acct.ledgers (company_id, code, name, group_id, ledger_type, is_system)
         SELECT $1,$2,$3,$4,$5,true
          WHERE NOT EXISTS (SELECT 1 FROM acct.ledgers WHERE company_id=$1 AND (code=$2 OR name=$3))`,
        [companyId, code, name, gid[gcode], type]);
    }

    // Default posting policies (pre-approved v1), one active per event type.
    // Seed if missing, and keep the system-seed rule in step with code (so a
    // changed default — e.g. DISPATCH_COGS now relieving Finished Goods — deploys
    // without a manual migration). Operator-authored policies are never touched.
    for (const [event, vtype, rule] of DEFAULT_POLICIES) {
      await c.query(
        `INSERT INTO acct.posting_policies (company_id, event_type, version, voucher_type, rule, is_active, approved_by, approved_at)
         SELECT $1,$2,1,$3,$4,true,'system-seed',now()
          WHERE NOT EXISTS (SELECT 1 FROM acct.posting_policies WHERE company_id=$1 AND event_type=$2)`,
        [companyId, event, vtype, JSON.stringify(rule)]);
      await c.query(
        `UPDATE acct.posting_policies SET rule=$4, voucher_type=$3
          WHERE company_id=$1 AND event_type=$2 AND is_active AND approved_by='system-seed'`,
        [companyId, event, vtype, JSON.stringify(rule)]);
    }

    // Monthly periods for every financial year. A closed FY's periods start CLOSED.
    const fys = (await c.query(`SELECT fy_id, start_date, end_date, is_closed FROM public.financial_years`)).rows;
    for (const fy of fys) {
      await c.query(
        `INSERT INTO acct.periods (company_id, fy_id, period_no, start_date, end_date, status)
         SELECT $1, $2, g.n,
                GREATEST(($3::date + make_interval(months => g.n - 1))::date, $3::date),
                LEAST(($3::date + make_interval(months => g.n))::date - 1, $4::date),
                CASE WHEN $5 THEN 'CLOSED' ELSE 'OPEN' END
           FROM generate_series(1,12) g(n)
          WHERE ($3::date + make_interval(months => g.n - 1))::date <= $4::date
         ON CONFLICT (company_id, fy_id, period_no) DO NOTHING`,
        [companyId, fy.fy_id, ymd(fy.start_date), ymd(fy.end_date), !!fy.is_closed]);
    }

    await c.query('COMMIT');
    return companyId;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// pg returns DATE as a JS Date at local midnight; format it back without a UTC shift.
function ymd(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { ensureAccountingSchema, PRIMARY_GROUPS, SYSTEM_LEDGERS, VOUCHER_TYPES, DEFAULT_POLICIES, ymd };
