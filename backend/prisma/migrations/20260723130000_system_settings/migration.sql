CREATE TABLE IF NOT EXISTS aquaflow.system_settings (
  setting_id BIGSERIAL PRIMARY KEY,
  utility_name VARCHAR(160) NOT NULL DEFAULT 'AquaFlow',
  utility_code VARCHAR(40) NOT NULL DEFAULT 'AQUAFLOW',
  email_address VARCHAR(180),
  phone_number VARCHAR(40),
  postal_address VARCHAR(250),
  physical_address VARCHAR(250),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  timezone VARCHAR(100) NOT NULL DEFAULT 'Africa/Nairobi',
  locale VARCHAR(20) NOT NULL DEFAULT 'en-KE',
  date_format VARCHAR(30) NOT NULL DEFAULT 'DD/MM/YYYY',
  billing_due_days INTEGER NOT NULL DEFAULT 14,
  reading_variance_percent DECIMAL(5, 2) NOT NULL DEFAULT 30,
  minimum_reading_value DECIMAL(18, 3) NOT NULL DEFAULT 0,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 30,
  password_minimum_length INTEGER NOT NULL DEFAULT 8,
  require_two_factor BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_system_settings_billing_due_days CHECK (billing_due_days BETWEEN 0 AND 365),
  CONSTRAINT ck_system_settings_variance CHECK (reading_variance_percent BETWEEN 0 AND 999.99),
  CONSTRAINT ck_system_settings_minimum_reading CHECK (minimum_reading_value >= 0),
  CONSTRAINT ck_system_settings_session_timeout CHECK (session_timeout_minutes BETWEEN 5 AND 1440),
  CONSTRAINT ck_system_settings_password_length CHECK (password_minimum_length BETWEEN 8 AND 128)
);

INSERT INTO aquaflow.system_settings (setting_id)
VALUES (1)
ON CONFLICT (setting_id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('aquaflow.system_settings', 'setting_id'),
  GREATEST((SELECT COALESCE(MAX(setting_id), 1) FROM aquaflow.system_settings), 1),
  TRUE
);

INSERT INTO aquaflow.permissions (permission_code, module_name, permission_name, description)
VALUES
  ('SETTINGS_VIEW', 'Settings', 'View system settings', 'View utility and system-wide defaults'),
  ('SETTINGS_MANAGE', 'Settings', 'Manage system settings', 'Change utility, operational and security defaults')
ON CONFLICT (permission_code) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  permission_name = EXCLUDED.permission_name,
  description = EXCLUDED.description;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
CROSS JOIN aquaflow.permissions p
WHERE r.role_code = 'SYSTEM_ADMIN'
  AND p.permission_code IN ('SETTINGS_VIEW', 'SETTINGS_MANAGE')
ON CONFLICT (role_id, permission_id) DO NOTHING;
