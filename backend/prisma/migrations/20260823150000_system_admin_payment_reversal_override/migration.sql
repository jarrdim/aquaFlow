SET search_path TO aquaflow, public;

-- PostgreSQL CHECK constraints cannot inspect the approver's application role.
-- Authorization therefore remains in the reversal decision endpoint, which
-- permits SYSTEM_ADMIN self-decisions while enforcing maker-checker separation
-- for every other role.
ALTER TABLE payment_reversals
  DROP CONSTRAINT IF EXISTS ck_payment_reversal_maker_checker;
