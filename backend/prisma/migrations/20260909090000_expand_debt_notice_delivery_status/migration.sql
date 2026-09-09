SET search_path TO aquaflow, public;

-- Some upgraded databases inherited this misleading name for the delivery
-- status check. Recreate both checks with explicit, column-specific rules.
ALTER TABLE debt_notices DROP CONSTRAINT IF EXISTS ck_debt_notice_status;
ALTER TABLE debt_notices DROP CONSTRAINT IF EXISTS debt_notices_delivery_status_check;
ALTER TABLE debt_notices DROP CONSTRAINT IF EXISTS debt_notices_notice_status_check;
ALTER TABLE debt_notices DROP CONSTRAINT IF EXISTS ck_debt_notice_delivery_status;

ALTER TABLE debt_notices
  ADD CONSTRAINT ck_debt_notice_delivery_status
  CHECK (delivery_status IN (
    'PENDING',
    'QUEUED',
    'READY_TO_PRINT',
    'SENT',
    'DELIVERED',
    'FAILED'
  ));

ALTER TABLE debt_notices
  ADD CONSTRAINT ck_debt_notice_status
  CHECK (notice_status IN (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT',
    'PAID',
    'EXPIRED',
    'REJECTED',
    'RETURNED'
  ));
