INSERT INTO aquaflow.permissions (permission_code, module_name, permission_name, description)
VALUES
  ('CUSTOMER_STATEMENT_VIEW', 'Billing', 'View customer statements', 'View customer account statements'),
  ('CUSTOMER_VIEW', 'Customers', 'View customers', 'View the customer register and customer profiles'),
  ('CUSTOMER_MANAGE', 'Customers', 'Manage customers', 'Create and update customer records'),
  ('READING_WORKLIST_VIEW', 'Meter Readings', 'View reading worklist', 'View meter-reading worklists'),
  ('READING_WORKLIST_MANAGE', 'Meter Readings', 'Manage reading worklist', 'Capture and synchronize readings from the worklist'),
  ('DISCONNECTION_LIST_VIEW', 'Arrears & Debt', 'View disconnection lists', 'View generated disconnection lists'),
  ('DISCONNECTION_LIST_MANAGE', 'Arrears & Debt', 'Manage disconnection lists', 'Create and process disconnection lists'),
  ('PROMISE_TO_PAY_VIEW', 'Arrears & Debt', 'View promises to pay', 'View promises to pay'),
  ('PROMISE_TO_PAY_MANAGE', 'Arrears & Debt', 'Manage promises to pay', 'Create and update promises to pay'),
  ('METER_ASSIGN_CUSTOMER', 'Meter Management', 'Assign customer meters', 'Assign meters to customer accounts'),
  ('METER_DIRECT_REPLACE', 'Meter Management', 'Direct meter replacement', 'Replace a customer meter directly'),
  ('METER_DIRECT_DISCONNECT', 'Meter Management', 'Disconnect meters directly', 'Record direct customer-meter disconnections'),
  ('METER_DIRECT_RECONNECT', 'Meter Management', 'Reconnect meters directly', 'Record direct customer-meter reconnections'),
  ('PAYMENT_OPERATIONS', 'Payments & Revenue', 'Payment operations', 'Use payment and revenue operations not separately restricted'),
  ('PAYMENT_DASHBOARD_VIEW', 'Payments & Revenue', 'View revenue dashboard', 'View the revenue dashboard'),
  ('PAYMENT_C2B_MANAGE', 'Payments & Revenue', 'Manage M-Pesa C2B integration', 'View and manage M-Pesa C2B integration'),
  ('PAYMENT_CHANNEL_MANAGE', 'Payments & Revenue', 'Manage payment channels', 'View and configure payment channels'),
  ('PAYMENT_UNMATCHED_VIEW', 'Payments & Revenue', 'View unmatched payments', 'View unmatched payments'),
  ('PAYMENT_UNMATCHED_MANAGE', 'Payments & Revenue', 'Reconcile unmatched payments', 'Allocate and reconcile unmatched payments'),
  ('PAYMENT_DAILY_RECEIPTS_VIEW', 'Payments & Revenue', 'View daily receipts report', 'View and export the detailed daily receipts report')
ON CONFLICT (permission_code) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  permission_name = EXCLUDED.permission_name,
  description = EXCLUDED.description;

INSERT INTO aquaflow.roles (role_code, role_name, description, status)
VALUES
  ('REVENUE_FIELD_OPERATIONS', 'Revenue & Field Operations Officer', 'Payments, connections, disconnections, reading worklists and promises to pay', 'ACTIVE'),
  ('CUSTOMER_METER_SERVICES', 'Customer & Meter Services Officer', 'Customer management, meter assignment, direct replacement and complaints', 'ACTIVE'),
  ('GENERAL_STAFF_VIEWER', 'General Staff Viewer', 'Common operational registers with view-only access', 'ACTIVE'),
  ('PAYMENT_RECONCILIATION', 'Payment Reconciliation Officer', 'Review and reconcile unmatched payments', 'ACTIVE')
ON CONFLICT (role_code) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  status = EXCLUDED.status;

-- Every new staff role receives the four common views requested by management.
INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
CROSS JOIN aquaflow.permissions p
WHERE r.role_code IN ('REVENUE_FIELD_OPERATIONS', 'CUSTOMER_METER_SERVICES', 'GENERAL_STAFF_VIEWER', 'PAYMENT_RECONCILIATION')
  AND p.permission_code IN ('CUSTOMER_STATEMENT_VIEW', 'SERVICE_REQUEST_VIEW', 'READING_WORKLIST_VIEW', 'DISCONNECTION_LIST_VIEW')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN (
  'PAYMENT_OPERATIONS',
  'CONNECTION_VIEW', 'CONNECTION_CREATE', 'CONNECTION_PROCESS',
  'READING_WORKLIST_MANAGE',
  'METER_DIRECT_DISCONNECT',
  'PROMISE_TO_PAY_VIEW', 'PROMISE_TO_PAY_MANAGE',
  'DISCONNECTION_LIST_MANAGE'
)
WHERE r.role_code = 'REVENUE_FIELD_OPERATIONS'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN (
  'CUSTOMER_VIEW', 'CUSTOMER_MANAGE',
  'METER_ASSIGN_CUSTOMER', 'METER_DIRECT_REPLACE',
  'SERVICE_REQUEST_CREATE'
)
WHERE r.role_code = 'CUSTOMER_METER_SERVICES'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN ('PAYMENT_UNMATCHED_VIEW', 'PAYMENT_UNMATCHED_MANAGE')
WHERE r.role_code = 'PAYMENT_RECONCILIATION'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- The administrator is the superuser in code and also receives the complete catalogue for UI clarity.
INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
CROSS JOIN aquaflow.permissions p
WHERE r.role_code = 'SYSTEM_ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;
