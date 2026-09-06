ALTER TABLE aquaflow.bills
  ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN corrected_at TIMESTAMP(3);

CREATE TABLE aquaflow.reading_corrections (
  correction_id BIGSERIAL PRIMARY KEY,
  reading_id BIGINT NOT NULL REFERENCES aquaflow.meter_readings(reading_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  bill_id BIGINT NOT NULL REFERENCES aquaflow.bills(bill_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  original_current_reading NUMERIC(18,3) NOT NULL,
  corrected_current_reading NUMERIC(18,3) NOT NULL,
  adjustment_amount NUMERIC(18,2) NOT NULL,
  reason TEXT NOT NULL,
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB NOT NULL,
  corrected_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  corrected_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_reading_correction_reason CHECK (LENGTH(TRIM(reason)) >= 3),
  CONSTRAINT ck_reading_correction_values CHECK (original_current_reading >= 0 AND corrected_current_reading >= 0)
);

CREATE INDEX ix_reading_corrections_reading_date ON aquaflow.reading_corrections(reading_id, corrected_at DESC);
CREATE INDEX ix_reading_corrections_bill_date ON aquaflow.reading_corrections(bill_id, corrected_at DESC);
