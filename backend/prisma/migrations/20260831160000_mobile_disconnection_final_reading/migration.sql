ALTER TABLE aquaflow.field_disconnection_reports
  ADD COLUMN IF NOT EXISTS current_reading NUMERIC(18,3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_field_disconnection_current_reading'
      AND conrelid = 'aquaflow.field_disconnection_reports'::regclass
  ) THEN
    ALTER TABLE aquaflow.field_disconnection_reports
      ADD CONSTRAINT ck_field_disconnection_current_reading
      CHECK (current_reading IS NULL OR current_reading >= 0);
  END IF;
END $$;
