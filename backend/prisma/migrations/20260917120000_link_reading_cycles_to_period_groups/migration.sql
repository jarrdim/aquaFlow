ALTER TABLE aquaflow.reading_cycles
  ADD COLUMN billing_period_group_id BIGINT;

UPDATE aquaflow.reading_cycles AS reading_cycle
SET billing_period_group_id = billing_cycle.billing_period_group_id
FROM aquaflow.billing_cycles AS billing_cycle
WHERE reading_cycle.billing_cycle_id = billing_cycle.billing_cycle_id
  AND reading_cycle.billing_period_group_id IS NULL;

CREATE INDEX reading_cycles_billing_period_group_id_idx
  ON aquaflow.reading_cycles (billing_period_group_id);

ALTER TABLE aquaflow.reading_cycles
  ADD CONSTRAINT reading_cycles_billing_period_group_id_fkey
  FOREIGN KEY (billing_period_group_id)
  REFERENCES aquaflow.billing_period_groups (billing_period_group_id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
