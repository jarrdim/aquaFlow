-- Complete Meter Reading Management (FR-060 through FR-075).
-- Additive and safe to execute repeatedly against the AquaFlow baseline DDL.

ALTER TABLE aquaflow.reading_cycles
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE aquaflow.route_assignments
  ADD COLUMN IF NOT EXISTS assigned_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE aquaflow.meter_readings
  ADD COLUMN IF NOT EXISTS approval_comments TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meter_readings_sync_id
  ON aquaflow.meter_readings(sync_id)
  WHERE sync_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meter_readings_cycle_approval
  ON aquaflow.meter_readings(reading_cycle_id, approval_status);

CREATE INDEX IF NOT EXISTS idx_route_assignments_cycle_route
  ON aquaflow.route_assignments(reading_cycle_id, route_id);

CREATE TABLE IF NOT EXISTS aquaflow.meter_reading_evidence (
  evidence_id BIGSERIAL PRIMARY KEY,
  reading_id BIGINT NOT NULL REFERENCES aquaflow.meter_readings(reading_id) ON UPDATE CASCADE ON DELETE CASCADE,
  evidence_type VARCHAR(40) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(120),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_meter_reading_evidence_type CHECK (evidence_type IN ('METER_PHOTO','SUPPORTING_DOCUMENT'))
);

CREATE INDEX IF NOT EXISTS idx_meter_reading_evidence_reading
  ON aquaflow.meter_reading_evidence(reading_id);

CREATE TABLE IF NOT EXISTS aquaflow.meter_reading_events (
  event_id BIGSERIAL PRIMARY KEY,
  reading_id BIGINT NOT NULL REFERENCES aquaflow.meter_readings(reading_id) ON UPDATE CASCADE ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  remarks TEXT,
  performed_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meter_reading_events_reading_created
  ON aquaflow.meter_reading_events(reading_id, created_at DESC);
