SET search_path TO aquaflow, public;

ALTER TABLE mpesa_stk_requests
  ADD COLUMN IF NOT EXISTS purpose_type VARCHAR(40) NOT NULL DEFAULT 'BILL_PAYMENT',
  ADD COLUMN IF NOT EXISTS purpose_reference VARCHAR(100);

ALTER TABLE reconnection_requests
  ADD COLUMN IF NOT EXISTS fee_payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS fee_payment_id BIGINT REFERENCES payments(payment_id),
  ADD COLUMN IF NOT EXISTS fee_paid_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE reconnection_requests ADD CONSTRAINT ck_reconnection_fee_payment_status
    CHECK (fee_payment_status IN ('UNPAID', 'PENDING', 'PAID'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_mpesa_stk_purpose
  ON mpesa_stk_requests(purpose_type, purpose_reference, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconnection_fee_payment
  ON reconnection_requests(fee_payment_id) WHERE fee_payment_id IS NOT NULL;
