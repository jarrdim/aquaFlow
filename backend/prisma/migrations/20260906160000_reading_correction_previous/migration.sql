ALTER TABLE aquaflow.reading_corrections
  ADD COLUMN original_previous_reading NUMERIC(18,3),
  ADD COLUMN corrected_previous_reading NUMERIC(18,3);
