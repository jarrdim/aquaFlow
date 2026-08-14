import { Prisma } from "@prisma/client";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isSystemAdmin, requireAuth, requirePermission } from "../middleware/auth";

export const workOrdersRouter = Router();
workOrdersRouter.use(requireAuth);

const canView = requirePermission("WORK_ORDER_VIEW");
const canCreate = requirePermission("WORK_ORDER_CREATE");
const canAssign = requirePermission("WORK_ORDER_ASSIGN");
const canExecute = requirePermission("WORK_ORDER_EXECUTE");
const canVerify = requirePermission("WORK_ORDER_VERIFY");
const id = z.coerce.bigint().positive();
const priorities = ["LOW", "NORMAL", "HIGH", "EMERGENCY"] as const;
const statuses = ["CREATED", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "VERIFIED", "CLOSED", "REOPENED", "CANCELLED"] as const;
const sourceTypes = ["MANUAL", "SERVICE_REQUEST", "COMPLAINT", "METER_ALERT", "DISCONNECTION"] as const;
const openStatuses = ["CREATED", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REOPENED"];

function csv(value: unknown) {
  return String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function userId(req: Express.Request) {
  return BigInt(req.user!.userId);
}

async function officerForUser(currentUserId: bigint) {
  const rows = await prisma.$queryRaw<{ field_officer_id: bigint }[]>`
    SELECT field_officer_id FROM aquaflow.field_officers
    WHERE user_id = ${currentUserId} AND status = 'ACTIVE'
    LIMIT 1`;
  return rows[0]?.field_officer_id ?? null;
}

async function enforceOfficerOwnership(req: Request, res: Response, workOrderId: bigint) {
  const officerId = await officerForUser(userId(req));
  // Administrative users without a field profile continue through the
  // permission-gated admin workflow. Any active field officer is restricted
  // to the latest assignment that belongs to them.
  if (!officerId) {
    const fieldRole = req.user?.roles.some((role) =>
      ["METER_READER", "FIELD_OFFICER"].includes(role),
    );
    if (fieldRole) {
      res.status(403).json({ error: "No active field officer profile is linked to this user" });
      return { officerId: null, allowed: false };
    }
    return { officerId: null, allowed: true };
  }
  const rows = await prisma.$queryRaw<{ field_officer_id: bigint; status: string }[]>`
    SELECT field_officer_id, status FROM aquaflow.work_order_assignments
    WHERE work_order_id = ${workOrderId}
    ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1`;
  if (!rows[0] || rows[0].field_officer_id !== officerId || !["ASSIGNED", "ACCEPTED"].includes(rows[0].status)) {
    res.status(403).json({ error: "This work order is not assigned to you" });
    return { officerId, allowed: false };
  }
  return { officerId, allowed: true };
}

workOrdersRouter.get("/dashboard", canView, async (_req, res) => {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','REOPENED'))::int AS open,
      COUNT(*) FILTER (WHERE status = 'CREATED')::int AS unassigned,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','REOPENED'))::int AS overdue,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS awaiting_verification,
      COUNT(*) FILTER (WHERE status IN ('VERIFIED','CLOSED'))::int AS verified
    FROM aquaflow.work_orders`;
  res.json(rows[0] ?? { total: 0, open: 0, unassigned: 0, overdue: 0, awaiting_verification: 0, verified: 0 });
});

workOrdersRouter.get("/lookups", canView, async (_req, res) => {
  const [types, zones, officers] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT work_order_type_id AS "workOrderTypeId", type_code AS "typeCode",
             type_name AS "typeName", requires_photo AS "requiresPhoto",
             requires_gps AS "requiresGps", requires_signature AS "requiresSignature"
      FROM aquaflow.work_order_types WHERE status = 'ACTIVE' ORDER BY type_name`,
    prisma.$queryRaw<any[]>`
      SELECT zone_id AS "zoneId", zone_code AS "zoneCode", zone_name AS "zoneName"
      FROM aquaflow.zones WHERE status = 'ACTIVE' ORDER BY zone_name`,
    prisma.$queryRaw<any[]>`
      SELECT fo.field_officer_id AS "fieldOfficerId", fo.employee_number AS "employeeNumber",
             fo.availability_status AS "availabilityStatus", fo.home_zone_id AS "homeZoneId",
             u.user_id AS "userId", u.first_name AS "firstName", u.last_name AS "lastName",
             u.username
      FROM aquaflow.field_officers fo
      JOIN aquaflow.users u ON u.user_id = fo.user_id
      WHERE fo.status = 'ACTIVE' AND u.status = 'ACTIVE'
      ORDER BY u.first_name, u.last_name`,
  ]);
  res.json({ types, zones, officers, priorities, statuses, sourceTypes });
});

workOrdersRouter.get("/targets", canCreate, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const pattern = `%${q}%`;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT ca.account_id AS "accountId", ca.account_number AS "accountNumber",
           ca.property_id AS "propertyId", p.zone_id AS "zoneId", z.zone_name AS "zoneName",
           c.customer_id AS "customerId", c.customer_number AS "customerNumber",
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS "customerName",
           ca.current_balance AS "currentBalance"
    FROM aquaflow.customer_accounts ca
    JOIN aquaflow.customers c ON c.customer_id = ca.customer_id
    JOIN aquaflow.properties p ON p.property_id = ca.property_id
    JOIN aquaflow.zones z ON z.zone_id = p.zone_id
    WHERE (${q} = '' OR ca.account_number ILIKE ${pattern} OR c.customer_number ILIKE ${pattern}
      OR c.first_name ILIKE ${pattern} OR c.middle_name ILIKE ${pattern}
      OR c.last_name ILIKE ${pattern} OR c.organization_name ILIKE ${pattern})
    ORDER BY ca.account_number`;
  res.json(rows);
});

workOrdersRouter.get("/", canView, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const take = Math.min(100, Math.max(10, Number(req.query.take) || 25));
  const q = String(req.query.q ?? "").trim();
  const clauses: Prisma.Sql[] = [];
  if (q) {
    const pattern = `%${q}%`;
    clauses.push(Prisma.sql`(
      wo.work_order_number ILIKE ${pattern} OR wo.description ILIKE ${pattern}
      OR ca.account_number ILIKE ${pattern} OR c.customer_number ILIKE ${pattern}
      OR c.first_name ILIKE ${pattern} OR c.last_name ILIKE ${pattern}
      OR c.organization_name ILIKE ${pattern}
    )`);
  }
  const statusValues = csv(req.query.status);
  if (statusValues.length) clauses.push(Prisma.sql`wo.status IN (${Prisma.join(statusValues)})`);
  const priorityValues = csv(req.query.priority);
  if (priorityValues.length) clauses.push(Prisma.sql`wo.priority IN (${Prisma.join(priorityValues)})`);
  const sourceValues = csv(req.query.sourceType);
  if (sourceValues.length) clauses.push(Prisma.sql`wo.source_type IN (${Prisma.join(sourceValues)})`);
  const zoneValues = csv(req.query.zoneId).map(BigInt);
  if (zoneValues.length) clauses.push(Prisma.sql`wo.zone_id IN (${Prisma.join(zoneValues)})`);
  const typeValues = csv(req.query.typeId).map(BigInt);
  if (typeValues.length) clauses.push(Prisma.sql`wo.work_order_type_id IN (${Prisma.join(typeValues)})`);
  const officerValues = csv(req.query.officerId).map(BigInt);
  if (officerValues.length) clauses.push(Prisma.sql`assignee.field_officer_id IN (${Prisma.join(officerValues)})`);
  const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
  const offset = (page - 1) * take;

  const base = Prisma.sql`
    FROM aquaflow.work_orders wo
    JOIN aquaflow.work_order_types wt ON wt.work_order_type_id = wo.work_order_type_id
    JOIN aquaflow.zones z ON z.zone_id = wo.zone_id
    LEFT JOIN aquaflow.customer_accounts ca ON ca.account_id = wo.account_id
    LEFT JOIN aquaflow.customers c ON c.customer_id = ca.customer_id
    LEFT JOIN LATERAL (
      SELECT a.assignment_id, a.field_officer_id, a.status AS assignment_status,
             u.first_name, u.last_name, u.username
      FROM aquaflow.work_order_assignments a
      JOIN aquaflow.field_officers fo ON fo.field_officer_id = a.field_officer_id
      JOIN aquaflow.users u ON u.user_id = fo.user_id
      WHERE a.work_order_id = wo.work_order_id
      ORDER BY a.assigned_at DESC LIMIT 1
    ) assignee ON TRUE`;
  const [countRows, data] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*)::int AS total ${base} ${where}`),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT wo.work_order_id AS "workOrderId", wo.work_order_number AS "workOrderNumber",
             wo.priority, wo.status, wo.description, wo.source_type AS "sourceType",
             wo.scheduled_date AS "scheduledDate", wo.due_date AS "dueDate",
             wo.created_at AS "createdAt", wt.work_order_type_id AS "workOrderTypeId",
             wt.type_code AS "typeCode", wt.type_name AS "typeName",
             z.zone_id AS "zoneId", z.zone_name AS "zoneName",
             ca.account_id AS "accountId", ca.account_number AS "accountNumber",
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS "customerName",
             assignee.assignment_id AS "assignmentId", assignee.field_officer_id AS "fieldOfficerId",
             assignee.assignment_status AS "assignmentStatus",
             NULLIF(TRIM(CONCAT_WS(' ', assignee.first_name, assignee.last_name)), '') AS "officerName"
      ${base} ${where}
      ORDER BY
        CASE wo.priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,
        wo.due_date NULLS LAST, wo.created_at DESC
      OFFSET ${offset} LIMIT ${take}`),
  ]);
  const total = countRows[0]?.total ?? 0;
  res.json({ data, total, page, take, pages: Math.max(1, Math.ceil(total / take)) });
});

workOrdersRouter.get("/:id", canView, async (req, res) => {
  const parsed = id.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid work order id" });
  const rows = await prisma.$queryRaw<any[]>`
    SELECT wo.*, wt.type_code, wt.type_name, wt.requires_photo, wt.requires_gps, wt.requires_signature,
           z.zone_code, z.zone_name, ca.account_number, c.customer_number,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS customer_name,
           sr.request_number AS service_request_number, sr.subject AS service_request_subject
    FROM aquaflow.work_orders wo
    JOIN aquaflow.work_order_types wt ON wt.work_order_type_id = wo.work_order_type_id
    JOIN aquaflow.zones z ON z.zone_id = wo.zone_id
    LEFT JOIN aquaflow.customer_accounts ca ON ca.account_id = wo.account_id
    LEFT JOIN aquaflow.customers c ON c.customer_id = ca.customer_id
    LEFT JOIN aquaflow.service_requests sr ON sr.service_request_id = wo.service_request_id
    WHERE wo.work_order_id = ${parsed.data}`;
  if (!rows[0]) return res.status(404).json({ error: "Work order not found" });
  const [assignments, updates, evidence, consumables] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT a.*, u.first_name, u.last_name, u.username
      FROM aquaflow.work_order_assignments a
      JOIN aquaflow.field_officers fo ON fo.field_officer_id = a.field_officer_id
      JOIN aquaflow.users u ON u.user_id = fo.user_id
      WHERE a.work_order_id = ${parsed.data} ORDER BY a.assigned_at DESC`,
    prisma.$queryRaw<any[]>`
      SELECT wu.*, u.first_name, u.last_name, u.username
      FROM aquaflow.work_order_updates wu
      LEFT JOIN aquaflow.field_officers fo ON fo.field_officer_id = wu.field_officer_id
      LEFT JOIN aquaflow.users u ON u.user_id = fo.user_id
      WHERE wu.work_order_id = ${parsed.data} ORDER BY wu.updated_at DESC`,
    prisma.$queryRaw<any[]>`
      SELECT * FROM aquaflow.work_order_evidence
      WHERE work_order_id = ${parsed.data} ORDER BY captured_at DESC`,
    prisma.$queryRaw<any[]>`
      SELECT wc.*, u.first_name, u.last_name
      FROM aquaflow.work_order_consumables wc
      JOIN aquaflow.users u ON u.user_id = wc.recorded_by
      WHERE wc.work_order_id = ${parsed.data} ORDER BY wc.recorded_at DESC`,
  ]);
  res.json({ ...rows[0], assignments, updates, evidence, consumables });
});

const createInput = z.object({
  workOrderTypeId: id,
  accountId: id.optional().nullable(),
  zoneId: id.optional().nullable(),
  fieldOfficerId: id.optional().nullable(),
  serviceRequestId: id.optional().nullable(),
  connectionApplicationId: id.optional().nullable(),
  sourceType: z.preprocess(
    (value) => typeof value === "string" ? value.toUpperCase() : value,
    z.enum(sourceTypes, { errorMap: () => ({ message: "Select a valid work order source" }) }),
  ).default("MANUAL"),
  priority: z.preprocess(
    (value) => typeof value === "string" ? value.toUpperCase() : value,
    z.enum(priorities, { errorMap: () => ({ message: "Select a valid priority" }) }),
  ).default("NORMAL"),
  description: z.string().trim().min(5).max(5000),
  scheduledDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
});

workOrdersRouter.post("/", canCreate, async (req, res) => {
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  let accountId = parsed.data.accountId ?? null;
  let serviceRequest: any = null;
  let connectionApplication: any = null;
  if (parsed.data.serviceRequestId) {
    serviceRequest = await prisma.serviceRequest.findUnique({ where: { serviceRequestId: parsed.data.serviceRequestId } });
    if (!serviceRequest) return res.status(404).json({ error: "Service request not found" });
    accountId ??= serviceRequest.accountId;
  }
  if (parsed.data.connectionApplicationId) {
    const applications = await prisma.$queryRaw<any[]>`
      SELECT connection_application_id, application_number, customer_id, account_id, zone_id, status
      FROM aquaflow.new_connection_applications
      WHERE connection_application_id = ${parsed.data.connectionApplicationId}`;
    connectionApplication = applications[0];
    if (!connectionApplication) return res.status(404).json({ error: "Connection application not found" });
    if (connectionApplication.status !== "CUSTOMER_CREATED") {
      return res.status(409).json({ error: "The connection must have a linked customer before its installation work order is created" });
    }
    accountId ??= connectionApplication.account_id;
    if (!accountId && connectionApplication.customer_id) {
      const accounts = await prisma.$queryRaw<{ account_id: bigint }[]>`
        SELECT account_id FROM aquaflow.customer_accounts
        WHERE customer_id = ${connectionApplication.customer_id}
        ORDER BY created_at DESC`;
      // An unambiguous existing account can be selected automatically. When a
      // customer has several premises the operator must choose the right one.
      if (accounts.length === 1) accountId = accounts[0].account_id;
    }
  }
  let zoneId = parsed.data.zoneId ?? null;
  zoneId ??= connectionApplication?.zone_id ?? null;
  let propertyId: bigint | null = null;
  if (accountId) {
    const targets = await prisma.$queryRaw<{ property_id: bigint; zone_id: bigint; customer_id: bigint }[]>`
      SELECT ca.property_id, p.zone_id, ca.customer_id
      FROM aquaflow.customer_accounts ca
      JOIN aquaflow.properties p ON p.property_id = ca.property_id
      WHERE ca.account_id = ${accountId}`;
    if (!targets[0]) return res.status(404).json({ error: "Customer account not found" });
    if (connectionApplication?.customer_id && targets[0].customer_id !== connectionApplication.customer_id) {
      return res.status(400).json({ error: "Select an account belonging to the customer linked to this connection" });
    }
    propertyId = targets[0].property_id;
    zoneId ??= targets[0].zone_id;
  }
  if (!zoneId) return res.status(400).json({ error: "Select a zone or customer account" });
  const type = await prisma.$queryRaw<any[]>`
    SELECT work_order_type_id FROM aquaflow.work_order_types
    WHERE work_order_type_id = ${parsed.data.workOrderTypeId} AND status = 'ACTIVE'`;
  if (!type[0]) return res.status(404).json({ error: "Work order type not found" });
  const fieldOfficerId = parsed.data.fieldOfficerId ?? null;
  if (fieldOfficerId) {
    const mayAssign = isSystemAdmin(req) || Boolean(await prisma.rolePermission.count({
      where: {
        permission: { permissionCode: "WORK_ORDER_ASSIGN" },
        role: {
          status: "ACTIVE",
          userRoles: { some: { userId: userId(req), status: "ACTIVE" } },
        },
      },
    }));
    if (!mayAssign) return res.status(403).json({ error: "You do not have permission to assign work orders" });
    const officer = await prisma.$queryRaw<any[]>`
      SELECT field_officer_id FROM aquaflow.field_officers
      WHERE field_officer_id = ${fieldOfficerId} AND status = 'ACTIVE'`;
    if (!officer[0]) return res.status(404).json({ error: "Field officer not found or inactive" });
  }
  const number = `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
  const created = await prisma.$transaction(async (tx) => {
    const initialStatus = fieldOfficerId ? "ASSIGNED" : "CREATED";
    const rows = await tx.$queryRaw<any[]>`
      INSERT INTO aquaflow.work_orders
        (work_order_number, work_order_type_id, account_id, property_id, zone_id,
         service_request_id, source_type, source_reference, priority, description,
         scheduled_date, due_date, status, created_by)
      VALUES
        (${number}, ${parsed.data.workOrderTypeId}, ${accountId}, ${propertyId}, ${zoneId},
         ${parsed.data.serviceRequestId ?? null}, ${parsed.data.serviceRequestId ? (serviceRequest?.requestType === "COMPLAINT" ? "COMPLAINT" : "SERVICE_REQUEST") : parsed.data.sourceType},
         ${serviceRequest?.requestNumber ?? null}, ${parsed.data.priority}, ${parsed.data.description},
         ${parsed.data.scheduledDate ?? null}, ${parsed.data.dueDate ?? null}, ${initialStatus}, ${userId(req)})
      RETURNING *`;
    if (fieldOfficerId) {
      await tx.$executeRaw`
        INSERT INTO aquaflow.work_order_assignments
          (work_order_id, field_officer_id, assigned_by, status)
        VALUES (${rows[0].work_order_id}, ${fieldOfficerId}, ${userId(req)}, 'ASSIGNED')`;
    }
    await tx.$executeRaw`
      INSERT INTO aquaflow.work_order_updates (work_order_id, previous_status, new_status, notes)
      VALUES (
        ${rows[0].work_order_id}, NULL, ${initialStatus},
        ${fieldOfficerId ? `${parsed.data.description}\n\nCreated and assigned from the work order form.` : parsed.data.description}
      )`;
    if (parsed.data.serviceRequestId) {
      await tx.serviceRequestEvent.create({ data: {
        serviceRequestId: parsed.data.serviceRequestId, eventType: "WORK_ORDER_CREATED",
        oldStatus: serviceRequest.status, newStatus: serviceRequest.status,
        comments: `${number} created`, performedBy: userId(req),
      } });
    }
    if (parsed.data.connectionApplicationId) {
      await tx.$executeRaw`
        UPDATE aquaflow.new_connection_applications
        SET work_order_id = ${rows[0].work_order_id}, account_id = ${accountId},
            status = 'INSTALLATION_ORDERED', updated_at = CURRENT_TIMESTAMP
        WHERE connection_application_id = ${parsed.data.connectionApplicationId}`;
      await tx.$executeRaw`
        INSERT INTO aquaflow.new_connection_activities
          (connection_application_id, activity_type, notes, performed_by)
        VALUES (${parsed.data.connectionApplicationId}, 'MARK_INSTALLATION_ORDERED',
          ${`${number} created and installation dispatched`}, ${userId(req)})`;
    }
    return rows[0];
  });
  res.status(201).json(created);
});

const assignInput = z.object({
  fieldOfficerId: id,
  scheduledDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2000).optional(),
});

workOrdersRouter.patch("/:id/assign", canAssign, async (req, res) => {
  const workOrderId = id.safeParse(req.params.id);
  const parsed = assignInput.safeParse(req.body);
  if (!workOrderId.success || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid work order id" : parsed.error.issues[0].message });
  const current = await prisma.$queryRaw<any[]>`SELECT status FROM aquaflow.work_orders WHERE work_order_id = ${workOrderId.data}`;
  if (!current[0]) return res.status(404).json({ error: "Work order not found" });
  if (["VERIFIED", "CLOSED", "CANCELLED"].includes(current[0].status)) return res.status(409).json({ error: "This work order can no longer be assigned" });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE aquaflow.work_order_assignments SET status = 'REASSIGNED'
      WHERE work_order_id = ${workOrderId.data} AND status IN ('ASSIGNED','ACCEPTED')`;
    await tx.$executeRaw`
      INSERT INTO aquaflow.work_order_assignments (work_order_id, field_officer_id, assigned_by, status)
      VALUES (${workOrderId.data}, ${parsed.data.fieldOfficerId}, ${userId(req)}, 'ASSIGNED')`;
    await tx.$executeRaw`
      UPDATE aquaflow.work_orders SET status = 'ASSIGNED',
        scheduled_date = COALESCE(${parsed.data.scheduledDate ?? null}, scheduled_date),
        due_date = COALESCE(${parsed.data.dueDate ?? null}, due_date), updated_at = CURRENT_TIMESTAMP
      WHERE work_order_id = ${workOrderId.data}`;
    await tx.$executeRaw`
      INSERT INTO aquaflow.work_order_updates (work_order_id, previous_status, new_status, notes)
      VALUES (${workOrderId.data}, ${current[0].status}, 'ASSIGNED', ${parsed.data.notes ?? "Work assigned"})`;
  });
  res.json({ message: "Work order assigned" });
});

const transitionInput = z.object({
  status: z.enum(statuses),
  notes: z.string().trim().min(2).max(5000),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
});
const transitions: Record<string, string[]> = {
  ASSIGNED: ["ACCEPTED", "REOPENED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "REOPENED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "REOPENED", "CANCELLED"],
  REOPENED: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  VERIFIED: ["CLOSED", "REOPENED"],
};

workOrdersRouter.patch("/:id/status", canExecute, async (req, res) => {
  const workOrderId = id.safeParse(req.params.id);
  const parsed = transitionInput.safeParse(req.body);
  if (!workOrderId.success || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid work order id" : parsed.error.issues[0].message });
  const ownership = await enforceOfficerOwnership(req, res, workOrderId.data);
  if (!ownership.allowed) return;
  const current = await prisma.$queryRaw<any[]>`SELECT status, service_request_id FROM aquaflow.work_orders WHERE work_order_id = ${workOrderId.data}`;
  if (!current[0]) return res.status(404).json({ error: "Work order not found" });
  if (!(transitions[current[0].status] ?? []).includes(parsed.data.status)) {
    return res.status(409).json({ error: `Cannot change a ${current[0].status} work order to ${parsed.data.status}` });
  }
  const officerId = ownership.officerId;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE aquaflow.work_orders SET status = ${parsed.data.status},
        started_at = CASE WHEN ${parsed.data.status} = 'IN_PROGRESS' THEN CURRENT_TIMESTAMP ELSE started_at END,
        completed_at = CASE WHEN ${parsed.data.status} = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        closed_at = CASE WHEN ${parsed.data.status} = 'CLOSED' THEN CURRENT_TIMESTAMP ELSE closed_at END,
        completion_notes = CASE WHEN ${parsed.data.status} = 'COMPLETED' THEN ${parsed.data.notes} ELSE completion_notes END,
        updated_at = CURRENT_TIMESTAMP WHERE work_order_id = ${workOrderId.data}`;
    await tx.$executeRaw`
      INSERT INTO aquaflow.work_order_updates
        (work_order_id, field_officer_id, previous_status, new_status, notes, gps_latitude, gps_longitude)
      VALUES (${workOrderId.data}, ${officerId}, ${current[0].status}, ${parsed.data.status}, ${parsed.data.notes},
              ${parsed.data.gpsLatitude ?? null}, ${parsed.data.gpsLongitude ?? null})`;
    if (parsed.data.status === "ACCEPTED" && officerId) {
      await tx.$executeRaw`
        UPDATE aquaflow.work_order_assignments SET status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP
        WHERE work_order_id = ${workOrderId.data} AND field_officer_id = ${officerId} AND status = 'ASSIGNED'`;
    }
    if (parsed.data.status === "COMPLETED" && officerId) {
      await tx.$executeRaw`
        UPDATE aquaflow.work_order_assignments SET status = 'COMPLETED'
        WHERE work_order_id = ${workOrderId.data} AND field_officer_id = ${officerId} AND status IN ('ASSIGNED','ACCEPTED')`;
    }
  });
  res.json({ message: `Work order changed to ${parsed.data.status}` });
});

const evidenceInput = z.object({
  evidenceType: z.enum(["BEFORE_PHOTO", "AFTER_PHOTO", "METER_PHOTO", "SIGNATURE", "CHECKLIST", "DOCUMENT"]),
  filePath: z.string().trim().min(2).max(10_000_000),
  description: z.string().trim().max(2000).optional(),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
});
workOrdersRouter.post("/:id/evidence", canExecute, async (req, res) => {
  const workOrderId = id.safeParse(req.params.id);
  const parsed = evidenceInput.safeParse(req.body);
  if (!workOrderId.success || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid work order id" : parsed.error.issues[0].message });
  const ownership = await enforceOfficerOwnership(req, res, workOrderId.data);
  if (!ownership.allowed) return;
  const officerId = ownership.officerId;
  const rows = await prisma.$queryRaw<any[]>`
    INSERT INTO aquaflow.work_order_evidence
      (work_order_id, evidence_type, file_path, description, gps_latitude, gps_longitude, captured_by)
    VALUES (${workOrderId.data}, ${parsed.data.evidenceType}, ${parsed.data.filePath}, ${parsed.data.description ?? null},
            ${parsed.data.gpsLatitude ?? null}, ${parsed.data.gpsLongitude ?? null}, ${officerId})
    RETURNING *`;
  res.status(201).json(rows[0]);
});

const consumableInput = z.object({
  materialName: z.string().trim().min(2).max(120),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1).max(30).default("item"),
  unitCost: z.coerce.number().nonnegative().optional().nullable(),
});
workOrdersRouter.post("/:id/consumables", canExecute, async (req, res) => {
  const workOrderId = id.safeParse(req.params.id);
  const parsed = consumableInput.safeParse(req.body);
  if (!workOrderId.success || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid work order id" : parsed.error.issues[0].message });
  const ownership = await enforceOfficerOwnership(req, res, workOrderId.data);
  if (!ownership.allowed) return;
  const rows = await prisma.$queryRaw<any[]>`
    INSERT INTO aquaflow.work_order_consumables
      (work_order_id, material_name, quantity, unit, unit_cost, recorded_by)
    VALUES (${workOrderId.data}, ${parsed.data.materialName}, ${parsed.data.quantity}, ${parsed.data.unit},
            ${parsed.data.unitCost ?? null}, ${userId(req)})
    RETURNING *`;
  res.status(201).json(rows[0]);
});

const verifyInput = z.object({
  decision: z.enum(["VERIFY", "RETURN"]),
  notes: z.string().trim().min(2).max(5000),
});
workOrdersRouter.patch("/:id/verify", canVerify, async (req, res) => {
  const workOrderId = id.safeParse(req.params.id);
  const parsed = verifyInput.safeParse(req.body);
  if (!workOrderId.success || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid work order id" : parsed.error.issues[0].message });
  const rows = await prisma.$queryRaw<any[]>`SELECT status FROM aquaflow.work_orders WHERE work_order_id = ${workOrderId.data}`;
  if (!rows[0]) return res.status(404).json({ error: "Work order not found" });
  if (rows[0].status !== "COMPLETED") return res.status(409).json({ error: "Only a completed work order can be verified or returned" });
  const nextStatus = parsed.data.decision === "VERIFY" ? "VERIFIED" : "REOPENED";
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE aquaflow.work_orders SET status = ${nextStatus},
        verified_by = CASE WHEN ${nextStatus} = 'VERIFIED' THEN ${userId(req)} ELSE NULL END,
        verified_at = CASE WHEN ${nextStatus} = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP WHERE work_order_id = ${workOrderId.data}`;
    await tx.$executeRaw`
      UPDATE aquaflow.work_order_evidence SET verification_status = ${parsed.data.decision === "VERIFY" ? "VERIFIED" : "PENDING"}
      WHERE work_order_id = ${workOrderId.data}`;
    await tx.$executeRaw`
      INSERT INTO aquaflow.work_order_updates (work_order_id, previous_status, new_status, notes)
      VALUES (${workOrderId.data}, 'COMPLETED', ${nextStatus}, ${parsed.data.notes})`;
  });
  res.json({ message: nextStatus === "VERIFIED" ? "Work order verified" : "Work order returned to the field" });
});

workOrdersRouter.patch("/:id/close", canVerify, async (req, res) => {
  const workOrderId = id.safeParse(req.params.id);
  const notes = z.string().trim().min(2).max(5000).safeParse(req.body?.notes);
  if (!workOrderId.success || !notes.success) return res.status(400).json({ error: "A closing comment is required" });
  const rows = await prisma.$queryRaw<any[]>`SELECT status, service_request_id FROM aquaflow.work_orders WHERE work_order_id = ${workOrderId.data}`;
  if (!rows[0]) return res.status(404).json({ error: "Work order not found" });
  if (rows[0].status !== "VERIFIED") return res.status(409).json({ error: "Verify the work order before closing it" });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE aquaflow.work_orders SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE work_order_id = ${workOrderId.data}`;
    await tx.$executeRaw`
      INSERT INTO aquaflow.work_order_updates (work_order_id, previous_status, new_status, notes)
      VALUES (${workOrderId.data}, 'VERIFIED', 'CLOSED', ${notes.data})`;
    if (rows[0].service_request_id) {
      const request = await tx.serviceRequest.findUnique({ where: { serviceRequestId: rows[0].service_request_id } });
      if (request && !["CLOSED", "CANCELLED"].includes(request.status)) {
        await tx.serviceRequest.update({ where: { serviceRequestId: request.serviceRequestId }, data: {
          status: "RESOLVED", resolution: notes.data, resolvedAt: new Date(),
        } });
        await tx.serviceRequestEvent.create({ data: {
          serviceRequestId: request.serviceRequestId, eventType: "WORK_ORDER_CLOSED",
          oldStatus: request.status, newStatus: "RESOLVED", comments: notes.data, performedBy: userId(req),
        } });
      }
    }
  });
  res.json({ message: "Work order closed and its source request resolved" });
});
