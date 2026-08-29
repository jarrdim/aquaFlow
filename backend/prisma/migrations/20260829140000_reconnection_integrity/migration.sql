CREATE UNIQUE INDEX IF NOT EXISTS uq_reconnection_requests_open_account
  ON aquaflow.reconnection_requests(account_id)
  WHERE status IN ('SUBMITTED','APPROVED','WORK_ORDER_CREATED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_reconnection_requests_work_order
  ON aquaflow.reconnection_requests(work_order_id)
  WHERE work_order_id IS NOT NULL;
