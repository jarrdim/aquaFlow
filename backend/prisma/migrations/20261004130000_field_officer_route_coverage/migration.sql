CREATE TABLE IF NOT EXISTS aquaflow.field_officer_route_coverages (
  route_coverage_id BIGSERIAL PRIMARY KEY,
  field_officer_id BIGINT NOT NULL REFERENCES aquaflow.field_officers(field_officer_id),
  route_id BIGINT NOT NULL REFERENCES aquaflow.routes(route_id),
  assigned_by BIGINT REFERENCES aquaflow.users(user_id),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_field_officer_route_coverage UNIQUE (field_officer_id, route_id),
  CONSTRAINT ck_field_officer_route_coverage_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX IF NOT EXISTS ix_field_officer_route_coverages_route
  ON aquaflow.field_officer_route_coverages(route_id, status);

CREATE INDEX IF NOT EXISTS ix_field_officer_route_coverages_officer
  ON aquaflow.field_officer_route_coverages(field_officer_id, status);
