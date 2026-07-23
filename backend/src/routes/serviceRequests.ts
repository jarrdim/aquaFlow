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
const requestInclude = {
  customer: { select: { customerId: true, customerNumber: true, firstName: true, lastName: true, organizationName: true, phoneNumber: true } },
  account: { select: { accountId: true, accountNumber: true, currentBalance: true } },
  creator: { select: { userId: true, firstName: true, lastName: true, username: true } },
  assignee: { select: { userId: true, firstName: true, lastName: true, username: true } },
} satisfies Prisma.ServiceRequestInclude;

serviceRequestsRouter.get("/dashboard", canView, async (_req, res) => {
  const [total, open, overdue, complaints, resolved] = await Promise.all([
    prisma.serviceRequest.count(),
    prisma.serviceRequest.count({ where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"] } } }),
    prisma.serviceRequest.count({ where: { dueAt: { lt: new Date() }, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_CUSTOMER"] } } }),
    prisma.serviceRequest.count({ where: { requestType: "COMPLAINT" } }),
    prisma.serviceRequest.count({ where: { status: { in: ["RESOLVED", "CLOSED"] } } }),
  ]);
  res.json({ total, open, overdue, complaints, resolved });
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
  res.json(await prisma.user.findMany({
    where: { status: "ACTIVE", userType: { in: ["STAFF", "SYSTEM"] }, userRoles: { some: { status: "ACTIVE", role: { roleCode: { in: ["CUSTOMER_CARE_OFFICER", "SYSTEM_ADMIN"] } } } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { userId: true, firstName: true, lastName: true, username: true },
  }));
});

serviceRequestsRouter.get("/", canView, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const take = Math.min(100, Math.max(10, Number(req.query.take) || 25));
  const q = String(req.query.q ?? "").trim();
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
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.assignedTo ? { assignedTo: BigInt(String(req.query.assignedTo)) } : {}),
    ...(req.query.customerId ? { customerId: BigInt(String(req.query.customerId)) } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({ where, include: requestInclude, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], skip: (page - 1) * take, take }),
  ]);
  res.json({ data, total, page, take, pages: Math.max(1, Math.ceil(total / take)) });
});

serviceRequestsRouter.get("/:id", canView, async (req, res) => {
  const parsed = id.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request id" });
  const item = await prisma.serviceRequest.findUnique({ where: { serviceRequestId: parsed.data }, include: { ...requestInclude, events: { include: { performer: { select: { firstName: true, lastName: true, username: true } } }, orderBy: { createdAt: "desc" } } } });
  if (!item) return res.status(404).json({ error: "Service request not found" });
  res.json(item);
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
  const account = await prisma.customerAccount.findUnique({ where: { accountId: parsed.data.accountId } });
  if (!account) return res.status(404).json({ error: "Customer account not found" });
  const hours = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 120 }[parsed.data.priority];
  const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.serviceRequest.create({ data: {
      ...parsed.data, customerId: account.customerId, assignedTo: parsed.data.assignedTo ?? null,
      status: parsed.data.assignedTo ? "ASSIGNED" : "OPEN", dueAt,
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
