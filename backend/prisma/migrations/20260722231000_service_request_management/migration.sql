CREATE TABLE IF NOT EXISTS aquaflow.service_requests (
  service_request_id BIGSERIAL PRIMARY KEY,
  request_number VARCHAR(60) NOT NULL UNIQUE,
  request_type VARCHAR(30) NOT NULL,
  customer_id BIGINT REFERENCES aquaflow.customers(customer_id),
  account_id BIGINT REFERENCES aquaflow.customer_accounts(account_id),
  category VARCHAR(60) NOT NULL,
  subject VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  contact_channel VARCHAR(30) NOT NULL DEFAULT 'PHONE',
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  assigned_to BIGINT REFERENCES aquaflow.users(user_id),
  due_at TIMESTAMPTZ,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_service_request_target CHECK (customer_id IS NOT NULL OR account_id IS NOT NULL),
  CONSTRAINT ck_service_request_type CHECK (request_type IN ('SERVICE_REQUEST', 'COMPLAINT')),
  CONSTRAINT ck_service_request_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT ck_service_request_status CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS ix_service_requests_status_priority ON aquaflow.service_requests(status, priority);
CREATE INDEX IF NOT EXISTS ix_service_requests_customer ON aquaflow.service_requests(customer_id);
CREATE INDEX IF NOT EXISTS ix_service_requests_account ON aquaflow.service_requests(account_id);
CREATE INDEX IF NOT EXISTS ix_service_requests_assignee ON aquaflow.service_requests(assigned_to, status);

CREATE TABLE IF NOT EXISTS aquaflow.service_request_events (
  service_request_event_id BIGSERIAL PRIMARY KEY,
  service_request_id BIGINT NOT NULL REFERENCES aquaflow.service_requests(service_request_id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  old_status VARCHAR(30),
  new_status VARCHAR(30),
  comments TEXT,
  performed_by BIGINT NOT NULL REFERENCES aquaflow.users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_service_request_events_request_created
  ON aquaflow.service_request_events(service_request_id, created_at);
