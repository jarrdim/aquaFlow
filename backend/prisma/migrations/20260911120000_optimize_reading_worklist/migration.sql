-- Support resolving the current readable assignment without scanning removed history.
CREATE INDEX IF NOT EXISTS meter_assignments_reading_worklist_idx
  ON aquaflow.meter_assignments(account_id, assignment_date DESC, assignment_id DESC)
  INCLUDE (meter_id)
  WHERE assignment_status = 'ACTIVE' AND removal_date IS NULL AND account_id IS NOT NULL;

-- Worklist summaries and page hydration start with the selected cycle.
CREATE INDEX IF NOT EXISTS meter_readings_cycle_meter_idx
  ON aquaflow.meter_readings(reading_cycle_id, meter_id)
  WHERE reading_cycle_id IS NOT NULL;

-- Each displayed row needs its latest previous reading.
CREATE INDEX IF NOT EXISTS meter_readings_meter_latest_idx
  ON aquaflow.meter_readings(meter_id, reading_date DESC, reading_id DESC);
