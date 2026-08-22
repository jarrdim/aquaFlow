-- Reuse the legacy customer_documents table. document_number,
-- document_type and file_path are Document ID, Title and Form/File.
CREATE TABLE IF NOT EXISTS "aquaflow"."customer_documents" (
  "document_id" BIGSERIAL NOT NULL,
  "customer_id" BIGINT NOT NULL,
  "document_type" VARCHAR(100) NOT NULL,
  "document_number" VARCHAR(100),
  "file_path" TEXT NOT NULL,
  "issue_date" DATE,
  "expiry_date" DATE,
  "verification_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "verified_by" BIGINT,
  "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "file_name" VARCHAR(255),
  "mime_type" VARCHAR(100),
  "file_size" INTEGER,
  "uploaded_by" BIGINT,
  CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("document_id"),
  CONSTRAINT "customer_documents_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "aquaflow"."customers"("customer_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "aquaflow"."customer_documents"
  ADD COLUMN IF NOT EXISTS "file_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "mime_type" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "file_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "uploaded_by" BIGINT;

CREATE INDEX IF NOT EXISTS "customer_documents_customer_id_document_reference_idx"
  ON "aquaflow"."customer_documents"("customer_id", "document_number");

CREATE INDEX IF NOT EXISTS "customer_documents_customer_id_created_at_idx"
  ON "aquaflow"."customer_documents"("customer_id", "uploaded_at" DESC);
