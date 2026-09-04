-- A bill's allocatable outstanding amount is total_amount_due minus its active
-- allocations. total_current_charges is informational for the current period
-- and must not be used when an account credit reduced total_amount_due.
CREATE OR REPLACE FUNCTION aquaflow.validate_payment_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payment_total NUMERIC(18,2);
  allocated_total NUMERIC(18,2);
  bill_due NUMERIC(18,2);
  bill_allocated NUMERIC(18,2);
  bill_outstanding NUMERIC(18,2);
BEGIN
  -- Reversing an allocation reduces the active total and cannot over-allocate.
  IF NEW.status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  SELECT amount INTO payment_total
  FROM aquaflow.payments
  WHERE payment_id = NEW.payment_id
  FOR UPDATE;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO allocated_total
  FROM aquaflow.payment_allocations
  WHERE payment_id = NEW.payment_id
    AND status = 'ACTIVE'
    AND allocation_id <> COALESCE(NEW.allocation_id, 0);

  IF allocated_total + NEW.allocated_amount > payment_total THEN
    RAISE EXCEPTION 'Payment allocation exceeds payment amount';
  END IF;

  SELECT total_amount_due INTO bill_due
  FROM aquaflow.bills
  WHERE bill_id = NEW.bill_id
  FOR UPDATE;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO bill_allocated
  FROM aquaflow.payment_allocations
  WHERE bill_id = NEW.bill_id
    AND status = 'ACTIVE'
    AND allocation_id <> COALESCE(NEW.allocation_id, 0);

  bill_outstanding := GREATEST(0, bill_due - bill_allocated);
  IF NEW.allocated_amount > bill_outstanding THEN
    RAISE EXCEPTION 'Payment allocation exceeds bill amount due';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_payment_allocation ON aquaflow.payment_allocations;
CREATE TRIGGER trg_validate_payment_allocation
BEFORE INSERT OR UPDATE ON aquaflow.payment_allocations
FOR EACH ROW EXECUTE FUNCTION aquaflow.validate_payment_allocation();
