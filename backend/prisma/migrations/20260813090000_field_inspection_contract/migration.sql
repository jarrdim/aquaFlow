-- Persist the full field-inspection form separately from the lean
-- new_connection_applications workflow columns. One report belongs to one
-- application and is updated in place while it is a draft.
CREATE TABLE IF NOT EXISTS aquaflow.field_inspection_reports (
  inspection_report_id BIGSERIAL PRIMARY KEY,
  connection_application_id BIGINT NOT NULL UNIQUE
    REFERENCES aquaflow.new_connection_applications(connection_application_id) ON DELETE CASCADE,
  field_officer_id BIGINT NOT NULL REFERENCES aquaflow.field_officers(field_officer_id),
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  findings TEXT,
  recommendations TEXT,
  estimated_material_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  estimated_labour_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  gps_latitude NUMERIC(10,7),
  gps_longitude NUMERIC(10,7),
  gps_captured_at TIMESTAMPTZ,
  recommendation VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_field_inspection_report_status CHECK (status IN ('DRAFT','SUBMITTED')),
  CONSTRAINT ck_field_inspection_recommendation CHECK (recommendation IS NULL OR recommendation IN ('RECOMMENDED','NOT_RECOMMENDED'))
);

CREATE TABLE IF NOT EXISTS aquaflow.field_inspection_photos (
  inspection_photo_id BIGSERIAL PRIMARY KEY,
  connection_application_id BIGINT NOT NULL
    REFERENCES aquaflow.new_connection_applications(connection_application_id) ON DELETE CASCADE,
  captured_by BIGINT NOT NULL REFERENCES aquaflow.field_officers(field_officer_id),
  content TEXT NOT NULL,
  mime_type VARCHAR(120) NOT NULL DEFAULT 'image/jpeg',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_field_inspection_reports_officer
  ON aquaflow.field_inspection_reports(field_officer_id, status);
CREATE INDEX IF NOT EXISTS ix_field_inspection_photos_application
  ON aquaflow.field_inspection_photos(connection_application_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS ix_new_connection_inspection_assignment
  ON aquaflow.new_connection_applications(inspection_officer_id, status);
