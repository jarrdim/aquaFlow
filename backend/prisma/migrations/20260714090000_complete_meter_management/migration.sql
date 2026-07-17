-- Additive completion of the meter-management lifecycle. This migration keeps
-- the original AquaFlow DDL intact while adding the fields required by the
-- Meter_Management_Function_User_Interfaces specification.

ALTER TABLE aquaflow.meters
  ADD COLUMN IF NOT EXISTS purchase_date DATE,
  ADD COLUMN IF NOT EXISTS warranty_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS storage_location VARCHAR(150),
  ADD COLUMN IF NOT EXISTS installation_status VARCHAR(20) NOT NULL DEFAULT 'IN_STORE',
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE aquaflow.meters DROP CONSTRAINT IF EXISTS ck_meter_status;
ALTER TABLE aquaflow.meters ADD CONSTRAINT ck_meter_status
  CHECK (status IN ('IN_STOCK','ACTIVE','FAULTY','INACTIVE','REMOVED','REPLACED','DISCONNECTED','TAMPERED'));
ALTER TABLE aquaflow.meters DROP CONSTRAINT IF EXISTS ck_meter_installation_status;
ALTER TABLE aquaflow.meters ADD CONSTRAINT ck_meter_installation_status
  CHECK (installation_status IN ('IN_STORE','INSTALLED','REMOVED'));
ALTER TABLE aquaflow.meters DROP CONSTRAINT IF EXISTS ck_meter_warranty_dates;
ALTER TABLE aquaflow.meters ADD CONSTRAINT ck_meter_warranty_dates
  CHECK (warranty_expiry_date IS NULL OR purchase_date IS NULL OR warranty_expiry_date >= purchase_date);

ALTER TABLE aquaflow.meter_assignments
  ADD COLUMN IF NOT EXISTS installed_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installation_point VARCHAR(255),
  ADD COLUMN IF NOT EXISTS installation_status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE aquaflow.meter_replacements
  ADD COLUMN IF NOT EXISTS request_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS requested_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_comments TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS remarks TEXT;

UPDATE aquaflow.meter_replacements
SET request_status = 'APPROVED', decided_at = COALESCE(decided_at, created_at)
WHERE approved_by IS NOT NULL AND request_status = 'PENDING';

ALTER TABLE aquaflow.meter_replacements DROP CONSTRAINT IF EXISTS ck_meter_replacement_request_status;
ALTER TABLE aquaflow.meter_replacements ADD CONSTRAINT ck_meter_replacement_request_status
  CHECK (request_status IN ('DRAFT','PENDING','APPROVED','REJECTED','RETURNED'));

CREATE TABLE IF NOT EXISTS aquaflow.meter_events (
  event_id BIGSERIAL PRIMARY KEY,
  meter_id BIGINT NOT NULL REFERENCES aquaflow.meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assignment_id BIGINT REFERENCES aquaflow.meter_assignments(assignment_id) ON UPDATE CASCADE ON DELETE SET NULL,
  replacement_id BIGINT REFERENCES aquaflow.meter_replacements(replacement_id) ON UPDATE CASCADE ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  previous_status VARCHAR(20),
  new_status VARCHAR(20),
  reading NUMERIC(18,3),
  reason TEXT,
  remarks TEXT,
  gps_latitude NUMERIC(10,7),
  gps_longitude NUMERIC(10,7),
  performed_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  event_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB,
  CONSTRAINT ck_meter_event_type CHECK (event_type IN (
    'REGISTERED','ASSIGNED','INSTALLATION_UPDATED','STATUS_CHANGED','FAULT_REPORTED',
    'READING','REPLACEMENT_DRAFTED','REPLACEMENT_SUBMITTED','REPLACEMENT_APPROVED',
    'REPLACEMENT_REJECTED','REPLACEMENT_RETURNED','ALERT_CREATED','ALERT_DISMISSED','WORK_ORDER_CREATED'
  )),
  CONSTRAINT ck_meter_event_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
  CONSTRAINT ck_meter_event_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS aquaflow.meter_evidence (
  evidence_id BIGSERIAL PRIMARY KEY,
  meter_id BIGINT NOT NULL REFERENCES aquaflow.meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assignment_id BIGINT REFERENCES aquaflow.meter_assignments(assignment_id) ON UPDATE CASCADE ON DELETE SET NULL,
  replacement_id BIGINT REFERENCES aquaflow.meter_replacements(replacement_id) ON UPDATE CASCADE ON DELETE SET NULL,
  evidence_type VARCHAR(30) NOT NULL,
  file_name VARCHAR(255),
  content_data TEXT NOT NULL,
  description TEXT,
  uploaded_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_meter_evidence_type CHECK (evidence_type IN ('INSTALLATION_PHOTO','METER_PHOTO','CUSTOMER_SIGNATURE','STATUS_PHOTO','REPLACEMENT_PHOTO','DOCUMENT'))
);

CREATE TABLE IF NOT EXISTS aquaflow.meter_installation_materials (
  material_id BIGSERIAL PRIMARY KEY,
  meter_id BIGINT NOT NULL REFERENCES aquaflow.meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  assignment_id BIGINT NOT NULL REFERENCES aquaflow.meter_assignments(assignment_id) ON UPDATE CASCADE ON DELETE CASCADE,
  material_name VARCHAR(150) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_meter_material_quantity CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS aquaflow.meter_alerts (
  alert_id BIGSERIAL PRIMARY KEY,
  meter_id BIGINT NOT NULL REFERENCES aquaflow.meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  alert_type VARCHAR(30) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'OPEN',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dismissed_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ,
  work_order_id BIGINT REFERENCES aquaflow.work_orders(work_order_id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT ck_meter_alert_type CHECK (alert_type IN ('FAULTY','TAMPER','ZERO_READING','NO_READING','ABNORMAL_USE','INACTIVE')),
  CONSTRAINT ck_meter_alert_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT ck_meter_alert_status CHECK (status IN ('OPEN','DISMISSED','WORK_ORDER_CREATED','RESOLVED'))
);

CREATE INDEX IF NOT EXISTS idx_meter_events_meter_date ON aquaflow.meter_events(meter_id, event_date);
CREATE INDEX IF NOT EXISTS idx_meter_evidence_meter ON aquaflow.meter_evidence(meter_id);
CREATE INDEX IF NOT EXISTS idx_meter_alerts_status ON aquaflow.meter_alerts(status, detected_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_meter_alert
  ON aquaflow.meter_alerts(meter_id, alert_type)
  WHERE status = 'OPEN';

