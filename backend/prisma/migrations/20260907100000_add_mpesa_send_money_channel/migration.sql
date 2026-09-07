INSERT INTO aquaflow.payment_channels (
  channel_code,
  channel_name,
  requires_reference,
  auto_allocation,
  receipt_required,
  remarks,
  status
)
VALUES (
  'MPESA_SEND_MONEY',
  'M-Pesa Send Money',
  TRUE,
  TRUE,
  TRUE,
  'M-Pesa payments sent directly to the utility phone number',
  'ACTIVE'
)
ON CONFLICT (channel_code) DO UPDATE
SET channel_name = EXCLUDED.channel_name,
    requires_reference = EXCLUDED.requires_reference,
    auto_allocation = EXCLUDED.auto_allocation,
    receipt_required = EXCLUDED.receipt_required,
    remarks = EXCLUDED.remarks,
    status = 'ACTIVE',
    updated_at = CURRENT_TIMESTAMP;
