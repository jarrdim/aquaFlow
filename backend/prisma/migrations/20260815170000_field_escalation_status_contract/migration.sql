ALTER TABLE aquaflow.work_orders
  DROP CONSTRAINT IF EXISTS ck_work_order_status;

ALTER TABLE aquaflow.work_orders
  ADD CONSTRAINT ck_work_order_status
  CHECK (status IN (
    'CREATED',
    'ASSIGNED',
    'ACCEPTED',
    'IN_PROGRESS',
    'COMPLETED',
    'VERIFIED',
    'CLOSED',
    'REOPENED',
    'CANCELLED',
    'ESCALATED'
  ));
