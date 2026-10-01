-- Forward-only field-level customer profile audit. Existing customer rows are
-- deliberately not backfilled because updated_at cannot prove what changed.
CREATE TABLE aquaflow.customer_profile_changes (
  customer_profile_change_id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  changes JSONB NOT NULL,
  changed_by BIGINT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_profile_changes_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES aquaflow.customers(customer_id)
    ON DELETE CASCADE,
  CONSTRAINT customer_profile_changes_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES aquaflow.users(user_id)
    ON DELETE SET NULL
);

CREATE INDEX customer_profile_changes_customer_id_created_at_idx
  ON aquaflow.customer_profile_changes(customer_id, created_at DESC);

-- Account notifications already have an account_id/created_at index. Direct
-- customer notifications also need a matching history lookup index.
CREATE INDEX notifications_customer_id_created_at_idx
  ON aquaflow.notifications(customer_id, created_at DESC);
