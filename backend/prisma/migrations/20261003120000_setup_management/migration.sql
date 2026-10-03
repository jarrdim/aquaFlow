CREATE TABLE IF NOT EXISTS aquaflow.service_request_types (
  service_request_type_id BIGSERIAL PRIMARY KEY,
  type_code VARCHAR(60) NOT NULL UNIQUE,
  type_name VARCHAR(120) NOT NULL UNIQUE,
  request_class VARCHAR(30) NOT NULL DEFAULT 'SERVICE_REQUEST',
  default_priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  target_resolution_hours INTEGER,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_service_request_type_class CHECK (request_class IN ('SERVICE_REQUEST', 'COMPLAINT')),
  CONSTRAINT ck_service_request_type_priority CHECK (default_priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT ck_service_request_type_target CHECK (target_resolution_hours IS NULL OR target_resolution_hours > 0)
);

CREATE TABLE IF NOT EXISTS aquaflow.meter_catalogue (
  meter_catalogue_item_id BIGSERIAL PRIMARY KEY,
  catalogue_code VARCHAR(60) NOT NULL UNIQUE,
  catalogue_name VARCHAR(140) NOT NULL,
  meter_type VARCHAR(30) NOT NULL,
  technology VARCHAR(30) NOT NULL,
  brand VARCHAR(100),
  model VARCHAR(100),
  meter_size_mm NUMERIC(10, 2) NOT NULL,
  default_installation_status VARCHAR(30) NOT NULL DEFAULT 'IN_STORE',
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_meter_catalogue_definition UNIQUE (catalogue_name, meter_type, technology, meter_size_mm),
  CONSTRAINT ck_meter_catalogue_type CHECK (meter_type IN ('CUSTOMER', 'BULK', 'ZONE', 'BOREHOLE')),
  CONSTRAINT ck_meter_catalogue_technology CHECK (technology IN ('MANUAL', 'PREPAID', 'SMART')),
  CONSTRAINT ck_meter_catalogue_size CHECK (meter_size_mm > 0),
  CONSTRAINT ck_meter_catalogue_installation CHECK (default_installation_status IN ('IN_STORE', 'INSTALLED', 'REMOVED'))
);

ALTER TABLE aquaflow.work_order_types
  ADD COLUMN IF NOT EXISTS default_priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS standard_materials TEXT,
  ADD COLUMN IF NOT EXISTS completion_instructions TEXT,
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;

INSERT INTO aquaflow.service_request_types
  (type_code, type_name, request_class, default_priority, target_resolution_hours, description)
VALUES
  ('WATER_SUPPLY', 'Water supply', 'SERVICE_REQUEST', 'HIGH', 24, 'Interruption, low pressure or other water-supply issue'),
  ('LEAKAGE', 'Leakage', 'COMPLAINT', 'URGENT', 4, 'Reported leak requiring assessment or repair'),
  ('METER_ISSUE', 'Meter issue', 'SERVICE_REQUEST', 'MEDIUM', 48, 'Meter accuracy, damage, access or reading issue'),
  ('BILLING', 'Billing', 'COMPLAINT', 'MEDIUM', 72, 'Bill, tariff or account-charge query'),
  ('PAYMENT', 'Payment', 'SERVICE_REQUEST', 'MEDIUM', 48, 'Payment allocation or receipt query'),
  ('NEW_CONNECTION', 'New connection', 'SERVICE_REQUEST', 'MEDIUM', 120, 'New connection enquiry or follow-up'),
  ('RECONNECTION', 'Reconnection', 'SERVICE_REQUEST', 'HIGH', 24, 'Supply reconnection request or follow-up'),
  ('OTHER', 'Other', 'SERVICE_REQUEST', 'MEDIUM', 72, 'Other customer-service matter')
ON CONFLICT (type_code) DO NOTHING;

INSERT INTO aquaflow.meter_catalogue
  (catalogue_code, catalogue_name, meter_type, technology, meter_size_mm, default_installation_status, description)
VALUES
  ('CUSTOMER-MANUAL-15', '15 mm manual customer meter', 'CUSTOMER', 'MANUAL', 15, 'IN_STORE', 'Standard domestic customer meter'),
  ('CUSTOMER-MANUAL-20', '20 mm manual customer meter', 'CUSTOMER', 'MANUAL', 20, 'IN_STORE', 'Standard higher-flow customer meter'),
  ('CUSTOMER-SMART-15', '15 mm smart customer meter', 'CUSTOMER', 'SMART', 15, 'IN_STORE', 'Smart domestic customer meter'),
  ('BULK-MANUAL-50', '50 mm manual bulk meter', 'BULK', 'MANUAL', 50, 'IN_STORE', 'Standard bulk-supply meter')
ON CONFLICT (catalogue_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_service_request_types_status_name
  ON aquaflow.service_request_types(status, type_name);
CREATE INDEX IF NOT EXISTS ix_meter_catalogue_status_name
  ON aquaflow.meter_catalogue(status, catalogue_name);
