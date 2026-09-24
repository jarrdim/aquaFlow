-- Keep historical role and assignment records, but remove legacy roles from
-- active access control and from the normal administration selectors.
UPDATE aquaflow.user_roles
SET
  status = 'INACTIVE',
  effective_to = COALESCE(effective_to, CURRENT_DATE)
WHERE status = 'ACTIVE'
  AND role_id IN (
    SELECT role_id
    FROM aquaflow.roles
    WHERE role_code IN (
      'ACCOUNTANT',
      'AUDITOR',
      'BILLING_OFFICER',
      'BILLING_SUPERVISOR',
      'CASHIER',
      'CREDIT_CONTROL_OFFICER',
      'CREDIT_CONTROL_SUPERVISOR',
      'CUSTOMER_CARE_OFFICER',
      'FINANCE_MANAGER',
      'METER_SUPERVISOR'
    )
  );

UPDATE aquaflow.roles
SET
  status = 'INACTIVE',
  updated_at = CURRENT_TIMESTAMP
WHERE role_code IN (
  'ACCOUNTANT',
  'AUDITOR',
  'BILLING_OFFICER',
  'BILLING_SUPERVISOR',
  'CASHIER',
  'CREDIT_CONTROL_OFFICER',
  'CREDIT_CONTROL_SUPERVISOR',
  'CUSTOMER_CARE_OFFICER',
  'FINANCE_MANAGER',
  'METER_SUPERVISOR'
);
