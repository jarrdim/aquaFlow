CREATE INDEX IF NOT EXISTS bills_cycle_status_posting_idx
  ON aquaflow.bills (billing_cycle_id, status, bill_id);

CREATE INDEX IF NOT EXISTS billing_events_bill_posting_evidence_idx
  ON aquaflow.billing_events (bill_id, event_type)
  WHERE bill_id IS NOT NULL;
