-- Samdamte Google Play Store test Field Officer
-- Creates or updates ONLY playfield01. It does not modify customer test users.
-- Replace PASTE_BCRYPT_HASH_HERE with the same bcrypt cost-12 hash used for
-- the Google Play customer test accounts before running this in DBeaver.

BEGIN;

-- Imported/restored databases can have sequences behind their table IDs.
SELECT setval(
    pg_get_serial_sequence('aquaflow.users', 'user_id')::regclass,
    GREATEST(
        coalesce((SELECT max(user_id) FROM aquaflow.users), 0),
        nextval(pg_get_serial_sequence('aquaflow.users', 'user_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.field_officers', 'field_officer_id')::regclass,
    GREATEST(
        coalesce((SELECT max(field_officer_id) FROM aquaflow.field_officers), 0),
        nextval(pg_get_serial_sequence('aquaflow.field_officers', 'field_officer_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.user_roles', 'user_role_id')::regclass,
    GREATEST(
        coalesce((SELECT max(user_role_id) FROM aquaflow.user_roles), 0),
        nextval(pg_get_serial_sequence('aquaflow.user_roles', 'user_role_id')::regclass)
    ),
    true
);

DO $seed$
DECLARE
    v_password_hash text := 'PASTE_BCRYPT_HASH_HERE';
    v_username text := 'playfield01';
    v_email text := 'playfield01@example.invalid';
    v_phone text := '+254700999901';
    v_employee_number text := 'PLAY-FIELD-01';
    v_user_id bigint;
    v_zone_id bigint;
    v_role_id bigint;
BEGIN
    IF v_password_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN
        RAISE EXCEPTION 'Replace PASTE_BCRYPT_HASH_HERE with a bcrypt cost-12 hash before running this script';
    END IF;

    SELECT zone_id INTO v_zone_id
    FROM aquaflow.zones
    WHERE zone_code = 'PLAYTEST'
      AND status = 'ACTIVE';

    IF v_zone_id IS NULL THEN
        RAISE EXCEPTION 'Active PLAYTEST zone is missing. The customer test seed must be run first';
    END IF;

    SELECT role_id INTO v_role_id
    FROM aquaflow.roles
    WHERE role_code = 'METER_READER'
      AND status = 'ACTIVE';

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Active METER_READER role is missing. Run the application reference-data seed first';
    END IF;

    IF EXISTS (
        SELECT 1 FROM aquaflow.users
        WHERE username = v_username
          AND email_address <> v_email
    ) THEN
        RAISE EXCEPTION 'Refusing to modify non-test user %', v_username;
    END IF;

    IF EXISTS (
        SELECT 1 FROM aquaflow.users
        WHERE (email_address = v_email OR phone_number = v_phone)
          AND username <> v_username
    ) THEN
        RAISE EXCEPTION 'Test email or phone is assigned to another user';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM aquaflow.field_officers fo
        JOIN aquaflow.users u ON u.user_id = fo.user_id
        WHERE fo.employee_number = v_employee_number
          AND u.username <> v_username
    ) THEN
        RAISE EXCEPTION 'Employee number % is assigned to another user', v_employee_number;
    END IF;

    INSERT INTO aquaflow.users
        (username, first_name, last_name, email_address, phone_number,
         password_hash, user_type, customer_id, two_factor_enabled, status,
         created_at, updated_at)
    VALUES
        (v_username, 'Google Play Test', 'Field Officer', v_email, v_phone,
         v_password_hash, 'STAFF', NULL, false, 'ACTIVE', now(), now())
    ON CONFLICT (username) DO UPDATE SET
        first_name = 'Google Play Test',
        last_name = 'Field Officer',
        email_address = v_email,
        phone_number = v_phone,
        password_hash = v_password_hash,
        user_type = 'STAFF',
        customer_id = NULL,
        status = 'ACTIVE',
        updated_at = now()
    RETURNING user_id INTO v_user_id;

    INSERT INTO aquaflow.field_officers
        (user_id, employee_number, officer_type, phone_number, home_zone_id,
         availability_status, status, created_at, updated_at)
    VALUES
        (v_user_id, v_employee_number, 'METER_READER', v_phone, v_zone_id,
         'AVAILABLE', 'ACTIVE', now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
        employee_number = v_employee_number,
        officer_type = 'METER_READER',
        phone_number = v_phone,
        home_zone_id = v_zone_id,
        availability_status = 'AVAILABLE',
        status = 'ACTIVE',
        updated_at = now();

    UPDATE aquaflow.user_roles
    SET status = 'ACTIVE',
        effective_from = current_date,
        effective_to = NULL
    WHERE user_id = v_user_id
      AND role_id = v_role_id;

    IF NOT FOUND THEN
        INSERT INTO aquaflow.user_roles
            (user_id, role_id, assigned_at, effective_from, effective_to, status)
        VALUES
            (v_user_id, v_role_id, now(), current_date, NULL, 'ACTIVE');
    END IF;
END
$seed$;

COMMIT;

-- Verification: this should return exactly one fully ACTIVE METER_READER.
SELECT
    u.username,
    concat_ws(' ', u.first_name, u.last_name) AS display_name,
    u.status AS user_status,
    u.user_type,
    fo.employee_number,
    fo.officer_type,
    fo.availability_status,
    fo.status AS field_officer_status,
    r.role_code,
    ur.status AS role_status,
    z.zone_code AS home_zone
FROM aquaflow.users u
JOIN aquaflow.field_officers fo ON fo.user_id = u.user_id
JOIN aquaflow.user_roles ur ON ur.user_id = u.user_id
JOIN aquaflow.roles r ON r.role_id = ur.role_id
LEFT JOIN aquaflow.zones z ON z.zone_id = fo.home_zone_id
WHERE u.username = 'playfield01'
  AND r.role_code = 'METER_READER';

-- Complete Google Play Store test-user list (15 customers + 1 Field Officer).
-- All accounts use the password corresponding to PASTE_BCRYPT_HASH_HERE.
SELECT
    u.username AS login_identifier,
    concat_ws(' ', u.first_name, u.last_name) AS display_name,
    u.user_type,
    CASE
        WHEN u.user_type = 'CUSTOMER' THEN 'CUSTOMER'
        ELSE coalesce(string_agg(DISTINCT r.role_code, ', '), 'NO ACTIVE ROLE')
    END AS login_role,
    u.status AS user_status,
    c.customer_number,
    c.status AS customer_status,
    fo.employee_number,
    fo.status AS field_officer_status,
    fo.availability_status
FROM aquaflow.users u
LEFT JOIN aquaflow.customers c ON c.customer_id = u.customer_id
LEFT JOIN aquaflow.field_officers fo ON fo.user_id = u.user_id
LEFT JOIN aquaflow.user_roles ur
    ON ur.user_id = u.user_id
   AND ur.status = 'ACTIVE'
   AND ur.effective_from <= current_date
   AND (ur.effective_to IS NULL OR ur.effective_to >= current_date)
LEFT JOIN aquaflow.roles r
    ON r.role_id = ur.role_id
   AND r.status = 'ACTIVE'
WHERE u.username ~ '^playtest(0[1-9]|1[0-5])$'
   OR u.username = 'playfield01'
GROUP BY
    u.username,
    u.first_name,
    u.last_name,
    u.user_type,
    u.status,
    c.customer_number,
    c.status,
    fo.employee_number,
    fo.status,
    fo.availability_status
ORDER BY u.username;
