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
  gpsAccuracy: z.coerce.number().min(0).max(10_000).optional(),
  meterCondition: z.enum(["GOOD", "DAMAGED", "LEAKING", "TAMPERED", "INACCESSIBLE"]).default("GOOD"),
  anomalyReason: z.string().trim().min(3).max(1000).optional(),
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

function worklistSearch(search: string, exact: boolean): Prisma.MeterAssignmentWhereInput {
  const text = exact
    ? { equals: search, mode: Prisma.QueryMode.insensitive }
    : { contains: search, mode: Prisma.QueryMode.insensitive };
  return {
    OR: [
      { meter: { meterNumber: text } },
      { meter: { serialNumber: text } },
      { account: { accountNumber: text } },
      { account: { customer: { customerNumber: text } } },
      { account: { customer: { firstName: text } } },
      { account: { customer: { middleName: text } } },
      { account: { customer: { lastName: text } } },
      { account: { customer: { organizationName: text } } },
      { account: { customer: { phoneNumber: text } } },
    ],
  };
}

function readingWorklistSearch(search: string): Prisma.MeterReadingWhereInput {
  const terms = search.trim().split(/\s+/).filter(Boolean);
  return terms.length ? {
    AND: terms.map((term) => {
      const text = { contains: term, mode: Prisma.QueryMode.insensitive };
      return {
        OR: [
          { meter: { meterNumber: text } },
          { meter: { serialNumber: text } },
          { account: { accountNumber: text } },
          { account: { customer: { customerNumber: text } } },
          { account: { customer: { firstName: text } } },
          { account: { customer: { middleName: text } } },
          { account: { customer: { lastName: text } } },
          { account: { customer: { organizationName: text } } },
          { account: { customer: { phoneNumber: text } } },
        ],
      };
    }),
  } : {};
}

async function getEligibleAssignments(
  cycleId?: bigint,
  routeIds?: bigint[],
  zoneId?: bigint,
  search = "",
  meterId?: bigint,
  allowedRouteIds?: bigint[],
  accountIds?: bigint[],
) {
  const accountFilters: Prisma.CustomerAccountWhereInput[] = [
    { accountStatus: "ACTIVE" },
    ...(routeIds?.length
      ? [{
          OR: [
            { routeId: { in: routeIds } },
            { property: { routeId: { in: routeIds } } },
          ],
        } as Prisma.CustomerAccountWhereInput]
      : []),
    ...(allowedRouteIds
      ? [{
          OR: [
            { routeId: { in: allowedRouteIds } },
            { property: { routeId: { in: allowedRouteIds } } },
          ],
        } as Prisma.CustomerAccountWhereInput]
      : []),
    ...(zoneId ? [{ property: { zoneId } } as Prisma.CustomerAccountWhereInput] : []),
  ];
  const baseWhere: Prisma.MeterAssignmentWhereInput = {
    ...(meterId ? { meterId } : {}),
    assignmentStatus: "ACTIVE",
    removalDate: null,
    accountId: accountIds?.length ? { in: accountIds } : { not: null },
    account: { AND: accountFilters },
    meter: { status: "ACTIVE" },
  };
  const terms = search.trim().split(/\s+/).filter(Boolean);
  let searchWhere: Prisma.MeterAssignmentWhereInput | undefined;
  if (terms.length) {
    const exactWhere = worklistSearch(search.trim(), true);
    const hasExactMatch = await prisma.meterAssignment.findFirst({
      where: { AND: [baseWhere, exactWhere] },
      select: { assignmentId: true },
    });
    searchWhere = hasExactMatch
      ? exactWhere
      : { AND: terms.map((term) => worklistSearch(term, false)) };
  }

  return prisma.meterAssignment.findMany({
    where: searchWhere ? { AND: [baseWhere, searchWhere] } : baseWhere,
    include: {
      meter: { include: { readings: { orderBy: { readingDate: "desc" }, take: 1 } } },
      account: {
        include: {
          customer: true,
          route: { include: { zone: true } },
          property: {
            include: {
              route: { include: { zone: true } },
              zone: true,
              serviceArea: true,
            },
          },
        },
      },
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

readingsRouter.get("/pending-count", async (_req, res, next) => {
  try {
    const count = await prisma.meterReading.count({
      where: { approvalStatus: "PENDING" },
    });
    res.json({ count });
  } catch (error) {
    next(error);
  }
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

readingsRouter.post("/assignments/bulk", async (req, res, next) => {
  const data = parse(z.object({
    readingCycleId: id,
    assignedDate: dateText.optional(),
    remarks: z.string().trim().max(1000).optional(),
    assignments: z.array(z.object({
      routeId: id,
      fieldOfficerId: id,
    })).min(1).max(500),
  }), req.body, res);
  if (!data) return;
  try {
    const uniqueRouteIds = [...new Set(data.assignments.map((assignment) => assignment.routeId.toString()))].map(BigInt);
    if (uniqueRouteIds.length !== data.assignments.length) {
      return res.status(400).json({ error: "Each selected route may only appear once in a bulk assignment" });
    }
    const officerIds = [...new Set(data.assignments.map((assignment) => assignment.fieldOfficerId.toString()))].map(BigInt);
    const [cycle, routes, officers, existing] = await Promise.all([
      prisma.readingCycle.findUnique({ where: { readingCycleId: data.readingCycleId } }),
      prisma.route.findMany({ where: { routeId: { in: uniqueRouteIds }, status: "ACTIVE" }, select: { routeId: true, routeName: true } }),
      prisma.fieldOfficer.findMany({
        where: {
          fieldOfficerId: { in: officerIds },
          status: "ACTIVE",
          officerType: { in: ["METER_READER", "SUPERVISOR"] },
        },
        select: { fieldOfficerId: true },
      }),
      prisma.routeAssignment.findMany({
        where: {
          readingCycleId: data.readingCycleId,
          routeId: { in: uniqueRouteIds },
          status: { in: ["ASSIGNED", "ACCEPTED"] },
        },
        include: { route: { select: { routeName: true } } },
      }),
    ]);
    if (!cycle || !["PLANNED", "OPEN"].includes(cycle.status)) {
      return res.status(409).json({ error: "Routes can only be assigned to planned or open cycles" });
    }
    if (routes.length !== uniqueRouteIds.length) {
      return res.status(400).json({ error: "One or more selected routes are missing or inactive" });
    }
    if (officers.length !== officerIds.length) {
      return res.status(400).json({ error: "One or more selected meter readers are missing or inactive" });
    }
    if (existing.length) {
      const names = existing.slice(0, 5).map((assignment) => assignment.route.routeName).join(", ");
      const suffix = existing.length > 5 ? ` and ${existing.length - 5} more` : "";
      return res.status(409).json({
        error: `${existing.length} selected route(s) already have an active assignment for this cycle: ${names}${suffix}`,
      });
    }

    const assignedDate = data.assignedDate ? asDate(data.assignedDate) : undefined;
    const assignedBy = userId(req);
    const created = await prisma.$transaction(async (tx) => {
      const records = [];
      for (const assignment of data.assignments) {
        records.push(await tx.routeAssignment.create({
          data: {
            readingCycleId: data.readingCycleId,
            routeId: assignment.routeId,
            fieldOfficerId: assignment.fieldOfficerId,
            assignedDate,
            assignedBy,
            remarks: data.remarks,
          },
        }));
      }
      await tx.fieldOfficer.updateMany({
        where: { fieldOfficerId: { in: officerIds } },
        data: { availabilityStatus: "ASSIGNED", updatedAt: new Date() },
      });
      return records;
    });
    res.status(201).json({ created: created.length, assignments: created });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "One or more route assignments already exist. Refresh the planner and try again." });
    }
    next(error);
  }
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

readingsRouter.get("/worklist/captured-count", async (req, res, next) => {
  try {
    const cycleId = req.query.cycleId ? BigInt(String(req.query.cycleId)) : undefined;
    if (!cycleId) return res.status(400).json({ error: "cycleId is required" });
    const rawRouteIds = String(req.query.routeIds ?? req.query.routeId ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (rawRouteIds.some((value) => !/^\d+$/.test(value))) {
      return res.status(400).json({ error: "routeIds must contain valid route IDs" });
    }
    const requestedRouteIds = Array.from(new Set(rawRouteIds)).map((value) => BigInt(value));
    const zoneId = req.query.zoneId ? BigInt(String(req.query.zoneId)) : undefined;
    const meterId = req.query.meterId ? BigInt(String(req.query.meterId)) : undefined;
    const rawAccountIds = String(req.query.accountIds ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (rawAccountIds.some((value) => !/^\d+$/.test(value))) {
      return res.status(400).json({ error: "accountIds must contain valid account IDs" });
    }
    const accountIds = Array.from(new Set(rawAccountIds)).map((value) => BigInt(value));
    const search = String(req.query.search ?? "").trim();
    let allowedRouteIds: bigint[] | undefined;
    if (req.user?.roles.includes("METER_READER")) {
      const officer = await prisma.fieldOfficer.findUnique({
        where: { userId: BigInt(req.user.userId) },
        select: {
          status: true,
          routeAssignments: {
            where: { readingCycleId: cycleId, status: { in: ["ASSIGNED", "ACCEPTED"] } },
            select: { routeId: true },
          },
        },
      });
      if (!officer || officer.status !== "ACTIVE") {
        return res.status(403).json({ error: "No active field officer profile is linked to this user" });
      }
      allowedRouteIds = officer.routeAssignments.map((assignment) => assignment.routeId);
      if (requestedRouteIds.some((routeId) => !allowedRouteIds?.some((allowed) => allowed === routeId))) {
        return res.status(403).json({ error: "This route is not assigned to you for the selected cycle" });
      }
    }
    const effectiveRouteIds = requestedRouteIds.length ? requestedRouteIds : allowedRouteIds;
    const accountFilters: Prisma.CustomerAccountWhereInput[] = [
      ...(effectiveRouteIds ? [{
        OR: [
          { routeId: { in: effectiveRouteIds } },
          { property: { routeId: { in: effectiveRouteIds } } },
        ],
      } as Prisma.CustomerAccountWhereInput] : []),
      ...(zoneId ? [{ property: { zoneId } } as Prisma.CustomerAccountWhereInput] : []),
    ];
    const count = await prisma.meterReading.count({
      where: {
        readingCycleId: cycleId,
        ...(meterId ? { meterId } : {}),
        ...(accountIds.length ? { accountId: { in: accountIds } } : {}),
        ...(accountFilters.length ? { account: { AND: accountFilters } } : {}),
        ...readingWorklistSearch(search),
      },
    });
    res.json({ count });
  } catch (error) { next(error); }
});

readingsRouter.get("/worklist", async (req, res, next) => {
  try {
    const cycleId = req.query.cycleId ? BigInt(String(req.query.cycleId)) : undefined;
    if (!cycleId) return res.status(400).json({ error: "cycleId is required" });
    const rawRouteIds = String(req.query.routeIds ?? req.query.routeId ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (rawRouteIds.some((value) => !/^\d+$/.test(value))) {
      return res.status(400).json({ error: "routeIds must contain valid route IDs" });
    }
    const routeIds = Array.from(new Set(rawRouteIds)).map((value) => BigInt(value));
    const zoneId = req.query.zoneId ? BigInt(String(req.query.zoneId)) : undefined;
    const meterId = req.query.meterId ? BigInt(String(req.query.meterId)) : undefined;
    const missedCycleId = req.query.missedCycleId
      ? BigInt(String(req.query.missedCycleId))
      : undefined;
    const rawAccountIds = String(req.query.accountIds ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (rawAccountIds.some((value) => !/^\d+$/.test(value))) {
      return res.status(400).json({ error: "accountIds must contain valid account IDs" });
    }
    const accountIds = Array.from(new Set(rawAccountIds)).map((value) => BigInt(value));
    const search = String(req.query.search ?? "").trim();
    let allowedRouteIds: bigint[] | undefined;
    if (req.user?.roles.includes("METER_READER")) {
      const officer = await prisma.fieldOfficer.findUnique({
        where: { userId: BigInt(req.user.userId) },
        select: {
          status: true,
          routeAssignments: {
            where: {
              readingCycleId: cycleId,
              status: { in: ["ASSIGNED", "ACCEPTED"] },
            },
            select: { routeId: true },
          },
        },
      });
      if (!officer || officer.status !== "ACTIVE") {
        return res.status(403).json({ error: "No active field officer profile is linked to this user" });
      }
      allowedRouteIds = officer.routeAssignments.map((assignment) => assignment.routeId);
      if (
        routeIds.some(
          (routeId) => !allowedRouteIds?.some((allowed) => allowed === routeId),
        )
      ) {
        return res.status(403).json({ error: "This route is not assigned to you for the selected cycle" });
      }
    }
    const items = await getEligibleAssignments(
      cycleId,
      routeIds,
      zoneId,
      search,
      meterId,
      allowedRouteIds,
      accountIds,
    );
    const meterIds = items.map((assignment) => assignment.meterId);
    const [currentReadings, missedCycle] = await Promise.all([
      prisma.meterReading.findMany({
        where: { readingCycleId: cycleId, meterId: { in: meterIds } },
        include: { evidence: true },
      }),
      missedCycleId
        ? prisma.readingCycle.findUnique({
            where: { readingCycleId: missedCycleId },
            select: {
              readingCycleId: true,
              cycleCode: true,
              cycleName: true,
              endDate: true,
              status: true,
            },
          })
        : Promise.resolve(null),
    ]);
    if (missedCycleId && (!missedCycle || missedCycle.status !== "CLOSED")) {
      return res.status(400).json({
        error: "The carry-forward source must be a closed reading cycle",
      });
    }
    if (missedCycleId === cycleId) {
      return res.status(400).json({
        error: "The carry-forward source must be different from the selected reading cycle",
      });
    }
    const missedCycleReadings = missedCycle
      ? await prisma.meterReading.findMany({
          where: {
            readingCycleId: missedCycle.readingCycleId,
            meterId: { in: meterIds },
          },
          select: { meterId: true },
        })
      : [];
    const byMeter = new Map(currentReadings.map((reading) => [reading.meterId.toString(), reading]));
    const readInMissedCycle = new Set(
      missedCycleReadings.map((reading) => reading.meterId.toString()),
    );
    const visibleItems = missedCycle
      ? items.filter(
          (assignment) =>
            assignment.assignmentDate <= missedCycle.endDate &&
            !byMeter.has(assignment.meterId.toString()) &&
            !readInMissedCycle.has(assignment.meterId.toString()),
        )
      : items;
    res.json(visibleItems.map((a) => ({
      ...a,
      cycleReading: byMeter.get(a.meterId.toString()) ?? null,
      missedCycleUnread: Boolean(missedCycle),
      missedCycle: missedCycle
        ? {
            readingCycleId: missedCycle.readingCycleId,
            cycleCode: missedCycle.cycleCode,
            cycleName: missedCycle.cycleName,
          }
        : null,
      route: a.account?.route ?? a.account?.property.route,
      zone: a.account?.property.zone,
      customerName:
        a.account?.customer.organizationName ||
        [
          a.account?.customer.firstName,
          a.account?.customer.middleName,
          a.account?.customer.lastName,
        ]
          .filter(Boolean)
          .join(" "),
    })));
  } catch (error) { next(error); }
});

async function capture(input: any, req: any) {
  if (input.syncId) {
    const existing = await prisma.meterReading.findUnique({ where: { syncId: input.syncId }, include: readingInclude });
    if (existing) return { reading: existing, duplicateSync: true };
  }
  const [meter, cycle] = await Promise.all([
    prisma.meter.findUnique({ where: { meterId: input.meterId }, include: {
      assignments: {
        where: { assignmentStatus: "ACTIVE", removalDate: null },
        include: { account: { include: { property: true } } },
        orderBy: { assignmentDate: "desc" },
        take: 1,
      },
      readings: { orderBy: { readingDate: "desc" }, take: 1 },
    } }),
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
  if (req.user?.roles.includes("METER_READER")) {
    const officer = await prisma.fieldOfficer.findUnique({
      where: { userId: BigInt(req.user.userId) },
      select: {
        fieldOfficerId: true,
        status: true,
        routeAssignments: {
          where: {
            readingCycleId: input.readingCycleId,
            status: { in: ["ASSIGNED", "ACCEPTED"] },
          },
          select: { routeId: true },
        },
      },
    });
    if (!officer || officer.status !== "ACTIVE") {
      throw Object.assign(new Error("No active field officer profile is linked to this user"), { status: 403 });
    }
    const accountRouteId = assignment.account?.routeId ?? assignment.account?.property.routeId;
    if (
      !accountRouteId ||
      !officer.routeAssignments.some((routeAssignment) => routeAssignment.routeId === accountRouteId)
    ) {
      throw Object.assign(new Error("This meter is not on a route assigned to you for this cycle"), { status: 403 });
    }
    fieldOfficerId = officer.fieldOfficerId;
  }
  const previous = Number(meter.readings[0]?.currentReading ?? meter.openingReading);
  if (input.previousReading != null && Math.abs(input.previousReading - previous) > 0.001) throw Object.assign(new Error(`Previous reading changed to ${previous}. Refresh before submitting.`), { status: 409 });
  const consumption = input.currentReading - previous;
  if (consumption < 0) {
    throw Object.assign(
      new Error(`Current reading cannot be below the previous reading of ${previous}. Check the meter value before submitting.`),
      { status: 400 },
    );
  }
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
      events: { create: { eventType: "CAPTURED", remarks: input.remarks, performedBy: userId(req), metadata: {
        source: input.syncId ? "SYNC" : "WEB",
        meterCondition: input.meterCondition,
        gpsAccuracy: input.gpsAccuracy,
        anomalyReason: input.anomalyReason,
      } } },
    }, include: readingInclude });
    await tx.meterEvent.create({ data: { meterId: input.meterId, assignmentId: assignment.assignmentId, eventType: "READING_CAPTURED", reading: input.currentReading, remarks: input.remarks, gpsLatitude: input.gpsLatitude, gpsLongitude: input.gpsLongitude, performedBy: userId(req), metadata: { readingId: reading.readingId.toString(), cycleId: input.readingCycleId.toString(), exceptionType } } });
    return reading;
  });
  return { reading: result, duplicateSync: false };
}

readingsRouter.post(
  "/",
  requireRole("SYSTEM_ADMIN", "METER_READER", "METER_SUPERVISOR", "SUPERVISOR"),
  async (req, res, next) => {
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
  },
);

readingsRouter.post(
  "/sync",
  requireRole("SYSTEM_ADMIN", "METER_READER", "METER_SUPERVISOR", "SUPERVISOR"),
  async (req, res, next) => {
  const body = parse(z.object({ readings: z.array(captureSchema).min(1).max(100) }), req.body, res);
  if (!body) return;
  const results: any[] = [];
  try {
    for (let index = 0; index < body.readings.length; index++) {
      try { results.push({ index, ok: true, ...(await capture(body.readings[index], req)) }); }
      catch (error: any) {
        const statusCode = error.code === "P2002" ? 409 : Number(error.status) || 500;
        results.push({
          index,
          ok: false,
          statusCode,
          retryable: statusCode === 429 || statusCode >= 500,
          error: error.code === "P2002" ? "Reading already exists for this cycle" : error.message,
        });
      }
    }
    res.json({ total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  } catch (error) { next(error); }
  },
);

const requiredReadingNumber = z.preprocess(
  (value) => value === null || value === undefined || (typeof value === "string" && value.trim() === "") ? undefined : value,
  z.coerce.number().finite().min(0),
);

const legacyCurrentImportSchema = z.object({
  items: z.array(z.object({
    meterNumber: z.string().trim().min(1),
    accountNumber: z.string().trim().min(1),
    cycleCode: z.string().trim().min(1).max(50),
    cycleStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cycleEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    previousReading: requiredReadingNumber,
    currentReading: requiredReadingNumber,
    readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1).max(1000),
});

readingsRouter.post("/bulk-import-current", async (req, res, next) => {
  const parsed = legacyCurrentImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rows = parsed.data.items;
  let importStage = "validating cycle details";
  try {
    const cycleCodes = [...new Set(rows.map((row) => row.cycleCode))];
    if (cycleCodes.length !== 1) return res.status(400).json({ error: "Each batch must contain one reading cycle" });
    const cycleCode = cycleCodes[0];
    const cycleStarts = [...new Set(rows.map((row) => row.cycleStartDate))];
    const cycleEnds = [...new Set(rows.map((row) => row.cycleEndDate))];
    if (cycleStarts.length !== 1 || cycleEnds.length !== 1) return res.status(400).json({ error: "Each cycle must have one consistent start and end date" });
    const cycleStart = new Date(`${cycleStarts[0]}T00:00:00.000Z`);
    const cycleEnd = new Date(`${cycleEnds[0]}T00:00:00.000Z`);
    if (cycleEnd < cycleStart) return res.status(400).json({ error: "Cycle end date cannot be before its start date" });
    importStage = "loading or creating the reading cycle";
    let cycle = await prisma.readingCycle.findUnique({ where: { cycleCode } });
    if (!cycle) {
      cycle = await prisma.readingCycle.create({
        data: {
          cycleCode,
          cycleName: `Legacy current readings ${cycleCode.replace(/^RC-/, "")}`,
          startDate: cycleStart,
          endDate: cycleEnd,
          status: "CLOSED",
          createdBy: req.user ? BigInt(req.user.userId) : null,
          remarks: "Imported from MajiWare MeterReadingsCurrent",
        },
      });
    } else {
      if (cycleStart.getTime() !== cycle.startDate.getTime() || cycleEnd.getTime() !== cycle.endDate.getTime()) {
        cycle = await prisma.readingCycle.update({
          where: { readingCycleId: cycle.readingCycleId },
          data: { startDate: cycleStart, endDate: cycleEnd },
        });
      }
    }
    importStage = "matching meters and customer accounts";
    const [meters, accounts] = await Promise.all([
      prisma.meter.findMany({ where: { meterNumber: { in: rows.map((row) => row.meterNumber) } }, select: { meterId: true, meterNumber: true } }),
      prisma.customerAccount.findMany({ where: { accountNumber: { in: rows.map((row) => row.accountNumber) } }, select: { accountId: true, accountNumber: true } }),
    ]);
    const meterIds = new Map(meters.map((row) => [row.meterNumber, row.meterId]));
    const accountIds = new Map(accounts.map((row) => [row.accountNumber, row.accountId]));
    const syncIds = rows.map((row) => `legacy-current-${cycleCode}-${row.meterNumber}`);
    importStage = "checking existing imported readings";
    const existing = await prisma.meterReading.findMany({ where: { syncId: { in: syncIds } }, select: { syncId: true } });
    const existingSyncIds = new Set(existing.map((row) => row.syncId));
    const seenMeters = new Set<string>();
    const errors: string[] = [];
    rows.forEach((row, index) => {
      const line = index + 2;
      if (!meterIds.has(row.meterNumber)) errors.push(`Row ${line}: meter ${row.meterNumber} was not found.`);
      if (!accountIds.has(row.accountNumber)) errors.push(`Row ${line}: account ${row.accountNumber} was not found.`);
      if (seenMeters.has(row.meterNumber)) errors.push(`Row ${line}: meter ${row.meterNumber} appears more than once.`);
      seenMeters.add(row.meterNumber);
    });
    if (errors.length) return res.status(409).json({ error: errors.slice(0, 100).join("\n") });

    const newRows = rows.filter((row) => !existingSyncIds.has(`legacy-current-${cycleCode}-${row.meterNumber}`));
    importStage = "saving the reading batch";
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.meterReading.createMany({
        skipDuplicates: true,
        data: newRows.map((row) => ({
          meterId: meterIds.get(row.meterNumber)!,
          accountId: accountIds.get(row.accountNumber)!,
          readingCycleId: cycle!.readingCycleId,
          previousReading: row.previousReading,
          currentReading: row.currentReading,
          readingType: "ACTUAL",
          readingDate: new Date(`${row.readingDate}T00:00:00.000Z`),
          abnormalFlag: row.currentReading < row.previousReading,
          exceptionType: row.currentReading < row.previousReading ? "NEGATIVE" : "NONE",
          approvalStatus: "APPROVED",
          approvalComments: "Imported legacy previous/current reading pair",
          approvedBy: req.user ? BigInt(req.user.userId) : null,
          approvedAt: new Date(),
          syncId: `legacy-current-${cycleCode}-${row.meterNumber}`,
        })),
      });

      // A retry must also repair any legacy row that has the correct sync ID but
      // was previously linked to the wrong cycle/account.
      for (const row of rows.filter((item) => existingSyncIds.has(`legacy-current-${cycleCode}-${item.meterNumber}`))) {
        await tx.meterReading.update({
          where: { syncId: `legacy-current-${cycleCode}-${row.meterNumber}` },
          data: {
            meterId: meterIds.get(row.meterNumber)!,
            accountId: accountIds.get(row.accountNumber)!,
            readingCycleId: cycle!.readingCycleId,
            previousReading: row.previousReading,
            currentReading: row.currentReading,
            readingDate: new Date(`${row.readingDate}T00:00:00.000Z`),
            readingType: "ACTUAL",
            abnormalFlag: row.currentReading < row.previousReading,
            exceptionType: row.currentReading < row.previousReading ? "NEGATIVE" : "NONE",
            approvalStatus: "APPROVED",
            approvalComments: "Imported legacy previous/current reading pair",
            approvedBy: req.user ? BigInt(req.user.userId) : null,
            approvedAt: new Date(),
          },
        });
      }

      const verified = await tx.meterReading.count({
        where: {
          readingCycleId: cycle!.readingCycleId,
          syncId: { in: syncIds },
        },
      });
      return { created: created.count, verified };
    }, {
      maxWait: 10_000,
      timeout: 120_000,
    });
    if (result.verified !== rows.length) {
      return res.status(500).json({
        error: `The batch was not fully linked to ${cycleCode}: expected ${rows.length}, verified ${result.verified}.`,
      });
    }
    res.status(201).json({
      imported: result.created,
      repaired: rows.length - newRows.length,
      verified: result.verified,
      cycleCode,
      readingCycleId: cycle.readingCycleId.toString(),
    });
  } catch (error: any) {
    console.error(`Legacy current-reading import failed while ${importStage}`, error);
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? ` (${error.code})`
        : "";
    const cause =
      typeof error?.meta?.cause === "string"
        ? error.meta.cause
        : typeof error?.message === "string"
          ? error.message.split("\n").filter(Boolean).at(-1)
          : "Unknown database error";
    res.status(500).json({
      error: `Current-reading import failed while ${importStage}${code}: ${cause}`,
    });
  }
});

readingsRouter.get("/", async (req, res, next) => {
  try {
    const cycleId = req.query.cycleId ? BigInt(String(req.query.cycleId)) : undefined;
    const routeId = req.query.routeId ? BigInt(String(req.query.routeId)) : undefined;
    const approvalStatus = String(req.query.approvalStatus ?? "");
    const exceptionOnly = String(req.query.exceptionOnly ?? "") === "true";
    const readingType = String(req.query.readingType ?? "");
    const readingValue = String(req.query.readingValue ?? "").toUpperCase();
    const fromDate = String(req.query.fromDate ?? "");
    const toDate = String(req.query.toDate ?? "");
    const search = String(req.query.search ?? "");
    const exportMode = String(req.query.export ?? "") === "true";
    const paginated = req.query.page !== undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 50));
    const validFromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromDate);
    const validToDate = /^\d{4}-\d{2}-\d{2}$/.test(toDate);
    const readingDateFilter: Prisma.DateTimeFilter = {
      ...(validFromDate
        ? { gte: new Date(`${fromDate}T00:00:00.000+03:00`) }
        : {}),
      ...(validToDate
        ? { lte: new Date(`${toDate}T23:59:59.999+03:00`) }
        : {}),
    };
    const where: Prisma.MeterReadingWhereInput = {
      ...(cycleId ? { readingCycleId: cycleId } : {}),
      ...(approvalStatus ? { approvalStatus } : {}),
      ...(exceptionOnly ? { abnormalFlag: true } : {}),
      ...(readingType ? { readingType } : {}),
      ...(readingValue === "ZERO_CONSUMPTION" ? { consumption: { equals: 0 } } : {}),
      ...(readingValue === "ZERO_CURRENT" ? { currentReading: { equals: 0 } } : {}),
      ...(readingValue === "POSITIVE_CONSUMPTION" ? { consumption: { gt: 0 } } : {}),
      ...(readingValue === "NEGATIVE_CONSUMPTION" ? { consumption: { lt: 0 } } : {}),
      ...(validFromDate || validToDate ? { readingDate: readingDateFilter } : {}),
      ...(routeId ? { account: { OR: [{ routeId }, { property: { routeId } }] } } : {}),
      ...(search ? { OR: [
        { meter: { meterNumber: { contains: search, mode: "insensitive" } } },
        { account: { accountNumber: { contains: search, mode: "insensitive" } } },
        { account: { customer: { firstName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { middleName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { lastName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { organizationName: { contains: search, mode: "insensitive" } } } },
      ] } : {}),
    };
    if (exportMode) {
      return res.json(await prisma.meterReading.findMany({
        where,
        select: {
          readingId: true,
          readingDate: true,
          previousReading: true,
          currentReading: true,
          consumption: true,
          readingType: true,
          exceptionType: true,
          approvalStatus: true,
          cycle: { select: { cycleName: true } },
          meter: { select: { meterNumber: true } },
          account: {
            select: {
              accountNumber: true,
              customer: {
                select: {
                  customerType: true,
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  organizationName: true,
                },
              },
            },
          },
        },
        orderBy: [{ readingDate: "desc" }, { readingId: "desc" }],
      }));
    }
    if (paginated) {
      const [items, total] = await Promise.all([
        prisma.meterReading.findMany({
          where,
          include: readingInclude,
          orderBy: [{ readingDate: "desc" }, { readingId: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.meterReading.count({ where }),
      ]);
      return res.json({
        items,
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }
    res.json(await prisma.meterReading.findMany({ where, include: readingInclude, orderBy: { readingDate: "desc" }, take: 2000 }));
  } catch (error) { next(error); }
});

readingsRouter.patch("/bulk-decision", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({
    readingIds: z.array(id).min(1).max(500),
    decision: z.enum(["APPROVED", "REJECTED"]),
    comments: z.string().trim().min(3).max(2000),
  }), req.body, res);
  if (!data) return;
  try {
    const readingIds = [...new Set(data.readingIds.map((readingId) => readingId.toString()))].map(BigInt);
    const readings = await prisma.meterReading.findMany({
      where: { readingId: { in: readingIds } },
      include: { fieldOfficer: { select: { userId: true } } },
    });
    if (readings.length !== readingIds.length) {
      return res.status(404).json({ error: "One or more selected readings no longer exist. Refresh the approval list." });
    }
    const nonPending = readings.filter((reading) => reading.approvalStatus !== "PENDING");
    if (nonPending.length) {
      return res.status(409).json({ error: `${nonPending.length} selected reading(s) have already been decided. Refresh the approval list.` });
    }
    const approverId = userId(req);
    const ownReadings = approverId
      ? readings.filter((reading) => reading.fieldOfficer?.userId === approverId)
      : [];
    if (ownReadings.length) {
      return res.status(409).json({
        error: `Maker-checker control: you cannot decide ${ownReadings.length} reading(s) that you captured. No selected readings were changed.`,
      });
    }
    await prisma.$transaction(async (tx) => {
      const updated = await tx.meterReading.updateMany({
        where: { readingId: { in: readingIds }, approvalStatus: "PENDING" },
        data: {
          approvalStatus: data.decision,
          approvalComments: data.comments,
          approvedBy: approverId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (updated.count !== readings.length) {
        throw Object.assign(new Error("Some selected readings changed during approval. Refresh and try again."), { status: 409 });
      }
      await tx.meterReadingEvent.createMany({
        data: readings.map((reading) => ({
          readingId: reading.readingId,
          eventType: data.decision,
          remarks: data.comments,
          performedBy: approverId,
        })),
      });
      await tx.meterEvent.createMany({
        data: readings.map((reading) => ({
          meterId: reading.meterId,
          eventType: `READING_${data.decision}`,
          reading: reading.currentReading,
          remarks: data.comments,
          performedBy: approverId,
          metadata: { readingId: reading.readingId.toString(), bulkDecision: true },
        })),
      });
    });
    res.json({ updated: readings.length, decision: data.decision });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

readingsRouter.patch("/:id/decision", requireRole("SYSTEM_ADMIN", "SUPERVISOR", "METER_SUPERVISOR", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const readingId = parse(id, req.params.id, res);
  const data = parse(z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comments: z.string().trim().min(3).max(2000) }), req.body, res);
  if (!readingId || !data) return;
  try {
    const existing = await prisma.meterReading.findUnique({
      where: { readingId },
      include: { fieldOfficer: { select: { userId: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Reading not found" });
    if (existing.approvalStatus !== "PENDING") return res.status(409).json({ error: "This reading has already been decided" });
    if (userId(req) && existing.fieldOfficer?.userId === userId(req)) {
      return res.status(409).json({ error: "Maker-checker control: you cannot decide a reading that you captured." });
    }
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
    const readingWhere = cycleId ? { readingCycleId: cycleId, ...(meterIds.length ? { meterId: { in: meterIds } } : zoneId ? { meterId: -1n } : {}) } : undefined;
    const [readings, recent] = cycleId && readingWhere ? await Promise.all([
      prisma.meterReading.findMany({
        where: readingWhere,
        select: { meterId: true, approvalStatus: true, abnormalFlag: true },
      }),
      prisma.meterReading.findMany({
        where: readingWhere,
        include: { meter: true, account: { include: { customer: true } }, fieldOfficer: { include: { user: true } } },
        orderBy: { readingDate: "desc" },
        take: 8,
      }),
    ]) : [[], []];
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
      recent,
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
      const eligible = await getEligibleAssignments(cycleId, [route.routeId]);
      const meterIds = eligible.map((a) => a.meterId);
      const readings = meterIds.length ? await prisma.meterReading.findMany({ where: { readingCycleId: cycleId, meterId: { in: meterIds } } }) : [];
      const routeAssignment = await prisma.routeAssignment.findFirst({ where: { readingCycleId: cycleId, routeId: route.routeId, status: { not: "REASSIGNED" } }, include: { fieldOfficer: { include: { user: true } } }, orderBy: { createdAt: "desc" } });
      rows.push({ route, assignedOfficer: routeAssignment ? nameOf(routeAssignment.fieldOfficer.user) : "Unassigned", totalMeters: eligible.length, captured: readings.length, unread: Math.max(eligible.length - readings.length, 0), approved: readings.filter((r) => r.approvalStatus === "APPROVED").length, exceptions: readings.filter((r) => r.abnormalFlag).length, completionPercent: eligible.length ? Math.round((readings.length / eligible.length) * 1000) / 10 : 0 });
    }
    res.json(rows);
  } catch (error) { next(error); }
});
