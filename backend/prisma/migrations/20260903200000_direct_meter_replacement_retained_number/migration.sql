ALTER TABLE aquaflow.meter_replacements
  ADD COLUMN IF NOT EXISTS retained_meter_number BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE aquaflow.meter_replacements
  DROP CONSTRAINT IF EXISTS ck_meter_replacement_distinct;

ALTER TABLE aquaflow.meter_replacements
  ADD CONSTRAINT ck_meter_replacement_distinct CHECK (
    (old_meter_id <> new_meter_id AND retained_meter_number = FALSE)
    OR
    (old_meter_id = new_meter_id AND retained_meter_number = TRUE AND request_status = 'APPROVED')
  );
