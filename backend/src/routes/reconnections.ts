import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requirePermission } from "../middleware/auth";

export const reconnectionsRouter = Router();
reconnectionsRouter.use(requireAuth);

const canView = requirePermission("SERVICE_REQUEST_VIEW");
const canDecide = requirePermission("SERVICE_REQUEST_RESOLVE");
const canCreateWorkOrder = requirePermission("WORK_ORDER_CREATE");
const id = z.coerce.bigint().positive();

reconnectionsRouter.get("/", canView, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const take = Math.min(100, Math.max(10, Number(req.query.take) || 25));
    const status = String(req.query.status ?? "").trim();
    const q = String(req.query.q ?? "").trim();
    const pattern = `%${q}%`;
    const offset = (page - 1) * take;
    const [count, rows] = await Promise.all([
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM aquaflow.reconnection_requests r
        JOIN aquaflow.customer_accounts a ON a.account_id = r.account_id
        JOIN aquaflow.customers c ON c.customer_id = r.customer_id
        WHERE (${status} = '' OR r.status = ${status})
          AND (${q} = '' OR r.request_number ILIKE ${pattern}
            OR a.account_number ILIKE ${pattern}
            OR c.phone_number ILIKE ${pattern})`,
      prisma.$queryRaw<any[]>`
        SELECT r.reconnection_request_id AS "reconnectionRequestId",
          r.request_number AS "requestNumber", r.reason, r.contact_phone AS "contactPhone",
          r.status, r.reconnection_fee AS "reconnectionFee",
          r.fee_payment_status AS "feePaymentStatus", r.fee_paid_at AS "feePaidAt",
          r.work_order_id AS "workOrderId", r.created_at AS "createdAt",
          a.account_number AS "accountNumber", a.current_balance AS "currentBalance",
          COALESCE(c.organization_name, CONCAT_WS(' ', c.first_name, c.last_name)) AS "customerName"
        FROM aquaflow.reconnection_requests r
        JOIN aquaflow.customer_accounts a ON a.account_id = r.account_id
        JOIN aquaflow.customers c ON c.customer_id = r.customer_id
        WHERE (${status} = '' OR r.status = ${status})
          AND (${q} = '' OR r.request_number ILIKE ${pattern}
            OR a.account_number ILIKE ${pattern}
            OR c.phone_number ILIKE ${pattern})
        ORDER BY r.created_at DESC LIMIT ${take} OFFSET ${offset}`,
    ]);
    const total = count[0]?.count ?? 0;
    res.json({ rows, total, page, take, pages: Math.max(1, Math.ceil(total / take)) });
  } catch (error) {
    next(error);
  }
});

reconnectionsRouter.get("/:id", canView, async (req, res, next) => {
  const parsed = id.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid reconnection request" });
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT r.reconnection_request_id AS "reconnectionRequestId",
        r.request_number AS "requestNumber", r.customer_id AS "customerId",
        r.account_id AS "accountId", r.reason, r.contact_phone AS "contactPhone",
        r.status, r.reconnection_fee AS "reconnectionFee",
        r.fee_payment_status AS "feePaymentStatus", r.fee_paid_at AS "feePaidAt",
        r.decision_notes AS "decisionNotes", r.decided_at AS "decidedAt",
        r.work_order_id AS "workOrderId", r.created_at AS "createdAt",
        a.account_number AS "accountNumber", a.current_balance AS "currentBalance",
        a.account_status AS "accountStatus", p.zone_id AS "zoneId",
        COALESCE(c.organization_name, CONCAT_WS(' ', c.first_name, c.last_name)) AS "customerName",
        c.phone_number AS "customerPhone", w.work_order_number AS "workOrderNumber",
        pay.transaction_reference AS "mpesaReceiptNumber", rec.receipt_number AS "receiptNumber"
      FROM aquaflow.reconnection_requests r
      JOIN aquaflow.customer_accounts a ON a.account_id = r.account_id
      JOIN aquaflow.properties p ON p.property_id = a.property_id
      JOIN aquaflow.customers c ON c.customer_id = r.customer_id
      LEFT JOIN aquaflow.work_orders w ON w.work_order_id = r.work_order_id
      LEFT JOIN aquaflow.payments pay ON pay.payment_id = r.fee_payment_id
      LEFT JOIN aquaflow.receipts rec ON rec.payment_id = pay.payment_id
      WHERE r.reconnection_request_id = ${parsed.data}`;
    if (!rows[0]) return res.status(404).json({ error: "Reconnection request not found" });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

reconnectionsRouter.patch("/:id/decision", canDecide, async (req, res, next) => {
  const parsedId = id.safeParse(req.params.id);
  const parsed = z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    notes: z.string().trim().min(3).max(2000),
  }).safeParse(req.body);
  if (!parsedId.success || !parsed.success) return res.status(400).json({ error: "Enter a valid decision and notes" });
  try {
    const rows = await prisma.$queryRaw<any[]>`
      UPDATE aquaflow.reconnection_requests
      SET status = ${parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED"},
        decision_notes = ${parsed.data.notes}, decided_by = ${BigInt(req.user!.userId)},
        decided_at = NOW(), updated_at = NOW()
      WHERE reconnection_request_id = ${parsedId.data} AND status = 'SUBMITTED'
      RETURNING reconnection_request_id AS "reconnectionRequestId", status`;
    if (!rows[0]) return res.status(409).json({ error: "Only submitted requests can be decided" });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

reconnectionsRouter.post("/:id/work-order", canCreateWorkOrder, async (req, res, next) => {
  const parsedId = id.safeParse(req.params.id);
  const parsed = z.object({
    description: z.string().trim().min(5).max(2000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "EMERGENCY"]).default("HIGH"),
  }).safeParse(req.body);
  if (!parsedId.success || !parsed.success) return res.status(400).json({ error: "Invalid work-order request" });
  try {
    const requests = await prisma.$queryRaw<any[]>`
      SELECT r.status, r.fee_payment_status, r.fee_payment_id, r.reconnection_fee,
        pay.payment_status, pay.payment_type, pay.amount AS paid_amount,
        r.account_id, r.request_number, a.property_id, p.zone_id
      FROM aquaflow.reconnection_requests r
      JOIN aquaflow.customer_accounts a ON a.account_id = r.account_id
      JOIN aquaflow.properties p ON p.property_id = a.property_id
      LEFT JOIN aquaflow.payments pay ON pay.payment_id=r.fee_payment_id
      WHERE r.reconnection_request_id = ${parsedId.data}`;
    const request = requests[0];
    if (!request) return res.status(404).json({ error: "Reconnection request not found" });
    if (request.status !== "APPROVED") return res.status(409).json({ error: "Approve the request before creating a work order" });
    if (request.fee_payment_status !== "PAID" || request.payment_status !== "POSTED" || request.payment_type !== "RECONNECTION_FEE" || Number(request.paid_amount) < Number(request.reconnection_fee)) {
      return res.status(409).json({ error: "A posted reconnection-fee payment is required before dispatch" });
    }
    const types = await prisma.$queryRaw<any[]>`
      SELECT work_order_type_id FROM aquaflow.work_order_types
      WHERE type_code = 'RECONNECTION' AND status = 'ACTIVE'`;
    if (!types[0]) return res.status(409).json({ error: "The RECONNECTION work-order type is not active" });
    const number = `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.$queryRaw<any[]>`
        INSERT INTO aquaflow.work_orders
          (work_order_number, work_order_type_id, account_id, property_id, zone_id,
           source_type, source_reference, priority, description, status, created_by)
        VALUES (${number}, ${types[0].work_order_type_id}, ${request.account_id},
          ${request.property_id}, ${request.zone_id}, 'SERVICE_REQUEST',
          ${request.request_number}, ${parsed.data.priority}, ${parsed.data.description},
          'CREATED', ${BigInt(req.user!.userId)})
        RETURNING work_order_id AS "workOrderId", work_order_number AS "workOrderNumber"`;
      await tx.$executeRaw`
        INSERT INTO aquaflow.work_order_updates
          (work_order_id, previous_status, new_status, notes)
        VALUES (${created[0].workOrderId}, NULL, 'CREATED',
          ${`Created from reconnection request ${request.request_number}`})`;
      await tx.$executeRaw`
        UPDATE aquaflow.reconnection_requests
        SET status='WORK_ORDER_CREATED', work_order_id=${created[0].workOrderId},
          disconnection_work_order_id=COALESCE(disconnection_work_order_id,(
            SELECT wo.work_order_id FROM aquaflow.work_orders wo
            JOIN aquaflow.work_order_types wt ON wt.work_order_type_id=wo.work_order_type_id
            WHERE wo.account_id=${request.account_id} AND wt.type_code='DISCONNECTION'
              AND wo.status IN ('COMPLETED','VERIFIED','CLOSED')
            ORDER BY wo.completed_at DESC NULLS LAST,wo.created_at DESC LIMIT 1
          )), updated_at=NOW()
        WHERE reconnection_request_id=${parsedId.data}`;
      return created[0];
    });
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});
