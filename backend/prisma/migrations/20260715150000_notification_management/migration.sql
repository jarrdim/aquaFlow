SET search_path TO aquaflow, public;

CREATE TABLE IF NOT EXISTS notification_templates (
  template_id BIGSERIAL PRIMARY KEY,
  template_code VARCHAR(100) NOT NULL UNIQUE,
  template_name VARCHAR(150) NOT NULL,
  notification_type VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
  channel VARCHAR(20) NOT NULL,
  subject VARCHAR(255),
  message_body TEXT NOT NULL,
  description TEXT,
  variables JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by BIGINT REFERENCES users(user_id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS notification_type VARCHAR(50) NOT NULL DEFAULT 'GENERAL';
ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS variables JSONB;
ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(user_id);

CREATE TABLE IF NOT EXISTS notification_providers (
  provider_id BIGSERIAL PRIMARY KEY,
  provider_code VARCHAR(100) NOT NULL UNIQUE,
  provider_name VARCHAR(150) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  provider_type VARCHAR(30) NOT NULL DEFAULT 'SIMULATED',
  endpoint_url TEXT,
  environment_prefix VARCHAR(50),
  configuration JSONB,
  encrypted_secret TEXT,
  secret_configured_at TIMESTAMP,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  remarks TEXT,
  created_by BIGINT REFERENCES users(user_id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notification_providers ADD COLUMN IF NOT EXISTS configuration JSONB;
ALTER TABLE notification_providers ADD COLUMN IF NOT EXISTS encrypted_secret TEXT;
ALTER TABLE notification_providers ADD COLUMN IF NOT EXISTS secret_configured_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT REFERENCES notification_templates(template_id),
  provider_id BIGINT REFERENCES notification_providers(provider_id),
  customer_id BIGINT REFERENCES customers(customer_id),
  account_id BIGINT REFERENCES customer_accounts(account_id),
  bill_id BIGINT REFERENCES bills(bill_id),
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  message_body TEXT NOT NULL,
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  external_reference VARCHAR(255),
  failure_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  requested_by BIGINT REFERENCES users(user_id),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS provider_id BIGINT REFERENCES notification_providers(provider_id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS bill_id BIGINT REFERENCES bills(bill_id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS requested_by BIGINT REFERENCES users(user_id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE notifications ALTER COLUMN scheduled_at DROP NOT NULL;

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  attempt_id BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(notification_id) ON DELETE CASCADE,
  provider_id BIGINT REFERENCES notification_providers(provider_id),
  attempt_number INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_reference VARCHAR(255),
  request_payload JSONB,
  response_payload JSONB,
  error_message TEXT,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_notification_attempt UNIQUE (notification_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_notifications_queue ON notifications(delivery_status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_bill ON notifications(bill_id);

INSERT INTO notification_providers
  (provider_code, provider_name, channel, provider_type, is_default, status, remarks)
VALUES
  ('SIMULATED_SMS', 'Simulated SMS Gateway', 'SMS', 'SIMULATED', TRUE, 'ACTIVE', 'Safe local provider: records immediate delivery without external charges.'),
  ('SIMULATED_EMAIL', 'Simulated Email Gateway', 'EMAIL', 'SIMULATED', TRUE, 'ACTIVE', 'Safe local provider: records immediate delivery without sending email.'),
  ('SIMULATED_PUSH', 'Simulated Push Gateway', 'PUSH', 'SIMULATED', TRUE, 'ACTIVE', 'Safe local provider for user-interface testing.')
ON CONFLICT (provider_code) DO NOTHING;

INSERT INTO notification_providers
  (provider_code, provider_name, channel, provider_type, is_default, status, remarks)
VALUES
  ('SMTP_EMAIL', 'SMTP Email Gateway', 'EMAIL', 'SMTP', FALSE, 'INACTIVE', 'Configure SMTP securely, verify it, then make it the default email provider.')
ON CONFLICT (provider_code) DO NOTHING;

INSERT INTO notification_templates
  (template_code, template_name, notification_type, channel, subject, message_body, description, variables, status)
VALUES
  ('BILL_ISSUED_SMS', 'Bill issued - SMS', 'BILL_ISSUED', 'SMS', NULL,
   'Dear {{customer_name}}, bill {{bill_number}} for {{period}} is KSh {{amount_due}}, due {{due_date}}. Account {{account_number}}.',
   'Sent when a posted water bill is ready.', '["customer_name","bill_number","period","amount_due","due_date","account_number"]', 'ACTIVE'),
  ('BILL_ISSUED_EMAIL', 'Bill issued - Email', 'BILL_ISSUED', 'EMAIL', 'Water bill {{bill_number}}',
   'Dear {{customer_name}}, your water bill {{bill_number}} for {{period}} is KSh {{amount_due}} and is due on {{due_date}}. Account: {{account_number}}.',
   'Email version of a posted bill notice.', '["customer_name","bill_number","period","amount_due","due_date","account_number"]', 'ACTIVE'),
  ('PAYMENT_RECEIPT_SMS', 'Payment receipt - SMS', 'PAYMENT_RECEIPT', 'SMS', NULL,
   'Payment of KSh {{amount}} received for {{account_number}}. Receipt {{receipt_number}}. Balance: KSh {{balance}}. Thank you.',
   'Confirms a posted customer payment.', '["amount","account_number","receipt_number","balance"]', 'ACTIVE'),
  ('PAYMENT_RECEIPT_EMAIL', 'Payment receipt - Email', 'PAYMENT_RECEIPT', 'EMAIL', 'Payment receipt {{receipt_number}}',
   'Dear {{customer_name}}, we received KSh {{amount}} for account {{account_number}}. Receipt {{receipt_number}}. Remaining balance: KSh {{balance}}.',
   'Email payment confirmation.', '["customer_name","amount","account_number","receipt_number","balance"]', 'ACTIVE'),
  ('PAYMENT_REVERSAL_SMS', 'Payment reversal - SMS', 'PAYMENT_REVERSAL', 'SMS', NULL,
   'Payment {{payment_reference}} of KSh {{amount}} on {{account_number}} was reversed. Current balance: KSh {{balance}}.',
   'Advises a customer that a payment was reversed.', '["payment_reference","amount","account_number","balance"]', 'ACTIVE'),
  ('BALANCE_REMINDER_SMS', 'Balance reminder - SMS', 'BALANCE_REMINDER', 'SMS', NULL,
   'Dear {{customer_name}}, account {{account_number}} has an outstanding balance of KSh {{balance}}. Please pay to avoid service interruption.',
   'Manual outstanding balance reminder.', '["customer_name","account_number","balance"]', 'ACTIVE'),
  ('DUE_DATE_REMINDER_SMS', 'Due date reminder - SMS', 'DUE_DATE_REMINDER', 'SMS', NULL,
   'Reminder: bill {{bill_number}} for KSh {{amount_due}} is due on {{due_date}}. Account {{account_number}}.',
   'Reminder before a bill due date.', '["bill_number","amount_due","due_date","account_number"]', 'ACTIVE'),
  ('BALANCE_REMINDER_EMAIL', 'Balance reminder - Email', 'BALANCE_REMINDER', 'EMAIL', 'Outstanding balance for {{account_number}}',
   'Dear {{customer_name}}, account {{account_number}} has an outstanding balance of KSh {{balance}}. Please arrange payment or contact AquaFlow if you need assistance.',
   'Email version of the outstanding balance reminder.', '["customer_name","account_number","balance"]', 'ACTIVE'),
  ('DUE_DATE_REMINDER_EMAIL', 'Due date reminder - Email', 'DUE_DATE_REMINDER', 'EMAIL', 'Bill {{bill_number}} is due {{due_date}}',
   'Dear {{customer_name}}, this is a reminder that bill {{bill_number}} for KSh {{amount_due}} is due on {{due_date}}. Account: {{account_number}}.',
   'Email reminder before a bill due date.', '["customer_name","bill_number","amount_due","due_date","account_number"]', 'ACTIVE'),
  ('PAYMENT_REVERSAL_EMAIL', 'Payment reversal - Email', 'PAYMENT_REVERSAL', 'EMAIL', 'Payment reversal for {{account_number}}',
   'Dear {{customer_name}}, payment {{payment_reference}} of KSh {{amount}} was reversed on account {{account_number}}. The current balance is KSh {{balance}}.',
   'Email advice for an approved payment reversal.', '["customer_name","payment_reference","amount","account_number","balance"]', 'ACTIVE')
ON CONFLICT (template_code) DO NOTHING;

UPDATE notification_templates
SET message_body = E'Dear {{customer_name}},\n\nYour water account currently has an outstanding balance.\n\nAccount number: {{account_number}}\nOutstanding balance: KSh {{balance}}\n\nPlease arrange payment or contact AquaFlow if you need assistance.\n\nKind regards,\nAquaFlow Customer Service',
    updated_at = CURRENT_TIMESTAMP
WHERE template_code = 'BALANCE_REMINDER_EMAIL';

UPDATE notification_templates
SET message_body = E'Dear {{customer_name}},\n\nYour water bill is now available.\n\nBill number: {{bill_number}}\nBilling period: {{period}}\nAccount number: {{account_number}}\nAmount due: KSh {{amount_due}}\nDue date: {{due_date}}\n\nPlease make payment by the due date.\n\nKind regards,\nAquaFlow Customer Service',
    updated_at = CURRENT_TIMESTAMP
WHERE template_code = 'BILL_ISSUED_EMAIL';

UPDATE notification_templates
SET message_body = E'Dear {{customer_name}},\n\nWe have received your payment.\n\nAccount number: {{account_number}}\nReceipt number: {{receipt_number}}\nAmount received: KSh {{amount}}\nRemaining balance: KSh {{balance}}\n\nThank you for your payment.\n\nKind regards,\nAquaFlow Customer Service',
    updated_at = CURRENT_TIMESTAMP
WHERE template_code = 'PAYMENT_RECEIPT_EMAIL';

UPDATE notification_templates
SET message_body = E'Dear {{customer_name}},\n\nThis is a reminder that your water bill is approaching its due date.\n\nBill number: {{bill_number}}\nAccount number: {{account_number}}\nAmount due: KSh {{amount_due}}\nDue date: {{due_date}}\n\nKind regards,\nAquaFlow Customer Service',
    updated_at = CURRENT_TIMESTAMP
WHERE template_code = 'DUE_DATE_REMINDER_EMAIL';

UPDATE notification_templates
SET message_body = E'Dear {{customer_name}},\n\nA payment on your water account has been reversed.\n\nPayment reference: {{payment_reference}}\nAccount number: {{account_number}}\nReversed amount: KSh {{amount}}\nCurrent balance: KSh {{balance}}\n\nPlease contact AquaFlow if you need more information.\n\nKind regards,\nAquaFlow Customer Service',
    updated_at = CURRENT_TIMESTAMP
WHERE template_code = 'PAYMENT_REVERSAL_EMAIL';
