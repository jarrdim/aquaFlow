CREATE INDEX IF NOT EXISTS bills_billing_cycle_record_lookup_idx
  ON aquaflow.bills (billing_cycle_id, bill_id DESC);
