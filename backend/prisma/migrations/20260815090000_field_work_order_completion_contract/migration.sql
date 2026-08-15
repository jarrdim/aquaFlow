CREATE TABLE IF NOT EXISTS aquaflow.inventory_items (
  inventory_item_id BIGSERIAL PRIMARY KEY,
  item_code VARCHAR(50) NOT NULL UNIQUE,
  item_name VARCHAR(150) NOT NULL,
  item_category VARCHAR(30) NOT NULL,
  unit_of_measure VARCHAR(30) NOT NULL,
  unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(18,3) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_field_completion_inventory_category
    CHECK (item_category IN ('PIPE','FITTING','METER','VALVE','CHEMICAL','TOOL','OTHER')),
  CONSTRAINT ck_field_completion_inventory_status
    CHECK (status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT ck_field_completion_inventory_values
    CHECK (unit_cost >= 0 AND reorder_level >= 0)
);

CREATE TABLE IF NOT EXISTS aquaflow.field_work_order_completion_reports (
  completion_report_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL UNIQUE
    REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  field_officer_id BIGINT NOT NULL
    REFERENCES aquaflow.field_officers(field_officer_id),
  customer_name_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  customer_identity_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  no_materials_used BOOLEAN NOT NULL DEFAULT FALSE,
  completion_notes TEXT,
  signature_evidence_id BIGINT UNIQUE
    REFERENCES aquaflow.work_order_evidence(evidence_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_field_work_order_completion_status
    CHECK (status IN ('DRAFT', 'SUBMITTED')),
  CONSTRAINT ck_field_work_order_completion_submission
    CHECK ((status = 'DRAFT' AND submitted_at IS NULL)
      OR (status = 'SUBMITTED' AND submitted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS aquaflow.work_order_materials (
  usage_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL
    REFERENCES aquaflow.work_orders(work_order_id) ON DELETE CASCADE,
  inventory_item_id BIGINT NOT NULL
    REFERENCES aquaflow.inventory_items(inventory_item_id) ON DELETE RESTRICT,
  quantity_used NUMERIC(18,3) NOT NULL,
  unit_cost NUMERIC(18,2) NOT NULL,
  issued_by BIGINT REFERENCES aquaflow.users(user_id),
  used_by BIGINT REFERENCES aquaflow.field_officers(field_officer_id),
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completion_report_id BIGINT
    REFERENCES aquaflow.field_work_order_completion_reports(completion_report_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_field_completion_material_values
    CHECK (quantity_used > 0 AND unit_cost >= 0)
);

ALTER TABLE aquaflow.work_order_materials
  ADD COLUMN IF NOT EXISTS completion_report_id BIGINT
    REFERENCES aquaflow.field_work_order_completion_reports(completion_report_id)
    ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_field_completion_material
  ON aquaflow.work_order_materials(completion_report_id, inventory_item_id)
  WHERE completion_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_field_completion_officer_status
  ON aquaflow.field_work_order_completion_reports(field_officer_id, status);
