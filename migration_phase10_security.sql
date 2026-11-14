-- Phase 10 Migration — Security & DB Integrity Fixes
-- Run against dhown_mes database
-- Date: 2026-06-22

-- ── P1-14: Missing indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_status_log_machine_date
  ON machine_status_log(machine_id, DATE(start_time), shift);

CREATE INDEX IF NOT EXISTS idx_downtime_machine_status
  ON machine_downtime(machine_id, status);

CREATE INDEX IF NOT EXISTS idx_rfid_events_time
  ON rfid_events(event_time DESC);

CREATE INDEX IF NOT EXISTS idx_assignments_status
  ON operator_assignments(status);

CREATE INDEX IF NOT EXISTS idx_audit_logs_time
  ON audit_logs(created_at DESC);

-- ── P1-15: Unique constraint on operator_code ───────────────────
-- Check for duplicates first: SELECT operator_code, COUNT(*) FROM operators GROUP BY operator_code HAVING COUNT(*) > 1;
ALTER TABLE operators
  ADD CONSTRAINT IF NOT EXISTS uq_operators_code UNIQUE (operator_code);

-- ── P1-16: Foreign key constraints ──────────────────────────────
-- rolls → operators
ALTER TABLE rolls
  ADD CONSTRAINT IF NOT EXISTS fk_rolls_operator
  FOREIGN KEY (operator_id) REFERENCES operators(operator_id) ON DELETE SET NULL;

-- rfid_events → machines (nullable — scan may not have machine context)
ALTER TABLE rfid_events
  ADD CONSTRAINT IF NOT EXISTS fk_rfid_machine
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id) ON DELETE SET NULL;

-- maintenance_records → machines
ALTER TABLE maintenance_records
  ADD CONSTRAINT IF NOT EXISTS fk_maintenance_machine
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id) ON DELETE CASCADE;

-- ── P1-17: Drop orphaned supervisors table ───────────────────────
-- Supervisors are now managed via users table WHERE role = 'SUPERVISOR'
DROP TABLE IF EXISTS supervisors;

-- ── Remove duplicate fabric column — use only fabric_code FK ────
-- ALTER TABLE machines DROP COLUMN IF EXISTS fabric;
-- (Commented out — verify frontend doesn't use machines.fabric before running)

SELECT 'Migration phase10 complete' AS status;
