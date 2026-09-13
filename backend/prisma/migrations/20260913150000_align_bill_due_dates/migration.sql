UPDATE "aquaflow"."bills" AS bill
SET
  "due_date" = cycle."due_date",
  "updated_at" = CURRENT_TIMESTAMP
FROM "aquaflow"."billing_cycles" AS cycle
WHERE bill."billing_cycle_id" = cycle."billing_cycle_id"
  AND bill."due_date" IS DISTINCT FROM cycle."due_date";
