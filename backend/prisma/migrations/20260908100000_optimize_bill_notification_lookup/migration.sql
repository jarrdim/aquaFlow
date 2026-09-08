CREATE INDEX IF NOT EXISTS bills_cycle_notification_status_idx
  ON aquaflow.bills (billing_cycle_id, notification_status, status)
  WHERE reading_id IS NOT NULL;
