ALTER TABLE "aquaflow"."notifications"
ADD COLUMN "read_at" TIMESTAMP(3);

CREATE INDEX "notifications_customer_id_read_at_idx"
ON "aquaflow"."notifications"("customer_id", "read_at");
