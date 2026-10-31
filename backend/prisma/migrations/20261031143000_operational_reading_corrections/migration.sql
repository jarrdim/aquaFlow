ALTER TABLE aquaflow.reading_corrections
  ALTER COLUMN bill_id DROP NOT NULL;

ALTER TABLE aquaflow.reading_corrections
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'BILL',
  ADD COLUMN IF NOT EXISTS source_id BIGINT;

UPDATE aquaflow.reading_corrections
SET source_id = bill_id
WHERE source_id IS NULL AND bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_reading_corrections_source
  ON aquaflow.reading_corrections(source_type, source_id, corrected_at DESC);
