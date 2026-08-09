-- A payment tied to a verified customer account is fully matched even when
-- some of its value remains as account credit after bill allocation.
UPDATE aquaflow.payments
SET
  matching_status = 'MATCHED',
  updated_at = CURRENT_TIMESTAMP
WHERE matching_status = 'PARTIALLY_MATCHED'
  AND account_id IS NOT NULL
  AND payment_status <> 'REVERSED';
