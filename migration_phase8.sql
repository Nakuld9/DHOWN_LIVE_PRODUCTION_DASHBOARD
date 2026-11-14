-- Phase 8 Migration
-- operators: add department, shift, updated_at + trigger
-- users: add mobile

ALTER TABLE operators ADD COLUMN IF NOT EXISTS department VARCHAR(50);
ALTER TABLE operators ADD COLUMN IF NOT EXISTS shift      VARCHAR(10);
ALTER TABLE operators ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operators_updated_at ON operators;
CREATE TRIGGER trg_operators_updated_at
  BEFORE UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(20);

SELECT 'Phase 8 migration complete' AS result;
