ALTER TABLE "aquaflow"."properties"
  ADD COLUMN IF NOT EXISTS "route_id" BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'aquaflow.properties'::regclass
      AND conname = 'properties_route_id_fkey'
  ) THEN
    ALTER TABLE "aquaflow"."properties"
      ADD CONSTRAINT "properties_route_id_fkey"
      FOREIGN KEY ("route_id") REFERENCES "aquaflow"."routes"("route_id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_properties_route_id"
  ON "aquaflow"."properties"("route_id");
