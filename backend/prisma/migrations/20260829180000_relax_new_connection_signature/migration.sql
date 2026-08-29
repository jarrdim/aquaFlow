-- Temporary operational policy: new-connection work can be completed without
-- the materials/customer-signature completion report. This is data-driven and
-- can be restored later by setting requires_signature back to TRUE.
UPDATE aquaflow.work_order_types
SET requires_signature = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE type_code = 'NEW_CONNECTION';
