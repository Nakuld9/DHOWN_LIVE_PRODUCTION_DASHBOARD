-- ============================================================
-- Phase 9: Live Counter & Production Engine
-- Run once against dhown_mes database
-- ============================================================

-- production_history: hourly / shift / daily aggregation buckets
CREATE TABLE IF NOT EXISTS production_history (
  id            BIGSERIAL PRIMARY KEY,
  machine_id    VARCHAR(20)    NOT NULL,
  period_type   VARCHAR(10)    NOT NULL,
  period_start  TIMESTAMPTZ    NOT NULL,
  period_end    TIMESTAMPTZ    NOT NULL,
  shift         VARCHAR(2)     NOT NULL DEFAULT '',
  record_date   DATE           NOT NULL,
  hour_bucket   SMALLINT       NOT NULL DEFAULT -1,  -- 0-23 for HOURLY; -1 for SHIFT/DAILY
  counter_start NUMERIC(12,0)  NOT NULL DEFAULT 0,
  counter_end   NUMERIC(12,0)  NOT NULL DEFAULT 0,
  production_kg NUMERIC(10,4)  NOT NULL DEFAULT 0,
  rpm_avg       NUMERIC(6,2)   NOT NULL DEFAULT 0,
  sample_count  INT            NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ    DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    DEFAULT NOW(),
  CONSTRAINT chk_period_type CHECK (period_type IN ('HOURLY','SHIFT','DAILY')),
  UNIQUE(machine_id, period_type, record_date, hour_bucket, shift)
);

CREATE INDEX IF NOT EXISTS idx_prod_hist_machine_date
  ON production_history(machine_id, record_date);

CREATE INDEX IF NOT EXISTS idx_prod_hist_period_date
  ON production_history(period_type, record_date);
