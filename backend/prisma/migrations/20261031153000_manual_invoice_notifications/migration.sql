ALTER TABLE aquaflow.manual_invoices
  ADD COLUMN IF NOT EXISTS notify_on_issue BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notification_channels JSONB;
