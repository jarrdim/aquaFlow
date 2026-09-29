-- Customer and meter services officers work directly with customer meters,
-- so their worklist access includes capturing and synchronizing readings.
INSERT INTO aquaflow.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM aquaflow.roles r
JOIN aquaflow.permissions p
  ON p.permission_code = 'READING_WORKLIST_MANAGE'
WHERE r.role_code = 'CUSTOMER_METER_SERVICES'
ON CONFLICT (role_id, permission_id) DO NOTHING;
