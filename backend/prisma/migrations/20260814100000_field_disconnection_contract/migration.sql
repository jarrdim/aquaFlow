INSERT INTO aquaflow.work_order_types
  (type_code, type_name, description, requires_photo, requires_gps, requires_signature, status)
VALUES
  ('DISCONNECTION', 'Disconnection', 'Disconnect a supply following an approved recovery process', TRUE, TRUE, TRUE, 'ACTIVE')
ON CONFLICT (type_code) DO UPDATE SET
  requires_photo=TRUE, requires_gps=TRUE, requires_signature=TRUE, status='ACTIVE', updated_at=CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS aquaflow.field_disconnection_reports (
  disconnection_report_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL UNIQUE REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  field_officer_id BIGINT NOT NULL REFERENCES aquaflow.field_officers(field_officer_id),
  disconnection_datetime TIMESTAMPTZ,
  gps_latitude NUMERIC(10, 7),
  gps_longitude NUMERIC(10, 7),
  gps_captured_at TIMESTAMPTZ,
  customer_acknowledgement VARCHAR(30),
  remarks TEXT,
  officer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_field_disconnection_status CHECK (status IN ('DRAFT','SUBMITTED')),
  CONSTRAINT ck_field_disconnection_acknowledgement CHECK (
    customer_acknowledgement IS NULL OR customer_acknowledgement IN ('ACKNOWLEDGED','UNAVAILABLE','REFUSED_TO_SIGN')
  ),
  CONSTRAINT ck_field_disconnection_latitude CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
  CONSTRAINT ck_field_disconnection_longitude CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS ix_field_disconnection_reports_officer
  ON aquaflow.field_disconnection_reports(field_officer_id, status);
