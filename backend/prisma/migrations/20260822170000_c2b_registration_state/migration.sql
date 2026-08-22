CREATE TABLE IF NOT EXISTS aquaflow.mpesa_c2b_registrations (
  registration_id BIGSERIAL PRIMARY KEY,
  configuration_fingerprint VARCHAR(64) NOT NULL UNIQUE,
  environment VARCHAR(20) NOT NULL,
  short_code VARCHAR(30) NOT NULL,
  validation_url TEXT NOT NULL,
  confirmation_url TEXT NOT NULL,
  response_code VARCHAR(30),
  response_description VARCHAR(255),
  registered_by BIGINT REFERENCES aquaflow.users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mpesa_c2b_registration_date
  ON aquaflow.mpesa_c2b_registrations(registered_at DESC);
