import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requirePermission } from "../middleware/auth";

export const serviceRequestsRouter = Router();
serviceRequestsRouter.use(requireAuth);
const canView = requirePermission("SERVICE_REQUEST_VIEW");
const canCreate = requirePermission("SERVICE_REQUEST_CREATE");
const canAssign = requirePermission("SERVICE_REQUEST_ASSIGN");
const canResolve = requirePermission("SERVICE_REQUEST_RESOLVE");
const id = z.coerce.bigint().positive();
const requestStatuses = ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER", "RESOLVED", "CLOSED", "CANCELLED"] as const;
function isMissingRouteCoverageTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2010" &&
    String(error.meta?.code) === "42P01";
}
const requestInclude = {
  customer: { select: { customerId: true, customerNumber: true, firstName: true, lastName: true, organizationName: true, phoneNumber: true } },
  account: {
    select: {
      accountId: true,
      accountNumber: true,
      currentBalance: true,
      property: {
        select: {
          serviceArea: {
            select: { serviceAreaId: true, areaCode: true, areaName: true },
          },
        },
      },
    },
  },
  creator: { select: { userId: true, firstName: true, lastName: true, username: true } },
  assignee: { select: { userId: true, firstName: true, lastName: true, username: true } },
} satisfies Prisma.ServiceRequestInclude;

serviceRequestsRouter.get("/dashboard", canView, async (_req, res) => {
  const [total, open, overdue, complaints, unassignedComplaints, resolved] = await Promise.all([
    prisma.serviceRequest.count(),
    prisma.serviceRequest.count({ where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"] } } }),
    prisma.serviceRequest.count({ where: { dueAt: { lt: new Date() }, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"] } } }),
    prisma.serviceRequest.count({ where: { requestType: "COMPLAINT" } }),
    prisma.serviceRequest.count({ where: { requestType: "COMPLAINT", assignedTo: null, status: { notIn: ["RESOLVED", "CLOSED", "CANCELLED"] } } }),
    prisma.serviceRequest.count({ where: { status: { in: ["RESOLVED", "CLOSED"] } } }),
  ]);
  res.json({ total, open, overdue, complaints, unassignedComplaints, resolved });
});

serviceRequestsRouter.get("/targets", canCreate, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const accounts = await prisma.customerAccount.findMany({
    where: q ? { OR: [
      { accountNumber: { contains: q, mode: "insensitive" } },
      { customer: { customerNumber: { contains: q, mode: "insensitive" } } },
      { customer: { firstName: { contains: q, mode: "insensitive" } } },
      { customer: { lastName: { contains: q, mode: "insensitive" } } },
      { customer: { organizationName: { contains: q, mode: "insensitive" } } },
    ] } : undefined,
    take: 100,
    orderBy: { accountNumber: "asc" },
    include: { customer: true, category: true, route: { include: { zone: true } } },
  });
  res.json(accounts);
});

serviceRequestsRouter.get("/officers", canView, async (_req, res) => {
  const [officers, routeCoverages] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        userType: { in: ["STAFF", "SYSTEM"] },
        fieldOfficer: { is: { status: "ACTIVE" } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        userId: true,
        firstName: true,
        lastName: true,
        username: true,
        fieldOfficer: {
          select: {
            fieldOfficerId: true,
            officerType: true,
            availabilityStatus: true,
            homeZone: { select: { zoneName: true } },
          },
        },
      },
    }),
    prisma.$queryRaw<any[]>`
      SELECT fo.user_id AS "userId", coverage.route_id AS "routeId",
             r.route_code AS "routeCode", r.route_name AS "routeName",
             z.zone_name AS "zoneName",
             COALESCE((
               SELECT jsonb_agg(area ORDER BY area->>'areaName')
               FROM (
                 SELECT DISTINCT jsonb_build_object(
                   'serviceAreaId', sa.service_area_id::text,
                   'areaCode', sa.area_code,
                   'areaName', sa.area_name
                 ) AS area
                 FROM aquaflow.properties property
                 JOIN aquaflow.service_areas sa ON sa.service_area_id = property.service_area_id
                 WHERE property.route_id = coverage.route_id AND sa.status = 'ACTIVE'
               ) service_areas
             ), '[]'::jsonb) AS "serviceAreas"
      FROM aquaflow.field_officer_route_coverages coverage
      JOIN aquaflow.field_officers fo ON fo.field_officer_id = coverage.field_officer_id
      JOIN aquaflow.routes r ON r.route_id = coverage.route_id
      JOIN aquaflow.zones z ON z.zone_id = r.zone_id
      WHERE coverage.status = 'ACTIVE' AND fo.status = 'ACTIVE' AND r.status = 'ACTIVE'
      ORDER BY z.zone_name, r.route_name`.catch((error) => {
        if (isMissingRouteCoverageTable(error)) return [];
        throw error;
      }),
  ]);
  res.json(officers.map((officer) => ({
    ...officer,
    fieldOfficer: officer.fieldOfficer ? {
      ...officer.fieldOfficer,
      routeAssignments: routeCoverages.filter((coverage) => coverage.userId === officer.userId),
    } : null,
  })));
});

serviceRequestsRouter.get("/", canView, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const take = Math.min(500, Math.max(10, Number(req.query.take) || 25));
  const q = String(req.query.q ?? "").trim();
  const scope = String(req.query.scope ?? "").toUpperCase();
  const activeStatuses = ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"];
  const where: Prisma.ServiceRequestWhereInput = {
    ...(q ? { OR: [
      { requestNumber: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { customer: { customerNumber: { contains: q, mode: "insensitive" } } },
      { account: { accountNumber: { contains: q, mode: "insensitive" } } },
    ] } : {}),
    ...(req.query.requestType ? { requestType: String(req.query.requestType) } : {}),
    ...(req.query.category ? { category: String(req.query.category) } : {}),
    ...(req.query.priority ? { priority: String(req.query.priority) } : {}),
    ...(scope === "OPEN"
      ? { status: { in: activeStatuses } }
      : scope === "OVERDUE"
        ? { status: { in: activeStatuses }, dueAt: { lt: new Date() } }
        : scope === "RESOLVED"
          ? { status: { in: ["RESOLVED", "CLOSED"] } }
          : req.query.status
            ? { status: String(req.query.status) }
            : {}),
    ...(req.query.assignedTo === "UNASSIGNED"
      ? { assignedTo: null }
      : req.query.assignedTo && /^\d+$/.test(String(req.query.assignedTo))
        ? { assignedTo: BigInt(String(req.query.assignedTo)) }
        : {}),
    ...(req.query.customerId ? { customerId: BigInt(String(req.query.customerId)) } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({
      where,
      include: requestInclude,
      orderBy: [
        { account: { property: { serviceArea: { areaName: "asc" } } } },
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * take,
      take,
    }),
  ]);
  res.json({ data, total, page, take, pages: Math.max(1, Math.ceil(total / take)) });
});

serviceRequestsRouter.patch("/bulk-assign", canAssign, async (req, res) => {
  const parsed = z.object({
    requestIds: z.array(id).min(1, "Select at least one task").max(500),
    assigneeIds: z.array(id).min(1, "Select at least one staff member").max(50),
    comments: z.string().trim().max(1000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const uniqueIds = [...new Set(parsed.data.requestIds.map(String))].map(BigInt);
  const uniqueAssigneeIds = [...new Set(parsed.data.assigneeIds.map(String))].map(BigInt);
  const [assignees, requests] = await Promise.all([
    prisma.user.findMany({
      where: {
        userId: { in: uniqueAssigneeIds },
        status: "ACTIVE",
        userType: { in: ["STAFF", "SYSTEM"] },
        fieldOfficer: { is: { status: "ACTIVE" } },
      },
      select: {
        userId: true,
        firstName: true,
        lastName: true,
        fieldOfficer: {
          select: {
            fieldOfficerId: true,
            homeZone: { select: { serviceAreas: { where: { status: "ACTIVE" }, select: { serviceAreaId: true } } } },
          },
        },
      },
    }),
    prisma.serviceRequest.findMany({
      where: { serviceRequestId: { in: uniqueIds } },
      select: {
        serviceRequestId: true,
        status: true,
        account: { select: { property: { select: { routeId: true, serviceAreaId: true, serviceArea: { select: { areaName: true } } } } } },
      },
    }),
  ]);
  if (assignees.length !== uniqueAssigneeIds.length) return res.status(400).json({ error: "One or more selected users are not active field officers" });
  if (requests.length !== uniqueIds.length) return res.status(404).json({ error: "One or more selected tasks no longer exist" });
  if (requests.some((item) => !["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"].includes(item.status))) {
    return res.status(400).json({ error: "Resolved, closed or cancelled tasks cannot be assigned" });
  }

  const fieldOfficerIds = assignees.flatMap((assignee) => assignee.fieldOfficer?.fieldOfficerId ? [assignee.fieldOfficer.fieldOfficerId] : []);
  const routeCoverages = fieldOfficerIds.length
    ? await prisma.$queryRaw<{ fieldOfficerId: bigint; routeId: bigint }[]>`
        SELECT field_officer_id AS "fieldOfficerId", route_id AS "routeId"
        FROM aquaflow.field_officer_route_coverages
        WHERE status = 'ACTIVE' AND field_officer_id IN (${Prisma.join(fieldOfficerIds)})`.catch((error) => {
          if (isMissingRouteCoverageTable(error)) return [];
          throw error;
        })
    : [];
  const coverageByOfficer = new Map<string, Set<string>>();
  routeCoverages.forEach((coverage) => {
    const officerKey = String(coverage.fieldOfficerId);
    const routes = coverageByOfficer.get(officerKey) ?? new Set<string>();
    routes.add(String(coverage.routeId));
    coverageByOfficer.set(officerKey, routes);
  });

  const areaPositions = new Map<string, number>();
  const allocations = requests
    .sort((left, right) => (left.account?.property.serviceArea?.areaName ?? "").localeCompare(right.account?.property.serviceArea?.areaName ?? ""))
    .map((request) => {
      const serviceAreaId = request.account?.property.serviceAreaId;
      const routeId = request.account?.property.routeId;
      const routeMatches = routeId
        ? assignees.filter((assignee) => assignee.fieldOfficer && coverageByOfficer.get(String(assignee.fieldOfficer.fieldOfficerId))?.has(String(routeId)))
        : [];
      const serviceAreaMatches = serviceAreaId
        ? assignees.filter((assignee) => assignee.fieldOfficer?.homeZone?.serviceAreas.some((area) => area.serviceAreaId === serviceAreaId))
        : [];
      const matchingAssignees = routeMatches.length ? routeMatches : serviceAreaMatches;
      const pool = matchingAssignees.length ? matchingAssignees : assignees;
      const areaKey = String(serviceAreaId ?? "UNASSIGNED");
      const position = areaPositions.get(areaKey) ?? 0;
      areaPositions.set(areaKey, position + 1);
      return { request, assignee: pool[position % pool.length] };
    });

  await prisma.$transaction(async (tx) => {
    for (const allocation of allocations) {
      await tx.serviceRequest.update({
        where: { serviceRequestId: allocation.request.serviceRequestId },
        data: {
          assignedTo: allocation.assignee.userId,
          ...(allocation.request.status === "OPEN" ? { status: "ASSIGNED" } : {}),
        },
      });
    }
    await tx.serviceRequestEvent.createMany({
      data: allocations.map(({ request, assignee }) => ({
        serviceRequestId: request.serviceRequestId,
        eventType: "ASSIGNED",
        oldStatus: request.status,
        newStatus: request.status === "OPEN" ? "ASSIGNED" : request.status,
        comments: parsed.data.comments || `Bulk assigned to ${assignee.firstName} ${assignee.lastName}`,
        performedBy: BigInt(req.user!.userId),
      })),
    });
  });

  const distribution = assignees.map((assignee) => ({
    userId: assignee.userId,
    firstName: assignee.firstName,
    lastName: assignee.lastName,
    assigned: allocations.filter((allocation) => allocation.assignee.userId === assignee.userId).length,
  }));
  res.json({ assigned: uniqueIds.length, assignees: distribution });
});

serviceRequestsRouter.get("/:id", canView, async (req, res) => {
  const parsed = id.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request id" });
  const [item, linkedWorkOrders] = await Promise.all([
    prisma.serviceRequest.findUnique({ where: { serviceRequestId: parsed.data }, include: { ...requestInclude, events: { include: { performer: { select: { firstName: true, lastName: true, username: true } } }, orderBy: { createdAt: "desc" } } } }),
    prisma.$queryRaw<any[]>`
      SELECT wo.work_order_id AS "workOrderId", wo.work_order_number AS "workOrderNumber",
             wo.status, wo.priority, wo.description, wo.scheduled_date AS "scheduledDate",
             wo.due_date AS "dueDate", wo.created_at AS "createdAt",
             wt.work_order_type_id AS "workOrderTypeId", wt.type_name AS "typeName",
             COALESCE(ARRAY(
               SELECT a.field_officer_id::text
               FROM aquaflow.work_order_assignments a
               WHERE a.work_order_id = wo.work_order_id AND a.status IN ('ASSIGNED','ACCEPTED')
               ORDER BY a.assigned_at
             ), ARRAY[]::text[]) AS "fieldOfficerIds",
             NULLIF((
               SELECT STRING_AGG(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ', ' ORDER BY a.assigned_at)
               FROM aquaflow.work_order_assignments a
               JOIN aquaflow.field_officers fo ON fo.field_officer_id = a.field_officer_id
               JOIN aquaflow.users u ON u.user_id = fo.user_id
               WHERE a.work_order_id = wo.work_order_id AND a.status IN ('ASSIGNED','ACCEPTED')
             ), '') AS "officerNames"
      FROM aquaflow.work_orders wo
      JOIN aquaflow.work_order_types wt ON wt.work_order_type_id = wo.work_order_type_id
      WHERE wo.service_request_id = ${parsed.data}
      ORDER BY wo.created_at DESC, wo.work_order_id DESC`,
  ]);
  if (!item) return res.status(404).json({ error: "Service request not found" });
  res.json({ ...item, linkedWorkOrders });
});

const createInput = z.object({
  accountId: id,
  requestType: z.enum(["SERVICE_REQUEST", "COMPLAINT"]),
  category: z.string().trim().min(2).max(60),
  subject: z.string().trim().min(3).max(180),
  description: z.string().trim().min(5).max(5000),
  contactChannel: z.enum(["PHONE", "EMAIL", "SMS", "WALK_IN", "WEB", "OTHER"]).default("PHONE"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assignedTo: id.optional().nullable(),
});
serviceRequestsRouter.post("/", canCreate, async (req, res) => {
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const [account, configuredType] = await Promise.all([
    prisma.customerAccount.findUnique({ where: { accountId: parsed.data.accountId } }),
    prisma.serviceRequestType.findFirst({ where: { typeCode: parsed.data.category, status: "ACTIVE" } }),
  ]);
  if (!account) return res.status(404).json({ error: "Customer account not found" });
  if (!configuredType) return res.status(400).json({ error: "Select an active service-request type" });
  const hours = configuredType.targetResolutionHours ?? { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 120 }[parsed.data.priority];
  const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const assignedTo = req.user!.roles.includes("CUSTOMER_METER_SERVICES")
    ? null
    : parsed.data.assignedTo ?? null;
  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.serviceRequest.create({ data: {
      ...parsed.data, customerId: account.customerId, assignedTo,
      status: assignedTo ? "ASSIGNED" : "OPEN", dueAt,
      requestNumber: `SR-${Date.now()}-${account.accountNumber}`.slice(0, 60), createdBy: BigInt(req.user!.userId),
    } });
    await tx.serviceRequestEvent.create({ data: { serviceRequestId: record.serviceRequestId, eventType: "CREATED", newStatus: record.status, comments: parsed.data.description, performedBy: BigInt(req.user!.userId) } });
    return record;
  });
  res.status(201).json(created);
});

serviceRequestsRouter.patch("/:id/assign", canAssign, async (req, res) => {
  const requestId = id.safeParse(req.params.id);
  const parsed = z.object({ assigneeId: id.nullable(), comments: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!requestId.success || !parsed.success) return res.status(400).json({ error: "Invalid assignment" });
  const current = await prisma.serviceRequest.findUnique({ where: { serviceRequestId: requestId.data } });
  if (!current) return res.status(404).json({ error: "Service request not found" });
  if (["CLOSED", "CANCELLED"].includes(current.status)) return res.status(400).json({ error: "Closed requests cannot be reassigned" });
  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { userId: parsed.data.assigneeId, status: "ACTIVE", userType: { in: ["STAFF", "SYSTEM"] } },
      select: { userId: true },
    });
    if (!assignee) return res.status(400).json({ error: "Select an active staff user" });
  }
  const nextStatus = parsed.data.assigneeId ? (current.status === "OPEN" ? "ASSIGNED" : current.status) : "OPEN";
  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.serviceRequest.update({ where: { serviceRequestId: requestId.data }, data: { assignedTo: parsed.data.assigneeId, status: nextStatus } });
    await tx.serviceRequestEvent.create({ data: { serviceRequestId: requestId.data, eventType: "ASSIGNED", oldStatus: current.status, newStatus: nextStatus, comments: parsed.data.comments, performedBy: BigInt(req.user!.userId) } });
    return record;
  });
  res.json(updated);
});

serviceRequestsRouter.patch("/:id/status", canResolve, async (req, res) => {
  const requestId = id.safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(requestStatuses), comments: z.string().trim().min(2).max(3000), resolution: z.string().trim().max(5000).optional() }).safeParse(req.body);
  if (!requestId.success || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid request id" : parsed.error.issues[0].message });
  if (["RESOLVED", "CLOSED"].includes(parsed.data.status) && !parsed.data.resolution) return res.status(400).json({ error: "A resolution is required before resolving or closing a request" });
  const current = await prisma.serviceRequest.findUnique({ where: { serviceRequestId: requestId.data } });
  if (!current) return res.status(404).json({ error: "Service request not found" });
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.serviceRequest.update({ where: { serviceRequestId: requestId.data }, data: {
      status: parsed.data.status, resolution: parsed.data.resolution,
      resolvedAt: parsed.data.status === "RESOLVED" ? now : current.resolvedAt,
      closedAt: parsed.data.status === "CLOSED" ? now : null,
    } });
    await tx.serviceRequestEvent.create({ data: { serviceRequestId: requestId.data, eventType: "STATUS_CHANGED", oldStatus: current.status, newStatus: parsed.data.status, comments: parsed.data.comments, performedBy: BigInt(req.user!.userId) } });
    return record;
  });
  res.json(updated);
});

serviceRequestsRouter.post("/:id/comments", canResolve, async (req, res) => {
  const requestId = id.safeParse(req.params.id);
  const parsed = z.object({ comments: z.string().trim().min(2).max(3000) }).safeParse(req.body);
  if (!requestId.success || !parsed.success) return res.status(400).json({ error: "A comment is required" });
  res.status(201).json(await prisma.serviceRequestEvent.create({ data: { serviceRequestId: requestId.data, eventType: "COMMENT", comments: parsed.data.comments, performedBy: BigInt(req.user!.userId) } }));
});
