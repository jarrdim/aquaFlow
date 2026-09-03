SET search_path TO aquaflow, public;

-- A first-time new-connection applicant does not have a water account yet.
-- The application number in purpose_reference identifies and reconciles the
-- STK payment until an account is created later in the workflow.
ALTER TABLE mpesa_stk_requests
  ALTER COLUMN account_id DROP NOT NULL;
