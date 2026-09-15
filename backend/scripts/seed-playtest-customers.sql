-- Samdamte Google Play test users:
--   Customers: playtest01 through playtest15
--   Field officer: playfield01 (employee number PLAY-FIELD-01)
-- Idempotent: reserved PLAYTEST records are inserted or updated.
-- This script never stores a plaintext password. Generate one bcrypt cost-12
-- hash with the application command supplied alongside this file and replace
-- PASTE_BCRYPT_HASH_HERE below before executing in DBeaver.

BEGIN;

-- Imported/restored databases can have sequences behind their table IDs.
-- Advance (never lower) every sequence used by this script before inserting.
SELECT setval(
    pg_get_serial_sequence('aquaflow.zones', 'zone_id')::regclass,
    GREATEST(
        coalesce((SELECT max(zone_id) FROM aquaflow.zones), 0),
        nextval(pg_get_serial_sequence('aquaflow.zones', 'zone_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.service_areas', 'service_area_id')::regclass,
    GREATEST(
        coalesce((SELECT max(service_area_id) FROM aquaflow.service_areas), 0),
        nextval(pg_get_serial_sequence('aquaflow.service_areas', 'service_area_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.routes', 'route_id')::regclass,
    GREATEST(
        coalesce((SELECT max(route_id) FROM aquaflow.routes), 0),
        nextval(pg_get_serial_sequence('aquaflow.routes', 'route_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.customer_categories', 'category_id')::regclass,
    GREATEST(
        coalesce((SELECT max(category_id) FROM aquaflow.customer_categories), 0),
        nextval(pg_get_serial_sequence('aquaflow.customer_categories', 'category_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.customers', 'customer_id')::regclass,
    GREATEST(
        coalesce((SELECT max(customer_id) FROM aquaflow.customers), 0),
        nextval(pg_get_serial_sequence('aquaflow.customers', 'customer_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.properties', 'property_id')::regclass,
    GREATEST(
        coalesce((SELECT max(property_id) FROM aquaflow.properties), 0),
        nextval(pg_get_serial_sequence('aquaflow.properties', 'property_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.customer_accounts', 'account_id')::regclass,
    GREATEST(
        coalesce((SELECT max(account_id) FROM aquaflow.customer_accounts), 0),
        nextval(pg_get_serial_sequence('aquaflow.customer_accounts', 'account_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.users', 'user_id')::regclass,
    GREATEST(
        coalesce((SELECT max(user_id) FROM aquaflow.users), 0),
        nextval(pg_get_serial_sequence('aquaflow.users', 'user_id')::regclass)
    ),
    true
);
SELECT setval(
    pg_get_serial_sequence('aquaflow.customer_account_access', 'access_id')::regclass,
    GREATEST(
        coalesce((SELECT max(access_id) FROM aquaflow.customer_account_access), 0),
        nextval(pg_get_serial_sequence('aquaflow.customer_account_access', 'access_id')::regclass)
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
    v_zone_id bigint;
    v_area_id bigint;
    v_route_id bigint;
    v_category_id bigint;
    v_customer_id bigint;
    v_property_id bigint;
    v_account_id bigint;
    v_user_id bigint;
    v_field_officer_id bigint;
    v_role_id bigint;
    v_i integer;
    v_suffix text;
    v_username text;
    v_customer_number text;
    v_email text;
    v_phone text;
    v_account_number text;
BEGIN
    IF v_password_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN
        RAISE EXCEPTION 'Replace PASTE_BCRYPT_HASH_HERE with a bcrypt cost-12 hash before running this script';
    END IF;

    INSERT INTO aquaflow.zones
        (zone_code, zone_name, description, status, created_at, updated_at)
    VALUES
        ('PLAYTEST', 'Play Store Test Zone', 'Reserved for Google Play closed-test accounts', 'ACTIVE', now(), now())
    ON CONFLICT (zone_code) DO UPDATE SET
        zone_name = EXCLUDED.zone_name,
        description = EXCLUDED.description,
        status = 'ACTIVE',
        updated_at = now()
    RETURNING zone_id INTO v_zone_id;

    INSERT INTO aquaflow.service_areas
        (zone_id, area_code, area_name, area_type, description, status, created_at, updated_at)
    VALUES
        (v_zone_id, 'PLAYTEST', 'Play Store Test Area', 'OTHER', 'Reserved for Google Play closed-test accounts', 'ACTIVE', now(), now())
    ON CONFLICT (area_code) DO UPDATE SET
        zone_id = EXCLUDED.zone_id,
        area_name = EXCLUDED.area_name,
        area_type = EXCLUDED.area_type,
        description = EXCLUDED.description,
        status = 'ACTIVE',
        updated_at = now()
    RETURNING service_area_id INTO v_area_id;

    INSERT INTO aquaflow.routes
        (zone_id, route_code, route_name, sequence_number, estimated_customers, status, created_at, updated_at)
    VALUES
        (v_zone_id, 'PLAYTEST', 'Play Store Test Route', 9999, 15, 'ACTIVE', now(), now())
    ON CONFLICT (route_code) DO UPDATE SET
        zone_id = EXCLUDED.zone_id,
        route_name = EXCLUDED.route_name,
        sequence_number = EXCLUDED.sequence_number,
        estimated_customers = EXCLUDED.estimated_customers,
        status = 'ACTIVE',
        updated_at = now()
    RETURNING route_id INTO v_route_id;

    INSERT INTO aquaflow.customer_categories
        (category_code, category_name, description, status, created_at, updated_at)
    VALUES
        ('PLAYTEST', 'Play Store Test Customers', 'Non-production customer category for Google Play testing', 'ACTIVE', now(), now())
    ON CONFLICT (category_code) DO UPDATE SET
        category_name = EXCLUDED.category_name,
        description = EXCLUDED.description,
        status = 'ACTIVE',
        updated_at = now()
    RETURNING category_id INTO v_category_id;

    FOR v_i IN 1..15 LOOP
        v_suffix := lpad(v_i::text, 2, '0');
        v_username := 'playtest' || v_suffix;
        v_customer_number := 'PLAYTEST' || v_suffix;
        v_email := v_username || '@example.invalid';
        v_phone := '+25470099' || lpad(v_i::text, 4, '0');
        v_account_number := 'PLAYTEST-ACC-' || v_suffix;

        IF EXISTS (
            SELECT 1 FROM aquaflow.users
            WHERE username = v_username
              AND email_address NOT LIKE '%@example.invalid'
        ) THEN
            RAISE EXCEPTION 'Refusing to modify non-test user %', v_username;
        END IF;
        IF EXISTS (
            SELECT 1 FROM aquaflow.customers
            WHERE customer_number = v_customer_number
              AND coalesce(email_address, '') NOT LIKE '%@example.invalid'
        ) THEN
            RAISE EXCEPTION 'Refusing to modify non-test customer %', v_customer_number;
        END IF;
        IF EXISTS (
            SELECT 1 FROM aquaflow.users
            WHERE (email_address = v_email OR phone_number = v_phone)
              AND username <> v_username
        ) THEN
            RAISE EXCEPTION 'Test email or phone is already assigned to another user: %', v_username;
        END IF;

        INSERT INTO aquaflow.customers
            (customer_number, customer_type, first_name, last_name, national_id,
             phone_number, email_address, preferred_language, status,
             registration_date, created_at, updated_at)
        VALUES
            (v_customer_number, 'INDIVIDUAL', 'Google Play Test', 'Customer ' || v_suffix,
             'PLAY-TEST-ID-' || v_suffix, v_phone, v_email, 'EN', 'ACTIVE',
             current_date, now(), now())
        ON CONFLICT (customer_number) DO UPDATE SET
            customer_type = 'INDIVIDUAL',
            first_name = 'Google Play Test',
            last_name = 'Customer ' || v_suffix,
            phone_number = v_phone,
            email_address = v_email,
            preferred_language = 'EN',
            status = 'ACTIVE',
            updated_at = now()
        RETURNING customer_id INTO v_customer_id;

        INSERT INTO aquaflow.properties
            (property_code, owner_customer_id, zone_id, service_area_id, route_id,
             plot_number, physical_address, occupancy_status, status, created_at, updated_at)
        VALUES
            ('PLAYTEST-PROP-' || v_suffix, v_customer_id, v_zone_id, v_area_id,
             v_route_id, 'TEST-' || v_suffix, 'Play Store Test Address ' || v_suffix,
             'OWNER_OCCUPIED', 'ACTIVE', now(), now())
        ON CONFLICT (property_code) DO UPDATE SET
            owner_customer_id = v_customer_id,
            zone_id = v_zone_id,
            service_area_id = v_area_id,
            route_id = v_route_id,
            plot_number = 'TEST-' || v_suffix,
            physical_address = 'Play Store Test Address ' || v_suffix,
            occupancy_status = 'OWNER_OCCUPIED',
            status = 'ACTIVE',
            updated_at = now()
        RETURNING property_id INTO v_property_id;

        INSERT INTO aquaflow.customer_accounts
            (account_number, customer_id, property_id, category_id, route_id,
             opening_balance, current_balance, connection_date, account_status,
             created_at, updated_at)
        VALUES
            (v_account_number, v_customer_id, v_property_id, v_category_id,
             v_route_id, 0, 0, current_date, 'ACTIVE', now(), now())
        ON CONFLICT (account_number) DO UPDATE SET
            customer_id = v_customer_id,
            property_id = v_property_id,
            category_id = v_category_id,
            route_id = v_route_id,
            account_status = 'ACTIVE',
            updated_at = now()
        RETURNING account_id INTO v_account_id;

        INSERT INTO aquaflow.users
            (username, first_name, last_name, email_address, phone_number,
             password_hash, user_type, customer_id, two_factor_enabled, status,
             created_at, updated_at)
        VALUES
            (v_username, 'Google Play Test', 'Customer ' || v_suffix, v_email, v_phone,
             v_password_hash, 'CUSTOMER', v_customer_id, false, 'ACTIVE', now(), now())
        ON CONFLICT (username) DO UPDATE SET
            first_name = 'Google Play Test',
            last_name = 'Customer ' || v_suffix,
            email_address = v_email,
            phone_number = v_phone,
            password_hash = v_password_hash,
            user_type = 'CUSTOMER',
            customer_id = v_customer_id,
            status = 'ACTIVE',
            updated_at = now()
        RETURNING user_id INTO v_user_id;

        INSERT INTO aquaflow.customer_account_access
            (user_id, account_id, access_role, status, verified_at, is_default,
             created_at, updated_at)
        VALUES
            (v_user_id, v_account_id, 'OWNER', 'ACTIVE', now(), true, now(), now())
        ON CONFLICT (user_id, account_id) DO UPDATE SET
            access_role = 'OWNER',
            status = 'ACTIVE',
            verified_at = now(),
            is_default = true,
            updated_at = now();
    END LOOP;

    -- One active Field Officer account for Google Play testing. It uses the
    -- same password hash as the customer test accounts above.
    v_username := 'playfield01';
    v_email := 'playfield01@example.invalid';
    v_phone := '+254700999901';

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
        RAISE EXCEPTION 'Field Officer test email or phone is assigned to another user';
    END IF;
    IF EXISTS (
        SELECT 1 FROM aquaflow.field_officers fo
        JOIN aquaflow.users u ON u.user_id = fo.user_id
        WHERE fo.employee_number = 'PLAY-FIELD-01'
          AND u.username <> v_username
    ) THEN
        RAISE EXCEPTION 'Employee number PLAY-FIELD-01 is assigned to another user';
    END IF;

    SELECT role_id INTO v_role_id
    FROM aquaflow.roles
    WHERE role_code = 'METER_READER'
      AND status = 'ACTIVE';

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Active METER_READER role is missing. Run the application reference-data seed first';
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
        (v_user_id, 'PLAY-FIELD-01', 'METER_READER', v_phone, v_zone_id,
         'AVAILABLE', 'ACTIVE', now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
        employee_number = 'PLAY-FIELD-01',
        officer_type = 'METER_READER',
        phone_number = v_phone,
        home_zone_id = v_zone_id,
        availability_status = 'AVAILABLE',
        status = 'ACTIVE',
        updated_at = now()
    RETURNING field_officer_id INTO v_field_officer_id;

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

-- Verification: all rows should be ACTIVE and linked to one active account.
SELECT
    u.username,
    u.status AS user_status,
    u.user_type,
    c.customer_number,
    c.status AS customer_status,
    ca.account_number,
    ca.account_status,
    caa.status AS access_status
FROM aquaflow.users u
JOIN aquaflow.customers c ON c.customer_id = u.customer_id
JOIN aquaflow.customer_account_access caa ON caa.user_id = u.user_id
JOIN aquaflow.customer_accounts ca ON ca.account_id = caa.account_id
WHERE u.username ~ '^playtest(0[1-9]|1[0-5])$'
ORDER BY u.username;

-- Field Officer verification: this should return one ACTIVE METER_READER.
SELECT
    u.username,
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
