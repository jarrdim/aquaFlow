CREATE TABLE aquaflow.billing_period_groups (
  billing_period_group_id BIGSERIAL PRIMARY KEY,
  group_code VARCHAR(30) NOT NULL UNIQUE,
  group_name VARCHAR(150) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_billing_period_group_dates CHECK (period_end >= period_start)
);

ALTER TABLE aquaflow.billing_cycles
  ADD COLUMN billing_period_group_id BIGINT,
  ADD COLUMN cycle_type VARCHAR(30) NOT NULL DEFAULT 'ROUTINE';

INSERT INTO aquaflow.billing_period_groups (group_code, group_name, period_start, period_end)
SELECT DISTINCT
  'BPG-' || TO_CHAR(DATE_TRUNC('month', due_date), 'YYYY-MM'),
  TO_CHAR(DATE_TRUNC('month', due_date), 'FMMonth YYYY') || ' Billing',
  DATE_TRUNC('month', due_date)::date,
  (DATE_TRUNC('month', due_date) + INTERVAL '1 month - 1 day')::date
FROM aquaflow.billing_cycles;

UPDATE aquaflow.billing_cycles AS cycle
SET billing_period_group_id = period.billing_period_group_id,
    cycle_type = CASE
      WHEN cycle.cycle_code LIKE 'MR-%' THEN 'METER_REPLACEMENT'
      WHEN UPPER(cycle.cycle_code) LIKE '%LATE%' THEN 'LATE_READING'
      ELSE 'ROUTINE'
    END
FROM aquaflow.billing_period_groups AS period
WHERE period.group_code = 'BPG-' || TO_CHAR(DATE_TRUNC('month', cycle.due_date), 'YYYY-MM');

ALTER TABLE aquaflow.billing_cycles
  ALTER COLUMN billing_period_group_id SET NOT NULL,
  ADD CONSTRAINT fk_billing_cycle_period_group
    FOREIGN KEY (billing_period_group_id)
    REFERENCES aquaflow.billing_period_groups(billing_period_group_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX ix_billing_cycles_period_group
  ON aquaflow.billing_cycles(billing_period_group_id);
