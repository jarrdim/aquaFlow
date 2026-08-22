CREATE INDEX IF NOT EXISTS "idx_customers_created_at_desc"
  ON "aquaflow"."customers" ("created_at" DESC, "customer_id" DESC);

CREATE INDEX IF NOT EXISTS "idx_customer_accounts_customer_created_desc"
  ON "aquaflow"."customer_accounts" ("customer_id", "created_at" DESC, "account_id" DESC);

CREATE INDEX IF NOT EXISTS "idx_properties_owner_created_desc"
  ON "aquaflow"."properties" ("owner_customer_id", "created_at" DESC, "property_id" DESC);
