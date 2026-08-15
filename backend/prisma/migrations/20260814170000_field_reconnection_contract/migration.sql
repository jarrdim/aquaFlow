INSERT INTO aquaflow.work_order_types
  (type_code, type_name, description, requires_photo, requires_gps, requires_signature, status)
VALUES ('RECONNECTION', 'Reconnection', 'Restore an approved disconnected supply', TRUE, TRUE, FALSE, 'ACTIVE')
ON CONFLICT (type_code) DO UPDATE SET requires_photo=TRUE, requires_gps=TRUE, status='ACTIVE', updated_at=CURRENT_TIMESTAMP;

ALTER TABLE aquaflow.reconnection_requests
  ADD COLUMN IF NOT EXISTS disconnection_work_order_id BIGINT REFERENCES aquaflow.work_orders(work_order_id);

CREATE TABLE IF NOT EXISTS aquaflow.field_reconnection_reports (
  reconnection_report_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL UNIQUE REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  reconnection_request_id BIGINT NOT NULL UNIQUE REFERENCES aquaflow.reconnection_requests(reconnection_request_id),
  field_officer_id BIGINT NOT NULL REFERENCES aquaflow.field_officers(field_officer_id),
  reconnection_datetime TIMESTAMPTZ,
  gps_latitude NUMERIC(10,7),
  gps_longitude NUMERIC(10,7),
  gps_captured_at TIMESTAMPTZ,
  remarks TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_field_reconnection_status CHECK (status IN ('DRAFT','SUBMITTED')),
  CONSTRAINT ck_field_reconnection_latitude CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
  CONSTRAINT ck_field_reconnection_longitude CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS ix_field_reconnection_reports_officer ON aquaflow.field_reconnection_reports(field_officer_id,status);
