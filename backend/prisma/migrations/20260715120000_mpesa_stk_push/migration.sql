SET search_path TO aquaflow, public;

CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
  stk_request_id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  payment_id BIGINT UNIQUE REFERENCES payments(payment_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  initiated_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  phone_number VARCHAR(20) NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  merchant_request_id VARCHAR(100) UNIQUE,
  checkout_request_id VARCHAR(100) UNIQUE,
  customer_message TEXT,
  response_code VARCHAR(20),
  response_description TEXT,
  result_code INTEGER,
  result_description TEXT,
  mpesa_receipt_number VARCHAR(100) UNIQUE,
  transaction_date TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  callback_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mpesa_stk_account_created ON mpesa_stk_requests(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_status_created ON mpesa_stk_requests(status, created_at DESC);
