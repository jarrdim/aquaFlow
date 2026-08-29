CREATE TABLE IF NOT EXISTS aquaflow.disconnection_postings (
  disconnection_posting_id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL UNIQUE REFERENCES aquaflow.work_orders(work_order_id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES aquaflow.customer_accounts(account_id) ON DELETE RESTRICT,
  meter_id BIGINT NOT NULL REFERENCES aquaflow.meters(meter_id) ON DELETE RESTRICT,
  reading_id BIGINT NOT NULL UNIQUE REFERENCES aquaflow.meter_readings(reading_id) ON DELETE RESTRICT,
  previous_reading NUMERIC(18,3) NOT NULL,
  current_reading NUMERIC(18,3) NOT NULL,
  default_disconnection_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  disconnection_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  fee_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  fee_override_reason TEXT,
  fine_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  fine_reason TEXT,
  posted_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_disconnection_posting_readings CHECK (current_reading >= previous_reading),
  CONSTRAINT ck_disconnection_posting_amounts CHECK (
    default_disconnection_fee >= 0 AND disconnection_fee >= 0 AND fine_amount >= 0
  ),
  CONSTRAINT ck_disconnection_posting_override_reason CHECK (
    NOT fee_overridden OR LENGTH(TRIM(COALESCE(fee_override_reason, ''))) >= 3
  ),
  CONSTRAINT ck_disconnection_posting_fine_reason CHECK (
    fine_amount = 0 OR LENGTH(TRIM(COALESCE(fine_reason, ''))) >= 3
  )
);

CREATE INDEX IF NOT EXISTS ix_disconnection_postings_account_date
  ON aquaflow.disconnection_postings(account_id, posted_at);
