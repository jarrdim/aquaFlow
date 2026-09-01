BEGIN;

-- Preserve an auditable copy before removing only the unsent zero-value notices.
CREATE TABLE IF NOT EXISTS aquaflow.notifications_backup_zero_bill_20260901
(LIKE aquaflow.notifications INCLUDING ALL);

INSERT INTO aquaflow.notifications_backup_zero_bill_20260901
SELECT n.*
FROM aquaflow.notifications n
JOIN aquaflow.bills b ON b.bill_id = n.bill_id
WHERE b.billing_cycle_id = 2
  AND n.notification_type = 'BILL_ISSUED'
  AND n.delivery_status = 'QUEUED'
  AND n.message_body LIKE '%Total Amount 0.00.%'
ON CONFLICT (notification_id) DO NOTHING;

DELETE FROM aquaflow.notifications n
USING aquaflow.bills b
WHERE b.bill_id = n.bill_id
  AND b.billing_cycle_id = 2
  AND n.notification_type = 'BILL_ISSUED'
  AND n.delivery_status = 'QUEUED'
  AND n.message_body LIKE '%Total Amount 0.00.%';

-- Restore the bill-level indicator from the notifications that remain.
UPDATE aquaflow.bills b
SET notification_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM aquaflow.notifications n
        WHERE n.bill_id = b.bill_id
          AND n.notification_type = 'BILL_ISSUED'
          AND n.delivery_status IN ('SENT', 'DELIVERED')
      ) THEN 'SENT'
      ELSE 'NOT_SENT'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE b.billing_cycle_id = 2
  AND b.total_amount_due = 0.00;

-- These figures should show 0 remaining queued zero-value notices.
SELECT
  COUNT(*) FILTER (WHERE n.delivery_status = 'QUEUED') AS queued_zero_notices_remaining,
  COUNT(*) FILTER (WHERE n.delivery_status IN ('SENT', 'DELIVERED')) AS sent_zero_notices_retained
FROM aquaflow.notifications n
JOIN aquaflow.bills b ON b.bill_id = n.bill_id
WHERE b.billing_cycle_id = 2
  AND n.notification_type = 'BILL_ISSUED'
  AND n.message_body LIKE '%Total Amount 0.00.%';

COMMIT;
