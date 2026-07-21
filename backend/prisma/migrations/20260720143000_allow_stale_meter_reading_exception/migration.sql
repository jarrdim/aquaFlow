-- Historical readings outside every configured operational reading-cycle
-- window are retained without a cycle and explicitly marked as stale.
ALTER TABLE "aquaflow"."meter_readings"
  DROP CONSTRAINT IF EXISTS "ck_meter_reading_exception";

ALTER TABLE "aquaflow"."meter_readings"
  ADD CONSTRAINT "ck_meter_reading_exception"
  CHECK (
    "exception_type" IN (
      'ZERO',
      'NEGATIVE',
      'HIGH',
      'LOW',
      'TAMPERED',
      'NONE',
      'STALE_READING'
    )
  );
