-- DANGER: Permanently removes AquaFlow operational/transaction data.
--
-- Preserved:
--   users, roles, permissions, user_roles, role_permissions, field_officers,
--   zones, service_areas, routes, customer_categories, payment_channels,
--   mpesa_c2b_registrations, system_settings, tariffs, tariff_bands,
--   tariff_category_assignments, notification_templates,
--   notification_providers, work_order_types, boreholes, inventory_items.
--
-- Take and verify a database backup before running this file.
-- To rehearse safely, replace the final COMMIT with ROLLBACK.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '15min';

-- Customer portal users are setup/security records that must survive. Detach
-- them from deleted customer records first so customers can be removed safely.
UPDATE aquaflow.users
SET customer_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE customer_id IS NOT NULL;

CREATE TEMP TABLE _operational_reset_tables (
  delete_order integer GENERATED ALWAYS AS IDENTITY,
  table_name text PRIMARY KEY,
  deleted boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO _operational_reset_tables (table_name) VALUES
  ('notification_delivery_attempts'),
  ('bill_notifications'),
  ('notifications'),
  ('payment_events'),
  ('receipts'),
  ('payment_reversals'),
  ('suspense_payments'),
  ('payment_allocations'),
  ('mpesa_stk_requests'),
  ('payment_reconciliation_batches'),
  ('payments'),
  ('billing_security_alerts'),
  ('arrears_actions'),
  ('debt_write_offs'),
  ('disconnection_list_items'),
  ('disconnection_lists'),
  ('debt_notices'),
  ('promises_to_pay'),
  ('payment_plan_installments'),
  ('payment_plans'),
  ('billing_events'),
  ('billing_adjustments'),
  ('bill_items'),
  ('bills'),
  ('billing_cycles'),
  ('tariff_events'),
  ('tariff_simulations'),
  ('meter_alerts'),
  ('meter_installation_materials'),
  ('meter_evidence'),
  ('meter_events'),
  ('meter_replacements'),
  ('meter_reading_events'),
  ('meter_reading_evidence'),
  ('meter_readings'),
  ('meter_assignments'),
  ('meters'),
  ('route_assignments'),
  ('reading_cycles'),
  ('field_work_order_completion_reports'),
  ('field_reconnection_reports'),
  ('field_disconnection_reports'),
  ('field_inspection_photos'),
  ('field_inspection_reports'),
  ('work_order_materials'),
  ('work_order_consumables'),
  ('work_order_evidence'),
  ('work_order_updates'),
  ('work_order_assignments'),
  ('reconnection_requests'),
  ('work_orders'),
  ('service_request_events'),
  ('service_requests'),
  ('new_connection_activities'),
  ('new_connection_applications'),
  ('account_balance_reconciliations'),
  ('customer_account_access'),
  ('customer_documents'),
  ('customer_accounts'),
  ('properties'),
  ('customers');

-- Delete in repeated passes. A table blocked by an FK is retried after its
-- child table has been emptied. Any unknown preserved-table dependency aborts
-- the whole transaction instead of using unsafe CASCADE behavior.
DO $reset$
DECLARE
  target record;
  affected bigint;
  completed_this_pass integer;
  blocked_tables text;
BEGIN
  LOOP
    completed_this_pass := 0;

    FOR target IN
      SELECT table_name
      FROM _operational_reset_tables
      WHERE NOT deleted
      ORDER BY delete_order
    LOOP
      IF to_regclass(format('aquaflow.%I', target.table_name)) IS NULL THEN
        RAISE NOTICE 'Skipping absent table aquaflow.%', target.table_name;
        UPDATE _operational_reset_tables
        SET deleted = true
        WHERE table_name = target.table_name;
        completed_this_pass := completed_this_pass + 1;
        CONTINUE;
      END IF;

      BEGIN
        EXECUTE format('DELETE FROM aquaflow.%I', target.table_name);
        GET DIAGNOSTICS affected = ROW_COUNT;
        RAISE NOTICE 'Deleted % row(s) from aquaflow.%', affected, target.table_name;

        UPDATE _operational_reset_tables
        SET deleted = true
        WHERE table_name = target.table_name;
        completed_this_pass := completed_this_pass + 1;
      EXCEPTION
        WHEN foreign_key_violation THEN
          -- The failed statement is rolled back to this block's savepoint.
          NULL;
      END;
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM _operational_reset_tables WHERE NOT deleted
    );

    IF completed_this_pass = 0 THEN
      SELECT string_agg(table_name, ', ' ORDER BY delete_order)
      INTO blocked_tables
      FROM _operational_reset_tables
      WHERE NOT deleted;

      RAISE EXCEPTION
        'Reset stopped safely. Foreign-key dependencies still block: %',
        blocked_tables;
    END IF;
  END LOOP;
END
$reset$;

-- DELETE is intentionally used instead of TRUNCATE CASCADE so setup tables
-- cannot be erased through foreign keys. Reset identity sequences afterward.
DO $sequences$
DECLARE
  target record;
  sequence_name text;
BEGIN
  FOR target IN
    SELECT table_name
    FROM _operational_reset_tables
    WHERE deleted
      AND to_regclass(format('aquaflow.%I', table_name)) IS NOT NULL
  LOOP
    FOR sequence_name IN
      SELECT pg_get_serial_sequence(
        format('aquaflow.%I', target.table_name),
        attribute.attname
      )
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass(format('aquaflow.%I', target.table_name))
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND pg_get_serial_sequence(
          format('aquaflow.%I', target.table_name),
          attribute.attname
        ) IS NOT NULL
    LOOP
      EXECUTE format(
        'SELECT setval(%L::regclass, 1, false)',
        sequence_name
      );
    END LOOP;
  END LOOP;
END
$sequences$;

COMMIT;

