CREATE TABLE IF NOT EXISTS "aquaflow"."customer_documents" (
  "customer_document_id" BIGSERIAL NOT NULL,
  "customer_id" BIGINT NOT NULL,
  "document_reference" VARCHAR(100) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_data" TEXT NOT NULL,
  "uploaded_by" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("customer_document_id"),
  CONSTRAINT "customer_documents_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "aquaflow"."customers"("customer_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_documents_customer_id_document_reference_key"
  ON "aquaflow"."customer_documents"("customer_id", "document_reference");

CREATE INDEX IF NOT EXISTS "customer_documents_customer_id_created_at_idx"
  ON "aquaflow"."customer_documents"("customer_id", "created_at" DESC);
