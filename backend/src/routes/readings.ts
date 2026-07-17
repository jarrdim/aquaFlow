import { Prisma, PrismaClient } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";

const prisma = new PrismaClient();
export const readingsRouter = Router();
readingsRouter.use(requireAuth);

const id = z.coerce.bigint().positive();
const dateText = z.string().min(1);
const evidenceSchema = z.object({
  evidenceType: z.enum(["METER_PHOTO", "SUPPORTING_DOCUMENT"]),
  fileName: z.string().max(255).optional(),
  mimeType: z.string().max(120).optional(),
  content: z.string().min(1).max(6_000_000),
});
const captureSchema = z.object({
  meterId: id,
  readingCycleId: id,
  fieldOfficerId: id.optional(),
  previousReading: z.coerce.number().min(0).optional(),
  currentReading: z.coerce.number().min(0),
  readingType: z.enum(["ACTUAL", "ESTIMATED", "SMART"]),
  estimationReason: z.string().trim().min(3).max(1000).optional(),
  readingDate: z.string().datetime().optional(),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional(),
  exceptionType: z.enum(["NONE", "TAMPERED"]).optional(),
  syncId: z.string().trim().min(6).max(100).optional(),
  remarks: z.string().trim().max(2000).optional(),
  evidence: z.array(evidenceSchema).max(3).default([]),
}).superRefine((value, ctx) => {
  if (value.readingType === "ESTIMATED" && !value.estimationReason) {
    ctx.addIssue({ code: "custom", path: ["estimationReason"], message: "An estimation reason is required" });
  }
  if ((value.gpsLatitude == null) !== (value.gpsLongitude == null)) {
    ctx.addIssue({ code: "custom", path: ["gpsLatitude"], message: "Both GPS coordinates are required together" });
  }
});

function userId(req: any) {
  return req.user?.userId ? BigInt(req.user.userId) : undefined;
}
function parse<T>(schema: z.ZodType<T>, input: unknown, res: any): T | undefined {
  const result = schema.safeParse(input);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return undefined;
  }
  return result.data;
}
function asDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function nameOf(user: any) {
  return user ? `${user.firstName} ${user.lastName}`.trim() : "Unassigned";
}

const readingInclude = {
  meter: true,
  account: { include: { customer: true, route: true, property: { include: { zone: true, route: true } } } },
  cycle: true,
  fieldOfficer: { include: { user: true } },
  approver: true,
  evidence: true,
  events: { include: { performer: true }, orderBy: { createdAt: "desc" as const } },
};

async function getEligibleAssignments(cycleId?: bigint, routeId?: bigint, zoneId?: bigint) {
  return prisma.meterAssignment.findMany({
    where: {
      assignmentStatus: "ACTIVE",
      removalDate: null,
      accountId: { not: null },
      meter: { status: "ACTIVE" },
      ...(routeId ? { account: { OR: [{ routeId }, { property: { routeId } }] } } : {}),
      ...(zoneId ? { account: { property: { zoneId } } } : {}),
    },
    include: {
      meter: { include: { readings: { orderBy: { readingDate: "desc" }, take: 1 } } },
      account: { include: { customer: true, route: true, property: { include: { route: true, zone: true } } } },
    },
    orderBy: { assignmentDate: "asc" },
  });
}

readingsRouter.get("/cycles", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const cycles = await prisma.readingCycle.findMany({
      where: status ? { status } : undefined,
      include: { creator: true, _count: { select: { readings: true, routeAssignments: true } } },
      orderBy: [{ startDate: "desc" }, { readingCycleId: "desc" }],
    });
    res.json(cycles);
  } catch (error) { next(error); }
});

readingsRouter.post("/cycles", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({
    cycleCode: z.string().trim().min(2).max(30),
    cycleName: z.string().trim().min(3).max(150),
    startDate: dateText,
    endDate: dateText,
    status: z.enum(["PLANNED", "OPEN"]).default("PLANNED"),
    remarks: z.string().trim().max(2000).optional(),
  }).refine((v) => asDate(v.endDate) >= asDate(v.startDate), { path: ["endDate"], message: "End date must be on or after start date" }), req.body, res);
  if (!data) return;
  try {
    const created = await prisma.readingCycle.create({ data: { ...data, startDate: asDate(data.startDate), endDate: asDate(data.endDate), createdBy: userId(req) } });
    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === "P2002") {
      const existing = await prisma.readingCycle.findUnique({ where: { cycleCode: data.cycleCode } });
      return res.status(409).json({
        error: existing?.status === "CANCELLED"
          ? "This cycle code belongs to a cancelled cycle. Reopen that cycle from the register or use a new code."
          : "Cycle code already exists",
      });
    }
    next(error);
  }
});

readingsRouter.patch("/cycles/:id", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR"), async (req, res, next) => {
  const cycleId = parse(id, req.params.id, res);
  const data = parse(z.object({
    cycleCode: z.string().trim().min(2).max(30),
    cycleName: z.string().trim().min(3).max(150),
    startDate: dateText,
    endDate: dateText,
    remarks: z.string().trim().max(2000).optional(),
  }).refine((v) => asDate(v.endDate) >= asDate(v.startDate), { path: ["endDate"], message: "End date must be on or after start date" }), req.body, res);
  if (!cycleId || !data) return;
  try {
    const cycle = await prisma.readingCycle.findUnique({ where: { readingCycleId: cycleId }, include: { _count: { select: { readings: true } } } });
    if (!cycle) return res.status(404).json({ error: "Reading cycle not found" });
    if (!["PLANNED", "CANCELLED"].includes(cycle.status)) return res.status(409).json({ error: "Only planned or cancelled cycles can be edited" });
    if (cycle._count.readings) return res.status(409).json({ error: "A cycle with captured readings cannot be edited" });
    const updated = await prisma.readingCycle.update({
      where: { readingCycleId: cycleId },
      data: { ...data, startDate: asDate(data.startDate), endDate: asDate(data.endDate), updatedAt: new Date() },
    });
    res.json(updated);
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "Cycle code already belongs to another cycle" });
    next(error);
  }
});

readingsRouter.patch("/cycles/:id/status", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR"), async (req, res, next) => {
  const cycleId = parse(id, req.params.id, res);
  const data = parse(z.object({ status: z.enum(["PLANNED", "OPEN", "CLOSED", "CANCELLED"]) }), req.body, res);
  if (!cycleId || !data) return;
  try {
    const cycle = await prisma.readingCycle.findUnique({ where: { readingCycleId: cycleId }, include: { _count: { select: { readings: true } } } });
    if (!cycle) return res.status(404).json({ error: "Reading cycle not found" });
    const allowedTransitions: Record<string, string[]> = {
      PLANNED: ["OPEN", "CANCELLED"],
      OPEN: ["CLOSED", "CANCELLED"],
      CLOSED: [],
      CANCELLED: ["PLANNED"],
    };
    if (!(allowedTransitions[cycle.status] ?? []).includes(data.status)) {
      return res.status(409).json({ error: `A ${cycle.status.toLowerCase()} cycle cannot be changed to ${data.status.toLowerCase()}` });
    }
    if (cycle.status === "CANCELLED" && data.status === "PLANNED" && cycle._count.readings) {
      return res.status(409).json({ error: "A cancelled cycle with captured readings cannot be reopened. Create a new cycle with a new code." });
    }
    if (data.status === "CANCELLED" && cycle._count.readings) {
      return res.status(409).json({ error: "A cycle with captured readings cannot be cancelled. Review the readings and close the cycle instead." });
    }
    if (data.status === "CLOSED") {
      const pending = await prisma.meterReading.count({ where: { readingCycleId: cycleId, approvalStatus: "PENDING" } });
      if (pending) return res.status(409).json({ error: `${pending} reading(s) still await approval` });
    }
    res.json(await prisma.readingCycle.update({ where: { readingCycleId: cycleId }, data: { status: data.status, updatedAt: new Date() } }));
  } catch (error) { next(error); }
});

readingsRouter.get("/officers", async (_req, res, next) => {
  try {
    const officers = await prisma.fieldOfficer.findMany({ where: { status: "ACTIVE", officerType: { in: ["METER_READER", "SUPERVISOR"] } }, include: { user: true, homeZone: true }, orderBy: { employeeNumber: "asc" } });
    res.json(officers.map((o) => ({ ...o, officerName: nameOf(o.user) })));
  } catch (error) { next(error); }
});

readingsRouter.get("/staff-candidates", async (_req, res, next) => {
  try {
    res.json(await prisma.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", fieldOfficer: null }, select: { userId: true, username: true, firstName: true, lastName: true, phoneNumber: true }, orderBy: { firstName: "asc" } }));
  } catch (error) { next(error); }
});

readingsRouter.post("/officers", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({ userId: id, employeeNumber: z.string().trim().min(2).max(40), phoneNumber: z.string().trim().min(7).max(30), homeZoneId: id.optional(), officerType: z.enum(["METER_READER", "SUPERVISOR"]).default("METER_READER") }), req.body, res);
  if (!data) return;
  try {
    res.status(201).json(await prisma.fieldOfficer.create({ data: { ...data, officerType: data.officerType ?? "METER_READER" } }));
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "This user or employee number already has a field profile" });
    next(error);
  }
});

readingsRouter.get("/assignments", async (req, res, next) => {
  try {
    const cycleId = req.query.cycleId ? BigInt(String(req.query.cycleId)) : undefined;
    const assignments = await prisma.routeAssignment.findMany({
      where: cycleId ? { readingCycleId: cycleId } : undefined,
      include: { cycle: true, route: { include: { zone: true } }, fieldOfficer: { include: { user: true } }, assigner: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(assignments.map((a) => ({ ...a, officerName: nameOf(a.fieldOfficer.user) })));
  } catch (error) { next(error); }
});

readingsRouter.post("/assignments", async (req, res, next) => {
  const data = parse(z.object({ readingCycleId: id, routeId: id, fieldOfficerId: id, assignedDate: dateText.optional(), remarks: z.string().trim().max(1000).optional() }), req.body, res);
  if (!data) return;
  try {
    const cycle = await prisma.readingCycle.findUnique({ where: { readingCycleId: data.readingCycleId } });
    if (!cycle || !["PLANNED", "OPEN"].includes(cycle.status)) return res.status(409).json({ error: "Routes can only be assigned to planned or open cycles" });
    const duplicate = await prisma.routeAssignment.findFirst({ where: { readingCycleId: data.readingCycleId, routeId: data.routeId, status: { in: ["ASSIGNED", "ACCEPTED"] } } });
    if (duplicate) return res.status(409).json({ error: "This route already has an active assignment for the cycle" });
    const created = await prisma.routeAssignment.create({ data: { ...data, assignedDate: data.assignedDate ? asDate(data.assignedDate) : undefined, assignedBy: userId(req) } });
    await prisma.fieldOfficer.update({ where: { fieldOfficerId: data.fieldOfficerId }, data: { availabilityStatus: "ASSIGNED" } });
    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "Duplicate route assignment" });
    next(error);
  }
});

readingsRouter.patch("/assignments/:id/status", async (req, res, next) => {
  const routeAssignmentId = parse(id, req.params.id, res);
  const data = parse(z.object({ status: z.enum(["ASSIGNED", "ACCEPTED", "COMPLETED", "REASSIGNED"]) }), req.body, res);
  if (!routeAssignmentId || !data) return;
  try {
    const updated = await prisma.routeAssignment.update({ where: { routeAssignmentId }, data: { status: data.status, completedAt: data.status === "COMPLETED" ? new Date() : null } });
    res.json(updated);
  } catch (error) { next(error); }
});

readingsRouter.get("/worklist", async (req, res, next) => {
  try {
    const cycleId = req.query.cycleId ? BigInt(String(req.query.cycleId)) : undefined;
    if (!cycleId) return res.status(400).json({ error: "cycleId is required" });
    const routeId = req.query.routeId ? BigInt(String(req.query.routeId)) : undefined;
    const zoneId = req.query.zoneId ? BigInt(String(req.query.zoneId)) : undefined;
    const search = String(req.query.search ?? "").toLowerCase();
    let items = await getEligibleAssignments(cycleId, routeId, zoneId);
    if (search) items = items.filter((a) => [a.meter.meterNumber, a.account?.accountNumber, a.account?.customer.firstName, a.account?.customer.lastName, a.account?.customer.organizationName].filter(Boolean).join(" ").toLowerCase().includes(search));
    const currentReadings = await prisma.meterReading.findMany({ where: { readingCycleId: cycleId, meterId: { in: items.map((a) => a.meterId) } } });
    const byMeter = new Map(currentReadings.map((reading) => [reading.meterId.toString(), reading]));
    res.json(items.map((a) => ({ ...a, cycleReading: byMeter.get(a.meterId.toString()) ?? null, route: a.account?.route ?? a.account?.property.route, zone: a.account?.property.zone, customerName: a.account?.customer.organizationName || `${a.account?.customer.firstName ?? ""} ${a.account?.customer.lastName ?? ""}`.trim() })));
  } catch (error) { next(error); }
});

async function capture(input: any, req: any) {
  if (input.syncId) {
    const existing = await prisma.meterReading.findUnique({ where: { syncId: input.syncId }, include: readingInclude });
    if (existing) return { reading: existing, duplicateSync: true };
  }
  const [meter, cycle] = await Promise.all([
    prisma.meter.findUnique({ where: { meterId: input.meterId }, include: { assignments: { where: { assignmentStatus: "ACTIVE", removalDate: null }, orderBy: { assignmentDate: "desc" }, take: 1 }, readings: { orderBy: { readingDate: "desc" }, take: 1 } } }),
    prisma.readingCycle.findUnique({ where: { readingCycleId: input.readingCycleId } }),
  ]);
  if (!meter) throw Object.assign(new Error("Meter not found"), { status: 404 });
  if (!cycle || cycle.status !== "OPEN") throw Object.assign(new Error("Readings can only be captured in an open cycle"), { status: 409 });
  const assignment = meter.assignments[0];
  if (!assignment?.accountId) throw Object.assign(new Error("Meter has no active customer account assignment"), { status: 409 });
  let fieldOfficerId = input.fieldOfficerId;
  if (!fieldOfficerId && req.user?.userId) {
    const officer = await prisma.fieldOfficer.findUnique({ where: { userId: BigInt(req.user.userId) }, select: { fieldOfficerId: true } });
    fieldOfficerId = officer?.fieldOfficerId;
  }
  const previous = Number(meter.readings[0]?.currentReading ?? meter.openingReading);
  if (input.previousReading != null && Math.abs(input.previousReading - previous) > 0.001) throw Object.assign(new Error(`Previous reading changed to ${previous}. Refresh before submitting.`), { status: 409 });
  const consumption = input.currentReading - previous;
  let exceptionType: string = input.exceptionType ?? "NONE";
  if (exceptionType === "NONE") {
    if (consumption < 0) exceptionType = "NEGATIVE";
    else if (consumption === 0) exceptionType = "ZERO";
    else {
      const history = await prisma.meterReading.findMany({ where: { meterId: input.meterId, approvalStatus: "APPROVED", consumption: { gt: 0 } }, select: { consumption: true }, orderBy: { readingDate: "desc" }, take: 6 });
      const average = history.length ? history.reduce((sum, r) => sum + Number(r.consumption), 0) / history.length : 0;
      if ((average && consumption > average * 2) || (!average && consumption > 100)) exceptionType = "HIGH";
      else if (average && consumption < average * 0.25) exceptionType = "LOW";
    }
  }
  const result = await prisma.$transaction(async (tx) => {
    const reading = await tx.meterReading.create({ data: {
      meterId: input.meterId, accountId: assignment.accountId, readingCycleId: input.readingCycleId,
      fieldOfficerId, previousReading: previous, currentReading: input.currentReading,
      readingType: input.readingType, estimationReason: input.estimationReason,
      readingDate: input.readingDate ? new Date(input.readingDate) : new Date(), photoPath: input.evidence.find((e: any) => e.evidenceType === "METER_PHOTO")?.fileName,
      gpsLatitude: input.gpsLatitude, gpsLongitude: input.gpsLongitude,
      abnormalFlag: exceptionType !== "NONE", exceptionType, syncId: input.syncId,
      evidence: { create: input.evidence },
      events: { create: { eventType: "CAPTURED", remarks: input.remarks, performedBy: userId(req), metadata: { source: input.syncId ? "SYNC" : "WEB" } } },
    }, include: readingInclude });
    await tx.meterEvent.create({ data: { meterId: input.meterId, assignmentId: assignment.assignmentId, eventType: "READING_CAPTURED", reading: input.currentReading, remarks: input.remarks, gpsLatitude: input.gpsLatitude, gpsLongitude: input.gpsLongitude, performedBy: userId(req), metadata: { readingId: reading.readingId.toString(), cycleId: input.readingCycleId.toString(), exceptionType } } });
    return reading;
  });
  return { reading: result, duplicateSync: false };
}

readingsRouter.post("/", async (req, res, next) => {
  const data = parse(captureSchema, req.body, res);
  if (!data) return;
  try {
    const result = await capture(data, req);
    res.status(result.duplicateSync ? 200 : 201).json(result);
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "A reading already exists for this meter and cycle" });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

readingsRouter.post("/sync", async (req, res, next) => {
  const body = parse(z.object({ readings: z.array(captureSchema).min(1).max(100) }), req.body, res);
  if (!body) return;
  const results: any[] = [];
  try {
    for (let index = 0; index < body.readings.length; index++) {
      try { results.push({ index, ok: true, ...(await capture(body.readings[index], req)) }); }
      catch (error: any) { results.push({ index, ok: false, error: error.code === "P2002" ? "Reading already exists for this cycle" : error.message }); }
    }
    res.json({ total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  } catch (error) { next(error); }
});

readingsRouter.get("/", async (req, res, next) => {
  try {
    const cycleId = req.query.cycleId ? BigInt(String(req.query.cycleId)) : undefined;
    const routeId = req.query.routeId ? BigInt(String(req.query.routeId)) : undefined;
    const approvalStatus = String(req.query.approvalStatus ?? "");
    const exceptionOnly = String(req.query.exceptionOnly ?? "") === "true";
    const readingType = String(req.query.readingType ?? "");
    const search = String(req.query.search ?? "");
    const where: Prisma.MeterReadingWhereInput = {
      ...(cycleId ? { readingCycleId: cycleId } : {}),
      ...(approvalStatus ? { approvalStatus } : {}),
      ...(exceptionOnly ? { abnormalFlag: true } : {}),
      ...(readingType ? { readingType } : {}),
      ...(routeId ? { account: { OR: [{ routeId }, { property: { routeId } }] } } : {}),
      ...(search ? { OR: [
        { meter: { meterNumber: { contains: search, mode: "insensitive" } } },
        { account: { accountNumber: { contains: search, mode: "insensitive" } } },
        { account: { customer: { firstName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { lastName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { organizationName: { contains: search, mode: "insensitive" } } } },
      ] } : {}),
    };
    res.json(await prisma.meterReading.findMany({ where, include: readingInclude, orderBy: { readingDate: "desc" }, take: 2000 }));
  } catch (error) { next(error); }
});

readingsRouter.patch("/:id/decision", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const readingId = parse(id, req.params.id, res);
  const data = parse(z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comments: z.string().trim().min(3).max(2000) }), req.body, res);
  if (!readingId || !data) return;
  try {
    const existing = await prisma.meterReading.findUnique({ where: { readingId } });
    if (!existing) return res.status(404).json({ error: "Reading not found" });
    if (existing.approvalStatus !== "PENDING") return res.status(409).json({ error: "This reading has already been decided" });
    const updated = await prisma.$transaction(async (tx) => {
      const reading = await tx.meterReading.update({ where: { readingId }, data: { approvalStatus: data.decision, approvalComments: data.comments, approvedBy: userId(req), approvedAt: new Date(), updatedAt: new Date() }, include: readingInclude });
      await tx.meterReadingEvent.create({ data: { readingId, eventType: data.decision, remarks: data.comments, performedBy: userId(req) } });
      await tx.meterEvent.create({ data: { meterId: existing.meterId, eventType: `READING_${data.decision}`, reading: existing.currentReading, remarks: data.comments, performedBy: userId(req), metadata: { readingId: readingId.toString() } } });
      return reading;
    });
    res.json(updated);
  } catch (error) { next(error); }
});

readingsRouter.get("/dashboard/summary", async (req, res, next) => {
  try {
    const cycle = req.query.cycleId ? await prisma.readingCycle.findUnique({ where: { readingCycleId: BigInt(String(req.query.cycleId)) } }) : await prisma.readingCycle.findFirst({ where: { status: "OPEN" }, orderBy: { startDate: "desc" } });
    const cycleId = cycle?.readingCycleId;
    const zoneId = req.query.zoneId ? BigInt(String(req.query.zoneId)) : undefined;
    const eligible = cycleId ? await getEligibleAssignments(cycleId, undefined, zoneId) : [];
    const meterIds = eligible.map((a) => a.meterId);
    const readings = cycleId ? await prisma.meterReading.findMany({ where: { readingCycleId: cycleId, ...(meterIds.length ? { meterId: { in: meterIds } } : zoneId ? { meterId: -1n } : {}) }, include: { meter: true, account: { include: { customer: true } }, fieldOfficer: { include: { user: true } } }, orderBy: { readingDate: "desc" } }) : [];
    const readIds = new Set(readings.map((r) => r.meterId.toString()));
    res.json({
      cycle,
      totalMeters: eligible.length,
      captured: readings.length,
      unread: eligible.filter((a) => !readIds.has(a.meterId.toString())).length,
      pending: readings.filter((r) => r.approvalStatus === "PENDING").length,
      approved: readings.filter((r) => r.approvalStatus === "APPROVED").length,
      rejected: readings.filter((r) => r.approvalStatus === "REJECTED").length,
      exceptions: readings.filter((r) => r.abnormalFlag).length,
      completionPercent: eligible.length ? Math.round((readings.length / eligible.length) * 1000) / 10 : 0,
      recent: readings.slice(0, 8),
    });
  } catch (error) { next(error); }
});

readingsRouter.get("/reports/progress", async (req, res, next) => {
  try {
    if (!req.query.cycleId) return res.status(400).json({ error: "cycleId is required" });
    const cycleId = BigInt(String(req.query.cycleId));
    const routes = await prisma.route.findMany({ where: { status: "ACTIVE" }, include: { zone: true }, orderBy: { routeName: "asc" } });
    const rows = [];
    for (const route of routes) {
      const eligible = await getEligibleAssignments(cycleId, route.routeId);
      const meterIds = eligible.map((a) => a.meterId);
      const readings = meterIds.length ? await prisma.meterReading.findMany({ where: { readingCycleId: cycleId, meterId: { in: meterIds } } }) : [];
      const routeAssignment = await prisma.routeAssignment.findFirst({ where: { readingCycleId: cycleId, routeId: route.routeId, status: { not: "REASSIGNED" } }, include: { fieldOfficer: { include: { user: true } } }, orderBy: { createdAt: "desc" } });
      rows.push({ route, assignedOfficer: routeAssignment ? nameOf(routeAssignment.fieldOfficer.user) : "Unassigned", totalMeters: eligible.length, captured: readings.length, unread: Math.max(eligible.length - readings.length, 0), approved: readings.filter((r) => r.approvalStatus === "APPROVED").length, exceptions: readings.filter((r) => r.abnormalFlag).length, completionPercent: eligible.length ? Math.round((readings.length / eligible.length) * 1000) / 10 : 0 });
    }
    res.json(rows);
  } catch (error) { next(error); }
});
