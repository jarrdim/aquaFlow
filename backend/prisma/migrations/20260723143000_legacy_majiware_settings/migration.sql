ALTER TABLE aquaflow.system_settings
  ADD COLUMN IF NOT EXISTS secondary_phone_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS default_billing_rate DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS subproject_discount_rate DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS reconnection_fee DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS billing_message_line_1 TEXT,
  ADD COLUMN IF NOT EXISTS billing_message_line_2 TEXT,
  ADD COLUMN IF NOT EXISTS billing_message_line_3 TEXT,
  ADD COLUMN IF NOT EXISTS demand_message_line_1 TEXT,
  ADD COLUMN IF NOT EXISTS demand_message_line_2 TEXT,
  ADD COLUMN IF NOT EXISTS demand_message_line_3 TEXT,
  ADD COLUMN IF NOT EXISTS demand_message_line_4 TEXT,
  ADD COLUMN IF NOT EXISTS demand_message_line_5 TEXT,
  ADD COLUMN IF NOT EXISTS receipt_message TEXT;

ALTER TABLE aquaflow.system_settings
  DROP CONSTRAINT IF EXISTS ck_system_settings_default_billing_rate,
  DROP CONSTRAINT IF EXISTS ck_system_settings_discount_rate,
  DROP CONSTRAINT IF EXISTS ck_system_settings_reconnection_fee;

ALTER TABLE aquaflow.system_settings
  ADD CONSTRAINT ck_system_settings_default_billing_rate
    CHECK (default_billing_rate IS NULL OR default_billing_rate >= 0),
  ADD CONSTRAINT ck_system_settings_discount_rate
    CHECK (subproject_discount_rate IS NULL OR subproject_discount_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_system_settings_reconnection_fee
    CHECK (reconnection_fee IS NULL OR reconnection_fee >= 0);

UPDATE aquaflow.system_settings
SET
  utility_name = CASE WHEN utility_name = 'AquaFlow' THEN 'SAMDAMTE WATER' ELSE utility_name END,
  email_address = COALESCE(email_address, 'samdamtewaterservices@yahoo.com'),
  phone_number = COALESCE(phone_number, '+254-704-107-724'),
  secondary_phone_number = COALESCE(secondary_phone_number, '+254-788-484-737'),
  postal_address = COALESCE(postal_address, 'P.O. Box 24732'),
  postal_code = COALESCE(postal_code, '00100'),
  billing_due_days = CASE WHEN billing_due_days = 14 THEN 15 ELSE billing_due_days END,
  default_billing_rate = COALESCE(default_billing_rate, 100),
  subproject_discount_rate = COALESCE(subproject_discount_rate, 15),
  reconnection_fee = COALESCE(reconnection_fee, 1155),
  billing_message_line_1 = COALESCE(
    billing_message_line_1,
    'CHEQUES PAYABLE TO SAMDAMTE WATER SERVICES LTD. DIRECT BANKING CAN BE DONE AT EQUITY BANK,'
  ),
  billing_message_line_2 = COALESCE(
    billing_message_line_2,
    'KARIOBANGI BRANCH. ACCOUNT NO. 0320197604155. OUR PAYBILL NO. IS 823496 AND MPESA NO IS 0704107724'
  ),
  billing_message_line_3 = COALESCE(
    billing_message_line_3,
    'DUE DATE IS 10TH OF EVERY MONTH. ANY ACCOUNT UNCLEARED BY THEN WILL BE DISCONNECTED. RECONNECTION IS 1155'
  ),
  receipt_message = COALESCE(receipt_message, 'THANK YOU'),
  updated_at = NOW()
WHERE setting_id = 1;
