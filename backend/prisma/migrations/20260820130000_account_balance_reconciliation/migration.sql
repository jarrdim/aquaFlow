CREATE TABLE aquaflow.account_balance_reconciliations (
  reconciliation_id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES aquaflow.customer_accounts(account_id),
  stored_balance NUMERIC(18,2) NOT NULL,
  calculated_balance NUMERIC(18,2) NOT NULL,
  variance NUMERIC(18,2) NOT NULL,
  opening_balance NUMERIC(18,2) NOT NULL,
  posted_bill_total NUMERIC(18,2) NOT NULL,
  posted_payment_total NUMERIC(18,2) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'MANUAL_RECONCILIATION',
  reconciled_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX account_balance_reconciliations_account_created_idx
  ON aquaflow.account_balance_reconciliations(account_id, created_at DESC);
