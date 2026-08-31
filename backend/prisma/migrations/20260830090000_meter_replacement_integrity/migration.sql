-- Reserve replacement stock and prevent overlapping open replacement requests.
ALTER TABLE aquaflow.meters DROP CONSTRAINT IF EXISTS ck_meter_status;
ALTER TABLE aquaflow.meters ADD CONSTRAINT ck_meter_status
  CHECK (status IN ('IN_STOCK','RESERVED','ACTIVE','FAULTY','INACTIVE','REMOVED','REPLACED','DISCONNECTED','TAMPERED'));

-- Keep the newest pending request if legacy data contains overlaps.
WITH ranked AS (
  SELECT replacement_id, ROW_NUMBER() OVER (PARTITION BY old_meter_id ORDER BY created_at DESC,replacement_id DESC) AS position
  FROM aquaflow.meter_replacements WHERE request_status='PENDING'
)
UPDATE aquaflow.meter_replacements mr
SET request_status='RETURNED',decision_comments=COALESCE(decision_comments,'Returned during replacement-integrity upgrade: duplicate old meter'),decided_at=CURRENT_TIMESTAMP
FROM ranked r WHERE mr.replacement_id=r.replacement_id AND r.position>1;

WITH ranked AS (
  SELECT replacement_id, ROW_NUMBER() OVER (PARTITION BY new_meter_id ORDER BY created_at DESC,replacement_id DESC) AS position
  FROM aquaflow.meter_replacements WHERE request_status='PENDING'
)
UPDATE aquaflow.meter_replacements mr
SET request_status='RETURNED',decision_comments=COALESCE(decision_comments,'Returned during replacement-integrity upgrade: duplicate incoming meter'),decided_at=CURRENT_TIMESTAMP
FROM ranked r WHERE mr.replacement_id=r.replacement_id AND r.position>1;

UPDATE aquaflow.meters m SET status='RESERVED',updated_at=CURRENT_TIMESTAMP
WHERE m.status='IN_STOCK' AND EXISTS (
  SELECT 1 FROM aquaflow.meter_replacements mr WHERE mr.new_meter_id=m.meter_id AND mr.request_status='PENDING'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meter_replacement_pending_old_meter
  ON aquaflow.meter_replacements(old_meter_id)
  WHERE request_status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meter_replacement_pending_new_meter
  ON aquaflow.meter_replacements(new_meter_id)
  WHERE request_status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS uq_meter_replacement_work_order
  ON aquaflow.meter_replacements(work_order_id)
  WHERE work_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_meter_replacement_account_status
  ON aquaflow.meter_replacements(account_id, request_status);
