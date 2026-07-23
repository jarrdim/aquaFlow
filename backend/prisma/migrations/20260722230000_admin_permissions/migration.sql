INSERT INTO aquaflow.permissions (permission_code, module_name, permission_name, description)
VALUES
  ('ADMIN_USER_VIEW', 'Administration', 'View users', 'View user accounts and role assignments'),
  ('ADMIN_USER_MANAGE', 'Administration', 'Manage users', 'Create, edit, activate and deactivate users'),
  ('ADMIN_ROLE_VIEW', 'Administration', 'View roles', 'View roles and their permissions'),
  ('ADMIN_ROLE_MANAGE', 'Administration', 'Manage roles', 'Create roles and manage permission grants'),
  ('ADMIN_PERMISSION_VIEW', 'Administration', 'View permissions', 'View the permission catalogue'),
  ('ADMIN_PERMISSION_MANAGE', 'Administration', 'Manage permissions', 'Create and edit permission definitions'),
  ('SERVICE_REQUEST_VIEW', 'Service Requests', 'View service requests', 'View service requests and complaints'),
  ('SERVICE_REQUEST_CREATE', 'Service Requests', 'Create service requests', 'Register service requests and complaints'),
  ('SERVICE_REQUEST_ASSIGN', 'Service Requests', 'Assign service requests', 'Assign requests to service officers'),
  ('SERVICE_REQUEST_RESOLVE', 'Service Requests', 'Resolve service requests', 'Progress, resolve and close requests')
ON CONFLICT (permission_code) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  permission_name = EXCLUDED.permission_name,
  description = EXCLUDED.description;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
CROSS JOIN aquaflow.permissions p
WHERE r.role_code = 'SYSTEM_ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p ON p.permission_code IN (
  'SERVICE_REQUEST_VIEW', 'SERVICE_REQUEST_CREATE',
  'SERVICE_REQUEST_ASSIGN', 'SERVICE_REQUEST_RESOLVE'
)
WHERE r.role_code = 'CUSTOMER_CARE_OFFICER'
ON CONFLICT (role_id, permission_id) DO NOTHING;
