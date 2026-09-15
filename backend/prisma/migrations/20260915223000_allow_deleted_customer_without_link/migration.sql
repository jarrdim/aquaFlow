-- A deleted customer login is deliberately detached from the retained billing
-- customer record. Keep its original user type for audit/reporting purposes
-- while allowing that detached terminal state.
ALTER TABLE aquaflow.users
    DROP CONSTRAINT IF EXISTS ck_user_customer_link;

ALTER TABLE aquaflow.users
    ADD CONSTRAINT ck_user_customer_link CHECK (
        (user_type = 'CUSTOMER' AND customer_id IS NOT NULL)
        OR user_type IN ('STAFF', 'SYSTEM')
        OR (user_type = 'CUSTOMER' AND status = 'DELETED' AND customer_id IS NULL)
    );

-- DELETED is a terminal authentication state used by the account-deletion
-- endpoint. It was implemented by the API before the database status check
-- was expanded to accept it.
ALTER TABLE aquaflow.users
    DROP CONSTRAINT IF EXISTS ck_user_status;

ALTER TABLE aquaflow.users
    ADD CONSTRAINT ck_user_status CHECK (
        status IN ('PENDING', 'ACTIVE', 'LOCKED', 'DISABLED', 'DELETED')
    );
