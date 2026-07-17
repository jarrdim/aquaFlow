-- Complete Tariff Management extension (FR 3.7 / UI specification screens 1-14).
-- Additive and safe to execute repeatedly.

ALTER TABLE aquaflow.tariffs DROP CONSTRAINT IF EXISTS ck_tariff_status;
ALTER TABLE aquaflow.tariffs
  ADD COLUMN IF NOT EXISTS flat_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_per_unit NUMERIC(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_rule TEXT,
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_comments TEXT,
  ADD COLUMN IF NOT EXISTS simulation_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS activation_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS scheduled_activation TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE aquaflow.tariffs
  ADD CONSTRAINT ck_tariff_status CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','EXPIRED','REJECTED','RETURNED'));

ALTER TABLE aquaflow.tariffs DROP CONSTRAINT IF EXISTS ck_tariff_extended_amounts;
ALTER TABLE aquaflow.tariffs
  ADD CONSTRAINT ck_tariff_extended_amounts CHECK (flat_amount >= 0 AND rate_per_unit >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tariff_name_ci ON aquaflow.tariffs (LOWER(tariff_name));
CREATE INDEX IF NOT EXISTS idx_tariffs_category_status_dates ON aquaflow.tariffs(category_id, status, effective_from, effective_to);

ALTER TABLE aquaflow.tariff_bands ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS aquaflow.tariff_simulations (
  simulation_id BIGSERIAL PRIMARY KEY,
  tariff_id BIGINT NOT NULL REFERENCES aquaflow.tariffs(tariff_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  simulation_type VARCHAR(20) NOT NULL,
  sample_consumption NUMERIC(18,3) NOT NULL,
  current_amount NUMERIC(18,2) NOT NULL,
  proposed_amount NUMERIC(18,2) NOT NULL,
  difference_amount NUMERIC(18,2) NOT NULL,
  percentage_change NUMERIC(12,4) NOT NULL,
  customer_count INTEGER NOT NULL DEFAULT 1,
  result_data JSONB,
  simulated_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_tariff_simulation_type CHECK (simulation_type IN ('SINGLE','BULK')),
  CONSTRAINT ck_tariff_simulation_values CHECK (sample_consumption >= 0 AND customer_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tariff_simulations_tariff_created ON aquaflow.tariff_simulations(tariff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS aquaflow.tariff_category_assignments (
  assignment_id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES aquaflow.customer_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  tariff_id BIGINT NOT NULL REFERENCES aquaflow.tariffs(tariff_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  reason TEXT,
  assigned_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_tariff_assignment_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_tariff_assignment_status CHECK (status IN ('ACTIVE','EXPIRED','CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_tariff_category_assignments_category_dates ON aquaflow.tariff_category_assignments(category_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS aquaflow.tariff_events (
  event_id BIGSERIAL PRIMARY KEY,
  tariff_id BIGINT NOT NULL REFERENCES aquaflow.tariffs(tariff_id) ON UPDATE CASCADE ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tariff_events_tariff_created ON aquaflow.tariff_events(tariff_id, created_at DESC);
