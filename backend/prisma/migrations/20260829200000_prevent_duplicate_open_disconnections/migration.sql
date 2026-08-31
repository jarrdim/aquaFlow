-- Prevent concurrent/manual requests from creating a second open
-- disconnection work order for the same customer account. Historical
-- duplicates are preserved and can still progress through their lifecycle.
CREATE OR REPLACE FUNCTION aquaflow.prevent_duplicate_open_disconnection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  requested_type_code TEXT;
BEGIN
  IF NEW.account_id IS NULL OR NEW.status NOT IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','REOPENED') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.account_id IS NOT DISTINCT FROM NEW.account_id
     AND OLD.work_order_type_id IS NOT DISTINCT FROM NEW.work_order_type_id
     AND OLD.status IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','REOPENED') THEN
    RETURN NEW;
  END IF;

  SELECT type_code INTO requested_type_code
  FROM aquaflow.work_order_types
  WHERE work_order_type_id = NEW.work_order_type_id;

  IF requested_type_code <> 'DISCONNECTION' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('open-disconnection:' || NEW.account_id::text));

  IF EXISTS (
    SELECT 1
    FROM aquaflow.work_orders existing
    JOIN aquaflow.work_order_types existing_type
      ON existing_type.work_order_type_id = existing.work_order_type_id
    WHERE existing.account_id = NEW.account_id
      AND existing_type.type_code = 'DISCONNECTION'
      AND existing.status IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','REOPENED')
      AND existing.work_order_id IS DISTINCT FROM NEW.work_order_id
  ) THEN
    RAISE EXCEPTION 'An open disconnection work order already exists for this account'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_open_disconnection ON aquaflow.work_orders;
CREATE TRIGGER trg_prevent_duplicate_open_disconnection
BEFORE INSERT OR UPDATE OF account_id, work_order_type_id, status
ON aquaflow.work_orders
FOR EACH ROW
EXECUTE FUNCTION aquaflow.prevent_duplicate_open_disconnection();
