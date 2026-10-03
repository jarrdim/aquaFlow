INSERT INTO aquaflow.roles (role_code, role_name, description, status)
VALUES (
  'FIELD_OPERATIONS_TECHNICIAN',
  'Field Operations Technician',
  'Performs assigned field repairs and maintenance, including leak repairs, pipeline work, service restoration and meter-related field work',
  'ACTIVE'
)
ON CONFLICT (role_code) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p
  ON p.permission_code IN ('WORK_ORDER_VIEW', 'WORK_ORDER_EXECUTE')
WHERE r.role_code = 'FIELD_OPERATIONS_TECHNICIAN'
ON CONFLICT (role_id, permission_id) DO NOTHING;
