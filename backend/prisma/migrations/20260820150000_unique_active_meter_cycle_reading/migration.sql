CREATE UNIQUE INDEX meter_readings_one_active_per_meter_cycle_idx
  ON aquaflow.meter_readings(meter_id, reading_cycle_id)
  WHERE reading_cycle_id IS NOT NULL AND approval_status <> 'REJECTED';
