-- Daraja C2B payer and reference values are external data. The original
-- production table retained legacy VARCHAR limits that were narrower than the
-- Prisma model, causing valid confirmations to fail with Prisma P2000.
-- VARCHAR -> TEXT is non-destructive and preserves the existing unique index.
ALTER TABLE aquaflow.payments
  ALTER COLUMN transaction_reference TYPE TEXT,
  ALTER COLUMN payer_name TYPE TEXT,
  ALTER COLUMN payer_phone TYPE TEXT,
  ALTER COLUMN customer_reference TYPE TEXT;
