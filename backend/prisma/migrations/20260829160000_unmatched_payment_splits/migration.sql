ALTER TABLE aquaflow.payments
  ADD COLUMN IF NOT EXISTS parent_payment_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_payments_parent_payment_id
  ON aquaflow.payments(parent_payment_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payments_parent_payment_id_fkey'
      AND conrelid = 'aquaflow.payments'::regclass
  ) THEN
    ALTER TABLE aquaflow.payments
      ADD CONSTRAINT payments_parent_payment_id_fkey
      FOREIGN KEY (parent_payment_id)
      REFERENCES aquaflow.payments(payment_id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
