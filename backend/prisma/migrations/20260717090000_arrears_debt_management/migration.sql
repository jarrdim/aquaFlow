SET search_path TO aquaflow, public;

CREATE TABLE IF NOT EXISTS payment_plans (
  payment_plan_id BIGSERIAL PRIMARY KEY,
  plan_reference VARCHAR(50) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id),
  total_debt NUMERIC(18,2) NOT NULL CHECK (total_debt > 0),
  deposit_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  installment_amount NUMERIC(18,2) NOT NULL CHECK (installment_amount > 0),
  number_of_installments INTEGER NOT NULL CHECK (number_of_installments > 0),
  frequency VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
  agreement_file_name VARCHAR(255),
  remarks TEXT,
  created_by BIGINT REFERENCES users(user_id),
  approved_by BIGINT REFERENCES users(user_id),
  approved_at TIMESTAMP,
  decision_comments TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date),
  CHECK (status IN ('PROPOSED','APPROVED','ACTIVE','COMPLETED','DEFAULTED','CANCELLED','REJECTED','RETURNED'))
);

ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS plan_reference VARCHAR(50);
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS frequency VARCHAR(20) NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS agreement_file_name VARCHAR(255);
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(user_id);
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS decision_comments TEXT;
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE payment_plans SET plan_reference = 'PLAN-LEGACY-' || payment_plan_id WHERE plan_reference IS NULL;
ALTER TABLE payment_plans ALTER COLUMN plan_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_plans_reference ON payment_plans(plan_reference);
ALTER TABLE payment_plans DROP CONSTRAINT IF EXISTS ck_payment_plan_status;
ALTER TABLE payment_plans ADD CONSTRAINT ck_payment_plan_status
  CHECK (status IN ('PROPOSED','APPROVED','ACTIVE','COMPLETED','DEFAULTED','CANCELLED','REJECTED','RETURNED'));

CREATE TABLE IF NOT EXISTS payment_plan_installments (
  installment_id BIGSERIAL PRIMARY KEY,
  payment_plan_id BIGINT NOT NULL REFERENCES payment_plans(payment_plan_id),
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date DATE NOT NULL,
  amount_due NUMERIC(18,2) NOT NULL CHECK (amount_due > 0),
  amount_paid NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  UNIQUE (payment_plan_id, installment_number),
  CHECK (status IN ('PENDING','PARTIALLY_PAID','PAID','OVERDUE'))
);

CREATE TABLE IF NOT EXISTS promises_to_pay (
  promise_id BIGSERIAL PRIMARY KEY,
  promise_reference VARCHAR(50) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id),
  promised_amount NUMERIC(18,2) NOT NULL CHECK (promised_amount > 0),
  promise_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_payment_date DATE NOT NULL,
  follow_up_date DATE,
  contact_method VARCHAR(30) NOT NULL DEFAULT 'PHONE',
  recorded_by BIGINT NOT NULL REFERENCES users(user_id),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expected_payment_date >= promise_date),
  CHECK (status IN ('OPEN','KEPT','BROKEN','CANCELLED'))
);

ALTER TABLE promises_to_pay ADD COLUMN IF NOT EXISTS promise_reference VARCHAR(50);
ALTER TABLE promises_to_pay ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE promises_to_pay ADD COLUMN IF NOT EXISTS contact_method VARCHAR(30) NOT NULL DEFAULT 'PHONE';
ALTER TABLE promises_to_pay ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
ALTER TABLE promises_to_pay ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE promises_to_pay ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE promises_to_pay SET promise_reference = 'PTP-LEGACY-' || promise_id WHERE promise_reference IS NULL;
ALTER TABLE promises_to_pay ALTER COLUMN promise_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_promises_reference ON promises_to_pay(promise_reference);

CREATE TABLE IF NOT EXISTS debt_notices (
  notice_id BIGSERIAL PRIMARY KEY,
  notice_number VARCHAR(50) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id),
  notice_type VARCHAR(30) NOT NULL,
  notice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_deadline DATE,
  outstanding_amount NUMERIC(18,2) NOT NULL CHECK (outstanding_amount >= 0),
  delivery_channel VARCHAR(30) NOT NULL,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  notice_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  message_body TEXT NOT NULL,
  created_by BIGINT REFERENCES users(user_id),
  approved_by BIGINT REFERENCES users(user_id),
  approved_at TIMESTAMP,
  decision_comments TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (notice_type IN ('REMINDER','DEMAND','FINAL_DEMAND','DISCONNECTION_NOTICE')),
  CHECK (delivery_status IN ('PENDING','SENT','DELIVERED','FAILED')),
  CHECK (notice_status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','PAID','EXPIRED','REJECTED','RETURNED'))
);

ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS notice_number VARCHAR(50);
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS payment_deadline DATE;
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS notice_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS message_body TEXT;
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(user_id);
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(user_id);
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS decision_comments TEXT;
ALTER TABLE debt_notices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE debt_notices SET notice_number = 'DN-LEGACY-' || notice_id WHERE notice_number IS NULL;
UPDATE debt_notices SET message_body = 'Legacy debt notice' WHERE message_body IS NULL;
ALTER TABLE debt_notices ALTER COLUMN notice_number SET NOT NULL;
ALTER TABLE debt_notices ALTER COLUMN message_body SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_notices_number ON debt_notices(notice_number);
ALTER TABLE debt_notices DROP CONSTRAINT IF EXISTS ck_debt_notice_channel;
ALTER TABLE debt_notices ADD CONSTRAINT ck_debt_notice_channel
  CHECK (delivery_channel IN ('SMS','EMAIL','APP','PUSH','PRINT','SMS_PDF','SMS+EMAIL','SMS+PUSH','EMAIL+PUSH','SMS+EMAIL+PUSH'));

CREATE TABLE IF NOT EXISTS disconnection_lists (
  disconnection_list_id BIGSERIAL PRIMARY KEY,
  list_reference VARCHAR(50) NOT NULL UNIQUE,
  zone_id BIGINT REFERENCES zones(zone_id),
  minimum_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  minimum_age_days INTEGER NOT NULL DEFAULT 90,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  remarks TEXT,
  created_by BIGINT REFERENCES users(user_id),
  approved_by BIGINT REFERENCES users(user_id),
  approved_at TIMESTAMP,
  decision_comments TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','RETURNED','WORK_ORDERS_CREATED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS disconnection_list_items (
  disconnection_item_id BIGSERIAL PRIMARY KEY,
  disconnection_list_id BIGINT NOT NULL REFERENCES disconnection_lists(disconnection_list_id),
  account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id),
  outstanding_amount NUMERIC(18,2) NOT NULL,
  arrears_age_days INTEGER NOT NULL,
  last_notice_id BIGINT REFERENCES debt_notices(notice_id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (disconnection_list_id, account_id)
);

CREATE TABLE IF NOT EXISTS debt_write_offs (
  write_off_id BIGSERIAL PRIMARY KEY,
  write_off_reference VARCHAR(50) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  debt_age_days INTEGER NOT NULL CHECK (debt_age_days >= 0),
  recovery_actions TEXT NOT NULL,
  reason TEXT NOT NULL,
  supporting_file_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_by BIGINT NOT NULL REFERENCES users(user_id),
  approved_by BIGINT REFERENCES users(user_id),
  decision_comments TEXT,
  decided_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('PENDING','APPROVED','REJECTED','RETURNED','POSTED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS arrears_actions (
  arrears_action_id BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES customer_accounts(account_id),
  action_type VARCHAR(50) NOT NULL,
  reference_type VARCHAR(50),
  reference_id BIGINT,
  details TEXT NOT NULL,
  performed_by BIGINT REFERENCES users(user_id),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_arrears_actions_account_date ON arrears_actions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debt_notices_account_date ON debt_notices(account_id, notice_date DESC);
CREATE INDEX IF NOT EXISTS idx_promises_status_date ON promises_to_pay(status, expected_payment_date);

INSERT INTO roles (role_code, role_name, description, status)
VALUES
  ('CREDIT_CONTROL_OFFICER','Credit Control Officer','Manage arrears follow-up, notices, promises and payment plans','ACTIVE'),
  ('CREDIT_CONTROL_SUPERVISOR','Credit Control Supervisor','Approve debt notices and payment arrangements','ACTIVE'),
  ('CUSTOMER_CARE_OFFICER','Customer Care Officer','View arrears and record promises to pay','ACTIVE')
ON CONFLICT (role_code) DO UPDATE
SET role_name = EXCLUDED.role_name, description = EXCLUDED.description, status = 'ACTIVE';
