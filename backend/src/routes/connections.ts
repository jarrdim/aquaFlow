import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requirePermission } from "../middleware/auth";

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

const canView = requirePermission("CONNECTION_VIEW");
const canCreate = requirePermission("CONNECTION_CREATE");
const canProcess = requirePermission("CONNECTION_PROCESS");
const positiveId = z.coerce.bigint().positive();
const statuses = [
  "SUBMITTED", "INSPECTION_SCHEDULED", "INSPECTED", "QUOTED",
  "PARTIALLY_PAID", "PAID", "APPROVED", "CUSTOMER_CREATED",
  "INSTALLATION_ORDERED", "INSTALLATION_COMPLETED", "ACTIVE", "REJECTED",
] as const;

function normalizeKenyanPhone(value: unknown) {
  if (typeof value !== "string") return value;
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (compact.startsWith("0")) return `+254${compact.slice(1)}`;
  if (compact.startsWith("254")) return `+${compact}`;
  return compact;
}

function currentUserId(req: Express.Request) {
  return BigInt(req.user!.userId);
}

async function recordActivity(applicationId: bigint, type: string, notes: string | null, userId: bigint) {
  await prisma.$executeRaw`
    INSERT INTO aquaflow.new_connection_activities
      (connection_application_id, activity_type, notes, performed_by)
    VALUES (${applicationId}, ${type}, ${notes}, ${userId})`;
}

connectionsRouter.get("/dashboard", canView, async (_req, res) => {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('SUBMITTED','INSPECTION_SCHEDULED','INSPECTED','QUOTED','PARTIALLY_PAID','PAID','APPROVED','CUSTOMER_CREATED','INSTALLATION_ORDERED','INSTALLATION_COMPLETED'))::int AS open,
      COUNT(*) FILTER (WHERE status IN ('SUBMITTED','INSPECTION_SCHEDULED'))::int AS awaiting_inspection,
      COUNT(*) FILTER (WHERE status IN ('QUOTED','PARTIALLY_PAID'))::int AS awaiting_payment,
      COUNT(*) FILTER (WHERE status = 'PAID')::int AS awaiting_approval,
      COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
      COALESCE(SUM(quotation_total), 0) AS quoted_value,
      COALESCE(SUM(amount_paid), 0) AS collected_value
    FROM aquaflow.new_connection_applications`;
  res.json(rows[0]);
});

connectionsRouter.get("/lookups", canView, async (_req, res) => {
  const [zones, officers, fee] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT zone_id AS "zoneId", zone_code AS "zoneCode", zone_name AS "zoneName"
      FROM aquaflow.zones WHERE status = 'ACTIVE' ORDER BY zone_name`,
    prisma.$queryRaw<any[]>`
      SELECT u.user_id AS "userId", CONCAT_WS(' ', u.first_name, u.last_name) AS "name", u.username
      FROM aquaflow.users u WHERE u.status = 'ACTIVE' ORDER BY u.first_name, u.last_name`,
    prisma.$queryRaw<any[]>`
      SELECT default_connection_fee AS "defaultConnectionFee"
      FROM aquaflow.system_settings WHERE setting_id = 1`,
  ]);
  res.json({ zones, officers, defaultConnectionFee: fee[0]?.defaultConnectionFee ?? null, statuses });
});

connectionsRouter.get("/", canView, async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 25)));
  const search = String(req.query.search ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const zoneId = String(req.query.zoneId ?? "").trim();
  const pattern = `%${search}%`;
  const parsedZoneId = zoneId ? positiveId.safeParse(zoneId) : null;
  if (zoneId && !parsedZoneId?.success) return res.status(400).json({ error: "Invalid zone" });
  const zone = parsedZoneId?.success ? parsedZoneId.data : null;
  const offset = (page - 1) * pageSize;
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM aquaflow.new_connection_applications a
      WHERE (${search} = '' OR a.application_number ILIKE ${pattern}
        OR a.applicant_name ILIKE ${pattern} OR a.phone_number ILIKE ${pattern}
        OR COALESCE(a.identification_number, '') ILIKE ${pattern})
        AND (${status} = '' OR a.status = ${status})
        AND (${zone}::bigint IS NULL OR a.zone_id = ${zone})`,
    prisma.$queryRaw<any[]>`
      SELECT a.connection_application_id AS "connectionApplicationId",
        a.application_number AS "applicationNumber", a.applicant_name AS "applicantName",
        a.phone_number AS "phoneNumber", a.connection_type AS "connectionType",
        a.status, a.connection_fee AS "connectionFee", a.quotation_total AS "quotationTotal",
        a.amount_paid AS "amountPaid", a.created_at AS "createdAt",
        a.account_id AS "accountId", ca.account_number AS "accountNumber",
        z.zone_name AS "zoneName"
      FROM aquaflow.new_connection_applications a
      LEFT JOIN aquaflow.zones z ON z.zone_id = a.zone_id
      LEFT JOIN aquaflow.customer_accounts ca ON ca.account_id = a.account_id
      WHERE (${search} = '' OR a.application_number ILIKE ${pattern}
        OR a.applicant_name ILIKE ${pattern} OR a.phone_number ILIKE ${pattern}
        OR COALESCE(a.identification_number, '') ILIKE ${pattern})
        AND (${status} = '' OR a.status = ${status})
        AND (${zone}::bigint IS NULL OR a.zone_id = ${zone})
      ORDER BY a.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
  ]);
  const total = countRows[0]?.count ?? 0;
  res.json({ rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

connectionsRouter.get("/:id", canView, async (req, res) => {
  const parsed = positiveId.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid connection application" });
  const [applications, activities] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT a.*, a.connection_application_id AS "connectionApplicationId",
        a.application_number AS "applicationNumber", a.customer_id AS "customerId",
        a.applicant_type AS "applicantType", a.applicant_name AS "applicantName",
        a.identification_number AS "identificationNumber", a.phone_number AS "phoneNumber",
        a.email_address AS "emailAddress", a.physical_address AS "physicalAddress",
        a.plot_number AS "plotNumber", a.zone_id AS "zoneId",
        a.connection_type AS "connectionType", a.connection_fee AS "connectionFee",
        a.connection_fee_overridden AS "connectionFeeOverridden",
        a.fee_override_reason AS "feeOverrideReason",
        a.inspection_scheduled_at AS "inspectionScheduledAt",
        a.inspection_officer_id AS "inspectionOfficerId",
        a.inspection_outcome AS "inspectionOutcome", a.inspection_notes AS "inspectionNotes",
        a.materials_cost AS "materialsCost", a.labour_cost AS "labourCost",
        a.quotation_total AS "quotationTotal", a.amount_paid AS "amountPaid",
        a.payment_reference AS "paymentReference", a.decision_notes AS "decisionNotes",
        a.account_id AS "accountId", a.work_order_id AS "workOrderId",
        a.created_at AS "createdAt", a.updated_at AS "updatedAt",
        z.zone_name AS "zoneName"
      FROM aquaflow.new_connection_applications a
      LEFT JOIN aquaflow.zones z ON z.zone_id = a.zone_id
      WHERE a.connection_application_id = ${parsed.data}`,
    prisma.$queryRaw<any[]>`
      SELECT ac.connection_activity_id AS "connectionActivityId",
        ac.activity_type AS "activityType", ac.notes, ac.performed_at AS "performedAt",
        CONCAT_WS(' ', u.first_name, u.last_name) AS "performedByName"
      FROM aquaflow.new_connection_activities ac
      LEFT JOIN aquaflow.users u ON u.user_id = ac.performed_by
      WHERE ac.connection_application_id = ${parsed.data}
      ORDER BY ac.performed_at DESC`,
  ]);
  if (!applications[0]) return res.status(404).json({ error: "Connection application not found" });
  res.json({ ...applications[0], activities });
});

const createSchema = z.object({
  applicantType: z.enum(["INDIVIDUAL", "ORGANIZATION"]).default("INDIVIDUAL"),
  applicantName: z.string().trim().min(2).max(200),
  identificationNumber: z.string().trim().max(80).optional().nullable(),
  phoneNumber: z.preprocess(
    normalizeKenyanPhone,
    z.string().regex(/^\+254\d{9}$/, "Phone number must use +254 followed by 9 digits"),
  ),
  emailAddress: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
  physicalAddress: z.string().trim().min(3).max(300),
  plotNumber: z.string().trim().max(100).optional().nullable(),
  zoneId: z.coerce.bigint().positive().optional().nullable(),
  connectionType: z.enum(["DOMESTIC", "COMMERCIAL", "INSTITUTIONAL", "PUBLIC"]).default("DOMESTIC"),
  remarks: z.string().trim().max(1000).optional().nullable(),
  connectionFee: z.coerce.number().min(0).optional(),
  feeOverrideReason: z.string().trim().max(500).optional().nullable(),
});

connectionsRouter.post("/", canCreate, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const defaults = await prisma.$queryRaw<{ fee: any }[]>`
    SELECT default_connection_fee AS fee
    FROM aquaflow.system_settings WHERE setting_id = 1`;
  const configuredFee = defaults[0]?.fee;
  if (configuredFee == null && parsed.data.connectionFee === undefined) {
    return res.status(409).json({
      error: "The default connection fee is not configured. Set it in System Settings or enter an authorized application override.",
    });
  }
  const defaultFee = configuredFee == null ? null : Number(configuredFee);
  const fee = parsed.data.connectionFee ?? defaultFee!;
  const overridden =
    parsed.data.connectionFee !== undefined &&
    (defaultFee === null || parsed.data.connectionFee !== defaultFee);
  if (overridden && !parsed.data.feeOverrideReason) {
    return res.status(400).json({ error: "A reason is required when overriding the default connection fee" });
  }
  const number = `NC-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
  const rows = await prisma.$queryRaw<any[]>`
    INSERT INTO aquaflow.new_connection_applications
      (application_number, applicant_type, applicant_name, identification_number,
       phone_number, email_address, physical_address, plot_number, zone_id,
       connection_type, connection_fee, connection_fee_overridden, fee_override_reason,
       remarks, created_by)
    VALUES (${number}, ${parsed.data.applicantType}, ${parsed.data.applicantName},
      ${parsed.data.identificationNumber || null}, ${parsed.data.phoneNumber},
      ${parsed.data.emailAddress || null}, ${parsed.data.physicalAddress},
      ${parsed.data.plotNumber || null}, ${parsed.data.zoneId ?? null},
      ${parsed.data.connectionType}, ${fee}, ${overridden},
      ${parsed.data.feeOverrideReason || null}, ${parsed.data.remarks || null},
      ${currentUserId(req)})
    RETURNING connection_application_id AS "connectionApplicationId",
      application_number AS "applicationNumber", status`;
  await recordActivity(rows[0].connectionApplicationId, "APPLICATION_SUBMITTED", "New connection application registered", currentUserId(req));
  res.status(201).json(rows[0]);
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SCHEDULE_INSPECTION"), scheduledAt: z.coerce.date(), officerId: z.coerce.bigint().positive().optional().nullable(), notes: z.string().trim().max(1000).optional().nullable() }),
  z.object({ action: z.literal("RECORD_INSPECTION"), outcome: z.enum(["FEASIBLE", "NOT_FEASIBLE", "REVISIT"]), notes: z.string().trim().min(2).max(2000) }),
  z.object({ action: z.literal("ISSUE_QUOTATION"), materialsCost: z.coerce.number().min(0), labourCost: z.coerce.number().min(0), connectionFee: z.coerce.number().min(0).optional(), feeOverrideReason: z.string().trim().max(500).optional().nullable() }),
  z.object({ action: z.literal("RECORD_PAYMENT"), amount: z.coerce.number().positive(), reference: z.string().trim().min(2).max(120) }),
  z.object({ action: z.enum(["APPROVE", "REJECT", "MARK_INSTALLATION_ORDERED", "MARK_INSTALLATION_COMPLETED", "ACTIVATE"]), notes: z.string().trim().min(2).max(2000) }),
]);

connectionsRouter.patch("/:id/action", canProcess, async (req, res) => {
  const parsedId = positiveId.safeParse(req.params.id);
  const parsed = actionSchema.safeParse(req.body);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid application" });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid action" });
  const applicationId = parsedId.data;
  const current = await prisma.$queryRaw<any[]>`
    SELECT status, connection_fee, quotation_total, amount_paid
    FROM aquaflow.new_connection_applications WHERE connection_application_id = ${applicationId}`;
  if (!current[0]) return res.status(404).json({ error: "Connection application not found" });
  const data = parsed.data;
  const allowedStatuses: Record<typeof data.action, string[]> = {
    SCHEDULE_INSPECTION: ["SUBMITTED"],
    RECORD_INSPECTION: ["INSPECTION_SCHEDULED"],
    ISSUE_QUOTATION: ["INSPECTED"],
    RECORD_PAYMENT: ["QUOTED", "PARTIALLY_PAID"],
    APPROVE: ["PAID"],
    REJECT: ["PAID"],
    MARK_INSTALLATION_ORDERED: ["CUSTOMER_CREATED"],
    MARK_INSTALLATION_COMPLETED: ["INSTALLATION_ORDERED"],
    ACTIVATE: ["INSTALLATION_COMPLETED"],
  };
  if (!allowedStatuses[data.action].includes(current[0].status)) {
    return res.status(409).json({
      error: `This action is not available while the application is ${String(current[0].status).toLowerCase().replace(/_/g, " ")}. Refresh the application to see its current action.`,
    });
  }
  let note: string | null = "notes" in data ? (data.notes ?? null) : null;
  if (data.action === "SCHEDULE_INSPECTION") {
    await prisma.$executeRaw`UPDATE aquaflow.new_connection_applications SET status='INSPECTION_SCHEDULED', inspection_scheduled_at=${data.scheduledAt}, inspection_officer_id=${data.officerId ?? null}, inspection_notes=${data.notes || null}, updated_at=NOW() WHERE connection_application_id=${applicationId}`;
  } else if (data.action === "RECORD_INSPECTION") {
    const next = data.outcome === "FEASIBLE" ? "INSPECTED" : data.outcome === "NOT_FEASIBLE" ? "REJECTED" : "SUBMITTED";
    note = `Inspection outcome: ${data.outcome.replace(/_/g, " ")}. ${data.notes}`;
    await prisma.$executeRaw`
      UPDATE aquaflow.new_connection_applications
      SET status=${next},
        inspection_outcome=${data.outcome},
        inspection_notes=${data.notes},
        inspection_scheduled_at=CASE WHEN ${data.outcome}='REVISIT' THEN NULL ELSE inspection_scheduled_at END,
        inspection_officer_id=CASE WHEN ${data.outcome}='REVISIT' THEN NULL ELSE inspection_officer_id END,
        updated_at=NOW()
      WHERE connection_application_id=${applicationId}`;
  } else if (data.action === "ISSUE_QUOTATION") {
    const oldFee = Number(current[0].connection_fee);
    const fee = data.connectionFee ?? oldFee;
    const overridden = fee !== oldFee;
    if (overridden && !data.feeOverrideReason) return res.status(400).json({ error: "A reason is required to override the connection fee" });
    const total = fee + data.materialsCost + data.labourCost;
    note = `Quotation issued for KSh ${total.toFixed(2)}`;
    await prisma.$executeRaw`UPDATE aquaflow.new_connection_applications SET status='QUOTED', connection_fee=${fee}, connection_fee_overridden=(connection_fee_overridden OR ${overridden}), fee_override_reason=COALESCE(${data.feeOverrideReason || null}, fee_override_reason), materials_cost=${data.materialsCost}, labour_cost=${data.labourCost}, quotation_total=${total}, updated_at=NOW() WHERE connection_application_id=${applicationId}`;
  } else if (data.action === "RECORD_PAYMENT") {
    const paid = Number(current[0].amount_paid) + data.amount;
    const next = paid >= Number(current[0].quotation_total) ? "PAID" : "PARTIALLY_PAID";
    note = `Payment ${data.reference}: KSh ${data.amount.toFixed(2)}`;
    await prisma.$executeRaw`UPDATE aquaflow.new_connection_applications SET status=${next}, amount_paid=${paid}, payment_reference=${data.reference}, updated_at=NOW() WHERE connection_application_id=${applicationId}`;
  } else {
    const next = {
      APPROVE: "APPROVED", REJECT: "REJECTED",
      MARK_INSTALLATION_ORDERED: "INSTALLATION_ORDERED",
      MARK_INSTALLATION_COMPLETED: "INSTALLATION_COMPLETED", ACTIVATE: "ACTIVE",
    }[data.action];
    if (data.action === "APPROVE") {
      note = `${data.notes} Welcome SMS will be sent automatically when the customer account number is created.`;
    }
    await prisma.$executeRaw`UPDATE aquaflow.new_connection_applications SET status=${next}, decision_notes=${data.notes}, updated_at=NOW() WHERE connection_application_id=${applicationId}`;
  }
  await recordActivity(applicationId, data.action, note, currentUserId(req));
  res.json({ ok: true });
});

connectionsRouter.post("/:id/link-customer", canProcess, async (req, res) => {
  const applicationId = positiveId.safeParse(req.params.id);
  const customerId = positiveId.safeParse(req.body.customerId);
  if (!applicationId.success || !customerId.success) return res.status(400).json({ error: "Invalid application or customer" });
  const changed = await prisma.$executeRaw`
    UPDATE aquaflow.new_connection_applications
    SET customer_id=${customerId.data}, status='CUSTOMER_CREATED', updated_at=NOW()
    WHERE connection_application_id=${applicationId.data} AND status='APPROVED'`;
  if (!changed) return res.status(409).json({ error: "Only an approved application can create/link a customer" });
  await recordActivity(applicationId.data, "CUSTOMER_CREATED", `Customer ${customerId.data} linked through the existing customer wizard`, currentUserId(req));
  res.json({ ok: true });
});
