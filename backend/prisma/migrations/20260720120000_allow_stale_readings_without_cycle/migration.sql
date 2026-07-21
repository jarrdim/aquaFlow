-- A historical/latest-reading snapshot may not belong to any configured
-- operational reading-cycle window. Preserve the reading, but allow its cycle
-- link to remain unassigned until a valid cycle is identified.
ALTER TABLE "aquaflow"."meter_readings"
  ALTER COLUMN "reading_cycle_id" DROP NOT NULL;
