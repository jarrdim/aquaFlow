CREATE TABLE aquaflow.manual_invoices (
  invoice_id BIGSERIAL PRIMARY KEY,
  invoice_number VARCHAR(40) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES aquaflow.customer_accounts(account_id),
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  customer_reference VARCHAR(120),
  notes TEXT,
  terms TEXT,
  created_by BIGINT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  issued_by BIGINT,
  issued_at TIMESTAMPTZ,
  cancelled_by BIGINT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_invoices_date_check CHECK (due_date >= invoice_date),
  CONSTRAINT manual_invoices_amount_check CHECK (
    subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND
    total_amount >= 0 AND paid_amount >= 0 AND balance_amount >= 0
  ),
  CONSTRAINT manual_invoices_status_check CHECK (status IN ('DRAFT','APPROVED','ISSUED','PARTIALLY_PAID','PAID','CANCELLED'))
);

CREATE INDEX manual_invoices_account_date_idx
  ON aquaflow.manual_invoices(account_id, invoice_date DESC);
CREATE INDEX manual_invoices_status_due_idx
  ON aquaflow.manual_invoices(status, due_date);

CREATE TABLE aquaflow.manual_invoice_items (
  invoice_item_id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES aquaflow.manual_invoices(invoice_id) ON DELETE CASCADE,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(18,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  line_subtotal NUMERIC(18,2) NOT NULL,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(18,2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT manual_invoice_items_value_check CHECK (quantity > 0 AND unit_price >= 0 AND tax_rate >= 0)
);

CREATE TABLE aquaflow.manual_invoice_payments (
  invoice_payment_id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES aquaflow.manual_invoices(invoice_id),
  payment_id BIGINT NOT NULL UNIQUE REFERENCES aquaflow.payments(payment_id),
  amount NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_invoice_payments_amount_check CHECK (amount > 0)
);

CREATE INDEX manual_invoice_payments_invoice_idx
  ON aquaflow.manual_invoice_payments(invoice_id, created_at);

CREATE TABLE aquaflow.manual_invoice_events (
  invoice_event_id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES aquaflow.manual_invoices(invoice_id) ON DELETE CASCADE,
  event_type VARCHAR(60) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30),
  details TEXT,
  performed_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX manual_invoice_events_invoice_idx
  ON aquaflow.manual_invoice_events(invoice_id, created_at);
