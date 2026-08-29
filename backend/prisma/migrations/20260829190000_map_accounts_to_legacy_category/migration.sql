-- Use one customer category for all existing accounts so they resolve the
-- active DOMESTIC tariff assigned to the Legacy Customer category.
DO $$
DECLARE
  legacy_category_id BIGINT;
BEGIN
  SELECT category_id
  INTO legacy_category_id
  FROM aquaflow.customer_categories
  WHERE category_name = 'Legacy Customer';

  IF legacy_category_id IS NULL THEN
    RAISE EXCEPTION 'Legacy Customer category was not found';
  END IF;

  UPDATE aquaflow.customer_accounts
  SET category_id = legacy_category_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE category_id IS DISTINCT FROM legacy_category_id;
END $$;
