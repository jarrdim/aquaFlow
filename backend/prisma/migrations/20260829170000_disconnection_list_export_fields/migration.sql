ALTER TABLE aquaflow.disconnection_list_items
  ADD COLUMN IF NOT EXISTS account_balance NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS previous_reading NUMERIC(18,3),
  ADD COLUMN IF NOT EXISTS meter_number TEXT;

UPDATE aquaflow.disconnection_list_items item
SET account_balance = account.current_balance
FROM aquaflow.customer_accounts account
WHERE account.account_id = item.account_id
  AND item.account_balance IS NULL;

WITH latest AS (
  SELECT DISTINCT ON (reading.account_id)
    reading.account_id, reading.current_reading, meter.meter_number
  FROM aquaflow.meter_readings reading
  JOIN aquaflow.meters meter ON meter.meter_id = reading.meter_id
  WHERE reading.approval_status = 'APPROVED'
  ORDER BY reading.account_id, reading.reading_date DESC, reading.reading_id DESC
)
UPDATE aquaflow.disconnection_list_items item
SET previous_reading = latest.current_reading,
    meter_number = latest.meter_number
FROM latest
WHERE latest.account_id = item.account_id
  AND item.previous_reading IS NULL;
