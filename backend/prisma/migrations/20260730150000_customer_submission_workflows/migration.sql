ALTER TABLE aquaflow.service_requests
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS location_details VARCHAR(300),
  ADD COLUMN IF NOT EXISTS photo_evidence TEXT;

ALTER TABLE aquaflow.service_request_events
  ALTER COLUMN performed_by DROP NOT NULL;

ALTER TABLE aquaflow.new_connection_applications
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE aquaflow.new_connection_activities
  ALTER COLUMN performed_by DROP NOT NULL;

CREATE TABLE IF NOT EXISTS aquaflow.reconnection_requests (
  reconnection_request_id BIGSERIAL PRIMARY KEY,
  request_number VARCHAR(60) NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES aquaflow.customers(customer_id),
  account_id BIGINT NOT NULL REFERENCES aquaflow.customer_accounts(account_id),
  reason VARCHAR(1000) NOT NULL,
  contact_phone VARCHAR(40),
  status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  reconnection_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  decision_notes VARCHAR(2000),
  decided_by BIGINT REFERENCES aquaflow.users(user_id),
  decided_at TIMESTAMP,
  work_order_id BIGINT REFERENCES aquaflow.work_orders(work_order_id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_reconnection_request_status CHECK (
    status IN ('SUBMITTED','APPROVED','REJECTED','WORK_ORDER_CREATED','COMPLETED','CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS idx_reconnection_requests_status_created
  ON aquaflow.reconnection_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconnection_requests_customer
  ON aquaflow.reconnection_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_reconnection_requests_account
  ON aquaflow.reconnection_requests(account_id);
