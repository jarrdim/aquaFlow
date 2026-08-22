ALTER TABLE aquaflow.work_order_updates
  ADD COLUMN IF NOT EXISTS reason_code VARCHAR(50);

ALTER TABLE aquaflow.work_order_updates
  DROP CONSTRAINT IF EXISTS ck_work_order_update_reason_code;

ALTER TABLE aquaflow.work_order_updates
  ADD CONSTRAINT ck_work_order_update_reason_code
  CHECK (
    reason_code IS NULL OR reason_code IN (
      'CUSTOMER_UNAVAILABLE',
      'SITE_INACCESSIBLE',
      'SAFETY_RISK',
      'METER_OR_EQUIPMENT_ISSUE',
      'INCORRECT_TASK_DETAILS',
      'REQUIRES_SUPERVISOR',
      'OTHER'
    )
  );
