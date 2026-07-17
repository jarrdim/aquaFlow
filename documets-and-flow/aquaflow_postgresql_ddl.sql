
-- AquaFlow Water Distribution, Billing and Field Management System
-- PostgreSQL DDL
-- Generated from the approved functional specification and data dictionary.

BEGIN;

CREATE SCHEMA IF NOT EXISTS aquaflow;
SET search_path TO aquaflow, public;

-- =========================================================
-- Utility functions
-- =========================================================

CREATE OR REPLACE FUNCTION aquaflow.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- =========================================================
-- A. LOCATION AND DISTRIBUTION
-- =========================================================

CREATE TABLE zones (
    zone_id BIGSERIAL PRIMARY KEY,
    zone_code VARCHAR(30) NOT NULL UNIQUE,
    zone_name VARCHAR(150) NOT NULL,
    description TEXT,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_zones_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_zones_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_zones_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE service_areas (
    service_area_id BIGSERIAL PRIMARY KEY,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    area_code VARCHAR(30) NOT NULL UNIQUE,
    area_name VARCHAR(150) NOT NULL,
    area_type VARCHAR(30) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_service_area_type CHECK (area_type IN ('ESTATE','VILLAGE','MARKET','INDUSTRIAL','OTHER')),
    CONSTRAINT ck_service_area_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE routes (
    route_id BIGSERIAL PRIMARY KEY,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    route_code VARCHAR(30) NOT NULL UNIQUE,
    route_name VARCHAR(150) NOT NULL,
    sequence_number INTEGER,
    estimated_customers INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_routes_sequence CHECK (sequence_number IS NULL OR sequence_number > 0),
    CONSTRAINT ck_routes_estimated_customers CHECK (estimated_customers IS NULL OR estimated_customers >= 0),
    CONSTRAINT ck_routes_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE distribution_assets (
    asset_id BIGSERIAL PRIMARY KEY,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    asset_code VARCHAR(40) NOT NULL UNIQUE,
    asset_type VARCHAR(30) NOT NULL,
    asset_name VARCHAR(150) NOT NULL,
    capacity_litres NUMERIC(18,3),
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    installation_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_distribution_asset_type CHECK (asset_type IN ('TANK','RESERVOIR','PIPELINE','VALVE','PRESSURE_POINT')),
    CONSTRAINT ck_distribution_asset_capacity CHECK (capacity_litres IS NULL OR capacity_litres >= 0),
    CONSTRAINT ck_distribution_asset_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_distribution_asset_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_distribution_asset_status CHECK (status IN ('ACTIVE','INACTIVE','FAULTY','MAINTENANCE','RETIRED'))
);

-- =========================================================
-- B. CUSTOMER AND PROPERTY
-- =========================================================

CREATE TABLE customer_categories (
    category_id BIGSERIAL PRIMARY KEY,
    category_code VARCHAR(20) NOT NULL UNIQUE,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_customer_category_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE customers (
    customer_id BIGSERIAL PRIMARY KEY,
    customer_number VARCHAR(30) NOT NULL UNIQUE,
    customer_type VARCHAR(20) NOT NULL,
    first_name VARCHAR(100),
    middle_name VARCHAR(100),
    last_name VARCHAR(100),
    organization_name VARCHAR(200),
    national_id VARCHAR(50) UNIQUE,
    registration_number VARCHAR(80) UNIQUE,
    phone_number VARCHAR(30) NOT NULL,
    alternative_phone VARCHAR(30),
    email_address VARCHAR(254),
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'EN',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_customer_type CHECK (customer_type IN ('INDIVIDUAL','ORGANIZATION')),
    CONSTRAINT ck_customer_language CHECK (preferred_language IN ('EN','SW')),
    CONSTRAINT ck_customer_status CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED','CLOSED')),
    CONSTRAINT ck_customer_identity CHECK (
        (customer_type = 'INDIVIDUAL' AND first_name IS NOT NULL AND last_name IS NOT NULL)
        OR
        (customer_type = 'ORGANIZATION' AND organization_name IS NOT NULL)
    )
);

CREATE TABLE properties (
    property_id BIGSERIAL PRIMARY KEY,
    property_code VARCHAR(30) NOT NULL UNIQUE,
    owner_customer_id BIGINT REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    service_area_id BIGINT REFERENCES service_areas(service_area_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    route_id BIGINT REFERENCES routes(route_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    plot_number VARCHAR(100),
    building_name VARCHAR(150),
    physical_address TEXT NOT NULL,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    occupancy_status VARCHAR(30) NOT NULL DEFAULT 'OWNER_OCCUPIED',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_property_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_property_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_property_occupancy_status CHECK (occupancy_status IN ('OWNER_OCCUPIED','TENANTED','VACANT')),
    CONSTRAINT ck_property_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE property_occupancies (
    occupancy_id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES properties(property_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    occupancy_role VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_occupancy_role CHECK (occupancy_role IN ('OWNER','TENANT','CARETAKER')),
    CONSTRAINT ck_occupancy_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX uq_current_tenant_per_property
ON property_occupancies(property_id)
WHERE is_current = TRUE AND occupancy_role = 'TENANT';

CREATE TABLE customer_documents (
    document_id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    document_type VARCHAR(40) NOT NULL,
    document_number VARCHAR(100),
    file_path TEXT NOT NULL,
    issue_date DATE,
    expiry_date DATE,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    verified_by BIGINT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_customer_document_status CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
    CONSTRAINT ck_customer_document_dates CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

CREATE TABLE customer_accounts (
    account_id BIGSERIAL PRIMARY KEY,
    account_number VARCHAR(30) NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    property_id BIGINT NOT NULL REFERENCES properties(property_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    category_id BIGINT NOT NULL REFERENCES customer_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    route_id BIGINT REFERENCES routes(route_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    current_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    connection_date DATE,
    account_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    closure_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_customer_account_status CHECK (account_status IN ('PENDING','ACTIVE','SUSPENDED','DISCONNECTED','CLOSED')),
    CONSTRAINT ck_customer_account_dates CHECK (closure_date IS NULL OR connection_date IS NULL OR closure_date >= connection_date)
);

-- =========================================================
-- N. SECURITY BASE TABLES
-- Created early because many operational tables reference users
-- =========================================================

CREATE TABLE users (
    user_id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email_address VARCHAR(254) NOT NULL UNIQUE,
    phone_number VARCHAR(30) UNIQUE,
    password_hash TEXT NOT NULL,
    user_type VARCHAR(20) NOT NULL,
    customer_id BIGINT REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_user_type CHECK (user_type IN ('STAFF','CUSTOMER','SYSTEM')),
    CONSTRAINT ck_user_status CHECK (status IN ('PENDING','ACTIVE','LOCKED','DISABLED')),
    CONSTRAINT ck_user_customer_link CHECK (
        (user_type = 'CUSTOMER' AND customer_id IS NOT NULL)
        OR
        (user_type IN ('STAFF','SYSTEM'))
    )
);

ALTER TABLE customers
ADD CONSTRAINT fk_customers_created_by
FOREIGN KEY (created_by) REFERENCES users(user_id)
ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE customer_documents
ADD CONSTRAINT fk_customer_documents_verified_by
FOREIGN KEY (verified_by) REFERENCES users(user_id)
ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE roles (
    role_id BIGSERIAL PRIMARY KEY,
    role_code VARCHAR(60) NOT NULL UNIQUE,
    role_name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_roles_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE permissions (
    permission_id BIGSERIAL PRIMARY KEY,
    permission_code VARCHAR(80) NOT NULL UNIQUE,
    module_name VARCHAR(100) NOT NULL,
    permission_name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_roles (
    user_role_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    role_id BIGINT NOT NULL REFERENCES roles(role_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    assigned_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT ck_user_roles_status CHECK (status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_user_roles_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX uq_active_user_role
ON user_roles(user_id, role_id)
WHERE status = 'ACTIVE';

CREATE TABLE role_permissions (
    role_permission_id BIGSERIAL PRIMARY KEY,
    role_id BIGINT NOT NULL REFERENCES roles(role_id) ON UPDATE CASCADE ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(permission_id) ON UPDATE CASCADE ON DELETE CASCADE,
    granted_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

-- =========================================================
-- C. NEW CONNECTION
-- =========================================================

CREATE TABLE connection_applications (
    application_id BIGSERIAL PRIMARY KEY,
    application_reference VARCHAR(40) NOT NULL UNIQUE,
    applicant_customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    property_id BIGINT NOT NULL REFERENCES properties(property_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    category_id BIGINT REFERENCES customer_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    application_date DATE NOT NULL DEFAULT CURRENT_DATE,
    connection_type VARCHAR(20) NOT NULL,
    requested_meter_size VARCHAR(30),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    rejection_reason TEXT,
    submitted_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_connection_type CHECK (connection_type IN ('NEW','ADDITIONAL','TEMPORARY','BULK')),
    CONSTRAINT ck_connection_application_status CHECK (status IN ('DRAFT','SUBMITTED','INSPECTION','QUOTED','APPROVED','REJECTED','PAID','INSTALLED')),
    CONSTRAINT ck_connection_rejection_reason CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);

CREATE TABLE field_officers (
    field_officer_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    employee_number VARCHAR(40) NOT NULL UNIQUE,
    officer_type VARCHAR(30) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    home_zone_id BIGINT REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    availability_status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_field_officer_type CHECK (officer_type IN ('METER_READER','PLUMBER','TECHNICIAN','INSPECTOR','SUPERVISOR','DEBT_COLLECTOR')),
    CONSTRAINT ck_field_availability CHECK (availability_status IN ('AVAILABLE','ASSIGNED','LEAVE','INACTIVE')),
    CONSTRAINT ck_field_officer_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE site_inspections (
    inspection_id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES connection_applications(application_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    inspector_id BIGINT NOT NULL REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    inspection_date TIMESTAMPTZ NOT NULL,
    findings TEXT NOT NULL,
    recommendation VARCHAR(20) NOT NULL,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    customer_signature_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED',
    verified_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_site_inspection_recommendation CHECK (recommendation IN ('APPROVE','REJECT','REINSPECT')),
    CONSTRAINT ck_site_inspection_status CHECK (status IN ('ASSIGNED','COMPLETED','VERIFIED')),
    CONSTRAINT ck_site_inspection_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_site_inspection_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180)
);

CREATE TABLE connection_quotations (
    quotation_id BIGSERIAL PRIMARY KEY,
    application_id BIGINT NOT NULL REFERENCES connection_applications(application_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    quotation_number VARCHAR(40) NOT NULL UNIQUE,
    material_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    labour_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    application_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
    connection_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    issue_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    approved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_quotation_nonnegative CHECK (
        material_amount >= 0 AND labour_amount >= 0 AND application_fee >= 0
        AND connection_fee >= 0 AND total_amount >= 0
    ),
    CONSTRAINT ck_quotation_dates CHECK (expiry_date >= issue_date),
    CONSTRAINT ck_quotation_status CHECK (status IN ('DRAFT','ISSUED','ACCEPTED','PAID','EXPIRED','CANCELLED'))
);

CREATE TABLE quotation_items (
    quotation_item_id BIGSERIAL PRIMARY KEY,
    quotation_id BIGINT NOT NULL REFERENCES connection_quotations(quotation_id) ON UPDATE CASCADE ON DELETE CASCADE,
    item_type VARCHAR(20) NOT NULL,
    item_description TEXT NOT NULL,
    quantity NUMERIC(18,3) NOT NULL,
    unit_of_measure VARCHAR(30) NOT NULL,
    unit_price NUMERIC(18,2) NOT NULL,
    total_price NUMERIC(18,2) NOT NULL,
    CONSTRAINT ck_quotation_item_type CHECK (item_type IN ('MATERIAL','LABOUR','FEE')),
    CONSTRAINT ck_quotation_item_values CHECK (quantity > 0 AND unit_price >= 0 AND total_price >= 0)
);

-- =========================================================
-- D. METERS AND READINGS
-- =========================================================

CREATE TABLE boreholes (
    borehole_id BIGSERIAL PRIMARY KEY,
    borehole_code VARCHAR(40) NOT NULL UNIQUE,
    borehole_name VARCHAR(150) NOT NULL,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    gps_latitude NUMERIC(10,7) NOT NULL,
    gps_longitude NUMERIC(10,7) NOT NULL,
    depth_metres NUMERIC(10,2),
    rated_capacity_m3_hour NUMERIC(18,3),
    commissioning_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_borehole_lat CHECK (gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_borehole_lng CHECK (gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_borehole_depth CHECK (depth_metres IS NULL OR depth_metres >= 0),
    CONSTRAINT ck_borehole_capacity CHECK (rated_capacity_m3_hour IS NULL OR rated_capacity_m3_hour >= 0),
    CONSTRAINT ck_borehole_status CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE','DECOMMISSIONED'))
);

CREATE TABLE meters (
    meter_id BIGSERIAL PRIMARY KEY,
    meter_number VARCHAR(60) NOT NULL UNIQUE,
    meter_type VARCHAR(20) NOT NULL,
    technology VARCHAR(20) NOT NULL,
    brand VARCHAR(100),
    model VARCHAR(100),
    meter_size_mm NUMERIC(10,2) NOT NULL,
    serial_number VARCHAR(100) UNIQUE,
    installation_date DATE,
    opening_reading NUMERIC(18,3) NOT NULL DEFAULT 0,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    seal_number VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'IN_STOCK',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_meter_type CHECK (meter_type IN ('CUSTOMER','BULK','ZONE','BOREHOLE')),
    CONSTRAINT ck_meter_technology CHECK (technology IN ('MANUAL','PREPAID','SMART')),
    CONSTRAINT ck_meter_size CHECK (meter_size_mm > 0),
    CONSTRAINT ck_meter_opening CHECK (opening_reading >= 0),
    CONSTRAINT ck_meter_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_meter_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_meter_status CHECK (status IN ('IN_STOCK','ACTIVE','FAULTY','REMOVED','REPLACED','DISCONNECTED','TAMPERED'))
);

CREATE TABLE meter_assignments (
    assignment_id BIGSERIAL PRIMARY KEY,
    meter_id BIGINT NOT NULL REFERENCES meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    zone_id BIGINT REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    borehole_id BIGINT REFERENCES boreholes(borehole_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    asset_id BIGINT REFERENCES distribution_assets(asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    assignment_date DATE NOT NULL,
    removal_date DATE,
    assignment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_meter_assignment_target CHECK (
        ((account_id IS NOT NULL)::int +
         (zone_id IS NOT NULL)::int +
         (borehole_id IS NOT NULL)::int +
         (asset_id IS NOT NULL)::int) = 1
    ),
    CONSTRAINT ck_meter_assignment_dates CHECK (removal_date IS NULL OR removal_date >= assignment_date),
    CONSTRAINT ck_meter_assignment_status CHECK (assignment_status IN ('ACTIVE','ENDED'))
);

CREATE UNIQUE INDEX uq_active_meter_assignment
ON meter_assignments(meter_id)
WHERE assignment_status = 'ACTIVE';

CREATE UNIQUE INDEX uq_active_account_meter
ON meter_assignments(account_id)
WHERE assignment_status = 'ACTIVE' AND account_id IS NOT NULL;

CREATE TABLE billing_cycles (
    billing_cycle_id BIGSERIAL PRIMARY KEY,
    cycle_code VARCHAR(30) NOT NULL UNIQUE,
    cycle_name VARCHAR(150) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    frequency VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    posted_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_billing_cycle_dates CHECK (period_end >= period_start AND due_date >= period_end),
    CONSTRAINT ck_billing_cycle_frequency CHECK (frequency IN ('WEEKLY','MONTHLY','CUSTOM')),
    CONSTRAINT ck_billing_cycle_status CHECK (status IN ('DRAFT','PROCESSING','POSTED','CLOSED'))
);

CREATE TABLE reading_cycles (
    reading_cycle_id BIGSERIAL PRIMARY KEY,
    cycle_code VARCHAR(30) NOT NULL UNIQUE,
    cycle_name VARCHAR(150) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    billing_cycle_id BIGINT REFERENCES billing_cycles(billing_cycle_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_reading_cycle_dates CHECK (end_date >= start_date),
    CONSTRAINT ck_reading_cycle_status CHECK (status IN ('PLANNED','OPEN','CLOSED','CANCELLED'))
);

CREATE TABLE route_assignments (
    route_assignment_id BIGSERIAL PRIMARY KEY,
    reading_cycle_id BIGINT NOT NULL REFERENCES reading_cycles(reading_cycle_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    route_id BIGINT NOT NULL REFERENCES routes(route_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    field_officer_id BIGINT NOT NULL REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_route_assignment_status CHECK (status IN ('ASSIGNED','ACCEPTED','COMPLETED','REASSIGNED')),
    CONSTRAINT uq_route_assignment UNIQUE (reading_cycle_id, route_id, field_officer_id)
);

CREATE TABLE meter_readings (
    reading_id BIGSERIAL PRIMARY KEY,
    meter_id BIGINT NOT NULL REFERENCES meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    reading_cycle_id BIGINT NOT NULL REFERENCES reading_cycles(reading_cycle_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    field_officer_id BIGINT REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE SET NULL,
    previous_reading NUMERIC(18,3) NOT NULL,
    current_reading NUMERIC(18,3) NOT NULL,
    consumption NUMERIC(18,3) GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
    reading_type VARCHAR(20) NOT NULL,
    estimation_reason TEXT,
    reading_date TIMESTAMPTZ NOT NULL,
    photo_path TEXT,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    abnormal_flag BOOLEAN NOT NULL DEFAULT FALSE,
    exception_type VARCHAR(20) NOT NULL DEFAULT 'NONE',
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_meter_reading_values CHECK (previous_reading >= 0 AND current_reading >= 0),
    CONSTRAINT ck_meter_reading_type CHECK (reading_type IN ('ACTUAL','ESTIMATED','SMART')),
    CONSTRAINT ck_meter_reading_estimation CHECK (reading_type <> 'ESTIMATED' OR estimation_reason IS NOT NULL),
    CONSTRAINT ck_meter_reading_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_meter_reading_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_meter_reading_exception CHECK (exception_type IN ('ZERO','NEGATIVE','HIGH','LOW','TAMPERED','NONE')),
    CONSTRAINT ck_meter_reading_approval CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
    CONSTRAINT uq_meter_cycle_reading UNIQUE (meter_id, reading_cycle_id)
);

-- =========================================================
-- E. TARIFF AND BILLING
-- =========================================================

CREATE TABLE tariffs (
    tariff_id BIGSERIAL PRIMARY KEY,
    tariff_code VARCHAR(40) NOT NULL UNIQUE,
    tariff_name VARCHAR(150) NOT NULL,
    category_id BIGINT NOT NULL REFERENCES customer_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    billing_method VARCHAR(20) NOT NULL,
    minimum_charge NUMERIC(18,2) NOT NULL DEFAULT 0,
    standing_charge NUMERIC(18,2) NOT NULL DEFAULT 0,
    meter_rent NUMERIC(18,2) NOT NULL DEFAULT 0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    approved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_tariff_method CHECK (billing_method IN ('CONSUMPTION','FLAT','TIERED','BULK')),
    CONSTRAINT ck_tariff_amounts CHECK (minimum_charge >= 0 AND standing_charge >= 0 AND meter_rent >= 0),
    CONSTRAINT ck_tariff_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_tariff_status CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','EXPIRED'))
);

CREATE TABLE tariff_bands (
    tariff_band_id BIGSERIAL PRIMARY KEY,
    tariff_id BIGINT NOT NULL REFERENCES tariffs(tariff_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    band_sequence INTEGER NOT NULL,
    lower_limit NUMERIC(18,3) NOT NULL,
    upper_limit NUMERIC(18,3),
    rate_per_unit NUMERIC(18,4) NOT NULL,
    CONSTRAINT ck_tariff_band_sequence CHECK (band_sequence > 0),
    CONSTRAINT ck_tariff_band_limits CHECK (lower_limit >= 0 AND (upper_limit IS NULL OR upper_limit >= lower_limit)),
    CONSTRAINT ck_tariff_band_rate CHECK (rate_per_unit >= 0),
    CONSTRAINT uq_tariff_band_sequence UNIQUE (tariff_id, band_sequence)
);

CREATE TABLE bills (
    bill_id BIGSERIAL PRIMARY KEY,
    bill_number VARCHAR(40) NOT NULL UNIQUE,
    account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    billing_cycle_id BIGINT NOT NULL REFERENCES billing_cycles(billing_cycle_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    tariff_id BIGINT NOT NULL REFERENCES tariffs(tariff_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    reading_id BIGINT REFERENCES meter_readings(reading_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    previous_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    consumption_units NUMERIC(18,3) NOT NULL DEFAULT 0,
    consumption_charge NUMERIC(18,2) NOT NULL DEFAULT 0,
    fixed_charges NUMERIC(18,2) NOT NULL DEFAULT 0,
    penalties NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_current_charges NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_amount_due NUMERIC(18,2) NOT NULL DEFAULT 0,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_bill_amounts CHECK (
        consumption_units >= 0 AND consumption_charge >= 0 AND fixed_charges >= 0
        AND penalties >= 0 AND total_current_charges >= 0
    ),
    CONSTRAINT ck_bill_dates CHECK (due_date >= issue_date),
    CONSTRAINT ck_bill_status CHECK (status IN ('DRAFT','POSTED','PARTIALLY_PAID','PAID','CANCELLED')),
    CONSTRAINT uq_account_billing_cycle UNIQUE (account_id, billing_cycle_id)
);

CREATE TABLE bill_items (
    bill_item_id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(bill_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    charge_type VARCHAR(40) NOT NULL,
    description TEXT NOT NULL,
    quantity NUMERIC(18,3) NOT NULL DEFAULT 1,
    unit_rate NUMERIC(18,4) NOT NULL DEFAULT 0,
    amount NUMERIC(18,2) NOT NULL,
    tariff_band_id BIGINT REFERENCES tariff_bands(tariff_band_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_bill_item_values CHECK (quantity >= 0 AND unit_rate >= 0)
);

CREATE TABLE billing_adjustments (
    adjustment_id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(bill_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    adjustment_number VARCHAR(40) NOT NULL UNIQUE,
    adjustment_type VARCHAR(30) NOT NULL,
    reason TEXT NOT NULL,
    amount NUMERIC(18,2) NOT NULL,
    requested_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    approved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_billing_adjustment_type CHECK (adjustment_type IN ('CREDIT_NOTE','DEBIT_NOTE','CORRECTION','CANCELLATION')),
    CONSTRAINT ck_billing_adjustment_amount CHECK (amount > 0),
    CONSTRAINT ck_billing_adjustment_status CHECK (status IN ('PENDING','APPROVED','REJECTED','POSTED')),
    CONSTRAINT ck_billing_adjustment_maker_checker CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

-- =========================================================
-- F. PAYMENTS AND REVENUE
-- =========================================================

CREATE TABLE payment_channels (
    channel_id BIGSERIAL PRIMARY KEY,
    channel_code VARCHAR(30) NOT NULL UNIQUE,
    channel_name VARCHAR(100) NOT NULL UNIQUE,
    requires_reference BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT ck_payment_channel_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE payments (
    payment_id BIGSERIAL PRIMARY KEY,
    transaction_reference VARCHAR(100) NOT NULL UNIQUE,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    channel_id BIGINT NOT NULL REFERENCES payment_channels(channel_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    payer_name VARCHAR(200),
    payer_phone VARCHAR(30),
    amount NUMERIC(18,2) NOT NULL,
    payment_date TIMESTAMPTZ NOT NULL,
    value_date DATE NOT NULL,
    customer_reference VARCHAR(100),
    matching_status VARCHAR(30) NOT NULL DEFAULT 'UNMATCHED',
    payment_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    received_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_payment_amount CHECK (amount > 0),
    CONSTRAINT ck_payment_matching_status CHECK (matching_status IN ('MATCHED','UNMATCHED','PARTIALLY_MATCHED','SUSPENSE')),
    CONSTRAINT ck_payment_status CHECK (payment_status IN ('RECEIVED','POSTED','REVERSED'))
);

CREATE TABLE payment_allocations (
    allocation_id BIGSERIAL PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(payment_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    bill_id BIGINT NOT NULL REFERENCES bills(bill_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    allocated_amount NUMERIC(18,2) NOT NULL,
    allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    allocated_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_payment_allocation_amount CHECK (allocated_amount > 0),
    CONSTRAINT uq_payment_bill_allocation UNIQUE (payment_id, bill_id)
);

CREATE TABLE suspense_payments (
    suspense_id BIGSERIAL PRIMARY KEY,
    payment_id BIGINT NOT NULL UNIQUE REFERENCES payments(payment_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    suspense_reason TEXT NOT NULL,
    received_reference VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    resolved_account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    resolved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    resolution_date DATE,
    CONSTRAINT ck_suspense_payment_status CHECK (status IN ('OPEN','ASSIGNED','RESOLVED','REFUNDED'))
);

CREATE TABLE payment_reversals (
    reversal_id BIGSERIAL PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(payment_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    reversal_reference VARCHAR(50) NOT NULL UNIQUE,
    reversal_reason TEXT NOT NULL,
    reversal_amount NUMERIC(18,2) NOT NULL,
    requested_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    approved_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    reversal_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_payment_reversal_amount CHECK (reversal_amount > 0),
    CONSTRAINT ck_payment_reversal_status CHECK (status IN ('PENDING','APPROVED','REJECTED','POSTED')),
    CONSTRAINT ck_payment_reversal_maker_checker CHECK (approved_by <> requested_by)
);

CREATE TABLE receipts (
    receipt_id BIGSERIAL PRIMARY KEY,
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    payment_id BIGINT NOT NULL UNIQUE REFERENCES payments(payment_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    amount NUMERIC(18,2) NOT NULL,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    issued_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'GENERATED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_receipt_amount CHECK (amount > 0),
    CONSTRAINT ck_receipt_delivery_status CHECK (delivery_status IN ('GENERATED','SENT','FAILED'))
);

-- =========================================================
-- G. ARREARS AND DEBT
-- =========================================================

CREATE TABLE payment_plans (
    payment_plan_id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    total_debt NUMERIC(18,2) NOT NULL,
    deposit_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    installment_amount NUMERIC(18,2) NOT NULL,
    number_of_installments INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
    approved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_payment_plan_amounts CHECK (total_debt > 0 AND deposit_amount >= 0 AND installment_amount > 0),
    CONSTRAINT ck_payment_plan_installments CHECK (number_of_installments > 0),
    CONSTRAINT ck_payment_plan_dates CHECK (end_date >= start_date),
    CONSTRAINT ck_payment_plan_status CHECK (status IN ('PROPOSED','APPROVED','ACTIVE','COMPLETED','DEFAULTED','CANCELLED'))
);

CREATE TABLE payment_plan_installments (
    installment_id BIGSERIAL PRIMARY KEY,
    payment_plan_id BIGINT NOT NULL REFERENCES payment_plans(payment_plan_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    installment_number INTEGER NOT NULL,
    due_date DATE NOT NULL,
    amount_due NUMERIC(18,2) NOT NULL,
    amount_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT ck_plan_installment_number CHECK (installment_number > 0),
    CONSTRAINT ck_plan_installment_amounts CHECK (amount_due > 0 AND amount_paid >= 0),
    CONSTRAINT ck_plan_installment_status CHECK (status IN ('PENDING','PARTIALLY_PAID','PAID','OVERDUE')),
    CONSTRAINT uq_plan_installment UNIQUE (payment_plan_id, installment_number)
);

CREATE TABLE promises_to_pay (
    promise_id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    promised_amount NUMERIC(18,2) NOT NULL,
    promise_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_payment_date DATE NOT NULL,
    recorded_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    CONSTRAINT ck_promise_amount CHECK (promised_amount > 0),
    CONSTRAINT ck_promise_dates CHECK (expected_payment_date >= promise_date),
    CONSTRAINT ck_promise_status CHECK (status IN ('OPEN','KEPT','BROKEN','CANCELLED'))
);

CREATE TABLE debt_notices (
    notice_id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    notice_type VARCHAR(30) NOT NULL,
    notice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    outstanding_amount NUMERIC(18,2) NOT NULL,
    delivery_channel VARCHAR(20) NOT NULL,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_debt_notice_type CHECK (notice_type IN ('REMINDER','DEMAND','FINAL_DEMAND','DISCONNECTION_NOTICE')),
    CONSTRAINT ck_debt_notice_amount CHECK (outstanding_amount >= 0),
    CONSTRAINT ck_debt_notice_channel CHECK (delivery_channel IN ('SMS','EMAIL','APP','PRINT')),
    CONSTRAINT ck_debt_notice_status CHECK (delivery_status IN ('PENDING','SENT','DELIVERED','FAILED'))
);

-- =========================================================
-- H. FIELD MANAGEMENT
-- =========================================================

CREATE TABLE complaint_types (
    complaint_type_id BIGSERIAL PRIMARY KEY,
    type_code VARCHAR(40) NOT NULL UNIQUE,
    type_name VARCHAR(120) NOT NULL UNIQUE,
    default_priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    target_resolution_hours INTEGER NOT NULL,
    generates_work_order BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT ck_complaint_default_priority CHECK (default_priority IN ('LOW','NORMAL','HIGH','EMERGENCY')),
    CONSTRAINT ck_complaint_resolution_hours CHECK (target_resolution_hours > 0),
    CONSTRAINT ck_complaint_type_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE complaints (
    complaint_id BIGSERIAL PRIMARY KEY,
    complaint_reference VARCHAR(50) NOT NULL UNIQUE,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    complaint_type_id BIGINT NOT NULL REFERENCES complaint_types(complaint_type_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    channel VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_to BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_complaint_channel CHECK (channel IN ('APP','WEB','PHONE','WALK_IN','SMS','FIELD')),
    CONSTRAINT ck_complaint_priority CHECK (priority IN ('LOW','NORMAL','HIGH','EMERGENCY')),
    CONSTRAINT ck_complaint_status CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','REOPENED'))
);

CREATE TABLE complaint_updates (
    complaint_update_id BIGSERIAL PRIMARY KEY,
    complaint_id BIGINT NOT NULL REFERENCES complaints(complaint_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL,
    notes TEXT NOT NULL,
    updated_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visible_to_customer BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_complaint_update_status CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED','REOPENED'))
);

CREATE TABLE work_order_types (
    work_order_type_id BIGSERIAL PRIMARY KEY,
    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
    requires_gps BOOLEAN NOT NULL DEFAULT FALSE,
    requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT ck_work_order_type_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE work_orders (
    work_order_id BIGSERIAL PRIMARY KEY,
    work_order_number VARCHAR(50) NOT NULL UNIQUE,
    work_order_type_id BIGINT NOT NULL REFERENCES work_order_types(work_order_type_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    property_id BIGINT REFERENCES properties(property_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    complaint_id BIGINT REFERENCES complaints(complaint_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    application_id BIGINT REFERENCES connection_applications(application_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    description TEXT NOT NULL,
    scheduled_date DATE,
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    created_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    verified_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_work_order_priority CHECK (priority IN ('LOW','NORMAL','HIGH','EMERGENCY')),
    CONSTRAINT ck_work_order_status CHECK (status IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','COMPLETED','VERIFIED','CLOSED','REOPENED','CANCELLED')),
    CONSTRAINT ck_work_order_dates CHECK (due_date IS NULL OR scheduled_date IS NULL OR due_date >= scheduled_date)
);

CREATE TABLE work_order_assignments (
    assignment_id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    field_officer_id BIGINT NOT NULL REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    assigned_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ,
    rejection_reason TEXT,
    assignment_status VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED',
    CONSTRAINT ck_work_order_assignment_status CHECK (assignment_status IN ('ASSIGNED','ACCEPTED','REJECTED','COMPLETED','REASSIGNED'))
);

CREATE TABLE work_order_updates (
    update_id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    field_officer_id BIGINT REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE SET NULL,
    previous_status VARCHAR(20) NOT NULL,
    new_status VARCHAR(20) NOT NULL,
    update_notes TEXT,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_work_order_update_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_work_order_update_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180)
);

CREATE TABLE work_order_evidence (
    evidence_id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    evidence_type VARCHAR(30) NOT NULL,
    file_path TEXT NOT NULL,
    description TEXT,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    captured_by BIGINT REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE SET NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT ck_work_order_evidence_type CHECK (evidence_type IN ('BEFORE_PHOTO','AFTER_PHOTO','METER_PHOTO','SIGNATURE','CHECKLIST','DOCUMENT')),
    CONSTRAINT ck_work_order_evidence_lat CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_work_order_evidence_lng CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
    CONSTRAINT ck_work_order_evidence_status CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED'))
);

-- =========================================================
-- I. BOREHOLE, PRODUCTION, WATER QUALITY
-- =========================================================

CREATE TABLE pumps (
    pump_id BIGSERIAL PRIMARY KEY,
    borehole_id BIGINT NOT NULL REFERENCES boreholes(borehole_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    pump_code VARCHAR(40) NOT NULL UNIQUE,
    brand VARCHAR(100),
    model VARCHAR(100),
    capacity_m3_hour NUMERIC(18,3),
    power_rating_kw NUMERIC(18,3),
    installation_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_pump_capacity CHECK (capacity_m3_hour IS NULL OR capacity_m3_hour >= 0),
    CONSTRAINT ck_pump_power CHECK (power_rating_kw IS NULL OR power_rating_kw >= 0),
    CONSTRAINT ck_pump_status CHECK (status IN ('ACTIVE','FAULTY','MAINTENANCE','RETIRED'))
);

CREATE TABLE production_records (
    production_record_id BIGSERIAL PRIMARY KEY,
    borehole_id BIGINT NOT NULL REFERENCES boreholes(borehole_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    pump_id BIGINT REFERENCES pumps(pump_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    production_date DATE NOT NULL,
    opening_meter_reading NUMERIC(18,3) NOT NULL,
    closing_meter_reading NUMERIC(18,3) NOT NULL,
    volume_produced_m3 NUMERIC(18,3) GENERATED ALWAYS AS (closing_meter_reading - opening_meter_reading) STORED,
    pumping_hours NUMERIC(10,2) NOT NULL,
    electricity_kwh NUMERIC(18,3),
    fuel_litres NUMERIC(18,3),
    recorded_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_production_readings CHECK (opening_meter_reading >= 0 AND closing_meter_reading >= opening_meter_reading),
    CONSTRAINT ck_production_hours CHECK (pumping_hours >= 0),
    CONSTRAINT ck_production_energy CHECK (electricity_kwh IS NULL OR electricity_kwh >= 0),
    CONSTRAINT ck_production_fuel CHECK (fuel_litres IS NULL OR fuel_litres >= 0),
    CONSTRAINT uq_borehole_production_date UNIQUE (borehole_id, production_date)
);

CREATE TABLE borehole_downtime (
    downtime_id BIGSERIAL PRIMARY KEY,
    borehole_id BIGINT NOT NULL REFERENCES boreholes(borehole_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    pump_id BIGINT REFERENCES pumps(pump_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ,
    reason TEXT NOT NULL,
    corrective_action TEXT,
    work_order_id BIGINT REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_borehole_downtime_dates CHECK (end_datetime IS NULL OR end_datetime >= start_datetime)
);

CREATE TABLE water_quality_tests (
    test_id BIGSERIAL PRIMARY KEY,
    borehole_id BIGINT NOT NULL REFERENCES boreholes(borehole_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    sample_date DATE NOT NULL,
    test_type VARCHAR(100) NOT NULL,
    ph_value NUMERIC(5,2),
    turbidity_ntu NUMERIC(10,3),
    chlorine_mg_l NUMERIC(10,3),
    laboratory_name VARCHAR(200),
    result_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    report_file_path TEXT,
    recorded_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_water_test_ph CHECK (ph_value IS NULL OR ph_value BETWEEN 0 AND 14),
    CONSTRAINT ck_water_test_turbidity CHECK (turbidity_ntu IS NULL OR turbidity_ntu >= 0),
    CONSTRAINT ck_water_test_chlorine CHECK (chlorine_mg_l IS NULL OR chlorine_mg_l >= 0),
    CONSTRAINT ck_water_test_status CHECK (result_status IN ('PASS','FAIL','PENDING'))
);

CREATE TABLE water_treatment_records (
    treatment_id BIGSERIAL PRIMARY KEY,
    borehole_id BIGINT NOT NULL REFERENCES boreholes(borehole_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    treatment_date DATE NOT NULL,
    treatment_type VARCHAR(30) NOT NULL,
    chemical_name VARCHAR(150),
    quantity_used NUMERIC(18,3),
    unit_of_measure VARCHAR(30),
    performed_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_water_treatment_type CHECK (treatment_type IN ('CHLORINATION','FLUSHING','OTHER')),
    CONSTRAINT ck_water_treatment_quantity CHECK (quantity_used IS NULL OR quantity_used >= 0)
);

-- =========================================================
-- J. DISTRIBUTION AND WATER LOSS
-- =========================================================

CREATE TABLE water_supply_schedules (
    schedule_id BIGSERIAL PRIMARY KEY,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    schedule_type VARCHAR(20) NOT NULL,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    recurrence_rule TEXT,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_supply_schedule_type CHECK (schedule_type IN ('NORMAL','RATIONING','EMERGENCY')),
    CONSTRAINT ck_supply_schedule_dates CHECK (end_datetime >= start_datetime),
    CONSTRAINT ck_supply_schedule_status CHECK (status IN ('PLANNED','ACTIVE','COMPLETED','CANCELLED'))
);

CREATE TABLE distribution_records (
    distribution_record_id BIGSERIAL PRIMARY KEY,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    asset_id BIGINT REFERENCES distribution_assets(asset_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    meter_id BIGINT REFERENCES meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    record_date DATE NOT NULL,
    opening_reading NUMERIC(18,3) NOT NULL,
    closing_reading NUMERIC(18,3) NOT NULL,
    volume_distributed_m3 NUMERIC(18,3) GENERATED ALWAYS AS (closing_reading - opening_reading) STORED,
    recorded_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_distribution_readings CHECK (opening_reading >= 0 AND closing_reading >= opening_reading)
);

CREATE TABLE water_loss_records (
    water_loss_id BIGSERIAL PRIMARY KEY,
    zone_id BIGINT NOT NULL REFERENCES zones(zone_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    volume_produced_m3 NUMERIC(18,3) NOT NULL,
    billed_consumption_m3 NUMERIC(18,3) NOT NULL,
    authorized_unbilled_m3 NUMERIC(18,3) NOT NULL DEFAULT 0,
    water_loss_m3 NUMERIC(18,3) GENERATED ALWAYS AS (
        volume_produced_m3 - billed_consumption_m3 - authorized_unbilled_m3
    ) STORED,
    loss_percentage NUMERIC(8,3),
    risk_status VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    investigation_work_order_id BIGINT REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_water_loss_dates CHECK (period_end >= period_start),
    CONSTRAINT ck_water_loss_values CHECK (
        volume_produced_m3 >= 0 AND billed_consumption_m3 >= 0 AND authorized_unbilled_m3 >= 0
    ),
    CONSTRAINT ck_water_loss_risk CHECK (risk_status IN ('NORMAL','WARNING','HIGH','CRITICAL')),
    CONSTRAINT uq_zone_water_loss_period UNIQUE (zone_id, period_start, period_end)
);

-- =========================================================
-- K. INVENTORY
-- =========================================================

CREATE TABLE inventory_items (
    inventory_item_id BIGSERIAL PRIMARY KEY,
    item_code VARCHAR(50) NOT NULL UNIQUE,
    item_name VARCHAR(150) NOT NULL,
    item_category VARCHAR(30) NOT NULL,
    unit_of_measure VARCHAR(30) NOT NULL,
    unit_cost NUMERIC(18,2) NOT NULL DEFAULT 0,
    reorder_level NUMERIC(18,3) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_inventory_category CHECK (item_category IN ('PIPE','FITTING','METER','VALVE','CHEMICAL','TOOL','OTHER')),
    CONSTRAINT ck_inventory_values CHECK (unit_cost >= 0 AND reorder_level >= 0),
    CONSTRAINT ck_inventory_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE stock_transactions (
    stock_transaction_id BIGSERIAL PRIMARY KEY,
    inventory_item_id BIGINT NOT NULL REFERENCES inventory_items(inventory_item_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    transaction_type VARCHAR(20) NOT NULL,
    quantity NUMERIC(18,3) NOT NULL,
    unit_cost NUMERIC(18,2) NOT NULL,
    work_order_id BIGINT REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    field_officer_id BIGINT REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    reference_number VARCHAR(100),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    processed_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_stock_transaction_type CHECK (transaction_type IN ('RECEIPT','ISSUE','RETURN','ADJUSTMENT')),
    CONSTRAINT ck_stock_transaction_values CHECK (quantity > 0 AND unit_cost >= 0)
);

CREATE TABLE work_order_materials (
    usage_id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    inventory_item_id BIGINT NOT NULL REFERENCES inventory_items(inventory_item_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    quantity_used NUMERIC(18,3) NOT NULL,
    unit_cost NUMERIC(18,2) NOT NULL,
    issued_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    used_by BIGINT REFERENCES field_officers(field_officer_id) ON UPDATE CASCADE ON DELETE SET NULL,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT ck_work_order_material_values CHECK (quantity_used > 0 AND unit_cost >= 0)
);

-- =========================================================
-- L. COMMUNICATIONS
-- =========================================================

CREATE TABLE notification_templates (
    template_id BIGSERIAL PRIMARY KEY,
    template_code VARCHAR(60) NOT NULL UNIQUE,
    template_name VARCHAR(150) NOT NULL,
    channel VARCHAR(20) NOT NULL,
    subject VARCHAR(255),
    message_body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_notification_template_channel CHECK (channel IN ('SMS','EMAIL','PUSH','WHATSAPP')),
    CONSTRAINT ck_notification_template_status CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    template_id BIGINT REFERENCES notification_templates(template_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    customer_id BIGINT REFERENCES customers(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    account_id BIGINT REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    notification_type VARCHAR(50) NOT NULL,
    channel VARCHAR(20) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    message_body TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    external_reference VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_notification_channel CHECK (channel IN ('SMS','EMAIL','PUSH','WHATSAPP')),
    CONSTRAINT ck_notification_delivery_status CHECK (delivery_status IN ('QUEUED','SENT','DELIVERED','FAILED'))
);

-- =========================================================
-- M. APPROVALS AND AUDIT
-- =========================================================

CREATE TABLE approval_requests (
    approval_request_id BIGSERIAL PRIMARY KEY,
    request_type VARCHAR(60) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id BIGINT NOT NULL,
    requested_by BIGINT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approver_id BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    decision VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    decision_notes TEXT,
    decided_at TIMESTAMPTZ,
    CONSTRAINT ck_approval_decision CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
    CONSTRAINT ck_approval_maker_checker CHECK (approver_id IS NULL OR approver_id <> requested_by)
);

CREATE TABLE audit_logs (
    audit_log_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    action_type VARCHAR(20) NOT NULL,
    module_name VARCHAR(100) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id BIGINT,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    device_information TEXT,
    action_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_audit_action CHECK (action_type IN ('INSERT','UPDATE','DELETE','APPROVE','REJECT','LOGIN','LOGOUT'))
);

-- =========================================================
-- METER REPLACEMENTS: created after work_orders exists
-- =========================================================

CREATE TABLE meter_replacements (
    replacement_id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES customer_accounts(account_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    old_meter_id BIGINT NOT NULL REFERENCES meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    new_meter_id BIGINT NOT NULL REFERENCES meters(meter_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    replacement_date DATE NOT NULL,
    old_final_reading NUMERIC(18,3) NOT NULL,
    new_opening_reading NUMERIC(18,3) NOT NULL DEFAULT 0,
    replacement_reason TEXT NOT NULL,
    work_order_id BIGINT REFERENCES work_orders(work_order_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    approved_by BIGINT REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_meter_replacement_values CHECK (old_final_reading >= 0 AND new_opening_reading >= 0),
    CONSTRAINT ck_meter_replacement_distinct CHECK (old_meter_id <> new_meter_id)
);

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_service_areas_zone_id ON service_areas(zone_id);
CREATE INDEX idx_routes_zone_id ON routes(zone_id);
CREATE INDEX idx_properties_zone_id ON properties(zone_id);
CREATE INDEX idx_properties_route_id ON properties(route_id);
CREATE INDEX idx_customer_accounts_customer_id ON customer_accounts(customer_id);
CREATE INDEX idx_customer_accounts_property_id ON customer_accounts(property_id);
CREATE INDEX idx_customer_accounts_status ON customer_accounts(account_status);
CREATE INDEX idx_connection_applications_customer_id ON connection_applications(applicant_customer_id);
CREATE INDEX idx_connection_applications_status ON connection_applications(status);
CREATE INDEX idx_meter_assignments_account_id ON meter_assignments(account_id);
CREATE INDEX idx_meter_readings_account_id ON meter_readings(account_id);
CREATE INDEX idx_meter_readings_date ON meter_readings(reading_date);
CREATE INDEX idx_bills_account_id ON bills(account_id);
CREATE INDEX idx_bills_cycle_id ON bills(billing_cycle_id);
CREATE INDEX idx_bills_status ON bills(status);
CREATE INDEX idx_payments_account_id ON payments(account_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);
CREATE INDEX idx_payments_matching_status ON payments(matching_status);
CREATE INDEX idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_bill_id ON payment_allocations(bill_id);
CREATE INDEX idx_complaints_account_id ON complaints(account_id);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_work_orders_account_id ON work_orders(account_id);
CREATE INDEX idx_work_orders_zone_id ON work_orders(zone_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_order_assignments_officer_id ON work_order_assignments(field_officer_id);
CREATE INDEX idx_production_records_date ON production_records(production_date);
CREATE INDEX idx_distribution_records_date ON distribution_records(record_date);
CREATE INDEX idx_notifications_status ON notifications(delivery_status);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(action_timestamp);

-- =========================================================
-- UPDATED_AT TRIGGERS
-- =========================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'zones','service_areas','routes','distribution_assets',
        'customer_categories','customers','properties','customer_accounts',
        'users','roles','connection_applications','field_officers',
        'connection_quotations','boreholes','meters','billing_cycles',
        'reading_cycles','tariffs','bills','complaints','work_orders',
        'pumps','inventory_items','notification_templates'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION aquaflow.set_updated_at()',
            t, t
        );
    END LOOP;
END $$;

-- =========================================================
-- BUSINESS RULE FUNCTIONS / TRIGGERS
-- =========================================================

CREATE OR REPLACE FUNCTION aquaflow.validate_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_total NUMERIC(18,2);
    allocated_total NUMERIC(18,2);
    bill_due NUMERIC(18,2);
    bill_allocated NUMERIC(18,2);
BEGIN
    SELECT amount INTO payment_total
    FROM payments
    WHERE payment_id = NEW.payment_id;

    SELECT COALESCE(SUM(allocated_amount),0)
    INTO allocated_total
    FROM payment_allocations
    WHERE payment_id = NEW.payment_id
      AND allocation_id <> COALESCE(NEW.allocation_id,0);

    IF allocated_total + NEW.allocated_amount > payment_total THEN
        RAISE EXCEPTION 'Payment allocation exceeds payment amount';
    END IF;

    SELECT total_amount_due INTO bill_due
    FROM bills
    WHERE bill_id = NEW.bill_id;

    SELECT COALESCE(SUM(allocated_amount),0)
    INTO bill_allocated
    FROM payment_allocations
    WHERE bill_id = NEW.bill_id
      AND allocation_id <> COALESCE(NEW.allocation_id,0);

    IF bill_allocated + NEW.allocated_amount > bill_due THEN
        RAISE EXCEPTION 'Payment allocation exceeds bill amount due';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_payment_allocation
BEFORE INSERT OR UPDATE ON payment_allocations
FOR EACH ROW
EXECUTE FUNCTION aquaflow.validate_payment_allocation();

CREATE OR REPLACE FUNCTION aquaflow.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are append-only and cannot be updated or deleted';
END;
$$;

CREATE TRIGGER trg_prevent_audit_log_update
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION aquaflow.prevent_audit_log_mutation();

-- =========================================================
-- OPTIONAL SEED DATA
-- =========================================================

INSERT INTO customer_categories (category_code, category_name, description)
VALUES
    ('DOM','Domestic','Residential household customer'),
    ('COM','Commercial','Commercial business customer'),
    ('INS','Institutional','School, hospital, government or institution'),
    ('CON','Construction','Temporary construction account'),
    ('BLK','Bulk','Bulk water customer'),
    ('KSK','Kiosk','Water kiosk operator'),
    ('SPC','Special','Special approved category')
ON CONFLICT DO NOTHING;

INSERT INTO payment_channels (channel_code, channel_name, requires_reference)
VALUES
    ('MPESA','M-Pesa Paybill',TRUE),
    ('BANK','Bank Payment',TRUE),
    ('CASH','Cash Payment',TRUE),
    ('CARD','Card Payment',TRUE),
    ('USSD','USSD Payment',TRUE),
    ('APP','Mobile App Payment',TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO work_order_types
(type_code, type_name, description, requires_photo, requires_gps, requires_signature)
VALUES
    ('NEW_CONNECTION','New Connection','Installation of a new customer water connection',TRUE,TRUE,TRUE),
    ('METER_INSTALLATION','Meter Installation','Install a new customer meter',TRUE,TRUE,TRUE),
    ('METER_REPLACEMENT','Meter Replacement','Replace a faulty, old or tampered meter',TRUE,TRUE,FALSE),
    ('METER_READING','Meter Reading','Capture a scheduled meter reading',TRUE,TRUE,FALSE),
    ('LEAK_REPAIR','Leak Repair','Repair a reported water leakage',TRUE,TRUE,FALSE),
    ('BURST_PIPE_REPAIR','Burst Pipe Repair','Repair a major pipe burst',TRUE,TRUE,FALSE),
    ('SITE_INSPECTION','Site Inspection','Inspect premises before connection approval',TRUE,TRUE,TRUE),
    ('DISCONNECTION','Disconnection','Disconnect a customer account',TRUE,TRUE,FALSE),
    ('RECONNECTION','Reconnection','Reconnect a customer after payment or resolution',TRUE,TRUE,FALSE),
    ('ILLEGAL_CONNECTION','Illegal Connection Investigation','Investigate suspected unauthorized connection',TRUE,TRUE,FALSE),
    ('LOW_PRESSURE','Low Pressure Investigation','Investigate a low-pressure complaint',TRUE,TRUE,FALSE),
    ('NO_WATER','No Water Investigation','Investigate a supply failure',TRUE,TRUE,FALSE),
    ('TANK_INSPECTION','Tank Inspection','Inspect tank or reservoir',TRUE,TRUE,FALSE),
    ('BOREHOLE_MAINTENANCE','Borehole Maintenance','Inspect or service borehole and pump equipment',TRUE,TRUE,FALSE),
    ('VALVE_OPERATION','Valve Operation','Open or close a valve for distribution control',TRUE,TRUE,FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO complaint_types
(type_code, type_name, default_priority, target_resolution_hours, generates_work_order)
VALUES
    ('LEAK','Leak','HIGH',8,TRUE),
    ('NO_WATER','No Water','HIGH',12,TRUE),
    ('WRONG_BILL','Wrong Bill','NORMAL',48,FALSE),
    ('LOW_PRESSURE','Low Pressure','NORMAL',24,TRUE),
    ('FAULTY_METER','Faulty Meter','NORMAL',48,TRUE),
    ('ILLEGAL_CONNECTION','Illegal Connection','HIGH',24,TRUE)
ON CONFLICT DO NOTHING;

COMMIT;
