CREATE TABLE IF NOT EXISTS aquaflow.account_adjustments (
  account_adjustment_id BIGSERIAL PRIMARY KEY,
  adjustment_number VARCHAR(80) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL,
  adjustment_type VARCHAR(20) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_by BIGINT NOT NULL,
  approved_by BIGINT,
  adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supporting_file_name VARCHAR(255),
  supporting_content TEXT,
  decision_comments TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_account_adjustments_account
    FOREIGN KEY (account_id) REFERENCES aquaflow.customer_accounts(account_id),
  CONSTRAINT fk_account_adjustments_requester
    FOREIGN KEY (requested_by) REFERENCES aquaflow.users(user_id),
  CONSTRAINT fk_account_adjustments_approver
    FOREIGN KEY (approved_by) REFERENCES aquaflow.users(user_id),
  CONSTRAINT ck_account_adjustment_type
    CHECK (adjustment_type IN ('DEBIT', 'CREDIT')),
  CONSTRAINT ck_account_adjustment_status
    CHECK (status IN ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED')),
  CONSTRAINT ck_account_adjustment_amount
    CHECK (amount > 0),
  CONSTRAINT ck_account_adjustment_decision
    CHECK (
      (status = 'PENDING' AND approved_by IS NULL AND approved_at IS NULL)
      OR
      (status <> 'PENDING' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_account_adjustments_account_approved
  ON aquaflow.account_adjustments(account_id, approved_at);

CREATE INDEX IF NOT EXISTS ix_account_adjustments_status_created
  ON aquaflow.account_adjustments(status, created_at DESC);
