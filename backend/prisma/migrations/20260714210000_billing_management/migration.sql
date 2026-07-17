-- Complete Billing Management: periods, approvals, posting, invoices,
-- notifications, adjustments, security alerts and audit history.

ALTER TABLE aquaflow.billing_cycles
  ADD COLUMN IF NOT EXISTS penalty_date DATE,
  ADD COLUMN IF NOT EXISTS default_notification VARCHAR(30) NOT NULL DEFAULT 'SMS_APP',
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE aquaflow.billing_cycles DROP CONSTRAINT IF EXISTS ck_billing_cycle_status;
ALTER TABLE aquaflow.billing_cycles
  ADD CONSTRAINT ck_billing_cycle_status CHECK (status IN ('DRAFT','OPEN','PROCESSING','PENDING_APPROVAL','POSTED','CLOSED','CANCELLED'));

ALTER TABLE aquaflow.billing_cycles DROP CONSTRAINT IF EXISTS ck_billing_cycle_dates;
ALTER TABLE aquaflow.billing_cycles
  ADD CONSTRAINT ck_billing_cycle_dates CHECK (
    period_end >= period_start AND due_date >= period_end
    AND (penalty_date IS NULL OR penalty_date >= due_date)
  );

ALTER TABLE aquaflow.bills
  ADD COLUMN IF NOT EXISTS minimum_charge_adjustment NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS standing_charge NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meter_rent NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generated_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_comments TEXT,
  ADD COLUMN IF NOT EXISTS posted_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_status VARCHAR(20) NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN IF NOT EXISTS exception_type VARCHAR(30) NOT NULL DEFAULT 'NONE';

ALTER TABLE aquaflow.bills DROP CONSTRAINT IF EXISTS ck_bill_status;
ALTER TABLE aquaflow.bills
  ADD CONSTRAINT ck_bill_status CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','PARTIALLY_PAID','PAID','RETURNED','REJECTED','CANCELLED'));

ALTER TABLE aquaflow.bills DROP CONSTRAINT IF EXISTS ck_bill_amounts;
ALTER TABLE aquaflow.bills
  ADD CONSTRAINT ck_bill_amounts CHECK (
    consumption_units >= 0 AND consumption_charge >= 0 AND fixed_charges >= 0
    AND minimum_charge_adjustment >= 0 AND standing_charge >= 0 AND meter_rent >= 0
    AND penalties >= 0 AND total_current_charges >= 0 AND total_amount_due >= 0
  );

ALTER TABLE aquaflow.billing_adjustments
  ADD COLUMN IF NOT EXISTS supporting_file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS supporting_content TEXT,
  ADD COLUMN IF NOT EXISTS decision_comments TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE aquaflow.billing_adjustments DROP CONSTRAINT IF EXISTS ck_billing_adjustment_status;
ALTER TABLE aquaflow.billing_adjustments
  ADD CONSTRAINT ck_billing_adjustment_status CHECK (status IN ('PENDING','APPROVED','REJECTED','RETURNED','POSTED'));

CREATE TABLE IF NOT EXISTS aquaflow.billing_events (
  billing_event_id BIGSERIAL PRIMARY KEY,
  billing_cycle_id BIGINT REFERENCES aquaflow.billing_cycles(billing_cycle_id) ON UPDATE CASCADE ON DELETE CASCADE,
  bill_id BIGINT REFERENCES aquaflow.bills(bill_id) ON UPDATE CASCADE ON DELETE CASCADE,
  adjustment_id BIGINT REFERENCES aquaflow.billing_adjustments(adjustment_id) ON UPDATE CASCADE ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_billing_event_parent CHECK (billing_cycle_id IS NOT NULL OR bill_id IS NOT NULL OR adjustment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS aquaflow.bill_notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  bill_id BIGINT NOT NULL REFERENCES aquaflow.bills(bill_id) ON UPDATE CASCADE ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(255),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SENT',
  sent_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_bill_notification_channel CHECK (channel IN ('SMS','APP','EMAIL','WHATSAPP')),
  CONSTRAINT ck_bill_notification_status CHECK (status IN ('QUEUED','SENT','FAILED'))
);

CREATE TABLE IF NOT EXISTS aquaflow.billing_security_alerts (
  alert_id BIGSERIAL PRIMARY KEY,
  bill_id BIGINT REFERENCES aquaflow.bills(bill_id) ON UPDATE CASCADE ON DELETE SET NULL,
  alert_type VARCHAR(40) NOT NULL,
  attempted_action VARCHAR(100) NOT NULL,
  details TEXT NOT NULL,
  attempted_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  resolved_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_billing_security_alert_status CHECK (status IN ('OPEN','RESOLVED'))
);

CREATE INDEX IF NOT EXISTS idx_billing_events_cycle ON aquaflow.billing_events(billing_cycle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_bill ON aquaflow.billing_events(bill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_notifications_bill ON aquaflow.bill_notifications(bill_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_security_alerts_status ON aquaflow.billing_security_alerts(status, created_at DESC);

-- An installed active customer meter represents a completed connection.
UPDATE aquaflow.customer_accounts account
SET account_status = 'ACTIVE',
    connection_date = COALESCE(account.connection_date, assignment.assignment_date),
    updated_at = CURRENT_TIMESTAMP
FROM aquaflow.meter_assignments assignment
JOIN aquaflow.meters meter ON meter.meter_id = assignment.meter_id
WHERE assignment.account_id = account.account_id
  AND assignment.assignment_status = 'ACTIVE'
  AND assignment.removal_date IS NULL
  AND meter.status = 'ACTIVE'
  AND account.account_status = 'PENDING';
