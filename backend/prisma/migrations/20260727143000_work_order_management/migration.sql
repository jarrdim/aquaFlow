CREATE TABLE IF NOT EXISTS aquaflow.work_order_types (
  work_order_type_id BIGSERIAL PRIMARY KEY,
  type_code VARCHAR(50) NOT NULL UNIQUE,
  type_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
  requires_gps BOOLEAN NOT NULL DEFAULT FALSE,
  requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Older MajiWare upgrades may already contain this table with fewer columns.
ALTER TABLE aquaflow.work_order_types
  ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS aquaflow.work_orders (
  work_order_id BIGSERIAL PRIMARY KEY,
  work_order_number VARCHAR(60) NOT NULL UNIQUE,
  work_order_type_id BIGINT NOT NULL REFERENCES aquaflow.work_order_types(work_order_type_id),
  account_id BIGINT REFERENCES aquaflow.customer_accounts(account_id),
  property_id BIGINT REFERENCES aquaflow.properties(property_id),
  zone_id BIGINT NOT NULL REFERENCES aquaflow.zones(zone_id),
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  description TEXT NOT NULL,
  scheduled_date DATE,
  due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'CREATED',
  created_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  verified_by BIGINT REFERENCES aquaflow.users(user_id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aquaflow.work_order_assignments (
  assignment_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  field_officer_id BIGINT NOT NULL REFERENCES aquaflow.field_officers(field_officer_id),
  assigned_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ,
  rejection_reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'aquaflow' AND table_name = 'work_order_assignments'
      AND column_name = 'assignment_status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'aquaflow' AND table_name = 'work_order_assignments'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE aquaflow.work_order_assignments RENAME COLUMN assignment_status TO status;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS aquaflow.work_order_updates (
  update_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  field_officer_id BIGINT REFERENCES aquaflow.field_officers(field_officer_id),
  previous_status VARCHAR(30),
  new_status VARCHAR(30) NOT NULL,
  notes TEXT,
  gps_latitude NUMERIC(10, 7),
  gps_longitude NUMERIC(10, 7),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'aquaflow' AND table_name = 'work_order_updates'
      AND column_name = 'update_notes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'aquaflow' AND table_name = 'work_order_updates'
      AND column_name = 'notes'
  ) THEN
    ALTER TABLE aquaflow.work_order_updates RENAME COLUMN update_notes TO notes;
  END IF;
END $$;

ALTER TABLE aquaflow.work_order_updates
  ALTER COLUMN previous_status DROP NOT NULL;

CREATE TABLE IF NOT EXISTS aquaflow.work_order_evidence (
  evidence_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  evidence_type VARCHAR(30) NOT NULL,
  file_path TEXT NOT NULL,
  description TEXT,
  gps_latitude NUMERIC(10, 7),
  gps_longitude NUMERIC(10, 7),
  captured_by BIGINT REFERENCES aquaflow.field_officers(field_officer_id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
);

ALTER TABLE aquaflow.work_orders
  ADD COLUMN IF NOT EXISTS service_request_id BIGINT REFERENCES aquaflow.service_requests(service_request_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS source_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS completion_notes TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS aquaflow.work_order_consumables (
  consumable_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  material_name VARCHAR(120) NOT NULL,
  quantity NUMERIC(18, 3) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'item',
  unit_cost NUMERIC(18, 2),
  recorded_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_work_order_consumable_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS ix_work_orders_status_due ON aquaflow.work_orders(status, due_date);
CREATE INDEX IF NOT EXISTS ix_work_orders_zone_status ON aquaflow.work_orders(zone_id, status);
CREATE INDEX IF NOT EXISTS ix_work_orders_service_request ON aquaflow.work_orders(service_request_id);
CREATE INDEX IF NOT EXISTS ix_work_order_assignments_work_order ON aquaflow.work_order_assignments(work_order_id, status);
CREATE INDEX IF NOT EXISTS ix_work_order_assignments_officer ON aquaflow.work_order_assignments(field_officer_id, status);
CREATE INDEX IF NOT EXISTS ix_work_order_updates_work_order ON aquaflow.work_order_updates(work_order_id, updated_at);
CREATE INDEX IF NOT EXISTS ix_work_order_evidence_work_order ON aquaflow.work_order_evidence(work_order_id, captured_at);

INSERT INTO aquaflow.work_order_types
  (type_code, type_name, description, requires_photo, requires_gps, requires_signature, status)
VALUES
  ('METER_INSPECTION', 'Meter inspection', 'Investigate a meter exception, condition or status report', TRUE, TRUE, FALSE, 'ACTIVE'),
  ('LEAK_REPAIR', 'Leak repair', 'Locate and repair a reported water leak', TRUE, TRUE, FALSE, 'ACTIVE'),
  ('NEW_CONNECTION', 'New connection', 'Install and commission a new customer connection', TRUE, TRUE, TRUE, 'ACTIVE'),
  ('RECONNECTION', 'Reconnection', 'Restore an approved disconnected supply', TRUE, TRUE, TRUE, 'ACTIVE'),
  ('DISCONNECTION', 'Disconnection', 'Disconnect a supply following an approved recovery process', TRUE, TRUE, TRUE, 'ACTIVE'),
  ('METER_REPLACEMENT', 'Meter replacement', 'Remove and replace a customer meter', TRUE, TRUE, TRUE, 'ACTIVE'),
  ('WATER_QUALITY', 'Water quality inspection', 'Investigate a water quality complaint', TRUE, TRUE, FALSE, 'ACTIVE'),
  ('LOW_PRESSURE', 'Low pressure investigation', 'Investigate low or interrupted water pressure', FALSE, TRUE, FALSE, 'ACTIVE'),
  ('GENERAL_MAINTENANCE', 'General maintenance', 'General field maintenance and corrective work', FALSE, TRUE, FALSE, 'ACTIVE')
ON CONFLICT (type_code) DO UPDATE SET
  type_name = EXCLUDED.type_name,
  description = EXCLUDED.description,
  requires_photo = EXCLUDED.requires_photo,
  requires_gps = EXCLUDED.requires_gps,
  requires_signature = EXCLUDED.requires_signature,
  status = EXCLUDED.status;

INSERT INTO aquaflow.permissions (permission_code, module_name, permission_name, description)
VALUES
  ('WORK_ORDER_VIEW', 'Work Orders', 'View work orders', 'View work-order registers, details and history'),
  ('WORK_ORDER_CREATE', 'Work Orders', 'Create work orders', 'Create work orders from requests, alerts or manual field needs'),
  ('WORK_ORDER_ASSIGN', 'Work Orders', 'Assign work orders', 'Schedule and assign field officers'),
  ('WORK_ORDER_EXECUTE', 'Work Orders', 'Execute work orders', 'Accept, start, update and complete assigned work'),
  ('WORK_ORDER_VERIFY', 'Work Orders', 'Verify work orders', 'Verify, return and close completed field work')
ON CONFLICT (permission_code) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  permission_name = EXCLUDED.permission_name,
  description = EXCLUDED.description;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
CROSS JOIN aquaflow.permissions p
WHERE r.role_code = 'SYSTEM_ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN
  ('WORK_ORDER_VIEW', 'WORK_ORDER_CREATE', 'WORK_ORDER_ASSIGN', 'WORK_ORDER_VERIFY')
WHERE r.role_code = 'METER_SUPERVISOR'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN ('WORK_ORDER_VIEW', 'WORK_ORDER_EXECUTE')
WHERE r.role_code = 'METER_READER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN ('WORK_ORDER_VIEW', 'WORK_ORDER_CREATE')
WHERE r.role_code = 'CUSTOMER_CARE_OFFICER'
ON CONFLICT (role_id, permission_id) DO NOTHING;
