-- Account numbers use one continuous ACC-NNNNN sequence. The year belongs to
-- customer/work-order references, not to the customer's water account number.
WITH canonical_maximum AS (
  SELECT COALESCE(
    MAX(CAST(substring(account_number FROM '[0-9]+$') AS INTEGER)),
    0
  ) AS max_sequence
  FROM aquaflow.customer_accounts
  WHERE account_number ~ '^ACC-[0-9]+$'
), year_bearing_accounts AS (
  SELECT
    account_id,
    ROW_NUMBER() OVER (ORDER BY account_id) AS sequence_offset
  FROM aquaflow.customer_accounts
  WHERE account_number ~ '^ACC-[0-9]{4}-[0-9]+$'
)
UPDATE aquaflow.customer_accounts AS account
SET account_number = 'ACC-' || LPAD(
  (canonical_maximum.max_sequence + year_bearing_accounts.sequence_offset)::TEXT,
  5,
  '0'
)
FROM canonical_maximum, year_bearing_accounts
WHERE account.account_id = year_bearing_accounts.account_id;
