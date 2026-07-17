SET search_path TO aquaflow, public;

ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS account_identifier VARCHAR(100);
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120);
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS branch_name VARCHAR(120);
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(100);
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS auto_allocation BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'BILL_PAYMENT';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS unallocated_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'UNRECONCILED';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_payload JSONB;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE payment_reversals ALTER COLUMN approved_by DROP NOT NULL;
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS detailed_explanation TEXT;
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS supporting_file_name VARCHAR(255);
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS supporting_content TEXT;
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS decision_comments TEXT;
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(20) NOT NULL DEFAULT 'VALID';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payment_events (
  payment_event_id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT REFERENCES payments(payment_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reversal_id BIGINT REFERENCES payment_reversals(reversal_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  event_type VARCHAR(60) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_reconciliation_batches (
  batch_id BIGSERIAL PRIMARY KEY,
  batch_reference VARCHAR(50) NOT NULL UNIQUE,
  channel_id BIGINT NOT NULL REFERENCES payment_channels(channel_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  statement_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  system_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  matched_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance NUMERIC(18,2) NOT NULL DEFAULT 0,
  statement_file_name VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  remarks TEXT,
  created_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  completed_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_account_date ON payments(account_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status, matching_status);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reversals_status ON payment_reversals(status, created_at DESC);

CREATE OR REPLACE FUNCTION aquaflow.validate_payment_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_total NUMERIC(18,2); allocated_total NUMERIC(18,2); bill_due NUMERIC(18,2); bill_allocated NUMERIC(18,2);
BEGIN
  SELECT amount INTO payment_total FROM payments WHERE payment_id = NEW.payment_id;
  SELECT COALESCE(SUM(allocated_amount),0) INTO allocated_total FROM payment_allocations WHERE payment_id = NEW.payment_id AND status = 'ACTIVE' AND allocation_id <> COALESCE(NEW.allocation_id,0);
  IF allocated_total + NEW.allocated_amount > payment_total THEN RAISE EXCEPTION 'Payment allocation exceeds payment amount'; END IF;
  SELECT total_amount_due INTO bill_due FROM bills WHERE bill_id = NEW.bill_id;
  SELECT COALESCE(SUM(allocated_amount),0) INTO bill_allocated FROM payment_allocations WHERE bill_id = NEW.bill_id AND status = 'ACTIVE' AND allocation_id <> COALESCE(NEW.allocation_id,0);
  IF bill_allocated + NEW.allocated_amount > bill_due THEN RAISE EXCEPTION 'Payment allocation exceeds bill amount due'; END IF;
  RETURN NEW;
END; $$;

INSERT INTO payment_channels(channel_code, channel_name, requires_reference, status)
VALUES ('MPESA','M-Pesa',TRUE,'ACTIVE'),('BANK','Bank',TRUE,'ACTIVE'),('CASH','Cash',FALSE,'ACTIVE'),('CARD','Card',TRUE,'ACTIVE')
ON CONFLICT (channel_code) DO NOTHING;
