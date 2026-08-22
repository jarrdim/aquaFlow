CREATE TABLE IF NOT EXISTS aquaflow.customer_account_access (
    access_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES aquaflow.users(user_id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES aquaflow.customer_accounts(account_id) ON DELETE CASCADE,
    access_role VARCHAR(30) NOT NULL DEFAULT 'OWNER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    verified_at TIMESTAMPTZ,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_customer_account_access UNIQUE (user_id, account_id),
    CONSTRAINT ck_customer_account_access_role CHECK (access_role IN ('OWNER', 'AUTHORIZED')),
    CONSTRAINT ck_customer_account_access_status CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_customer_account_access_account_status
    ON aquaflow.customer_account_access (account_id, status);

-- Preserve access for customer portal users that already exist before this migration.
INSERT INTO aquaflow.customer_account_access
    (user_id, account_id, access_role, status, verified_at, is_default)
SELECT u.user_id,
       ca.account_id,
       'OWNER',
       'ACTIVE',
       CURRENT_TIMESTAMP,
       ROW_NUMBER() OVER (PARTITION BY u.user_id ORDER BY ca.account_number) = 1
FROM aquaflow.users u
JOIN aquaflow.customer_accounts ca ON ca.customer_id = u.customer_id
WHERE u.user_type = 'CUSTOMER'
  AND u.status = 'ACTIVE'
ON CONFLICT (user_id, account_id) DO NOTHING;
