-- Phase 11 Migration — BUSY Bridge integration tables
-- Run against dhown_mes database
-- Date: 2026-09-16
--
-- These tables hold INTEGRATION STATE ONLY: the mapping between DHOWN records
-- and BUSY records, the outbound queue, the audit trail and reconciliation
-- results. They are not a copy of the production tables and not a copy of
-- BUSY's books.
--
-- Nothing here touches machines, rolls, operators, downtime or production —
-- the dashboard remains the source of truth for production, BUSY remains the
-- source of truth for accounting.

-- ── Master mapping ──────────────────────────────────────────────
-- One row per DHOWN master record per entity type. IDs are never assumed
-- identical between the two systems, so every reference crosses this table.
CREATE TABLE IF NOT EXISTS busy_master_mapping (
  id              SERIAL PRIMARY KEY,
  entity_type     TEXT NOT NULL
                    CHECK (entity_type IN ('CUSTOMER','VENDOR','ITEM','WAREHOUSE','TRANSACTION')),
  dhown_id        TEXT NOT NULL,
  busy_id         TEXT,
  busy_code       TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (sync_status IN ('PENDING','SYNCED','FAILED','MANUAL_REVIEW')),
  last_synced_at  TIMESTAMPTZ,
  error           TEXT,
  dhown_name      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_busy_mapping_entity UNIQUE (entity_type, dhown_id)
);

-- A BUSY record must not be claimed by two different DHOWN records — that
-- would silently merge two customers' ledgers. Partial index so unmapped rows
-- do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_busy_mapping_busy
  ON busy_master_mapping (entity_type, busy_id)
  WHERE busy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_busy_mapping_status
  ON busy_master_mapping (sync_status);

-- ── Sync queue ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS busy_sync_queue (
  id                  SERIAL PRIMARY KEY,
  entity_type         TEXT NOT NULL,
  dhown_entity_id     TEXT NOT NULL,
  operation           TEXT NOT NULL,
  payload             JSONB NOT NULL,
  payload_version     INTEGER NOT NULL DEFAULT 1,
  external_reference  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PROCESSING','AWAITING_BUSY',
                                          'SUCCESS','FAILED','RETRY','MANUAL_REVIEW')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TIMESTAMPTZ,
  next_retry_at       TIMESTAMPTZ,
  busy_reference      TEXT,
  error_code          TEXT,
  error_message       TEXT,
  error_details       JSONB,
  created_by          TEXT NOT NULL DEFAULT 'DASHBOARD',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE idempotency guarantee. Enforced by the database, so two concurrent
-- submissions cannot both create the same BUSY transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_busy_queue_external_ref
  ON busy_sync_queue (external_reference);

CREATE INDEX IF NOT EXISTS idx_busy_queue_claim
  ON busy_sync_queue (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_busy_queue_entity
  ON busy_sync_queue (entity_type, dhown_entity_id);
CREATE INDEX IF NOT EXISTS idx_busy_queue_created
  ON busy_sync_queue (created_at DESC);

-- ── Audit ───────────────────────────────────────────────────────
-- Append-only. An integration failure is never silently discarded; it lands
-- here even when the queue row moves on.
CREATE TABLE IF NOT EXISTS busy_audit_log (
  id                  SERIAL PRIMARY KEY,
  queue_id            INTEGER REFERENCES busy_sync_queue(id) ON DELETE SET NULL,
  entity_type         TEXT NOT NULL,
  dhown_entity_id     TEXT NOT NULL,
  external_reference  TEXT,
  operation           TEXT NOT NULL,
  payload_version     INTEGER NOT NULL DEFAULT 1,
  payload_snapshot    JSONB,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  -- Username from the dashboard JWT, or 'system' for worker activity.
  actor               TEXT NOT NULL DEFAULT 'system',
  busy_response       TEXT,
  busy_reference      TEXT,
  final_status        TEXT NOT NULL,
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_busy_audit_queue   ON busy_audit_log (queue_id);
CREATE INDEX IF NOT EXISTS idx_busy_audit_ref     ON busy_audit_log (external_reference);
CREATE INDEX IF NOT EXISTS idx_busy_audit_created ON busy_audit_log (created_at DESC);

-- ── Reconciliation ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS busy_reconciliation (
  id                  SERIAL PRIMARY KEY,
  run_id              TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  dhown_entity_id     TEXT,
  external_reference  TEXT,
  busy_reference      TEXT,
  result              TEXT NOT NULL
                        CHECK (result IN ('MATCH','MISMATCH','MISSING_IN_BUSY',
                                          'MISSING_IN_MES','DUPLICATE')),
  differences         JSONB,
  resolved            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_busy_recon_run    ON busy_reconciliation (run_id);
CREATE INDEX IF NOT EXISTS idx_busy_recon_result ON busy_reconciliation (result, resolved);

-- ── Connection health ───────────────────────────────────────────
-- Single row. Lets the dashboard show BUSY connection state and last
-- successful sync without probing the BUSY machine on every page load.
CREATE TABLE IF NOT EXISTS busy_connection_state (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  online              BOOLEAN NOT NULL DEFAULT FALSE,
  last_checked_at     TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error_code     TEXT,
  last_error_message  TEXT,
  adapter             TEXT
);

INSERT INTO busy_connection_state (id, online)
  VALUES (1, FALSE)
  ON CONFLICT (id) DO NOTHING;
