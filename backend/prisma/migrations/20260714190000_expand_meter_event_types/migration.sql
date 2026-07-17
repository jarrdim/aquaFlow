-- Keep meter lifecycle audit events aligned with the reading and profile workflows.
ALTER TABLE aquaflow.meter_events
  DROP CONSTRAINT IF EXISTS ck_meter_event_type;

ALTER TABLE aquaflow.meter_events
  ADD CONSTRAINT ck_meter_event_type CHECK (event_type IN (
    'REGISTERED',
    'PROFILE_UPDATED',
    'ASSIGNED',
    'INSTALLATION_UPDATED',
    'STATUS_CHANGED',
    'FAULT_REPORTED',
    'READING',
    'READING_CAPTURED',
    'READING_APPROVED',
    'READING_REJECTED',
    'REPLACEMENT_DRAFTED',
    'REPLACEMENT_SUBMITTED',
    'REPLACEMENT_APPROVED',
    'REPLACEMENT_REJECTED',
    'REPLACEMENT_RETURNED',
    'ALERT_CREATED',
    'ALERT_DISMISSED',
    'WORK_ORDER_CREATED'
  ));
