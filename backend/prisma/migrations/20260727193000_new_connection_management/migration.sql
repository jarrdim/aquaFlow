ALTER TABLE aquaflow.system_settings
  ADD COLUMN IF NOT EXISTS default_connection_fee DECIMAL(18,2);

CREATE TABLE IF NOT EXISTS aquaflow.new_connection_applications (
  connection_application_id BIGSERIAL PRIMARY KEY,
  application_number VARCHAR(60) NOT NULL UNIQUE,
  customer_id BIGINT NULL REFERENCES aquaflow.customers(customer_id),
  applicant_type VARCHAR(30) NOT NULL DEFAULT 'INDIVIDUAL',
  applicant_name VARCHAR(200) NOT NULL,
  identification_number VARCHAR(80),
  phone_number VARCHAR(40) NOT NULL,
  email_address VARCHAR(200),
  physical_address VARCHAR(300) NOT NULL,
  plot_number VARCHAR(100),
  zone_id BIGINT NULL REFERENCES aquaflow.zones(zone_id),
  connection_type VARCHAR(40) NOT NULL DEFAULT 'DOMESTIC',
  status VARCHAR(40) NOT NULL DEFAULT 'SUBMITTED',
  connection_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  connection_fee_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  fee_override_reason TEXT,
  inspection_scheduled_at TIMESTAMPTZ,
  inspection_officer_id BIGINT NULL REFERENCES aquaflow.users(user_id),
  inspection_outcome VARCHAR(30),
  inspection_notes TEXT,
  materials_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
  labour_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
  quotation_total DECIMAL(18,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(18,2) NOT NULL DEFAULT 0,
  payment_reference VARCHAR(120),
  decision_notes TEXT,
  account_id BIGINT NULL REFERENCES aquaflow.customer_accounts(account_id),
  work_order_id BIGINT NULL,
  remarks TEXT,
  created_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_new_connection_fee_override
    CHECK (NOT connection_fee_overridden OR NULLIF(BTRIM(fee_override_reason), '') IS NOT NULL),
  CONSTRAINT ck_new_connection_non_negative_amounts
    CHECK (connection_fee >= 0 AND materials_cost >= 0 AND labour_cost >= 0
      AND quotation_total >= 0 AND amount_paid >= 0)
);

CREATE INDEX IF NOT EXISTS idx_new_connection_status
  ON aquaflow.new_connection_applications(status);
CREATE INDEX IF NOT EXISTS idx_new_connection_zone
  ON aquaflow.new_connection_applications(zone_id);
CREATE INDEX IF NOT EXISTS idx_new_connection_customer
  ON aquaflow.new_connection_applications(customer_id);

CREATE TABLE IF NOT EXISTS aquaflow.new_connection_activities (
  connection_activity_id BIGSERIAL PRIMARY KEY,
  connection_application_id BIGINT NOT NULL
    REFERENCES aquaflow.new_connection_applications(connection_application_id) ON DELETE CASCADE,
  activity_type VARCHAR(60) NOT NULL,
  notes TEXT,
  performed_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_new_connection_activity_application
  ON aquaflow.new_connection_activities(connection_application_id, performed_at DESC);

INSERT INTO aquaflow.permissions (permission_code, permission_name, module_name, description)
VALUES
  ('CONNECTION_VIEW', 'View new connections', 'NEW_CONNECTIONS', 'View the new connection register and profiles'),
  ('CONNECTION_CREATE', 'Create new connections', 'NEW_CONNECTIONS', 'Register new connection applications'),
  ('CONNECTION_PROCESS', 'Process new connections', 'NEW_CONNECTIONS', 'Inspect, quote, receive payment and approve new connections')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
CROSS JOIN aquaflow.permissions p
WHERE r.role_code IN ('SYSTEM_ADMIN', 'CUSTOMER_CARE_OFFICER', 'METER_SUPERVISOR', 'FINANCE_MANAGER')
  AND p.permission_code IN ('CONNECTION_VIEW', 'CONNECTION_CREATE', 'CONNECTION_PROCESS')
ON CONFLICT (role_id, permission_id) DO NOTHING;
