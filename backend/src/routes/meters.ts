import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { queryStkPush } from "../lib/mpesa";
import { initiateMpesaStk } from "../lib/mpesaStk";
import { requireAuth, requireRole } from "../middleware/auth";

export const metersRouter = Router();
metersRouter.use(requireAuth);

const meterTypes = ["CUSTOMER", "BULK", "ZONE", "BOREHOLE"] as const;
const technologies = ["MANUAL", "PREPAID", "SMART"] as const;
const meterStatuses = ["IN_STOCK", "RESERVED", "ACTIVE", "FAULTY", "INACTIVE", "REMOVED", "REPLACED", "DISCONNECTED", "TAMPERED"] as const;
const installationStatuses = ["IN_STORE", "INSTALLED", "REMOVED"] as const;
const evidenceTypes = ["INSTALLATION_PHOTO", "METER_PHOTO", "CUSTOMER_SIGNATURE", "STATUS_PHOTO", "REPLACEMENT_PHOTO", "DOCUMENT"] as const;

const optText = z.string().optional().transform((value) => value?.trim() || undefined);
const optNumber = z.union([z.coerce.number(), z.literal("")]).optional().transform((value) => value === "" ? undefined : value);
const evidenceSchema = z.object({
  evidenceType: z.enum(evidenceTypes),
  fileName: optText,
  contentData: z.string().min(1),
  description: optText,
});

const meterSchema = z.object({
  meterNumber: z.string().trim().min(1),
  meterType: z.enum(meterTypes),
  technology: z.enum(technologies),
  brand: optText,
  model: optText,
  meterSizeMm: z.coerce.number().positive(),
  serialNumber: optText,
  openingReading: z.coerce.number().min(0).default(0),
  installationDate: optText,
  purchaseDate: optText,
  warrantyExpiryDate: optText,
  storageLocation: optText,
  installationStatus: z.enum(installationStatuses).default("IN_STORE"),
  gpsLatitude: optNumber.pipe(z.number().min(-90).max(90).optional()),
  gpsLongitude: optNumber.pipe(z.number().min(-180).max(180).optional()),
  sealNumber: optText,
  remarks: optText,
  status: z.enum(meterStatuses).default("IN_STOCK"),
}).refine((data) => !data.purchaseDate || !data.warrantyExpiryDate || data.warrantyExpiryDate >= data.purchaseDate, {
  path: ["warrantyExpiryDate"], message: "Warranty expiry must be on or after the purchase date",
});

const registerMeterSchema = meterSchema.innerType().omit({ meterNumber: true }).refine(
  (data) => !data.purchaseDate || !data.warrantyExpiryDate || data.warrantyExpiryDate >= data.purchaseDate,
  { path: ["warrantyExpiryDate"], message: "Warranty expiry must be on or after the purchase date" },
);

async function nextMeterNumber() {
  const year = new Date().getFullYear();
  const prefix = `MTR-${year}-`;
  const meters = await prisma.meter.findMany({
    where: { meterNumber: { startsWith: prefix } },
    select: { meterNumber: true },
  });
  const highest = meters.reduce((max, meter) => {
    const sequence = Number(meter.meterNumber.slice(prefix.length));
    return Number.isInteger(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(5, "0")}`;
}

const meterProfileSchema = z.object({
  meterNumber: z.string().trim().min(1),
  meterType: z.enum(meterTypes),
  technology: z.enum(technologies),
  brand: z.string().trim().optional().default(""),
  model: z.string().trim().optional().default(""),
  meterSizeMm: z.coerce.number().positive(),
  serialNumber: z.string().trim().optional().default(""),
  openingReading: z.coerce.number().min(0),
  purchaseDate: z.string().trim().optional().default(""),
  warrantyExpiryDate: z.string().trim().optional().default(""),
  storageLocation: z.string().trim().optional().default(""),
  gpsLatitude: optNumber.pipe(z.number().min(-90).max(90).optional()),
  gpsLongitude: optNumber.pipe(z.number().min(-180).max(180).optional()),
  sealNumber: z.string().trim().optional().default(""),
  remarks: z.string().trim().optional().default(""),
}).refine((data) => !data.purchaseDate || !data.warrantyExpiryDate || data.warrantyExpiryDate >= data.purchaseDate, {
  path: ["warrantyExpiryDate"], message: "Warranty expiry must be on or after the purchase date",
});

const assignmentInclude = {
  account: { include: { customer: true, property: { include: { zone: true, route: true } } } },
  zone: true,
  borehole: { include: { zone: true } },
} as const;

const latestReadingOrder: Prisma.MeterReadingOrderByWithRelationInput[] = [
  { readingDate: "desc" },
  { readingId: "desc" },
];

const meterListInclude = {
  assignments: { where: { assignmentStatus: "ACTIVE" }, include: assignmentInclude, orderBy: { assignmentDate: "desc" as const }, take: 1 },
  readings: { orderBy: latestReadingOrder, take: 1 },
} as const;

const meterDetailInclude = {
  ...meterListInclude,
  evidence: { orderBy: { createdAt: "desc" as const } },
  materials: { orderBy: { createdAt: "asc" as const } },
  events: { orderBy: { eventDate: "desc" as const }, take: 20 },
} as const;

function customerName(customer?: any) {
  if (!customer) return null;
  return customer.customerType === "ORGANIZATION"
    ? customer.organizationName
    : [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
}

function presentMeter(meter: any) {
  const assignment = meter.assignments?.[0];
  const target = assignment?.account
    ? customerName(assignment.account.customer)
    : assignment?.zone?.zoneName ?? assignment?.borehole?.boreholeName ?? null;
  return { ...meter, assignment, assignedTo: target, latestReading: meter.readings?.[0] ?? null };
}

function userId(req: Express.Request) {
  return req.user ? BigInt(req.user.userId) : null;
}

type ReplacementChargeItem = {
  chargeType: string;
  description: string;
  quantity: number;
  unitRate: number;
  amount: number;
  tariffBandId?: bigint;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateReplacementBill(tariff: any, consumption: number) {
  const items: ReplacementChargeItem[] = [];
  let consumptionCharge = 0;
  if (tariff.billingMethod === "FLAT") {
    consumptionCharge = Number(tariff.flatAmount);
    items.push({ chargeType: "FLAT_CHARGE", description: "Flat water charge", quantity: 1, unitRate: consumptionCharge, amount: consumptionCharge });
  } else if (tariff.billingMethod === "TIERED") {
    for (const band of tariff.bands) {
      const lower = Number(band.lowerLimit);
      const upper = band.upperLimit == null ? consumption : Number(band.upperLimit);
      const units = Math.max(0, Math.min(consumption, upper) - lower);
      if (units <= 0) continue;
      const rate = Number(band.ratePerUnit);
      const amount = roundMoney(units * rate);
      consumptionCharge += amount;
      items.push({ chargeType: "CONSUMPTION_BAND", description: `Band ${band.bandSequence}: ${lower}-${band.upperLimit ?? "above"} units`, quantity: units, unitRate: rate, amount, tariffBandId: band.tariffBandId });
    }
  } else {
    const rate = Number(tariff.ratePerUnit);
    consumptionCharge = roundMoney(consumption * rate);
    items.push({ chargeType: "CONSUMPTION", description: "Water consumption", quantity: consumption, unitRate: rate, amount: consumptionCharge });
  }
  consumptionCharge = roundMoney(consumptionCharge);
  const minimumChargeAdjustment = roundMoney(Math.max(0, Number(tariff.minimumCharge) - consumptionCharge));
  const standingCharge = roundMoney(Number(tariff.standingCharge));
  const meterRent = roundMoney(Number(tariff.meterRent));
  if (minimumChargeAdjustment) items.push({ chargeType: "MINIMUM_ADJUSTMENT", description: "Minimum charge adjustment", quantity: 1, unitRate: minimumChargeAdjustment, amount: minimumChargeAdjustment });
  if (standingCharge) items.push({ chargeType: "STANDING_CHARGE", description: "Standing charge", quantity: 1, unitRate: standingCharge, amount: standingCharge });
  if (meterRent) items.push({ chargeType: "METER_RENT", description: "Meter rent", quantity: 1, unitRate: meterRent, amount: meterRent });
  const fixedCharges = roundMoney(minimumChargeAdjustment + standingCharge + meterRent);
  return { consumptionCharge, minimumChargeAdjustment, standingCharge, meterRent, fixedCharges, totalCurrentCharges: roundMoney(consumptionCharge + fixedCharges), items };
}

async function prepareReplacementBill(
  tx: Prisma.TransactionClient,
  accountId: bigint,
  replacementDate: Date,
  consumption: number,
) {
  const account = await tx.customerAccount.findUnique({
    where: { accountId },
    select: {
      accountId: true, accountNumber: true, categoryId: true, currentBalance: true,
      category: { select: { categoryCode: true, categoryName: true } },
    },
  });
  if (!account) throw Object.assign(new Error("Customer account was not found for immediate billing"), { status: 404 });
  const tariff = await tx.tariff.findFirst({
    where: {
      categoryId: account.categoryId, status: "ACTIVE", effectiveFrom: { lte: replacementDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: replacementDate } }],
    },
    include: { bands: { where: { status: "ACTIVE" }, orderBy: { bandSequence: "asc" } } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!tariff) throw Object.assign(new Error("No active tariff covers this account on the action date. Immediate billing cannot continue."), { status: 409 });
  const calculation = calculateReplacementBill(tariff, consumption);
  if (![consumption, calculation.totalCurrentCharges, ...calculation.items.flatMap((item) => [item.quantity, item.unitRate, item.amount])].every((value) => Number.isFinite(value) && value >= 0)) {
    throw Object.assign(new Error("The immediate bill calculation produced invalid amounts. The action cannot continue."), { status: 409 });
  }
  const settings = await tx.systemSetting.findUnique({ where: { settingId: 1n }, select: { billingDueDays: true } });
  const dueDate = new Date(replacementDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + (settings?.billingDueDays ?? 14));
  const previousBalance = Number(account.currentBalance);
  return {
    account, tariff, calculation, dueDate, previousBalance,
    totalAmountDue: roundMoney(Math.max(0, previousBalance + calculation.totalCurrentCharges)),
  };
}

async function addEvidence(tx: Prisma.TransactionClient, meterId: bigint, items: z.infer<typeof evidenceSchema>[], uploadedBy: bigint | null, assignmentId?: bigint, replacementId?: bigint) {
  for (const item of items) {
    await tx.meterEvidence.create({ data: {
      meterId, assignmentId, replacementId, uploadedBy, evidenceType: item.evidenceType,
      fileName: item.fileName, contentData: item.contentData, description: item.description,
    } });
  }
}

async function ensureAlert(tx: Prisma.TransactionClient, meterId: bigint, alertType: string, priority: string, reason: string, performedBy?: bigint | null) {
  const existing = await tx.meterAlert.findFirst({ where: { meterId, alertType, status: "OPEN" } });
  if (existing) return existing;
  const alert = await tx.meterAlert.create({ data: { meterId, alertType, priority, reason } });
  await tx.meterEvent.create({ data: { meterId, eventType: "ALERT_CREATED", reason, performedBy: performedBy ?? null, metadata: { alertId: alert.alertId.toString(), alertType, priority } } });
  return alert;
}

async function refreshAlerts() {
  const meters = await prisma.meter.findMany({
    where: { status: { in: ["FAULTY", "TAMPERED", "INACTIVE"] } },
    select: { meterId: true, status: true },
  });
  for (const meter of meters) {
    const settings: Record<string, [string, string, string]> = {
      FAULTY: ["FAULTY", "HIGH", "Meter is marked faulty"],
      TAMPERED: ["TAMPER", "CRITICAL", "Meter is marked as tampered"],
      INACTIVE: ["INACTIVE", "LOW", "Meter is inactive"],
    };
    const [type, priority, reason] = settings[meter.status];
    await prisma.$transaction((tx) => ensureAlert(tx, meter.meterId, type, priority, reason));
  }

  const abnormalReadings = await prisma.meterReading.findMany({
    where: { OR: [{ abnormalFlag: true }, { exceptionType: { not: "NONE" } }] },
    orderBy: { readingDate: "desc" }, distinct: ["meterId"], take: 1000,
  });
  for (const reading of abnormalReadings) {
    const type = reading.exceptionType === "ZERO" ? "ZERO_READING" : reading.exceptionType === "TAMPERED" ? "TAMPER" : "ABNORMAL_USE";
    await prisma.$transaction((tx) => ensureAlert(tx, reading.meterId, type, type === "ABNORMAL_USE" ? "CRITICAL" : "HIGH", `${type.replace(/_/g, " ")} detected from meter reading`));
  }

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  const noReadings = await prisma.meter.findMany({
    where: { status: "ACTIVE", OR: [{ readings: { none: {} } }, { readings: { none: { readingDate: { gte: cutoff } } } }] },
    select: { meterId: true }, take: 1000,
  });
  for (const meter of noReadings) {
    await prisma.$transaction((tx) => ensureAlert(tx, meter.meterId, "NO_READING", "HIGH", "No meter reading recorded in the last 90 days"));
  }
}

async function createWorkOrder(meterId: bigint, createdBy: bigint, description: string, priority: "LOW" | "NORMAL" | "HIGH" | "EMERGENCY" = "HIGH") {
  const meter = await prisma.meter.findUnique({ where: { meterId }, include: meterListInclude });
  if (!meter) throw new Error("Meter not found");
  const assignment: any = meter.assignments[0];
  const zoneId = assignment?.account?.property?.zoneId ?? assignment?.zoneId ?? assignment?.borehole?.zoneId;
  if (!zoneId) throw new Error("The meter needs an active assignment with a zone before a work order can be created");
  const accountId = assignment?.accountId ?? null;
  const propertyId = assignment?.account?.propertyId ?? null;
  const typeRows = await prisma.$queryRaw<{ work_order_type_id: bigint }[]>`
    INSERT INTO aquaflow.work_order_types (type_code, type_name, description, requires_photo, requires_gps, status)
    VALUES ('METER_INSPECTION', 'Meter Inspection', 'Investigate a meter exception or status report', TRUE, TRUE, 'ACTIVE')
    ON CONFLICT (type_code) DO UPDATE SET type_name = EXCLUDED.type_name
    RETURNING work_order_type_id`;
  const number = `WO-MTR-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
  const rows = await prisma.$queryRaw<{ work_order_id: bigint; work_order_number: string }[]>`
    INSERT INTO aquaflow.work_orders (work_order_number, work_order_type_id, account_id, property_id, zone_id, priority, description, created_by)
    VALUES (${number}, ${typeRows[0].work_order_type_id}, ${accountId}, ${propertyId}, ${zoneId}, ${priority}, ${description}, ${createdBy})
    RETURNING work_order_id, work_order_number`;
  await prisma.meterEvent.create({ data: { meterId, eventType: "WORK_ORDER_CREATED", performedBy: createdBy, remarks: description, metadata: { workOrderId: rows[0].work_order_id.toString(), workOrderNumber: rows[0].work_order_number } } });
  return rows[0];
}

metersRouter.get("/dashboard", async (req, res) => {
  const zoneId = String(req.query.zoneId ?? "");
  const from = String(req.query.dateFrom ?? "");
  const to = String(req.query.dateTo ?? "");
  const where: any = {};
  if (zoneId) where.assignments = { some: { assignmentStatus: "ACTIVE", OR: [{ zoneId: BigInt(zoneId) }, { account: { property: { zoneId: BigInt(zoneId) } } }, { borehole: { zoneId: BigInt(zoneId) } }] } };
  const eventWhere: any = {};
  if (from || to) eventWhere.eventDate = { ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}) };
  if (zoneId) eventWhere.meter = where;
  const [total, byStatus, byType, events] = await Promise.all([
    prisma.meter.count({ where }),
    prisma.meter.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.meter.groupBy({ by: ["meterType"], where, _count: { _all: true } }),
    prisma.meterEvent.findMany({ where: eventWhere, include: { meter: { include: meterListInclude } }, orderBy: { eventDate: "desc" }, take: 8 }),
  ]);
  res.json({
    total,
    status: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    types: Object.fromEntries(byType.map((row) => [row.meterType, row._count._all])),
    recent: events.map((event) => ({ ...event, meter: presentMeter(event.meter) })),
  });
});

metersRouter.get("/accounts", async (req, res) => {
  const q = String(req.query.q ?? "");
  const accounts = await prisma.customerAccount.findMany({
    where: q ? { OR: [
      { accountNumber: { contains: q, mode: "insensitive" } }, { customer: { customerNumber: { contains: q, mode: "insensitive" } } },
      { customer: { firstName: { contains: q, mode: "insensitive" } } }, { customer: { lastName: { contains: q, mode: "insensitive" } } },
      { customer: { organizationName: { contains: q, mode: "insensitive" } } }, { customer: { phoneNumber: { contains: q } } },
    ] } : undefined,
    include: { customer: true, property: { include: { zone: true, route: true } } }, orderBy: { accountNumber: "asc" }, take: 100,
  });
  res.json(accounts.map((account) => ({ ...account, customerName: customerName(account.customer) })));
});

metersRouter.get("/boreholes", async (_req, res) => {
  res.json(await prisma.borehole.findMany({ where: { status: "ACTIVE" }, include: { zone: true }, orderBy: { boreholeName: "asc" } }));
});

const boreholeSchema = z.object({
  boreholeCode: z.string().trim().min(2).max(50),
  boreholeName: z.string().trim().min(2).max(150),
  zoneId: z.coerce.bigint().positive(),
  gpsLatitude: z.coerce.number().min(-90).max(90),
  gpsLongitude: z.coerce.number().min(-180).max(180),
  depthMetres: optNumber.pipe(z.number().positive().optional()),
  ratedCapacity: optNumber.pipe(z.number().positive().optional()),
  commissioningDate: optText,
});

metersRouter.post("/boreholes", requireRole("ADMIN", "SYSTEM_ADMIN", "METER_MANAGER"), async (req, res) => {
  const parsed = boreholeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid borehole details" });
  try {
    const data = parsed.data;
    const borehole = await prisma.borehole.create({ data: {
      boreholeCode: data.boreholeCode,
      boreholeName: data.boreholeName,
      zoneId: data.zoneId,
      gpsLatitude: data.gpsLatitude,
      gpsLongitude: data.gpsLongitude,
      depthMetres: data.depthMetres,
      ratedCapacity: data.ratedCapacity,
      commissioningDate: data.commissioningDate ? new Date(data.commissioningDate) : undefined,
      status: "ACTIVE",
    }, include: { zone: true } });
    res.status(201).json(borehole);
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "That borehole code already exists" });
    res.status(400).json({ error: error.message ?? "Unable to create borehole" });
  }
});

metersRouter.get("/replacements", async (req, res) => {
  const status = String(req.query.status ?? "");
  const items = await prisma.meterReplacement.findMany({
    where: status ? { requestStatus: status } : undefined,
    include: { account: { include: { customer: true } }, oldMeter: true, newMeter: true, evidence: true }, orderBy: { createdAt: "desc" },
  });
  const workOrderIds = items.flatMap((item) => item.workOrderId ? [item.workOrderId] : []);
  const workOrders = workOrderIds.length ? await prisma.$queryRaw<any[]>`
    SELECT work_order_id,work_order_number,status FROM aquaflow.work_orders
    WHERE work_order_id IN (${Prisma.join(workOrderIds)})` : [];
  const workOrderById = new Map(workOrders.map((row) => [String(row.work_order_id), row]));
  res.json(items.map((item) => ({
    ...item,
    customerName: customerName(item.account.customer),
    workOrder: item.workOrderId ? workOrderById.get(String(item.workOrderId)) ?? null : null,
  })));
});

metersRouter.get("/replacements/direct/options", requireRole("ADMIN", "SYSTEM_ADMIN", "METER_MANAGER", "METER_SUPERVISOR", "SUPERVISOR"), async (req, res) => {
  const installedSearch = String(req.query.installedSearch ?? "").trim();
  const installed = await prisma.meter.findMany({
      where: {
        status: { in: ["ACTIVE", "FAULTY", "TAMPERED", "INACTIVE"] },
        assignments: { some: { assignmentStatus: "ACTIVE", removalDate: null, accountId: { not: null } } },
        ...(installedSearch ? { OR: [
          { meterNumber: { contains: installedSearch, mode: "insensitive" as const } },
          { serialNumber: { contains: installedSearch, mode: "insensitive" as const } },
          { assignments: { some: { assignmentStatus: "ACTIVE", account: { accountNumber: { contains: installedSearch, mode: "insensitive" as const } } } } },
          { assignments: { some: { assignmentStatus: "ACTIVE", account: { customer: { firstName: { contains: installedSearch, mode: "insensitive" as const } } } } } },
          { assignments: { some: { assignmentStatus: "ACTIVE", account: { customer: { lastName: { contains: installedSearch, mode: "insensitive" as const } } } } } },
          { assignments: { some: { assignmentStatus: "ACTIVE", account: { customer: { organizationName: { contains: installedSearch, mode: "insensitive" as const } } } } } },
        ] } : {}),
      }, include: meterListInclude, orderBy: { meterNumber: "asc" }, take: 100,
    });
  res.json({ installed: installed.map(presentMeter) });
});

metersRouter.get("/replacements/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid replacement id" });
  const item = await prisma.meterReplacement.findUnique({
    where: { replacementId: BigInt(req.params.id) },
    include: { account: { include: { customer: true } }, oldMeter: true, newMeter: true, evidence: true },
  });
  if (!item) return res.status(404).json({ error: "Replacement request not found" });
  const workOrders = item.workOrderId ? await prisma.$queryRaw<any[]>`
    SELECT work_order_id,work_order_number,status,created_at,started_at,completed_at,verified_at,closed_at
    FROM aquaflow.work_orders WHERE work_order_id=${item.workOrderId}` : [];
  res.json({
    ...item,
    customerName: customerName(item.account.customer),
    workOrder: workOrders[0] ?? null,
  });
});

metersRouter.get("/alerts", async (req, res) => {
  await refreshAlerts();
  const status = String(req.query.status ?? "OPEN");
  const alertType = String(req.query.alertType ?? "");
  const zoneId = String(req.query.zoneId ?? "");
  const where: any = { ...(status ? { status } : {}), ...(alertType ? { alertType } : {}) };
  if (zoneId) where.meter = { assignments: { some: { assignmentStatus: "ACTIVE", OR: [{ zoneId: BigInt(zoneId) }, { account: { property: { zoneId: BigInt(zoneId) } } }, { borehole: { zoneId: BigInt(zoneId) } }] } } };
  const alerts = await prisma.meterAlert.findMany({ where, include: { meter: { include: meterListInclude } }, orderBy: [{ priority: "asc" }, { detectedAt: "desc" }] });
  res.json(alerts.map((alert) => ({ ...alert, meter: presentMeter(alert.meter) })));
});

metersRouter.patch("/alerts/:id/dismiss", async (req, res) => {
  const alert = await prisma.meterAlert.update({ where: { alertId: BigInt(req.params.id) }, data: { status: "DISMISSED", dismissedBy: userId(req), dismissedAt: new Date() } });
  await prisma.meterEvent.create({ data: { meterId: alert.meterId, eventType: "ALERT_DISMISSED", performedBy: userId(req), metadata: { alertId: alert.alertId.toString() } } });
  res.json(alert);
});

metersRouter.post("/work-orders", async (req, res) => {
  const parsed = z.object({ meterId: z.string(), alertId: z.string().optional(), description: z.string().min(1), priority: z.enum(["LOW", "NORMAL", "HIGH", "EMERGENCY"]).default("HIGH") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const created = await createWorkOrder(BigInt(parsed.data.meterId), userId(req)!, parsed.data.description, parsed.data.priority);
    if (parsed.data.alertId) await prisma.meterAlert.update({ where: { alertId: BigInt(parsed.data.alertId) }, data: { status: "WORK_ORDER_CREATED", workOrderId: created.work_order_id } });
    res.status(201).json(created);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

metersRouter.get("/", async (req, res) => {
  const search = String(req.query.search ?? ""); const type = String(req.query.type ?? ""); const status = String(req.query.status ?? "");
  const zoneId = String(req.query.zoneId ?? ""); const customerId = String(req.query.customerId ?? "");
  const requestedTake = Number(req.query.take);
  const take = Number.isFinite(requestedTake)
    ? Math.min(50, Math.max(1, requestedTake))
    : undefined;
  const paginated = req.query.page !== undefined || req.query.pageSize !== undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
  const where: any = {};
  if (search) where.OR = [
    { meterNumber: { contains: search, mode: "insensitive" } }, { serialNumber: { contains: search, mode: "insensitive" } },
    { assignments: { some: { account: { customer: { firstName: { contains: search, mode: "insensitive" } } } } } },
    { assignments: { some: { account: { customer: { middleName: { contains: search, mode: "insensitive" } } } } } },
    { assignments: { some: { account: { customer: { lastName: { contains: search, mode: "insensitive" } } } } } },
    { assignments: { some: { account: { customer: { organizationName: { contains: search, mode: "insensitive" } } } } } },
  ];
  if (type) where.meterType = type; if (status) where.status = status;
  if (zoneId || customerId) where.assignments = { some: { assignmentStatus: "ACTIVE", ...(customerId ? { account: { customerId: BigInt(customerId) } } : {}), ...(zoneId ? { OR: [{ zoneId: BigInt(zoneId) }, { account: { property: { zoneId: BigInt(zoneId) } } }, { borehole: { zoneId: BigInt(zoneId) } }] } : {}) } };
  const [items, total] = await Promise.all([
    prisma.meter.findMany({ where, include: meterListInclude, orderBy: { createdAt: "desc" }, take: paginated ? pageSize : take, skip: paginated ? (page - 1) * pageSize : undefined }),
    paginated ? prisma.meter.count({ where }) : Promise.resolve(0),
  ]);
  if (!paginated) return res.json(items.map(presentMeter));
  res.json({ items: items.map(presentMeter), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

metersRouter.post("/", async (req, res) => {
  const parsed = registerMeterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  try {
    const meter = await prisma.$transaction(async (tx) => {
      const created = await tx.meter.create({ data: {
        ...data, meterNumber: await nextMeterNumber(), brand: data.brand, model: data.model, serialNumber: data.serialNumber,
        installationDate: data.installationDate ? new Date(data.installationDate) : null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        warrantyExpiryDate: data.warrantyExpiryDate ? new Date(data.warrantyExpiryDate) : null,
      } });
      await tx.meterEvent.create({ data: { meterId: created.meterId, eventType: "REGISTERED", newStatus: created.status, reading: created.openingReading, remarks: created.remarks, performedBy: userId(req) } });
      return created;
    });
    res.status(201).json(meter);
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "Meter number or serial number already exists" });
    throw error;
  }
});

metersRouter.post("/bulk/validate", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const numbers = items.map((item: any) => String(item.meterNumber ?? "")).filter(Boolean);
  const serials = items.map((item: any) => String(item.serialNumber ?? "")).filter(Boolean);
  const existing = await prisma.meter.findMany({ where: { OR: [{ meterNumber: { in: numbers } }, { serialNumber: { in: serials } }] }, select: { meterNumber: true, serialNumber: true } });
  const seen = new Set<string>();
  const results = items.map((item: any, index: number) => {
    const parsed = meterSchema.safeParse(item);
    const duplicate = seen.has(item.meterNumber) || existing.some((row) => row.meterNumber === item.meterNumber || (!!item.serialNumber && row.serialNumber === item.serialNumber));
    seen.add(item.meterNumber);
    return { row: index + 2, meterNumber: item.meterNumber, valid: parsed.success && !duplicate, duplicate, errors: parsed.success ? (duplicate ? ["Duplicate meter or serial number"] : []) : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  });
  res.json({ total: results.length, valid: results.filter((row: any) => row.valid).length, duplicates: results.filter((row: any) => row.duplicate).length, errors: results.filter((row: any) => !row.valid && !row.duplicate).length, results });
});

metersRouter.post("/bulk", async (req, res) => {
  const parsed = z.array(meterSchema).max(1000).safeParse(req.body?.items);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const results = [];
  for (const item of parsed.data) {
    try {
      const meter = await prisma.meter.create({ data: {
        ...item, installationDate: item.installationDate ? new Date(item.installationDate) : null,
        purchaseDate: item.purchaseDate ? new Date(item.purchaseDate) : null, warrantyExpiryDate: item.warrantyExpiryDate ? new Date(item.warrantyExpiryDate) : null,
      } });
      await prisma.meterEvent.create({ data: { meterId: meter.meterId, eventType: "REGISTERED", newStatus: meter.status, reading: meter.openingReading, performedBy: userId(req), metadata: { source: "BULK_IMPORT" } } });
      results.push({ meterNumber: meter.meterNumber, ok: true });
    } catch (error: any) { results.push({ meterNumber: item.meterNumber, ok: false, error: error?.code === "P2002" ? "Duplicate" : "Import failed" }); }
  }
  res.json({ results, imported: results.filter((item) => item.ok).length });
});

const bulkAssignmentSchema = z.object({
  items: z.array(z.object({
    meterNumber: z.string().trim().min(1),
    accountNumber: z.string().trim().min(1),
    assignmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    installationPoint: optText,
    installationStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).default("COMPLETED"),
    remarks: optText,
  })).min(1).max(1000),
});

metersRouter.post("/bulk-assign", async (req, res) => {
  const parsed = bulkAssignmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rows = parsed.data.items;
  const [meters, accounts] = await Promise.all([
    prisma.meter.findMany({
      where: { meterNumber: { in: rows.map((row) => row.meterNumber) } },
      select: { meterId: true, meterNumber: true },
    }),
    prisma.customerAccount.findMany({
      where: { accountNumber: { in: rows.map((row) => row.accountNumber) } },
      select: { accountId: true, accountNumber: true },
    }),
  ]);
  const meterIds = new Map(meters.map((row) => [row.meterNumber, row.meterId]));
  const accountIds = new Map(accounts.map((row) => [row.accountNumber, row.accountId]));
  const existing = await prisma.meterAssignment.findMany({
    where: {
      assignmentStatus: "ACTIVE",
      OR: [
        { meterId: { in: meters.map((row) => row.meterId) } },
        { accountId: { in: accounts.map((row) => row.accountId) } },
      ],
    },
    select: { meterId: true, accountId: true },
  });
  const activeByMeter = new Map(existing.map((row) => [row.meterId, row]));
  const activeByAccount = new Map(existing.filter((row) => row.accountId).map((row) => [row.accountId!, row]));
  const seenMeters = new Set<string>();
  const seenAccounts = new Set<string>();
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const meterId = meterIds.get(row.meterNumber);
    const accountId = accountIds.get(row.accountNumber);
    if (!meterId) errors.push(`Row ${line}: meter ${row.meterNumber} was not found.`);
    if (!accountId) errors.push(`Row ${line}: account ${row.accountNumber} was not found.`);
    if (seenMeters.has(row.meterNumber)) errors.push(`Row ${line}: meter ${row.meterNumber} appears more than once.`);
    if (seenAccounts.has(row.accountNumber)) errors.push(`Row ${line}: account ${row.accountNumber} appears more than once.`);
    seenMeters.add(row.meterNumber);
    seenAccounts.add(row.accountNumber);
    if (meterId && accountId) {
      const meterAssignment = activeByMeter.get(meterId);
      const accountAssignment = activeByAccount.get(accountId);
      if (meterAssignment && meterAssignment.accountId !== accountId) errors.push(`Row ${line}: meter ${row.meterNumber} is assigned to another account.`);
      if (accountAssignment && accountAssignment.meterId !== meterId) errors.push(`Row ${line}: account ${row.accountNumber} has another active meter.`);
    }
  });
  if (errors.length) return res.status(409).json({ error: errors.slice(0, 100).join("\n") });

  const newRows = rows.filter((row) => {
    const current = activeByMeter.get(meterIds.get(row.meterNumber)!);
    return !current || current.accountId !== accountIds.get(row.accountNumber)!;
  });
  const result = await prisma.meterAssignment.createMany({
    data: newRows.map((row) => ({
      meterId: meterIds.get(row.meterNumber)!,
      accountId: accountIds.get(row.accountNumber)!,
      assignmentDate: new Date(`${row.assignmentDate}T00:00:00.000Z`),
      assignmentStatus: "ACTIVE",
      installationPoint: row.installationPoint || null,
      installationStatus: row.installationStatus,
      remarks: row.remarks || null,
      installedBy: userId(req),
    })),
  });
  res.status(201).json({ imported: result.count, skipped: rows.length - newRows.length });
});

metersRouter.post("/assign", async (req, res) => {
  const parsed = z.object({
    meterId: z.string().min(1), accountId: optText, zoneId: optText, boreholeId: optText, assignmentDate: z.string(),
    openingReading: z.coerce.number().min(0), gpsLatitude: optNumber, gpsLongitude: optNumber, sealNumber: optText,
    installationPoint: optText, remarks: optText, evidence: z.array(evidenceSchema).default([]),
    materials: z.array(z.object({ materialName: z.string().min(1), quantity: z.coerce.number().positive(), unit: z.string().min(1), remarks: optText })).default([]),
  }).refine((data) => [data.accountId, data.zoneId, data.boreholeId].filter(Boolean).length === 1, { message: "Choose exactly one assignment target" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data; const id = BigInt(data.meterId);
  const meter = await prisma.meter.findUnique({ where: { meterId: id }, include: { assignments: { where: { assignmentStatus: "ACTIVE" } } } });
  if (!meter) return res.status(404).json({ error: "Meter not found" });
  if (meter.status !== "IN_STOCK" || meter.assignments.length) return res.status(409).json({ error: "Only an available, in-store meter can be assigned" });
  const result = await prisma.$transaction(async (tx) => {
    const assignment = await tx.meterAssignment.create({ data: {
      meterId: id, accountId: data.accountId ? BigInt(data.accountId) : null, zoneId: data.zoneId ? BigInt(data.zoneId) : null,
      boreholeId: data.boreholeId ? BigInt(data.boreholeId) : null, assignmentDate: new Date(data.assignmentDate), installedBy: userId(req),
      installationPoint: data.installationPoint, remarks: data.remarks, installationStatus: "COMPLETED",
    } });
    if (data.accountId) {
      await tx.customerAccount.update({
        where: { accountId: BigInt(data.accountId) },
        data: { accountStatus: "ACTIVE", connectionDate: new Date(data.assignmentDate), updatedAt: new Date() },
      });
    }
    await tx.meter.update({ where: { meterId: id }, data: {
      status: "ACTIVE", installationStatus: "INSTALLED", installationDate: new Date(data.assignmentDate), openingReading: data.openingReading,
      gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude, sealNumber: data.sealNumber,
    } });
    await addEvidence(tx, id, data.evidence, userId(req), assignment.assignmentId);
    for (const material of data.materials) await tx.meterInstallationMaterial.create({ data: { ...material, meterId: id, assignmentId: assignment.assignmentId } });
    await tx.meterEvent.create({ data: { meterId: id, assignmentId: assignment.assignmentId, eventType: "ASSIGNED", previousStatus: meter.status, newStatus: "ACTIVE", reading: data.openingReading, reason: "Meter installed and assigned", remarks: data.remarks, gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude, performedBy: userId(req) } });
    return assignment;
  });
  res.status(201).json(result);
});

const replacementInputSchema = z.object({
  accountId: z.string().min(1), oldMeterId: z.string().min(1), newMeterId: z.string().min(1),
  replacementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), oldFinalReading: z.coerce.number().min(0),
  newOpeningReading: z.coerce.number().min(0), replacementReason: z.string().trim().min(2).max(1000),
  requestStatus: z.enum(["DRAFT", "PENDING"]).default("PENDING"),
  gpsLatitude: optNumber, gpsLongitude: optNumber, remarks: optText,
  evidence: z.array(evidenceSchema).default([]),
}).refine((data) => data.oldMeterId !== data.newMeterId, {
  path: ["newMeterId"], message: "Choose a different replacement meter",
});

const directReplacementInputSchema = z.object({
  accountId: z.string().min(1), oldMeterId: z.string().min(1),
  replacementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), oldFinalReading: z.coerce.number().min(0),
  newOpeningReading: z.coerce.number().min(0), replacementReason: z.string().trim().min(2).max(1000),
  gpsLatitude: optNumber, gpsLongitude: optNumber, remarks: optText, confirmed: z.literal(true),
});

const directReplacementPreviewSchema = z.object({
  accountId: z.string().min(1), oldMeterId: z.string().min(1),
  replacementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  oldFinalReading: z.coerce.number().min(0),
});

const directDisconnectionSchema = z.object({
  accountId: z.string().regex(/^\d+$/),
  meterId: z.string().regex(/^\d+$/),
  actionDateTime: z.coerce.date(),
  currentReading: z.coerce.number().finite().min(0).max(999_999_999),
  reason: z.string().trim().min(3).max(1000),
  remarks: z.string().trim().max(5000).optional(),
  customerAcknowledgement: z.enum(["ACKNOWLEDGED", "UNAVAILABLE", "REFUSED_TO_SIGN"]),
  confirmed: z.literal(true),
});

const directDisconnectionPreviewSchema = directDisconnectionSchema.pick({
  accountId: true,
  meterId: true,
  actionDateTime: true,
  currentReading: true,
});

const directReconnectionSchema = z.object({
  accountId: z.string().regex(/^\d+$/),
  meterId: z.string().regex(/^\d+$/),
  actionDateTime: z.coerce.date(),
  reason: z.string().trim().min(3).max(1000),
  remarks: z.string().trim().max(5000).optional(),
  confirmed: z.literal(true),
});

const directServiceRoles = requireRole(
  "ADMIN", "SYSTEM_ADMIN", "METER_MANAGER", "METER_SUPERVISOR", "SUPERVISOR",
);

async function directServiceContext(
  tx: Prisma.TransactionClient,
  accountId: bigint,
  meterId: bigint,
  actionDate: Date,
  lock = false,
) {
  const rows = await tx.$queryRaw<any[]>(Prisma.sql`
    SELECT ca.account_id AS "accountId",ca.account_number AS "accountNumber",
      ca.account_status AS "accountStatus",ca.current_balance AS "currentBalance",
      ca.customer_id AS "customerId",ca.property_id AS "propertyId",p.zone_id AS "zoneId",
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.middle_name,c.last_name)),''),c.organization_name,c.customer_number) AS "customerName",
      c.phone_number AS "customerPhone",ma.assignment_id AS "assignmentId",
      m.meter_id AS "meterId",m.meter_number AS "meterNumber",m.serial_number AS "serialNumber",
      m.status AS "meterStatus",m.installation_status AS "installationStatus",m.opening_reading AS "openingReading",
      latest.current_reading AS "latestReading",latest.reading_date AS "latestReadingDate"
    FROM aquaflow.customer_accounts ca
    JOIN aquaflow.customers c ON c.customer_id=ca.customer_id
    JOIN aquaflow.properties p ON p.property_id=ca.property_id
    JOIN aquaflow.meter_assignments ma ON ma.account_id=ca.account_id
      AND ma.assignment_status='ACTIVE' AND ma.removal_date IS NULL
    JOIN aquaflow.meters m ON m.meter_id=ma.meter_id
    LEFT JOIN LATERAL (
      SELECT mr.current_reading,mr.reading_date FROM aquaflow.meter_readings mr
      WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
      ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1
    ) latest ON TRUE
    WHERE ca.account_id=${accountId} AND m.meter_id=${meterId}
    ORDER BY ma.assignment_date DESC,ma.assignment_id DESC LIMIT 1
    ${lock ? Prisma.sql`FOR UPDATE OF ca,ma,m` : Prisma.empty}`);
  const context = rows[0];
  if (!context) throw Object.assign(new Error("The meter is not currently assigned to this customer account"), { status: 409 });
  if (actionDate.getTime() > Date.now() + 5 * 60_000) {
    throw Object.assign(new Error("The action date and time cannot be in the future"), { status: 409 });
  }
  const latestReading = Number(context.latestReading ?? context.openingReading ?? 0);
  if (context.latestReadingDate && actionDate < new Date(context.latestReadingDate)) {
    throw Object.assign(new Error("The action date cannot be before the latest approved meter reading"), { status: 409 });
  }
  return { ...context, latestReading };
}

async function paidDirectReconnectionRequest(tx: Prisma.TransactionClient, accountId: bigint) {
  const rows = await tx.$queryRaw<any[]>`
    SELECT r.reconnection_request_id AS "reconnectionRequestId",r.request_number AS "requestNumber",
      r.status,r.reconnection_fee AS "reconnectionFee",r.fee_payment_status AS "feePaymentStatus",
      r.fee_paid_at AS "feePaidAt",r.work_order_id AS "workOrderId",r.decision_notes AS "decisionNotes",
      pay.payment_id AS "paymentId",pay.payment_status AS "paymentStatus",
      pay.payment_type AS "paymentType",pay.amount AS "paidAmount",
      rec.receipt_number AS "receiptNumber"
    FROM aquaflow.reconnection_requests r
    LEFT JOIN aquaflow.payments pay ON pay.payment_id=r.fee_payment_id
    LEFT JOIN aquaflow.receipts rec ON rec.payment_id=pay.payment_id
    WHERE r.account_id=${accountId} AND r.status IN ('SUBMITTED','APPROVED','WORK_ORDER_CREATED')
    ORDER BY r.created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

async function ensureDirectReconnectionRequest(
  tx: Prisma.TransactionClient,
  context: any,
  actorId: bigint,
  reason = "Direct meter reconnection",
  phoneNumber?: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`direct-reconnection:${context.accountId}`}))::text AS lock`;
  const existing = await paidDirectReconnectionRequest(tx, context.accountId);
  if (existing) return existing;
  const settings = await tx.systemSetting.findUnique({ where: { settingId: 1n }, select: { reconnectionFee: true } });
  const fee = Number(settings?.reconnectionFee ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) {
    throw Object.assign(new Error("A positive reconnection fee is not configured"), { status: 409 });
  }
  const disconnections = await tx.$queryRaw<any[]>`
    SELECT work_order_id FROM aquaflow.disconnection_postings
    WHERE account_id=${context.accountId} ORDER BY posted_at DESC LIMIT 1`;
  if (!disconnections[0]) {
    throw Object.assign(new Error("No completed disconnection posting exists for this account"), { status: 409 });
  }
  const requestNumber = `RC-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
  const rows = await tx.$queryRaw<any[]>`
    INSERT INTO aquaflow.reconnection_requests(request_number,customer_id,account_id,reason,contact_phone,
      status,reconnection_fee,decision_notes,decided_by,decided_at,disconnection_work_order_id)
    VALUES(${requestNumber},${context.customerId},${context.accountId},${reason},
      ${phoneNumber || context.customerPhone},'APPROVED',${fee},'Approved for direct meter-service payment',
      ${actorId},NOW(),${disconnections[0].work_order_id})
    RETURNING reconnection_request_id AS "reconnectionRequestId",request_number AS "requestNumber",
      status,reconnection_fee AS "reconnectionFee",fee_payment_status AS "feePaymentStatus",
      fee_paid_at AS "feePaidAt",work_order_id AS "workOrderId"`;
  return rows[0];
}

async function validateReplacementMeters(
  tx: Prisma.TransactionClient,
  data: z.infer<typeof replacementInputSchema>,
  replacementId?: bigint,
) {
  const accountId = BigInt(data.accountId);
  const oldMeterId = BigInt(data.oldMeterId);
  const newMeterId = BigInt(data.newMeterId);
  const assignments = await tx.$queryRaw<any[]>`
    SELECT ma.assignment_id,m.status,m.opening_reading,
      COALESCE((SELECT mr.current_reading FROM aquaflow.meter_readings mr
        WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
        ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1),m.opening_reading) AS previous_reading,
      (SELECT mr.reading_date FROM aquaflow.meter_readings mr
        WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
        ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1) AS latest_reading_date
    FROM aquaflow.meter_assignments ma JOIN aquaflow.meters m ON m.meter_id=ma.meter_id
    WHERE ma.account_id=${accountId} AND ma.meter_id=${oldMeterId}
      AND ma.assignment_status='ACTIVE' AND ma.removal_date IS NULL
    FOR UPDATE OF ma,m`;
  if (!assignments[0]) throw Object.assign(new Error("The old meter is not actively assigned to this customer account"), { status: 409 });
  const previousReading = Number(assignments[0].previous_reading);
  if (assignments[0].latest_reading_date && new Date(`${data.replacementDate}T23:59:59.999Z`) < new Date(assignments[0].latest_reading_date)) {
    throw Object.assign(new Error("Replacement date cannot be before the latest approved meter reading"), { status: 409 });
  }
  if (data.oldFinalReading < previousReading) {
    throw Object.assign(new Error(`Old final reading cannot be below the latest approved reading of ${previousReading}`), { status: 409 });
  }
  const newMeters = await tx.$queryRaw<any[]>`SELECT meter_id,status,installation_status FROM aquaflow.meters WHERE meter_id=${newMeterId} FOR UPDATE`;
  if (!newMeters[0]) throw Object.assign(new Error("Replacement meter not found"), { status: 404 });
  const ownedReservation = replacementId ? await tx.meterReplacement.findFirst({
    where: { replacementId, newMeterId, requestStatus: "PENDING" }, select: { replacementId: true },
  }) : null;
  if (newMeters[0].status !== "IN_STOCK" && !(newMeters[0].status === "RESERVED" && ownedReservation)) {
    throw Object.assign(new Error("The replacement meter is no longer available in store"), { status: 409 });
  }
  const conflicts = await tx.$queryRaw<any[]>`
    SELECT replacement_id FROM aquaflow.meter_replacements
    WHERE request_status='PENDING' AND (old_meter_id=${oldMeterId} OR new_meter_id=${newMeterId})
      AND (${replacementId ?? null}::bigint IS NULL OR replacement_id<>${replacementId ?? null}::bigint)
    LIMIT 1`;
  if (conflicts[0]) throw Object.assign(new Error("An open replacement already uses the old or incoming meter"), { status: 409 });
  return {
    accountId, oldMeterId, newMeterId, previousReading,
    assignmentId: BigInt(assignments[0].assignment_id), oldMeterStatus: String(assignments[0].status),
  };
}

async function validateDirectReplacementMeter(
  tx: Prisma.TransactionClient,
  data: z.infer<typeof directReplacementInputSchema>,
) {
  const accountId = BigInt(data.accountId);
  const meterId = BigInt(data.oldMeterId);
  const assignments = await tx.$queryRaw<any[]>`
    SELECT ma.assignment_id,m.status,m.opening_reading,
      COALESCE((SELECT mr.current_reading FROM aquaflow.meter_readings mr
        WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
        ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1),m.opening_reading) AS previous_reading,
      (SELECT mr.reading_date FROM aquaflow.meter_readings mr
        WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
        ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1) AS latest_reading_date
    FROM aquaflow.meter_assignments ma
    JOIN aquaflow.meters m ON m.meter_id=ma.meter_id
    WHERE ma.account_id=${accountId} AND ma.meter_id=${meterId}
      AND ma.assignment_status='ACTIVE' AND ma.removal_date IS NULL
    FOR UPDATE OF ma,m`;
  if (!assignments[0]) {
    throw Object.assign(new Error("The meter is not actively assigned to this customer account"), { status: 409 });
  }
  const previousReading = Number(assignments[0].previous_reading);
  if (assignments[0].latest_reading_date && new Date(`${data.replacementDate}T23:59:59.999Z`) < new Date(assignments[0].latest_reading_date)) {
    throw Object.assign(new Error("Replacement date cannot be before the latest approved meter reading"), { status: 409 });
  }
  if (data.oldFinalReading < previousReading) {
    throw Object.assign(new Error(`Old final reading cannot be below the latest approved reading of ${previousReading}`), { status: 409 });
  }
  const conflicts = await tx.$queryRaw<any[]>`
    SELECT replacement_id FROM aquaflow.meter_replacements
    WHERE request_status='PENDING'
      AND (old_meter_id=${meterId} OR new_meter_id=${meterId})
    LIMIT 1`;
  if (conflicts[0]) {
    throw Object.assign(new Error("This meter already has an open replacement request"), { status: 409 });
  }
  return {
    accountId,
    oldMeterId: meterId,
    newMeterId: meterId,
    previousReading,
    assignmentId: BigInt(assignments[0].assignment_id),
    oldMeterStatus: String(assignments[0].status),
  };
}

async function createReplacementWorkOrder(tx: Prisma.TransactionClient, replacement: any, createdBy: bigint) {
  if (replacement.workOrderId) return replacement.workOrderId;
  const accounts = await tx.$queryRaw<any[]>`
    SELECT ca.property_id,p.zone_id,old_meter.meter_number AS old_meter_number,new_meter.meter_number AS new_meter_number
    FROM aquaflow.customer_accounts ca JOIN aquaflow.properties p ON p.property_id=ca.property_id
    JOIN aquaflow.meters old_meter ON old_meter.meter_id=${replacement.oldMeterId}
    JOIN aquaflow.meters new_meter ON new_meter.meter_id=${replacement.newMeterId}
    WHERE ca.account_id=${replacement.accountId}`;
  if (!accounts[0]?.zone_id) throw Object.assign(new Error("The customer account needs a zone before a replacement work order can be created"), { status: 409 });
  const types = await tx.$queryRaw<any[]>`
    INSERT INTO aquaflow.work_order_types(type_code,type_name,description,requires_photo,requires_gps,requires_signature,status)
    VALUES('METER_REPLACEMENT','Meter replacement','Remove and replace a customer meter',TRUE,TRUE,TRUE,'ACTIVE')
    ON CONFLICT(type_code) DO UPDATE SET status='ACTIVE' RETURNING work_order_type_id`;
  const number = `WO-MREP-${Date.now()}-${String(replacement.replacementId).padStart(5, "0")}`;
  const rows = await tx.$queryRaw<any[]>`
    INSERT INTO aquaflow.work_orders(work_order_number,work_order_type_id,account_id,property_id,zone_id,priority,
      description,status,source_type,source_reference,created_by)
    VALUES(${number},${types[0].work_order_type_id},${replacement.accountId},${accounts[0].property_id},${accounts[0].zone_id},'HIGH',
      ${`Replace ${accounts[0].old_meter_number} with reserved meter ${accounts[0].new_meter_number}. Final old reading: ${replacement.oldFinalReading}; new opening reading: ${replacement.newOpeningReading}. Reason: ${replacement.replacementReason}`},'CREATED','MANUAL',
      ${`REP-${replacement.replacementId}`},${createdBy}) RETURNING work_order_id`;
  await tx.meterReplacement.update({ where: { replacementId: replacement.replacementId }, data: { workOrderId: rows[0].work_order_id } });
  const photos = await tx.meterEvidence.findMany({ where: { replacementId: replacement.replacementId, evidenceType: "REPLACEMENT_PHOTO" } });
  for (const photo of photos) {
    await tx.$executeRaw`INSERT INTO aquaflow.work_order_evidence(work_order_id,evidence_type,file_path,description)
      VALUES(${rows[0].work_order_id},'BEFORE_PHOTO',${photo.contentData},${photo.description ?? "Meter replacement request photo"})`;
  }
  return rows[0].work_order_id;
}

async function saveReplacement(req: Express.Request, data: z.infer<typeof replacementInputSchema>, replacementId?: bigint) {
  return prisma.$transaction(async (tx) => {
    const ids = await validateReplacementMeters(tx, data, replacementId);
    const existing = replacementId ? await tx.meterReplacement.findUnique({ where: { replacementId } }) : null;
    if (replacementId && (!existing || !["DRAFT", "RETURNED"].includes(existing.requestStatus))) {
      throw Object.assign(new Error("Only draft or returned replacements can be edited"), { status: 409 });
    }
    const retainedEvidence = replacementId ? await tx.meterEvidence.count({ where: { replacementId } }) : 0;
    if (data.requestStatus === "PENDING" && !req.user?.roles.includes("SYSTEM_ADMIN") && data.evidence.length + retainedEvidence < 1) {
      throw Object.assign(new Error("Add at least one replacement evidence photo before submitting"), { status: 400 });
    }
    const values = {
      accountId: ids.accountId, oldMeterId: ids.oldMeterId, newMeterId: ids.newMeterId,
      replacementDate: new Date(`${data.replacementDate}T00:00:00.000Z`), oldFinalReading: data.oldFinalReading,
      newOpeningReading: data.newOpeningReading, replacementReason: data.replacementReason,
      requestStatus: data.requestStatus, replacedBy: userId(req), gpsLatitude: data.gpsLatitude,
      gpsLongitude: data.gpsLongitude, remarks: data.remarks,
    };
    const replacement = existing
      ? await tx.meterReplacement.update({ where: { replacementId: existing.replacementId }, data: values })
      : await tx.meterReplacement.create({ data: { ...values, requestedBy: userId(req) } });
    if (data.evidence.length) {
      await tx.meterEvidence.deleteMany({ where: { replacementId: replacement.replacementId } });
      await addEvidence(tx, replacement.oldMeterId, data.evidence, userId(req), undefined, replacement.replacementId);
    }
    let workOrderId = replacement.workOrderId;
    if (data.requestStatus === "PENDING") {
      await tx.meter.update({ where: { meterId: replacement.newMeterId }, data: { status: "RESERVED" } });
      workOrderId = await createReplacementWorkOrder(tx, replacement, userId(req)!);
    }
    await tx.meterEvent.create({ data: {
      meterId: replacement.oldMeterId, replacementId: replacement.replacementId,
      eventType: data.requestStatus === "DRAFT" ? "REPLACEMENT_DRAFTED" : "REPLACEMENT_SUBMITTED",
      reading: data.oldFinalReading, reason: data.replacementReason, remarks: data.remarks,
      gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude, performedBy: userId(req),
      metadata: { newMeterId: replacement.newMeterId.toString(), workOrderId: workOrderId?.toString() ?? null },
    } });
    return { ...replacement, workOrderId };
  });
}

metersRouter.post("/replacements", async (req, res, next) => {
  const parsed = replacementInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.status(201).json(await saveReplacement(req, parsed.data)); }
  catch (error: any) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
});

metersRouter.post("/replacements/direct/preview", requireRole("ADMIN", "SYSTEM_ADMIN", "METER_MANAGER", "METER_SUPERVISOR", "SUPERVISOR"), async (req, res, next) => {
  const parsed = directReplacementPreviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const accountId = BigInt(parsed.data.accountId);
      const oldMeterId = BigInt(parsed.data.oldMeterId);
      const replacementDate = new Date(`${parsed.data.replacementDate}T00:00:00.000Z`);
      const assignment = await tx.meterAssignment.findFirst({
        where: { accountId, meterId: oldMeterId, assignmentStatus: "ACTIVE", removalDate: null },
        include: { meter: { include: { readings: {
          where: { approvalStatus: "APPROVED" }, orderBy: [{ readingDate: "desc" }, { readingId: "desc" }], take: 1,
        } } } },
      });
      if (!assignment) throw Object.assign(new Error("The old meter is not actively assigned to this customer account"), { status: 409 });
      const latest = assignment.meter.readings[0];
      const previousReading = Number(latest?.currentReading ?? assignment.meter.openingReading);
      if (latest && new Date(`${parsed.data.replacementDate}T23:59:59.999Z`) < latest.readingDate) {
        throw Object.assign(new Error("Replacement date cannot be before the latest approved meter reading"), { status: 409 });
      }
      if (parsed.data.oldFinalReading < previousReading) {
        throw Object.assign(new Error(`Old final reading cannot be below the latest approved reading of ${previousReading}`), { status: 409 });
      }
      const consumption = roundMoney(parsed.data.oldFinalReading - previousReading);
      const bill = await prepareReplacementBill(tx, accountId, replacementDate, consumption);
      return {
        previousReading, finalReading: parsed.data.oldFinalReading, consumption,
        categoryCode: bill.account.category.categoryCode, categoryName: bill.account.category.categoryName,
        tariffId: bill.tariff.tariffId, tariffCode: bill.tariff.tariffCode,
        tariffName: bill.tariff.tariffName, billingMethod: bill.tariff.billingMethod,
        effectiveFrom: bill.tariff.effectiveFrom, effectiveTo: bill.tariff.effectiveTo,
        ratePerUnit: bill.tariff.ratePerUnit, flatAmount: bill.tariff.flatAmount,
        minimumCharge: bill.tariff.minimumCharge, configuredStandingCharge: bill.tariff.standingCharge,
        configuredMeterRent: bill.tariff.meterRent,
        bands: bill.tariff.bands.map((band) => ({
          bandSequence: band.bandSequence, lowerLimit: band.lowerLimit,
          upperLimit: band.upperLimit, ratePerUnit: band.ratePerUnit,
        })),
        consumptionCharge: bill.calculation.consumptionCharge,
        minimumChargeAdjustment: bill.calculation.minimumChargeAdjustment,
        standingCharge: bill.calculation.standingCharge, meterRent: bill.calculation.meterRent,
        fixedCharges: bill.calculation.fixedCharges, totalCurrentCharges: bill.calculation.totalCurrentCharges,
        minimumApplied: bill.calculation.minimumChargeAdjustment > 0,
        minimumDecision: Number(bill.tariff.minimumCharge) <= 0
          ? "This tariff has no minimum charge."
          : bill.calculation.minimumChargeAdjustment > 0
            ? `Applied because the consumption charge of KSh ${bill.calculation.consumptionCharge.toFixed(2)} is below the tariff minimum of KSh ${Number(bill.tariff.minimumCharge).toFixed(2)}.`
            : `Not applied because the consumption charge of KSh ${bill.calculation.consumptionCharge.toFixed(2)} meets or exceeds the tariff minimum of KSh ${Number(bill.tariff.minimumCharge).toFixed(2)}.`,
        previousBalance: bill.previousBalance, totalAmountDue: bill.totalAmountDue, dueDate: bill.dueDate,
      };
    });
    res.json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/replacements/direct", requireRole("ADMIN", "SYSTEM_ADMIN", "METER_MANAGER", "METER_SUPERVISOR", "SUPERVISOR"), async (req, res, next) => {
  const parsed = directReplacementInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const data = parsed.data;
      const ids = await validateDirectReplacementMeter(tx, data);
      const replacementDate = new Date(`${data.replacementDate}T00:00:00.000Z`);
      const replacement = await tx.meterReplacement.create({ data: {
        accountId: ids.accountId, oldMeterId: ids.oldMeterId, newMeterId: ids.newMeterId,
        replacementDate, oldFinalReading: data.oldFinalReading, newOpeningReading: data.newOpeningReading,
        retainedMeterNumber: true,
        replacementReason: data.replacementReason, requestStatus: "APPROVED", requestedBy: userId(req),
        replacedBy: userId(req), approvedBy: userId(req), decidedAt: new Date(),
        decisionComments: "Completed directly without a work order", gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude, remarks: data.remarks,
      } });
      const replacementReadingCycle = await tx.readingCycle.create({ data: {
        cycleCode: `MR-REP-${replacement.replacementId}`,
        cycleName: `Meter replacement REP-${replacement.replacementId}`,
        startDate: replacementDate, endDate: replacementDate, status: "CLOSED",
        createdBy: userId(req), remarks: `Dedicated final-reading cycle for direct meter replacement REP-${replacement.replacementId}`,
      } });
      const baselineReadingCycle = await tx.readingCycle.create({ data: {
        cycleCode: `MR-BASE-${replacement.replacementId}`,
        cycleName: `Meter replacement baseline REP-${replacement.replacementId}`,
        startDate: replacementDate, endDate: replacementDate, status: "CLOSED",
        createdBy: userId(req), remarks: `Dedicated opening-baseline cycle for direct meter replacement REP-${replacement.replacementId}`,
      } });
      const finalReading = await tx.meterReading.create({ data: {
        meterId: ids.oldMeterId, accountId: ids.accountId, readingCycleId: replacementReadingCycle.readingCycleId,
        previousReading: ids.previousReading, currentReading: data.oldFinalReading, readingType: "ACTUAL",
        readingDate: replacementDate, gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude,
        abnormalFlag: false, exceptionType: "NONE", approvalStatus: "APPROVED", approvedBy: userId(req),
        approvedAt: new Date(), approvalComments: `Final reading from direct replacement REP-${replacement.replacementId}`,
        syncId: `METER_REPLACEMENT:${replacement.replacementId}`,
      } });
      const openingBaseline = await tx.meterReading.create({ data: {
        meterId: ids.oldMeterId, accountId: ids.accountId, readingCycleId: baselineReadingCycle.readingCycleId,
        previousReading: data.newOpeningReading, currentReading: data.newOpeningReading, readingType: "ACTUAL",
        readingDate: replacementDate, gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude,
        abnormalFlag: false, exceptionType: "NONE", approvalStatus: "APPROVED", approvedBy: userId(req),
        approvedAt: new Date(), approvalComments: `Opening baseline after direct replacement REP-${replacement.replacementId}`,
        syncId: `METER_REPLACEMENT_BASELINE:${replacement.replacementId}`,
      } });
      await tx.meter.update({ where: { meterId: ids.oldMeterId }, data: {
        status: "ACTIVE", installationStatus: "INSTALLED", installationDate: replacementDate,
        openingReading: data.newOpeningReading, gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude,
      } });
      await tx.meterEvent.createMany({ data: [
        { meterId: ids.oldMeterId, assignmentId: ids.assignmentId, replacementId: replacement.replacementId,
          eventType: "REPLACEMENT_APPROVED", previousStatus: ids.oldMeterStatus, newStatus: "ACTIVE",
          reading: data.oldFinalReading, reason: data.replacementReason, remarks: data.remarks,
          gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude, performedBy: userId(req),
          metadata: { retainedMeterNumber: true, openingBaselineReadingId: openingBaseline.readingId.toString(), direct: true } },
        { meterId: ids.oldMeterId, assignmentId: ids.assignmentId, replacementId: replacement.replacementId,
          eventType: "INSTALLATION_UPDATED", previousStatus: ids.oldMeterStatus, newStatus: "ACTIVE",
          reading: data.newOpeningReading, reason: data.replacementReason, remarks: data.remarks,
          gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude, performedBy: userId(req),
          metadata: { retainedMeterNumber: true, replacementId: replacement.replacementId.toString(), direct: true } },
      ] });

      const consumption = roundMoney(data.oldFinalReading - ids.previousReading);
      const preparedBill = await prepareReplacementBill(tx, ids.accountId, replacementDate, consumption);
      const { account, tariff, calculation, dueDate, previousBalance, totalAmountDue } = preparedBill;
      const postedAt = new Date();
      const billingCycle = await tx.billingCycle.create({ data: {
        cycleCode: `MR-${replacement.replacementId}`,
        cycleName: `Meter replacement ${account.accountNumber}`,
        periodStart: replacementDate, periodEnd: replacementDate, dueDate, frequency: "CUSTOM",
        status: "POSTED", defaultNotification: "SMS_APP",
        remarks: `Immediate final bill for direct meter replacement REP-${replacement.replacementId}`,
        createdBy: userId(req), postedBy: userId(req), postedAt,
      } });
      await tx.readingCycle.update({
        where: { readingCycleId: replacementReadingCycle.readingCycleId },
        data: { billingCycleId: billingCycle.billingCycleId, updatedAt: postedAt },
      });
      const bill = await tx.bill.create({ data: {
        billNumber: `BILL-MR-${replacement.replacementId}`,
        accountId: ids.accountId, billingCycleId: billingCycle.billingCycleId, tariffId: tariff.tariffId,
        readingId: finalReading.readingId, previousBalance, consumptionUnits: consumption,
        consumptionCharge: calculation.consumptionCharge, minimumChargeAdjustment: calculation.minimumChargeAdjustment,
        standingCharge: calculation.standingCharge, meterRent: calculation.meterRent, fixedCharges: calculation.fixedCharges,
        penalties: 0, totalCurrentCharges: calculation.totalCurrentCharges, totalAmountDue,
        issueDate: replacementDate, dueDate, status: "POSTED", generatedBy: userId(req), approvedBy: userId(req),
        approvedAt: postedAt, approvalComments: "Automatically approved during direct meter replacement",
        postedBy: userId(req), postedAt, exceptionType: "NONE", items: { create: calculation.items },
      } });
      await tx.customerAccount.update({
        where: { accountId: ids.accountId },
        data: { currentBalance: { increment: calculation.totalCurrentCharges }, updatedAt: postedAt },
      });
      await tx.billingEvent.createMany({ data: [
        { billingCycleId: billingCycle.billingCycleId, eventType: "PERIOD_CREATED", newStatus: "POSTED", details: `Created and posted automatically for REP-${replacement.replacementId}`, performedBy: userId(req), createdAt: postedAt },
        { billingCycleId: billingCycle.billingCycleId, billId: bill.billId, eventType: "BILL_GENERATED", newStatus: "POSTED", details: "Generated from the replacement final reading", performedBy: userId(req), createdAt: postedAt },
        { billingCycleId: billingCycle.billingCycleId, billId: bill.billId, eventType: "BILL_POSTED", previousStatus: "APPROVED", newStatus: "POSTED", details: "Posted immediately during direct meter replacement", performedBy: userId(req), createdAt: postedAt },
      ] });
      return { ...replacement, bill };
    }, { maxWait: 10_000, timeout: 30_000 });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.get("/service-actions/direct/options", directServiceRoles, async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const pattern = `%${search}%`;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT ca.account_id AS "accountId",ca.account_number AS "accountNumber",
        ca.account_status AS "accountStatus",ca.current_balance AS "currentBalance",
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.middle_name,c.last_name)),''),c.organization_name,c.customer_number) AS "customerName",
        c.phone_number AS "customerPhone",ma.assignment_id AS "assignmentId",
        m.meter_id AS "meterId",m.meter_number AS "meterNumber",m.serial_number AS "serialNumber",
        m.status AS "meterStatus",m.installation_status AS "installationStatus",
        COALESCE(latest.current_reading,m.opening_reading) AS "latestReading",
        latest.reading_date AS "latestReadingDate",
        rr.reconnection_request_id AS "reconnectionRequestId",rr.request_number AS "reconnectionRequestNumber",
        rr.status AS "reconnectionRequestStatus",COALESCE(rr.reconnection_fee,settings.reconnection_fee,0) AS "reconnectionFee",
        rr.fee_payment_status AS "reconnectionFeePaymentStatus",rr.fee_paid_at AS "reconnectionFeePaidAt",
        rr.work_order_id AS "workOrderId",
        rec.receipt_number AS "reconnectionReceiptNumber",
        GREATEST(0,-ca.current_balance) AS "accountCreditAvailable",
        CASE WHEN rr.fee_payment_status='PAID' AND rr.fee_payment_id IS NULL
          AND COALESCE(rr.decision_notes,'') ILIKE '%account credit%' THEN 'ACCOUNT_CREDIT'
          WHEN pay.payment_status='POSTED' AND pay.payment_type='RECONNECTION_FEE'
          AND pay.amount>=rr.reconnection_fee THEN 'PAYMENT' ELSE NULL END AS "reconnectionSettlementMethod",
        COALESCE((pay.payment_status='POSTED' AND pay.payment_type='RECONNECTION_FEE'
          AND pay.amount>=rr.reconnection_fee) OR (rr.fee_payment_status='PAID' AND rr.fee_payment_id IS NULL
          AND COALESCE(rr.decision_notes,'') ILIKE '%account credit%'),FALSE) AS "reconnectionPaymentConfirmed"
      FROM aquaflow.customer_accounts ca
      JOIN aquaflow.customers c ON c.customer_id=ca.customer_id
      JOIN LATERAL (
        SELECT current_assignment.* FROM aquaflow.meter_assignments current_assignment
        WHERE current_assignment.account_id=ca.account_id
          AND current_assignment.assignment_status='ACTIVE' AND current_assignment.removal_date IS NULL
        ORDER BY current_assignment.assignment_date DESC,current_assignment.assignment_id DESC LIMIT 1
      ) ma ON TRUE
      JOIN aquaflow.meters m ON m.meter_id=ma.meter_id
      LEFT JOIN aquaflow.system_settings settings ON settings.setting_id=1
      LEFT JOIN LATERAL (
        SELECT mr.current_reading,mr.reading_date FROM aquaflow.meter_readings mr
        WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
        ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1
      ) latest ON TRUE
      LEFT JOIN LATERAL (
        SELECT r.* FROM aquaflow.reconnection_requests r
        WHERE r.account_id=ca.account_id AND r.status IN ('SUBMITTED','APPROVED','WORK_ORDER_CREATED')
        ORDER BY r.created_at DESC LIMIT 1
      ) rr ON TRUE
      LEFT JOIN aquaflow.payments pay ON pay.payment_id=rr.fee_payment_id
      LEFT JOIN aquaflow.receipts rec ON rec.payment_id=pay.payment_id
      WHERE ca.account_status IN ('ACTIVE','SUSPENDED','DISCONNECTED')
        AND (${search}='' OR ca.account_number ILIKE ${pattern} OR m.meter_number ILIKE ${pattern}
          OR COALESCE(m.serial_number,'') ILIKE ${pattern} OR c.customer_number ILIKE ${pattern}
          OR COALESCE(c.phone_number,'') ILIKE ${pattern}
          OR CONCAT_WS(' ',c.first_name,c.middle_name,c.last_name,c.organization_name) ILIKE ${pattern})
      ORDER BY ca.account_number,ma.assignment_date DESC,ma.assignment_id DESC LIMIT 100`;
    res.json({ items: rows });
  } catch (error) { next(error); }
});

metersRouter.get("/service-actions/direct/history", directServiceRoles, async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT aa.arrears_action_id AS "actionId",aa.action_type AS "actionType",aa.details,
        aa.metadata,aa.created_at AS "createdAt",ca.account_number AS "accountNumber",
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.middle_name,c.last_name)),''),c.organization_name,c.customer_number) AS "customerName",
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.username) AS "performedByName"
      FROM aquaflow.arrears_actions aa
      JOIN aquaflow.customer_accounts ca ON ca.account_id=aa.account_id
      JOIN aquaflow.customers c ON c.customer_id=ca.customer_id
      LEFT JOIN aquaflow.users u ON u.user_id=aa.performed_by
      WHERE aa.action_type IN ('DIRECT_METER_DISCONNECTION','DIRECT_METER_RECONNECTION')
      ORDER BY aa.created_at DESC LIMIT 50`;
    res.json(rows);
  } catch (error) { next(error); }
});

metersRouter.post("/service-actions/direct/disconnection/preview", directServiceRoles, async (req, res, next) => {
  const parsed = directDisconnectionPreviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const data = parsed.data;
    const accountId = BigInt(data.accountId);
    const meterId = BigInt(data.meterId);
    const context = await directServiceContext(prisma, accountId, meterId, data.actionDateTime);
    if (!['ACTIVE', 'SUSPENDED'].includes(context.accountStatus)) {
      return res.status(409).json({ error: "Only an active or suspended account can be disconnected" });
    }
    if (context.meterStatus === "DISCONNECTED") return res.status(409).json({ error: "This meter is already disconnected" });
    if (data.currentReading < context.latestReading) {
      return res.status(409).json({ error: `Current reading cannot be below the latest approved reading of ${context.latestReading}` });
    }
    const consumption = roundMoney(data.currentReading - context.latestReading);
    const prepared = await prepareReplacementBill(prisma, accountId, data.actionDateTime, consumption);
    res.json({
      previousReading: context.latestReading, currentReading: data.currentReading, consumption,
      tariffCode: prepared.tariff.tariffCode, tariffName: prepared.tariff.tariffName,
      finalReadingCharge: prepared.calculation.totalCurrentCharges,
      currentBalance: prepared.previousBalance,
      balanceAfterDisconnection: roundMoney(prepared.previousBalance + prepared.calculation.totalCurrentCharges),
      calculation: prepared.calculation,
    });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/disconnect", directServiceRoles, async (req, res, next) => {
  const parsed = directDisconnectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const data = parsed.data;
      const accountId = BigInt(data.accountId);
      const meterId = BigInt(data.meterId);
      const actorId = userId(req)!;
      const context = await directServiceContext(tx, accountId, meterId, data.actionDateTime, true);
      if (!['ACTIVE', 'SUSPENDED'].includes(context.accountStatus)) throw Object.assign(new Error("Only an active or suspended account can be disconnected"), { status: 409 });
      if (context.meterStatus === "DISCONNECTED") throw Object.assign(new Error("This meter is already disconnected"), { status: 409 });
      if (data.currentReading < context.latestReading) throw Object.assign(new Error(`Current reading cannot be below the latest approved reading of ${context.latestReading}`), { status: 409 });
      const consumption = roundMoney(data.currentReading - context.latestReading);
      const prepared = await prepareReplacementBill(tx, accountId, data.actionDateTime, consumption);
      const types = await tx.$queryRaw<any[]>`SELECT work_order_type_id FROM aquaflow.work_order_types WHERE type_code='DISCONNECTION' AND status='ACTIVE' LIMIT 1`;
      if (!types[0]) throw Object.assign(new Error("The DISCONNECTION operation type is not configured"), { status: 409 });
      const workOrderNumber = `WO-DD-${Date.now()}-${meterId}`;
      const workOrders = await tx.$queryRaw<any[]>`
        INSERT INTO aquaflow.work_orders(work_order_number,work_order_type_id,account_id,property_id,zone_id,
          priority,description,scheduled_date,status,created_by,source_type,source_reference,
          completion_notes,started_at,completed_at,verified_by,verified_at,closed_at)
        VALUES(${workOrderNumber},${types[0].work_order_type_id},${accountId},${context.propertyId},${context.zoneId},
          'HIGH',${data.reason},${data.actionDateTime},'CLOSED',${actorId},'MANUAL','DIRECT_METER_SERVICE',
          ${data.remarks ?? data.reason},${data.actionDateTime},${data.actionDateTime},${actorId},${data.actionDateTime},${data.actionDateTime})
        RETURNING work_order_id AS "workOrderId",work_order_number AS "workOrderNumber"`;
      const workOrder = workOrders[0];
      const reading = await tx.meterReading.create({ data: {
        meterId, accountId, previousReading: context.latestReading, currentReading: data.currentReading,
        readingType: "ACTUAL", readingDate: data.actionDateTime,
        abnormalFlag: consumption === 0, exceptionType: consumption === 0 ? "ZERO" : "NONE",
        approvalStatus: "APPROVED", approvedBy: actorId, approvedAt: new Date(),
        approvalComments: `Approved during direct disconnection ${workOrder.workOrderNumber}`,
        syncId: `DIRECT_DISCONNECTION:${workOrder.workOrderId}`,
        events: { create: { eventType: "DISCONNECTION_READING_POSTED", remarks: data.remarks ?? data.reason, performedBy: actorId } },
      } });
      await tx.$executeRaw`
        INSERT INTO aquaflow.disconnection_postings(work_order_id,account_id,meter_id,reading_id,
          previous_reading,current_reading,default_disconnection_fee,disconnection_fee,
          fee_overridden,fee_override_reason,fine_amount,fine_reason,posted_by)
        VALUES(${workOrder.workOrderId},${accountId},${meterId},${reading.readingId},${context.latestReading},
          ${data.currentReading},${prepared.calculation.totalCurrentCharges},${prepared.calculation.totalCurrentCharges},
          FALSE,NULL,0,NULL,${actorId})`;
      await tx.customerAccount.update({ where: { accountId }, data: {
        currentBalance: { increment: prepared.calculation.totalCurrentCharges }, accountStatus: "DISCONNECTED", updatedAt: new Date(),
      } });
      await tx.meter.update({ where: { meterId }, data: { status: "DISCONNECTED", updatedAt: new Date() } });
      await tx.meterEvent.create({ data: {
        meterId, assignmentId: context.assignmentId, eventType: "STATUS_CHANGED",
        previousStatus: context.meterStatus, newStatus: "DISCONNECTED", reading: data.currentReading,
        reason: data.reason, remarks: data.remarks, performedBy: actorId,
        metadata: { direct: true, action: "DISCONNECTION", workOrderId: workOrder.workOrderId.toString(), customerAcknowledgement: data.customerAcknowledgement },
      } });
      await tx.arrearsAction.create({ data: {
        accountId, actionType: "DIRECT_METER_DISCONNECTION", referenceType: "WORK_ORDER",
        referenceId: workOrder.workOrderId, details: data.reason, performedBy: actorId,
        metadata: { meterId: meterId.toString(), meterNumber: context.meterNumber, readingId: reading.readingId.toString(), currentReading: data.currentReading, finalReadingCharge: prepared.calculation.totalCurrentCharges, remarks: data.remarks ?? null },
      } });
      return { action: "DISCONNECTED", workOrder, readingId: reading.readingId, finalReadingCharge: prepared.calculation.totalCurrentCharges };
    }, { maxWait: 10_000, timeout: 30_000 });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/reconnection/request", directServiceRoles, async (req, res, next) => {
  const parsed = z.object({
    accountId: z.string().regex(/^\d+$/), meterId: z.string().regex(/^\d+$/),
    reason: z.string().trim().min(3).max(1000).default("Direct meter reconnection"),
    phoneNumber: z.string().trim().min(7).max(40).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const context = await directServiceContext(tx, BigInt(parsed.data.accountId), BigInt(parsed.data.meterId), new Date(), true);
      if (context.accountStatus !== "DISCONNECTED" || context.meterStatus !== "DISCONNECTED") {
        throw Object.assign(new Error("The account and its current meter must both be disconnected"), { status: 409 });
      }
      const request = await ensureDirectReconnectionRequest(tx, context, userId(req)!, parsed.data.reason, parsed.data.phoneNumber);
      if (request.workOrderId) throw Object.assign(new Error("This reconnection has already been dispatched through a work order"), { status: 409 });
      return request;
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/reconnection/payment/stk", directServiceRoles, async (req, res, next) => {
  const parsed = z.object({
    accountId: z.string().regex(/^\d+$/), meterId: z.string().regex(/^\d+$/),
    phoneNumber: z.string().trim().min(7).max(40), reason: z.string().trim().min(3).max(1000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const accountId = BigInt(parsed.data.accountId);
    const meterId = BigInt(parsed.data.meterId);
    const context = await directServiceContext(prisma, accountId, meterId, new Date());
    if (context.accountStatus !== "DISCONNECTED" || context.meterStatus !== "DISCONNECTED") {
      return res.status(409).json({ error: "The account and its current meter must both be disconnected" });
    }
    const request = await prisma.$transaction(async (tx) =>
      ensureDirectReconnectionRequest(tx, context, userId(req)!, parsed.data.reason, parsed.data.phoneNumber));
    if (request.workOrderId) return res.status(409).json({ error: "This reconnection has already been dispatched through a work order" });
    if (request.feePaymentStatus === "PAID") return res.status(409).json({ error: "The reconnection fee has already been settled" });
    if (request.feePaymentStatus === "PENDING") return res.status(409).json({ error: "An M-Pesa prompt is already pending. Check its status before retrying." });
    const fee = Number(request.reconnectionFee);
    if (!Number.isInteger(fee) || fee <= 0) return res.status(409).json({ error: "M-Pesa requires a positive whole-number reconnection fee" });
    const stk = await initiateMpesaStk({
      account: { accountId, accountNumber: context.accountNumber }, phoneNumber: parsed.data.phoneNumber,
      amount: fee, initiatedBy: userId(req), accountReference: request.requestNumber,
      description: "AquaFlow reconnection fee", purposeType: "RECONNECTION_FEE", purposeReference: request.requestNumber,
    });
    await prisma.$executeRaw`UPDATE aquaflow.reconnection_requests SET fee_payment_status='PENDING',
      contact_phone=${parsed.data.phoneNumber},updated_at=NOW() WHERE reconnection_request_id=${request.reconnectionRequestId}`;
    res.status(201).json({ requestNumber: request.requestNumber, reconnectionFee: fee,
      feePaymentStatus: "PENDING", stkRequestId: stk.stkRequestId, customerMessage: stk.customerMessage });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/reconnection/payment/status", directServiceRoles, async (req, res, next) => {
  const parsed = z.object({ accountId: z.string().regex(/^\d+$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const request = await paidDirectReconnectionRequest(prisma, BigInt(parsed.data.accountId));
    if (!request) return res.status(404).json({ error: "No open reconnection request exists for this account" });
    if (request.feePaymentStatus !== "PENDING") return res.json({ feePaymentStatus: request.feePaymentStatus, requestNumber: request.requestNumber });
    const stk = await prisma.mpesaStkRequest.findFirst({
      where: { purposeType: "RECONNECTION_FEE", purposeReference: request.requestNumber }, orderBy: { createdAt: "desc" },
    });
    if (!stk) {
      await prisma.$executeRaw`UPDATE aquaflow.reconnection_requests SET fee_payment_status='UNPAID',updated_at=NOW()
        WHERE reconnection_request_id=${request.reconnectionRequestId} AND fee_payment_status='PENDING'`;
      return res.json({ feePaymentStatus: "UNPAID", requestNumber: request.requestNumber, message: "No pending M-Pesa request was found. You can retry." });
    }
    if (["FAILED", "CANCELLED"].includes(stk.status)) {
      await prisma.$executeRaw`UPDATE aquaflow.reconnection_requests SET fee_payment_status='UNPAID',updated_at=NOW()
        WHERE reconnection_request_id=${request.reconnectionRequestId} AND fee_payment_status='PENDING'`;
      return res.json({ feePaymentStatus: "UNPAID", requestNumber: request.requestNumber, message: stk.resultDescription || "The M-Pesa prompt was not completed." });
    }
    if (stk.status === "COMPLETED") return res.json({ feePaymentStatus: "PAID", requestNumber: request.requestNumber, message: "Reconnection fee payment completed." });
    if (!stk.checkoutRequestId) return res.status(409).json({ error: "The pending M-Pesa request has no checkout reference" });
    const query = await queryStkPush(stk.checkoutRequestId);
    const resultCode = query.ResultCode == null ? null : Number(query.ResultCode);
    const message = String(query.ResultDesc ?? query.ResponseDescription ?? "M-Pesa request is still pending");
    if (resultCode != null && resultCode !== 0) {
      const nextStatus = resultCode === 1032 ? "CANCELLED" : "FAILED";
      await prisma.$transaction(async (tx) => {
        await tx.mpesaStkRequest.update({ where: { stkRequestId: stk.stkRequestId }, data: {
          status: nextStatus, resultCode, resultDescription: message, completedAt: new Date(), updatedAt: new Date(),
        } });
        await tx.$executeRaw`UPDATE aquaflow.reconnection_requests SET fee_payment_status='UNPAID',updated_at=NOW()
          WHERE reconnection_request_id=${request.reconnectionRequestId} AND fee_payment_status='PENDING'`;
      });
      return res.json({ feePaymentStatus: "UNPAID", requestNumber: request.requestNumber, message });
    }
    res.json({ feePaymentStatus: "PENDING", requestNumber: request.requestNumber,
      message: resultCode === 0 ? "M-Pesa reports success; waiting for the payment callback." : message });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/reconnection/payment/reset", directServiceRoles, async (req, res, next) => {
  const parsed = z.object({
    accountId: z.string().regex(/^\d+$/),
    meterId: z.string().regex(/^\d+$/),
    confirmNotPaid: z.literal(true),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const accountId = BigInt(parsed.data.accountId);
    const meterId = BigInt(parsed.data.meterId);
    const context = await directServiceContext(prisma, accountId, meterId, new Date());
    if (context.accountStatus !== "DISCONNECTED" || context.meterStatus !== "DISCONNECTED") {
      return res.status(409).json({ error: "The account and its current meter must both be disconnected" });
    }
    const request = await paidDirectReconnectionRequest(prisma, accountId);
    if (!request) return res.status(404).json({ error: "No open reconnection request exists for this account" });
    if (request.feePaymentStatus !== "PENDING") {
      return res.status(409).json({ error: `The reconnection payment is ${String(request.feePaymentStatus).toLowerCase()}, not pending` });
    }
    const stk = await prisma.mpesaStkRequest.findFirst({
      where: { purposeType: "RECONNECTION_FEE", purposeReference: request.requestNumber },
      orderBy: { createdAt: "desc" },
    });
    if (!stk) return res.status(409).json({ error: "No pending M-Pesa request was found. Check the status to unlock this request." });
    if (stk.status === "COMPLETED" || stk.paymentId || stk.mpesaReceiptNumber) {
      return res.status(409).json({ error: "This M-Pesa request has payment evidence and cannot be reset" });
    }
    const minimumResetAgeMs = 2 * 60 * 1000;
    if (Date.now() - stk.createdAt.getTime() < minimumResetAgeMs) {
      return res.status(409).json({ error: "Wait at least two minutes and check the M-Pesa status before resetting the prompt" });
    }
    await prisma.$transaction(async (tx) => {
      const resetAt = new Date();
      await tx.mpesaStkRequest.update({
        where: { stkRequestId: stk.stkRequestId },
        data: {
          status: "CANCELLED",
          resultDescription: `Manually reset as not paid by user ${String(userId(req))}`,
          completedAt: resetAt,
          updatedAt: resetAt,
        },
      });
      await tx.$executeRaw`UPDATE aquaflow.reconnection_requests SET fee_payment_status='UNPAID',updated_at=NOW()
        WHERE reconnection_request_id=${request.reconnectionRequestId} AND fee_payment_status='PENDING'`;
      await tx.arrearsAction.create({ data: {
        accountId,
        actionType: "RECONNECTION_STK_RESET",
        referenceType: "RECONNECTION_REQUEST",
        referenceId: request.reconnectionRequestId,
        details: `Pending M-Pesa prompt reset as not paid for ${request.requestNumber}`,
        performedBy: userId(req),
        metadata: {
          stkRequestId: stk.stkRequestId.toString(),
          checkoutRequestId: stk.checkoutRequestId,
          requestNumber: request.requestNumber,
        },
      } });
    });
    res.json({
      feePaymentStatus: "UNPAID",
      requestNumber: request.requestNumber,
      message: "The unpaid prompt was reset. You can send a new M-Pesa prompt.",
    });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/reconnection/payment/credit", directServiceRoles, async (req, res, next) => {
  const parsed = z.object({
    accountId: z.string().regex(/^\d+$/), meterId: z.string().regex(/^\d+$/),
    reason: z.string().trim().min(3).max(1000).default("Reconnection fee settled from account credit"),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const accountId = BigInt(parsed.data.accountId);
      const context = await directServiceContext(tx, accountId, BigInt(parsed.data.meterId), new Date(), true);
      if (context.accountStatus !== "DISCONNECTED" || context.meterStatus !== "DISCONNECTED") {
        throw Object.assign(new Error("The account and its current meter must both be disconnected"), { status: 409 });
      }
      const request = await ensureDirectReconnectionRequest(tx, context, userId(req)!, parsed.data.reason);
      if (request.workOrderId) throw Object.assign(new Error("This reconnection has already been dispatched through a work order"), { status: 409 });
      if (request.feePaymentStatus === "PAID") throw Object.assign(new Error("The reconnection fee has already been settled"), { status: 409 });
      if (request.feePaymentStatus === "PENDING") throw Object.assign(new Error("Resolve the pending M-Pesa prompt before applying account credit"), { status: 409 });
      const fee = Number(request.reconnectionFee);
      const creditAvailable = Math.max(0, -Number(context.currentBalance));
      if (creditAvailable < fee) throw Object.assign(new Error(`Available account credit is KSh ${creditAvailable.toFixed(2)}; KSh ${fee.toFixed(2)} is required`), { status: 409 });
      const adjustmentNumber = `AADJ-RCF-${Date.now()}-${String(accountId).slice(-5)}`;
      const adjustment = await tx.accountAdjustment.create({ data: {
        adjustmentNumber, accountId, adjustmentType: "DEBIT", amount: fee,
        reason: `${parsed.data.reason} for ${request.requestNumber}`, status: "APPROVED",
        requestedBy: userId(req)!, approvedBy: userId(req), approvedAt: new Date(),
        decisionComments: "Automatically approved because the customer chose to apply existing account credit",
      } });
      await tx.customerAccount.update({ where: { accountId }, data: { currentBalance: { increment: fee }, updatedAt: new Date() } });
      await tx.$executeRaw`UPDATE aquaflow.reconnection_requests SET fee_payment_status='PAID',fee_payment_id=NULL,
        fee_paid_at=NOW(),decision_notes=${`Reconnection fee settled from account credit via ${adjustmentNumber}`},
        decided_by=${userId(req)},decided_at=COALESCE(decided_at,NOW()),updated_at=NOW()
        WHERE reconnection_request_id=${request.reconnectionRequestId}`;
      await tx.arrearsAction.create({ data: {
        accountId, actionType: "RECONNECTION_FEE_CREDIT_APPLIED", referenceType: "ACCOUNT_ADJUSTMENT",
        referenceId: adjustment.accountAdjustmentId, details: `${adjustmentNumber}: KSh ${fee.toFixed(2)} applied from customer credit`,
        performedBy: userId(req), metadata: { reconnectionRequestId: request.reconnectionRequestId.toString(), requestNumber: request.requestNumber, creditBefore: creditAvailable, creditAfter: roundMoney(creditAvailable - fee) },
      } });
      return { requestNumber: request.requestNumber, reconnectionFee: fee, adjustmentNumber,
        creditBefore: creditAvailable, creditAfter: roundMoney(creditAvailable - fee), feePaymentStatus: "PAID", settlementMethod: "ACCOUNT_CREDIT" };
    }, { maxWait: 10_000, timeout: 30_000 });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.post("/service-actions/direct/reconnect", directServiceRoles, async (req, res, next) => {
  const parsed = directReconnectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const data = parsed.data;
      const accountId = BigInt(data.accountId);
      const meterId = BigInt(data.meterId);
      const actorId = userId(req)!;
      const context = await directServiceContext(tx, accountId, meterId, data.actionDateTime, true);
      if (context.accountStatus !== "DISCONNECTED" || context.meterStatus !== "DISCONNECTED") {
        throw Object.assign(new Error("The account and its current meter must both be disconnected"), { status: 409 });
      }
      const request = await paidDirectReconnectionRequest(tx, accountId);
      const paidFromAccountCredit = request?.feePaymentStatus === "PAID" && !request?.paymentId &&
        String(request?.decisionNotes ?? "").toLowerCase().includes("account credit");
      const paid = paidFromAccountCredit || (request?.feePaymentStatus === "PAID" && request?.paymentStatus === "POSTED" &&
        request?.paymentType === "RECONNECTION_FEE" && Number(request?.paidAmount) >= Number(request?.reconnectionFee));
      if (!paid) throw Object.assign(new Error("A posted reconnection-fee payment is required before direct reconnection"), { status: 409 });
      if (request.workOrderId) throw Object.assign(new Error("This reconnection is already dispatched through a work order and must be completed there"), { status: 409 });
      await tx.customerAccount.update({ where: { accountId }, data: { accountStatus: "ACTIVE", updatedAt: new Date() } });
      await tx.meter.update({ where: { meterId }, data: { status: "ACTIVE", updatedAt: new Date() } });
      await tx.$executeRaw`UPDATE aquaflow.reconnection_requests SET status='COMPLETED',decision_notes=${data.reason},
        decided_by=${actorId},decided_at=COALESCE(decided_at,${data.actionDateTime}),updated_at=NOW()
        WHERE reconnection_request_id=${request.reconnectionRequestId}`;
      await tx.meterEvent.create({ data: {
        meterId, assignmentId: context.assignmentId, eventType: "STATUS_CHANGED",
        previousStatus: "DISCONNECTED", newStatus: "ACTIVE", reading: context.latestReading,
        reason: data.reason, remarks: data.remarks, performedBy: actorId,
        metadata: { direct: true, action: "RECONNECTION", reconnectionRequestId: request.reconnectionRequestId.toString(), receiptNumber: request.receiptNumber ?? null },
      } });
      await tx.arrearsAction.create({ data: {
        accountId, actionType: "DIRECT_METER_RECONNECTION", referenceType: "RECONNECTION_REQUEST",
        referenceId: request.reconnectionRequestId, details: data.reason, performedBy: actorId,
        metadata: { meterId: meterId.toString(), meterNumber: context.meterNumber, receiptNumber: request.receiptNumber ?? null, remarks: data.remarks ?? null },
      } });
      return { action: "RECONNECTED", reconnectionRequestId: request.reconnectionRequestId, requestNumber: request.requestNumber, receiptNumber: request.receiptNumber };
    }, { maxWait: 10_000, timeout: 30_000 });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

metersRouter.put("/replacements/:id", async (req, res, next) => {
  const parsed = replacementInputSchema.safeParse(req.body);
  if (!parsed.success || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: parsed.success ? "Invalid replacement id" : parsed.error.flatten() });
  try { res.json(await saveReplacement(req, parsed.data, BigInt(req.params.id))); }
  catch (error: any) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
});

metersRouter.patch("/replacements/:id", requireRole("SYSTEM_ADMIN", "METER_SUPERVISOR", "SUPERVISOR"), async (req, res, next) => {
  const parsed = z.object({ decision: z.enum(["APPROVE", "REJECT", "RETURN"]), comments: z.string().trim().min(2) }).safeParse(req.body);
  if (!parsed.success || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: parsed.success ? "Invalid replacement id" : parsed.error.flatten() });
  const decisionStatus = parsed.data.decision === "APPROVE" ? "APPROVED" : parsed.data.decision === "REJECT" ? "REJECTED" : "RETURNED";
  const eventType = parsed.data.decision === "APPROVE" ? "REPLACEMENT_APPROVED" : parsed.data.decision === "REJECT" ? "REPLACEMENT_REJECTED" : "REPLACEMENT_RETURNED";
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT mr.*,wo.status AS work_order_status,m.status AS new_meter_status
        FROM aquaflow.meter_replacements mr
        LEFT JOIN aquaflow.work_orders wo ON wo.work_order_id=mr.work_order_id
        JOIN aquaflow.meters m ON m.meter_id=mr.new_meter_id
        WHERE mr.replacement_id=${BigInt(req.params.id)} FOR UPDATE OF mr,m`;
      const replacement = rows[0];
      if (!replacement) throw Object.assign(new Error("Replacement request not found"), { status: 404 });
      if (replacement.request_status !== "PENDING") throw Object.assign(new Error("Only a pending request can be decided"), { status: 409 });
      if (parsed.data.decision === "APPROVE") {
        if (replacement.work_order_id && !["COMPLETED", "VERIFIED", "CLOSED"].includes(replacement.work_order_status)) {
          throw Object.assign(new Error("Complete the linked meter-replacement work order before approval"), { status: 409 });
        }
        if (replacement.new_meter_status !== "RESERVED") throw Object.assign(new Error("The incoming meter reservation is no longer valid"), { status: 409 });
        const evidenceCount = await tx.meterEvidence.count({ where: { replacementId: replacement.replacement_id } });
        const requestedByAdmin = replacement.requested_by
          ? await tx.userRole.count({
              where: {
                userId: replacement.requested_by,
                status: "ACTIVE",
                role: { roleCode: "SYSTEM_ADMIN", status: "ACTIVE" },
              },
            })
          : 0;
        if (!evidenceCount && !req.user?.roles.includes("SYSTEM_ADMIN") && !requestedByAdmin) {
          throw Object.assign(new Error("Replacement evidence is required before approval"), { status: 409 });
        }
        const assignment = await tx.meterAssignment.findFirst({
          where: { accountId: replacement.account_id, meterId: replacement.old_meter_id, assignmentStatus: "ACTIVE", removalDate: null },
        });
        if (!assignment) throw Object.assign(new Error("The old meter is no longer actively assigned to this account"), { status: 409 });
        const previousRows = await tx.$queryRaw<any[]>`SELECT COALESCE((SELECT current_reading FROM aquaflow.meter_readings
          WHERE meter_id=${replacement.old_meter_id} AND approval_status='APPROVED' ORDER BY reading_date DESC,reading_id DESC LIMIT 1),
          (SELECT opening_reading FROM aquaflow.meters WHERE meter_id=${replacement.old_meter_id})) AS value`;
        const previousReading = Number(previousRows[0].value);
        if (Number(replacement.old_final_reading) < previousReading) throw Object.assign(new Error(`Old final reading cannot be below ${previousReading}`), { status: 409 });
        const cycles = await tx.$queryRaw<any[]>`SELECT reading_cycle_id FROM aquaflow.reading_cycles
          WHERE status IN ('PLANNED','OPEN','IN_PROGRESS') AND end_date>=${replacement.replacement_date}
          ORDER BY CASE WHEN start_date<=${replacement.replacement_date} AND end_date>=${replacement.replacement_date} THEN 0 ELSE 1 END,start_date LIMIT 1`;
        if (!cycles[0]) throw Object.assign(new Error("Create or open a reading cycle covering the replacement before approval"), { status: 409 });
        const syncId = `METER_REPLACEMENT:${replacement.replacement_id}`;
        await tx.meterReading.upsert({
          where: { syncId }, update: {}, create: {
            meterId: replacement.old_meter_id, accountId: replacement.account_id,
            readingCycleId: cycles[0].reading_cycle_id, previousReading,
            currentReading: Number(replacement.old_final_reading), readingType: "ACTUAL",
            readingDate: replacement.replacement_date, gpsLatitude: replacement.gps_latitude,
            gpsLongitude: replacement.gps_longitude, abnormalFlag: false, exceptionType: "NONE",
            approvalStatus: "APPROVED", approvedBy: userId(req), approvedAt: new Date(),
            approvalComments: `Final reading from replacement REP-${replacement.replacement_id}`,
            syncId,
          },
        });
        await tx.meterAssignment.update({ where: { assignmentId: assignment.assignmentId }, data: { assignmentStatus: "ENDED", removalDate: replacement.replacement_date } });
        await tx.meter.update({ where: { meterId: replacement.old_meter_id }, data: { status: "REPLACED", installationStatus: "REMOVED" } });
        await tx.meter.update({ where: { meterId: replacement.new_meter_id }, data: { status: "ACTIVE", installationStatus: "INSTALLED", installationDate: replacement.replacement_date, openingReading: replacement.new_opening_reading, gpsLatitude: replacement.gps_latitude, gpsLongitude: replacement.gps_longitude } });
        await tx.meterAssignment.create({ data: { meterId: replacement.new_meter_id, accountId: replacement.account_id, assignmentDate: replacement.replacement_date, installedBy: replacement.replaced_by, remarks: replacement.remarks } });
      } else {
        await tx.meter.updateMany({ where: { meterId: replacement.new_meter_id, status: "RESERVED" }, data: { status: "IN_STOCK" } });
        if (parsed.data.decision === "REJECT" && replacement.work_order_id) {
          await tx.$executeRaw`UPDATE aquaflow.work_orders SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP
            WHERE work_order_id=${replacement.work_order_id} AND status IN ('CREATED','ASSIGNED','ACCEPTED','IN_PROGRESS','REOPENED')`;
        }
      }
      await tx.meterReplacement.update({ where: { replacementId: replacement.replacement_id }, data: { requestStatus: decisionStatus, approvedBy: parsed.data.decision === "APPROVE" ? userId(req) : null, decisionComments: parsed.data.comments, decidedAt: new Date() } });
      await tx.meterEvent.create({ data: { meterId: replacement.old_meter_id, replacementId: replacement.replacement_id, eventType, previousStatus: parsed.data.decision === "APPROVE" ? "ACTIVE" : undefined, newStatus: parsed.data.decision === "APPROVE" ? "REPLACED" : undefined, reading: replacement.old_final_reading, reason: replacement.replacement_reason, remarks: parsed.data.comments, performedBy: userId(req) } });
    });
    res.json({ decision: decisionStatus });
  } catch (error: any) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
});

metersRouter.get("/:id/history", async (req, res) => {
  const meter = await prisma.meter.findUnique({ where: { meterId: BigInt(req.params.id) }, include: {
    assignments: { include: assignmentInclude, orderBy: { assignmentDate: "asc" } }, readings: { orderBy: { readingDate: "asc" } },
    events: { include: { performer: true }, orderBy: { eventDate: "asc" } }, evidence: { orderBy: { createdAt: "asc" } },
    oldReplacements: { include: { account: { include: { customer: true } }, newMeter: true } },
    newReplacements: { include: { account: { include: { customer: true } }, oldMeter: true } },
  } });
  if (!meter) return res.status(404).json({ error: "Meter not found" });
  res.json(meter);
});

metersRouter.get("/:id", async (req, res) => {
  const meter = await prisma.meter.findUnique({ where: { meterId: BigInt(req.params.id) }, include: meterDetailInclude });
  if (!meter) return res.status(404).json({ error: "Meter not found" });
  res.json(presentMeter(meter));
});

metersRouter.patch("/:id", requireRole("SYSTEM_ADMIN", "METER_SUPERVISOR", "SUPERVISOR"), async (req, res) => {
  const parsed = meterProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const meterId = BigInt(req.params.id);
  const existing = await prisma.meter.findUnique({
    where: { meterId },
    include: { readings: { select: { readingId: true }, take: 1 } },
  });
  if (!existing) return res.status(404).json({ error: "Meter not found" });

  const data = parsed.data;
  if (existing.readings.length && Number(existing.openingReading) !== data.openingReading) {
    return res.status(409).json({ error: "Opening reading cannot be changed after meter readings have been recorded" });
  }

  const updateData = {
    meterNumber: data.meterNumber,
    meterType: data.meterType,
    technology: data.technology,
    brand: data.brand || null,
    model: data.model || null,
    meterSizeMm: data.meterSizeMm,
    serialNumber: data.serialNumber || null,
    openingReading: data.openingReading,
    purchaseDate: data.purchaseDate ? new Date(`${data.purchaseDate}T00:00:00.000Z`) : null,
    warrantyExpiryDate: data.warrantyExpiryDate ? new Date(`${data.warrantyExpiryDate}T00:00:00.000Z`) : null,
    storageLocation: data.storageLocation || null,
    gpsLatitude: data.gpsLatitude ?? null,
    gpsLongitude: data.gpsLongitude ?? null,
    sealNumber: data.sealNumber || null,
    remarks: data.remarks || null,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.meter.update({ where: { meterId }, data: updateData });
      await tx.meterEvent.create({
        data: {
          meterId,
          eventType: "PROFILE_UPDATED",
          previousStatus: existing.status,
          newStatus: existing.status,
          reading: data.openingReading,
          remarks: "Meter master and inventory details updated",
          performedBy: userId(req),
          metadata: {
            updatedFields: Object.keys(updateData),
            meterNumberBefore: existing.meterNumber,
            meterNumberAfter: data.meterNumber,
          },
        },
      });
    });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "Meter number or serial number already exists" });
    throw error;
  }

  const updated = await prisma.meter.findUnique({ where: { meterId }, include: meterDetailInclude });
  res.json(presentMeter(updated));
});

metersRouter.patch("/:id/installation", async (req, res) => {
  const parsed = z.object({ installationPoint: optText, installationDate: z.string(), openingReading: z.coerce.number().min(0), sealNumber: optText, gpsLatitude: optNumber, gpsLongitude: optNumber, remarks: optText, evidence: z.array(evidenceSchema).default([]), materials: z.array(z.object({ materialName: z.string().min(1), quantity: z.coerce.number().positive(), unit: z.string().min(1), remarks: optText })).default([]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const meterId = BigInt(req.params.id); const assignment = await prisma.meterAssignment.findFirst({ where: { meterId, assignmentStatus: "ACTIVE" } });
  if (!assignment) return res.status(404).json({ error: "Active meter installation not found" });
  await prisma.$transaction(async (tx) => {
    await tx.meter.update({ where: { meterId }, data: { installationDate: new Date(parsed.data.installationDate), openingReading: parsed.data.openingReading, sealNumber: parsed.data.sealNumber, gpsLatitude: parsed.data.gpsLatitude, gpsLongitude: parsed.data.gpsLongitude, installationStatus: "INSTALLED" } });
    await tx.meterAssignment.update({ where: { assignmentId: assignment.assignmentId }, data: { assignmentDate: new Date(parsed.data.installationDate), installationPoint: parsed.data.installationPoint, remarks: parsed.data.remarks, installationStatus: "COMPLETED" } });
    await addEvidence(tx, meterId, parsed.data.evidence, userId(req), assignment.assignmentId);
    await tx.meterInstallationMaterial.deleteMany({ where: { assignmentId: assignment.assignmentId } });
    for (const material of parsed.data.materials) await tx.meterInstallationMaterial.create({ data: { ...material, meterId, assignmentId: assignment.assignmentId } });
    await tx.meterEvent.create({ data: { meterId, assignmentId: assignment.assignmentId, eventType: "INSTALLATION_UPDATED", reading: parsed.data.openingReading, remarks: parsed.data.remarks, gpsLatitude: parsed.data.gpsLatitude, gpsLongitude: parsed.data.gpsLongitude, performedBy: userId(req) } });
  });
  res.json(await prisma.meter.findUnique({ where: { meterId }, include: meterDetailInclude }));
});

metersRouter.patch("/:id/status", async (req, res) => {
  const parsed = z.object({ status: z.enum(meterStatuses), reason: z.string().min(1), remarks: optText, gpsLatitude: optNumber, gpsLongitude: optNumber, evidence: z.array(evidenceSchema).default([]), createWorkOrder: z.boolean().default(false) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const meterId = BigInt(req.params.id); const existing = await prisma.meter.findUnique({ where: { meterId } });
  if (!existing) return res.status(404).json({ error: "Meter not found" });
  const meter = await prisma.$transaction(async (tx) => {
    const updated = await tx.meter.update({ where: { meterId }, data: { status: parsed.data.status, ...(parsed.data.status === "IN_STOCK" ? { installationStatus: "IN_STORE" } : {}), ...(parsed.data.status === "REMOVED" ? { installationStatus: "REMOVED" } : {}) } });
    await addEvidence(tx, meterId, parsed.data.evidence, userId(req));
    await tx.meterEvent.create({ data: { meterId, eventType: ["FAULTY", "TAMPERED"].includes(parsed.data.status) ? "FAULT_REPORTED" : "STATUS_CHANGED", previousStatus: existing.status, newStatus: parsed.data.status, reason: parsed.data.reason, remarks: parsed.data.remarks, gpsLatitude: parsed.data.gpsLatitude, gpsLongitude: parsed.data.gpsLongitude, performedBy: userId(req) } });
    if (["FAULTY", "TAMPERED", "INACTIVE"].includes(parsed.data.status)) {
      const settings: Record<string, [string, string]> = { FAULTY: ["FAULTY", "HIGH"], TAMPERED: ["TAMPER", "CRITICAL"], INACTIVE: ["INACTIVE", "LOW"] };
      await ensureAlert(tx, meterId, settings[parsed.data.status][0], settings[parsed.data.status][1], parsed.data.reason, userId(req));
    }
    return updated;
  });
  let workOrder = null;
  if (parsed.data.createWorkOrder) {
    try { workOrder = await createWorkOrder(meterId, userId(req)!, `${parsed.data.reason}${parsed.data.remarks ? `: ${parsed.data.remarks}` : ""}`); }
    catch (error: any) { return res.status(400).json({ error: `Status was updated, but work order creation failed: ${error.message}`, meter }); }
  }
  res.json({ ...meter, workOrder });
});
