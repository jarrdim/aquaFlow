-- Bill notification rows are cancelled when an operator clears a pending
-- notification or when delivery is blocked because its bill is no longer
-- eligible. Keep the database status contract aligned with those workflows.
ALTER TABLE aquaflow.bill_notifications
  DROP CONSTRAINT IF EXISTS ck_bill_notification_status;

ALTER TABLE aquaflow.bill_notifications
  ADD CONSTRAINT ck_bill_notification_status
  CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'CANCELLED'));
