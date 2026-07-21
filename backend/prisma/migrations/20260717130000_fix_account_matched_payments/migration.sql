-- A posted payment with an account_id has already been resolved to a valid
-- customer account. If no open bill existed, its unallocated_amount represents
-- account credit and must not cause the payment to appear in suspense.
UPDATE aquaflow.payments
SET
  matching_status = 'MATCHED',
  updated_at = CURRENT_TIMESTAMP
WHERE account_id IS NOT NULL
  AND payment_status = 'POSTED'
  AND matching_status = 'UNMATCHED';
