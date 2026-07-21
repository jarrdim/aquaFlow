import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const billingRouter = Router();
billingRouter.use(requireAuth);

const id = z.coerce.bigint().positive();
const optionalId = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : value,
  id.optional(),
);
const dayText = z.string().min(1);
const money = z.coerce.number().positive().max(999_999_999);

function uid(req: any) {
  return req.user?.userId ? BigInt(req.user.userId) : null;
}
function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, res: any): T | undefined {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return undefined;
  }
  return parsed.data;
}
function customerName(customer: any) {
  return customer?.organizationName || [customer?.firstName, customer?.middleName, customer?.lastName].filter(Boolean).join(" ");
}
function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

const billInclude = {
  account: {
    include: {
      customer: true,
      category: true,
      property: { include: { zone: true, route: true } },
      route: true,
    },
  },
  billingCycle: true,
  tariff: { include: { bands: { orderBy: { bandSequence: "asc" as const } } } },
  reading: { include: { meter: true } },
  items: { orderBy: { billItemId: "asc" as const } },
  generator: true,
  approver: true,
  poster: true,
  adjustments: { include: { requester: true, approver: true }, orderBy: { createdAt: "desc" as const } },
  notifications: { include: { sender: true }, orderBy: { sentAt: "desc" as const } },
  events: { include: { performer: true }, orderBy: { createdAt: "desc" as const } },
} as const;

type ChargeItem = {
  chargeType: string;
  description: string;
  quantity: number;
  unitRate: number;
  amount: number;
  tariffBandId?: bigint;
};

function calculateTariff(tariff: any, consumption: number) {
  const items: ChargeItem[] = [];
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
      const amount = round(units * rate);
      consumptionCharge += amount;
      items.push({ chargeType: "CONSUMPTION_BAND", description: `Band ${band.bandSequence}: ${lower}–${band.upperLimit ?? "above"} units`, quantity: units, unitRate: rate, amount, tariffBandId: band.tariffBandId });
    }
  } else {
    const rate = Number(tariff.ratePerUnit);
    consumptionCharge = round(consumption * rate);
    items.push({ chargeType: "CONSUMPTION", description: "Water consumption", quantity: consumption, unitRate: rate, amount: consumptionCharge });
  }
  consumptionCharge = round(consumptionCharge);
  const minimumChargeAdjustment = round(Math.max(0, Number(tariff.minimumCharge) - consumptionCharge));
  const standingCharge = round(Number(tariff.standingCharge));
  const meterRent = round(Number(tariff.meterRent));
  if (minimumChargeAdjustment) items.push({ chargeType: "MINIMUM_ADJUSTMENT", description: "Minimum charge adjustment", quantity: 1, unitRate: minimumChargeAdjustment, amount: minimumChargeAdjustment });
  if (standingCharge) items.push({ chargeType: "STANDING_CHARGE", description: "Standing charge", quantity: 1, unitRate: standingCharge, amount: standingCharge });
  if (meterRent) items.push({ chargeType: "METER_RENT", description: "Meter rent", quantity: 1, unitRate: meterRent, amount: meterRent });
  const fixedCharges = round(minimumChargeAdjustment + standingCharge + meterRent);
  return { consumptionCharge, minimumChargeAdjustment, standingCharge, meterRent, fixedCharges, totalCurrentCharges: round(consumptionCharge + fixedCharges), items };
}

async function cycleCandidates(cycleId: bigint, filters: any = {}) {
  const cycle = await prisma.billingCycle.findUnique({
    where: { billingCycleId: cycleId },
    include: { readingCycles: true },
  });
  if (!cycle) throw Object.assign(new Error("Billing period not found"), { status: 404 });
  const readingCycle = cycle.readingCycles[0];
  if (!readingCycle) throw Object.assign(new Error("Link a reading cycle to this billing period before generating bills"), { status: 409 });
  if (readingCycle.status !== "CLOSED") throw Object.assign(new Error("The linked reading cycle must be closed before bill generation"), { status: 409 });

  const accounts = await prisma.customerAccount.findMany({
    where: {
      accountStatus: "ACTIVE",
      ...(filters.zoneId ? { property: { zoneId: BigInt(filters.zoneId) } } : {}),
      ...(filters.routeId ? { OR: [{ routeId: BigInt(filters.routeId) }, { property: { routeId: BigInt(filters.routeId) } }] } : {}),
      ...(filters.categoryId ? { categoryId: BigInt(filters.categoryId) } : {}),
      meterAssignments: { some: { assignmentStatus: "ACTIVE", removalDate: null, meter: { status: "ACTIVE" } } },
    },
    include: {
      customer: true,
      category: true,
      property: { include: { zone: true, route: true } },
      route: true,
      meterAssignments: {
        where: { assignmentStatus: "ACTIVE", removalDate: null, meter: { status: "ACTIVE" } },
        take: 1,
        include: { meter: { include: { readings: { where: { readingCycleId: readingCycle.readingCycleId, approvalStatus: "APPROVED" }, take: 1 } } } },
      },
      bills: { where: { billingCycleId: cycleId }, take: 1 },
    },
    orderBy: { accountNumber: "asc" },
  });
  const tariffs = await prisma.tariff.findMany({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: cycle.periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: cycle.periodStart } }],
    },
    include: { bands: { where: { status: "ACTIVE" }, orderBy: { bandSequence: "asc" } } },
  });

  const rows = accounts.map((account: any) => {
    const assignment = account.meterAssignments[0];
    const reading = assignment?.meter?.readings?.[0];
    const tariff = tariffs.find((value: any) => value.categoryId === account.categoryId);
    let issue = "NONE";
    if (account.bills.length) issue = "DUPLICATE_BILL";
    else if (!tariff) issue = "MISSING_TARIFF";
    else if (tariff.billingMethod !== "FLAT" && !reading) issue = "MISSING_READING";
    else if (reading?.exceptionType && reading.exceptionType !== "NONE") issue = reading.exceptionType === "HIGH" ? "HIGH_USAGE" : reading.exceptionType;
    const consumption = Number(reading?.consumption ?? 0);
    const calculation = tariff ? calculateTariff(tariff, consumption) : null;
    const previousBalance = filters.includePreviousBalance === false ? 0 : Number(account.currentBalance);
    const penalties = 0;
    // A negative account balance is customer credit. It can offset the new
    // charges, but a bill itself must never carry a negative amount due; any
    // unused credit remains on the customer account for future postings.
    const totalAmountDue = calculation
      ? round(Math.max(0, previousBalance + calculation.totalCurrentCharges + penalties))
      : 0;
    return {
      account,
      assignment,
      reading,
      tariff,
      consumption,
      calculation,
      previousBalance,
      penalties,
      issue,
      eligible: !["DUPLICATE_BILL", "MISSING_TARIFF", "MISSING_READING"].includes(issue),
      totalAmountDue,
    };
  });
  return { cycle, readingCycle, rows };
}

async function event(data: Prisma.BillingEventUncheckedCreateInput) {
  return prisma.billingEvent.create({ data });
}

billingRouter.get("/cycles", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const rows = await prisma.billingCycle.findMany({
      where: status ? { status } : undefined,
      include: { readingCycles: true, creator: true, poster: true, _count: { select: { bills: true } }, bills: { select: { status: true, totalCurrentCharges: true, notificationStatus: true } } },
      orderBy: [{ periodStart: "desc" }, { billingCycleId: "desc" }],
    });
    res.json(rows.map((row: any) => ({
      ...row,
      totals: {
        amount: round(row.bills.reduce((sum: number, bill: any) => sum + Number(bill.totalCurrentCharges), 0)),
        approved: row.bills.filter((bill: any) => ["APPROVED", "POSTED", "PAID", "PARTIALLY_PAID"].includes(bill.status)).length,
        notified: row.bills.filter((bill: any) => bill.notificationStatus === "SENT").length,
      },
    })));
  } catch (error) { next(error); }
});

billingRouter.post("/cycles", requireRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({
    cycleCode: z.string().trim().min(2).max(30),
    cycleName: z.string().trim().min(3).max(150),
    readingCycleId: id,
    periodStart: dayText,
    periodEnd: dayText,
    dueDate: dayText,
    penaltyDate: z.string().optional(),
    frequency: z.enum(["WEEKLY", "MONTHLY", "CUSTOM"]),
    status: z.enum(["DRAFT", "OPEN"]).default("DRAFT"),
    defaultNotification: z.enum(["SMS_APP", "SMS", "APP", "EMAIL"]).default("SMS_APP"),
    remarks: z.string().trim().max(2000).optional(),
  }).superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "Period end must be on or after period start" });
    if (value.dueDate < value.periodEnd) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date must be on or after period end" });
    if (value.penaltyDate && value.penaltyDate < value.dueDate) ctx.addIssue({ code: "custom", path: ["penaltyDate"], message: "Penalty date must be on or after due date" });
  }), req.body, res);
  if (!data) return;
  try {
    const readingCycle = await prisma.readingCycle.findUnique({ where: { readingCycleId: data.readingCycleId } });
    if (!readingCycle) return res.status(404).json({ error: "Reading cycle not found" });
    if (readingCycle.billingCycleId) return res.status(409).json({ error: "This reading cycle is already linked to a billing period" });
    const created = await prisma.$transaction(async (tx) => {
      const cycle = await tx.billingCycle.create({ data: {
        cycleCode: data.cycleCode, cycleName: data.cycleName, periodStart: day(data.periodStart), periodEnd: day(data.periodEnd), dueDate: day(data.dueDate),
        penaltyDate: data.penaltyDate ? day(data.penaltyDate) : null, frequency: data.frequency, status: data.status,
        defaultNotification: data.defaultNotification, remarks: data.remarks, createdBy: uid(req),
      } });
      await tx.readingCycle.update({ where: { readingCycleId: data.readingCycleId }, data: { billingCycleId: cycle.billingCycleId, updatedAt: new Date() } });
      await tx.billingEvent.create({ data: { billingCycleId: cycle.billingCycleId, eventType: "PERIOD_CREATED", newStatus: cycle.status, details: data.remarks, performedBy: uid(req) } });
      return cycle;
    });
    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "Billing period code already exists" });
    next(error);
  }
});

billingRouter.patch("/cycles/:id/status", requireRole("SYSTEM_ADMIN", "BILLING_SUPERVISOR", "FINANCE_MANAGER"), async (req, res, next) => {
  const cycleId = parse(id, req.params.id, res);
  const data = parse(z.object({ status: z.enum(["OPEN", "CLOSED", "CANCELLED"]), reason: z.string().trim().min(3).max(1000) }), req.body, res);
  if (!cycleId || !data) return;
  try {
    const cycle = await prisma.billingCycle.findUnique({ where: { billingCycleId: cycleId }, include: { bills: true } });
    if (!cycle) return res.status(404).json({ error: "Billing period not found" });
    if (data.status === "CLOSED" && cycle.bills.some((bill: any) => !["POSTED", "PAID", "PARTIALLY_PAID", "CANCELLED"].includes(bill.status))) return res.status(409).json({ error: "All bills must be posted or cancelled before closing the period" });
    if (data.status === "CANCELLED" && cycle.bills.length) return res.status(409).json({ error: "A billing period with generated bills cannot be cancelled" });
    const updated = await prisma.billingCycle.update({ where: { billingCycleId: cycleId }, data: { status: data.status, updatedAt: new Date() } });
    await event({ billingCycleId: cycleId, eventType: `PERIOD_${data.status}`, previousStatus: cycle.status, newStatus: data.status, details: data.reason, performedBy: uid(req) });
    res.json(updated);
  } catch (error) { next(error); }
});

billingRouter.get("/preview", async (req, res, next) => {
  const cycleId = parse(id, req.query.billingCycleId, res);
  if (!cycleId) return;
  try {
    const result = await cycleCandidates(cycleId, {
      zoneId: req.query.zoneId, routeId: req.query.routeId, categoryId: req.query.categoryId,
      includePreviousBalance: String(req.query.includePreviousBalance ?? "true") === "true",
    });
    res.json({
      cycle: result.cycle,
      readingCycle: result.readingCycle,
      summary: {
        accounts: result.rows.length,
        eligible: result.rows.filter((row) => row.eligible).length,
        approvedReadings: result.rows.filter((row) => row.reading).length,
        missingReadings: result.rows.filter((row) => row.issue === "MISSING_READING").length,
        missingTariffs: result.rows.filter((row) => row.issue === "MISSING_TARIFF").length,
        duplicates: result.rows.filter((row) => row.issue === "DUPLICATE_BILL").length,
        exceptions: result.rows.filter((row) => row.eligible && row.issue !== "NONE").length,
        totalAmount: round(result.rows.filter((row) => row.eligible).reduce((sum, row) => sum + row.totalAmountDue, 0)),
      },
      rows: result.rows.map((row) => ({
        accountId: row.account.accountId,
        accountNumber: row.account.accountNumber,
        customerName: customerName(row.account.customer),
        category: row.account.category.categoryName,
        zone: row.account.property.zone.zoneName,
        route: row.account.route?.routeName ?? row.account.property.route?.routeName,
        meterNumber: row.assignment?.meter?.meterNumber,
        readingId: row.reading?.readingId,
        consumption: row.consumption,
        tariffName: row.tariff?.tariffName,
        billingMethod: row.tariff?.billingMethod,
        calculation: row.calculation,
        previousBalance: row.previousBalance,
        totalAmountDue: row.totalAmountDue,
        issue: row.issue,
        eligible: row.eligible,
      })),
    });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

billingRouter.post("/generate", requireRole("SYSTEM_ADMIN", "BILLING_OFFICER"), async (req, res, next) => {
  const data = parse(z.object({ billingCycleId: id, includePreviousBalance: z.boolean().default(true), includePenalties: z.boolean().default(true), sendForApproval: z.boolean().default(true), zoneId: optionalId, routeId: optionalId, categoryId: optionalId }), req.body, res);
  if (!data) return;
  try {
    const result = await cycleCandidates(data.billingCycleId, data);
    if (!["DRAFT", "OPEN", "PROCESSING", "RETURNED"].includes(result.cycle.status)) return res.status(409).json({ error: "This billing period no longer accepts bill generation" });
    const eligible = result.rows.filter((row) => row.eligible);
    if (!eligible.length) return res.status(409).json({ error: "No eligible accounts. Review missing tariffs, readings, account status and duplicate bills in the preview." });
    const generated: any[] = [];
    for (const row of eligible) {
      try {
        const tariff = row.tariff!;
        const calculation = row.calculation!;
        const bill = await prisma.$transaction(async (tx) => {
          const billNumber = `BILL-${result.cycle.cycleCode.replace(/[^A-Z0-9]/gi, "")}-${String(row.account.accountId).padStart(6, "0")}`.slice(0, 40);
          const created = await tx.bill.create({ data: {
            billNumber, accountId: row.account.accountId, billingCycleId: result.cycle.billingCycleId, tariffId: tariff.tariffId, readingId: row.reading?.readingId,
            previousBalance: row.previousBalance, consumptionUnits: row.consumption, consumptionCharge: calculation.consumptionCharge,
            minimumChargeAdjustment: calculation.minimumChargeAdjustment, standingCharge: calculation.standingCharge, meterRent: calculation.meterRent,
            fixedCharges: calculation.fixedCharges, penalties: row.penalties, totalCurrentCharges: calculation.totalCurrentCharges,
            totalAmountDue: row.totalAmountDue, issueDate: result.cycle.periodEnd, dueDate: result.cycle.dueDate,
            status: data.sendForApproval ? "PENDING_APPROVAL" : "DRAFT", generatedBy: uid(req), exceptionType: row.issue,
            items: { create: calculation.items },
          } });
          await tx.billingEvent.create({ data: { billingCycleId: result.cycle.billingCycleId, billId: created.billId, eventType: "BILL_GENERATED", newStatus: created.status, details: `Generated from ${row.reading ? "approved reading" : "flat billing"}`, performedBy: uid(req), metadata: { consumption: row.consumption, tariffId: tariff.tariffId.toString() } } });
          return created;
        });
        generated.push(bill);
      } catch (error: any) {
        if (error.code !== "P2002") throw error;
      }
    }
    const nextStatus = data.sendForApproval ? "PENDING_APPROVAL" : "PROCESSING";
    await prisma.billingCycle.update({ where: { billingCycleId: data.billingCycleId }, data: { status: nextStatus, updatedAt: new Date() } });
    await event({ billingCycleId: data.billingCycleId, eventType: "BATCH_GENERATED", previousStatus: result.cycle.status, newStatus: nextStatus, details: `${generated.length} bill(s) generated`, performedBy: uid(req) });
    res.status(201).json({ generated: generated.length, skipped: eligible.length - generated.length, issues: result.rows.filter((row) => !row.eligible).length });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

billingRouter.get("/bills", async (req, res, next) => {
  try {
    const cycleId = req.query.billingCycleId ? BigInt(String(req.query.billingCycleId)) : undefined;
    const accountId = req.query.accountId ? BigInt(String(req.query.accountId)) : undefined;
    const status = String(req.query.status ?? "");
    const search = String(req.query.search ?? "");
    const rows = await prisma.bill.findMany({
      where: {
        ...(cycleId ? { billingCycleId: cycleId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ billNumber: { contains: search, mode: "insensitive" } }, { account: { accountNumber: { contains: search, mode: "insensitive" } } }, { account: { customer: { firstName: { contains: search, mode: "insensitive" } } } }, { account: { customer: { lastName: { contains: search, mode: "insensitive" } } } }] } : {}),
      },
      include: billInclude,
      orderBy: { createdAt: "desc" }, take: 2000,
    });
    res.json(rows.map((row: any) => ({ ...row, customerName: customerName(row.account.customer) })));
  } catch (error) { next(error); }
});

billingRouter.get("/bills/:id", async (req, res, next) => {
  const billId = parse(id, req.params.id, res); if (!billId) return;
  try {
    const bill = await prisma.bill.findUnique({ where: { billId }, include: billInclude });
    if (!bill) return res.status(404).json({ error: "Bill not found" });
    res.json({ ...bill, customerName: customerName((bill as any).account.customer) });
  } catch (error) { next(error); }
});

billingRouter.patch("/bills/decision", requireRole("BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"), async (req, res, next) => {
  const data = parse(z.object({ billIds: z.array(id).min(1).max(500), decision: z.enum(["APPROVE", "REJECT", "RETURN"]), comments: z.string().trim().min(3).max(2000) }), req.body, res);
  if (!data) return;
  try {
    const bills = await prisma.bill.findMany({ where: { billId: { in: data.billIds } } });
    if (bills.length !== data.billIds.length) return res.status(404).json({ error: "One or more bills were not found" });
    if (bills.some((bill: any) => bill.status !== "PENDING_APPROVAL")) return res.status(409).json({ error: "Only pending bills can be decided" });
    if (bills.some((bill: any) => bill.generatedBy === uid(req))) {
      for (const bill of bills.filter((value: any) => value.generatedBy === uid(req))) await prisma.billingSecurityAlert.create({ data: { billId: bill.billId, alertType: "SELF_APPROVAL", attemptedAction: data.decision, details: "Bill generator attempted to approve their own bill", attemptedBy: uid(req) } });
      return res.status(403).json({ error: "Maker-checker control: a bill generator cannot approve their own bills" });
    }
    const status = data.decision === "APPROVE" ? "APPROVED" : data.decision === "RETURN" ? "RETURNED" : "REJECTED";
    await prisma.$transaction(async (tx) => {
      for (const bill of bills) {
        await tx.bill.update({ where: { billId: bill.billId }, data: { status, approvedBy: uid(req), approvedAt: new Date(), approvalComments: data.comments, updatedAt: new Date() } });
        await tx.billingEvent.create({ data: { billingCycleId: bill.billingCycleId, billId: bill.billId, eventType: `BILL_${status}`, previousStatus: bill.status, newStatus: status, details: data.comments, performedBy: uid(req) } });
      }
    });
    res.json({ updated: bills.length, status });
  } catch (error) { next(error); }
});

billingRouter.post("/cycles/:id/post", requireRole("FINANCE_MANAGER", "SYSTEM_ADMIN"), async (req, res, next) => {
  const cycleId = parse(id, req.params.id, res);
  const data = parse(z.object({ reason: z.string().trim().min(3).max(1000) }), req.body, res);
  if (!cycleId || !data) return;
  try {
    const cycle = await prisma.billingCycle.findUnique({ where: { billingCycleId: cycleId }, include: { bills: true } });
    if (!cycle) return res.status(404).json({ error: "Billing period not found" });
    const approved = cycle.bills.filter((bill: any) => bill.status === "APPROVED");
    if (!approved.length) return res.status(409).json({ error: "No approved bills are ready for posting" });
    if (cycle.bills.some((bill: any) => ["DRAFT", "PENDING_APPROVAL", "RETURNED"].includes(bill.status))) return res.status(409).json({ error: "Resolve all draft, pending or returned bills before posting the period" });
    await prisma.$transaction(async (tx) => {
      for (const bill of approved) {
        await tx.bill.update({ where: { billId: bill.billId }, data: { status: "POSTED", postedBy: uid(req), postedAt: new Date(), updatedAt: new Date() } });
        await tx.customerAccount.update({ where: { accountId: bill.accountId }, data: { currentBalance: { increment: bill.totalCurrentCharges }, updatedAt: new Date() } });
        await tx.billingEvent.create({ data: { billingCycleId: cycleId, billId: bill.billId, eventType: "BILL_POSTED", previousStatus: "APPROVED", newStatus: "POSTED", details: data.reason, performedBy: uid(req) } });
      }
      await tx.billingCycle.update({ where: { billingCycleId: cycleId }, data: { status: "POSTED", postedBy: uid(req), postedAt: new Date(), updatedAt: new Date() } });
      await tx.billingEvent.create({ data: { billingCycleId: cycleId, eventType: "PERIOD_POSTED", previousStatus: cycle.status, newStatus: "POSTED", details: `${approved.length} bill(s) posted. ${data.reason}`, performedBy: uid(req) } });
    });
    res.json({ posted: approved.length });
  } catch (error) { next(error); }
});

billingRouter.post("/notifications", requireRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({ billingCycleId: id, channels: z.array(z.enum(["SMS", "APP", "EMAIL", "WHATSAPP"])).min(1), billIds: z.array(id).optional() }), req.body, res);
  if (!data) return;
  try {
    const bills = await prisma.bill.findMany({ where: { billingCycleId: data.billingCycleId, status: { in: ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"] }, ...(data.billIds ? { billId: { in: data.billIds } } : {}) }, include: { account: { include: { customer: true } }, billingCycle: true } });
    let sent = 0;
    await prisma.$transaction(async (tx) => {
      for (const bill of bills) {
        const name = customerName(bill.account.customer);
        const message = `Dear ${name}, your water bill for ${bill.billingCycle.cycleName} is KSh ${Number(bill.totalAmountDue).toFixed(2)}. Pay by ${bill.dueDate.toISOString().slice(0, 10)}. Account: ${bill.account.accountNumber}.`;
        for (const channel of data.channels) {
          const recipient = channel === "EMAIL" ? bill.account.customer.emailAddress : bill.account.customer.phoneNumber;
          await tx.billNotification.create({ data: { billId: bill.billId, channel, recipient, message, status: "SENT", sentBy: uid(req) } });
          sent += 1;
        }
        await tx.bill.update({ where: { billId: bill.billId }, data: { notificationStatus: "SENT", updatedAt: new Date() } });
        await tx.billingEvent.create({ data: { billingCycleId: bill.billingCycleId, billId: bill.billId, eventType: "NOTIFICATION_SENT", details: data.channels.join(", "), performedBy: uid(req) } });
      }
    });
    res.json({ bills: bills.length, notifications: sent });
  } catch (error) { next(error); }
});

billingRouter.get("/statements/:accountId", async (req, res, next) => {
  const accountId = parse(id, req.params.accountId, res); if (!accountId) return;
  try {
    const account = await prisma.customerAccount.findUnique({ where: { accountId }, include: { customer: true } });
    if (!account) return res.status(404).json({ error: "Account not found" });
    const from = req.query.from ? day(String(req.query.from)) : new Date("2000-01-01T00:00:00.000Z");
    // Blank date filters mean the complete account history. This also keeps a
    // newly posted, future-dated period visible immediately after posting.
    const to = req.query.to ? new Date(`${String(req.query.to)}T23:59:59.999Z`) : new Date("9999-12-31T23:59:59.999Z");
    const [bills, payments, priorBills, priorPayments] = await Promise.all([
      prisma.bill.findMany({ where: { accountId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, issueDate: { gte: from, lte: to } }, include: { billingCycle: true }, orderBy: { issueDate: "asc" } }),
      prisma.$queryRaw<any[]>`SELECT payment_id, transaction_reference, amount, payment_date FROM aquaflow.payments WHERE account_id = ${accountId} AND payment_status = 'POSTED' AND payment_date BETWEEN ${from} AND ${to} ORDER BY payment_date`,
      prisma.bill.aggregate({ where: { accountId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, issueDate: { lt: from } }, _sum: { totalCurrentCharges: true } }),
      prisma.$queryRaw<any[]>`SELECT COALESCE(SUM(amount), 0) AS total FROM aquaflow.payments WHERE account_id = ${accountId} AND payment_status = 'POSTED' AND payment_date < ${from}`,
    ]);
    const entries = [
      ...bills.map((bill: any) => ({ id: `B${bill.billId}`, date: bill.issueDate, description: `Bill ${bill.billingCycle.cycleName} (${bill.billNumber})`, debit: Number(bill.totalCurrentCharges), credit: 0 })),
      ...payments.map((payment: any) => ({ id: `P${payment.payment_id}`, date: payment.payment_date, description: `Payment ${payment.transaction_reference}`, debit: 0, credit: Number(payment.amount) })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const openingBalance = round(Number(account.openingBalance) + Number(priorBills._sum.totalCurrentCharges ?? 0) - Number(priorPayments[0]?.total ?? 0));
    let balance = openingBalance;
    const statement = entries.map((entry) => { balance = round(balance + entry.debit - entry.credit); return { ...entry, balance }; });
    res.json({ account: { ...account, customerName: customerName(account.customer) }, openingBalance, closingBalance: balance, entries: statement });
  } catch (error) { next(error); }
});

billingRouter.get("/adjustments", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    res.json(await prisma.billingAdjustment.findMany({ where: status ? { status } : undefined, include: { bill: { include: { account: { include: { customer: true } }, billingCycle: true } }, requester: true, approver: true, events: { include: { performer: true }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } }));
  } catch (error) { next(error); }
});

billingRouter.post("/adjustments", requireRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({ billId: id, adjustmentType: z.enum(["CREDIT_NOTE", "DEBIT_NOTE", "CORRECTION", "CANCELLATION"]), amount: money, reason: z.string().trim().min(5).max(2000), supportingFileName: z.string().max(255).optional(), supportingContent: z.string().max(6_000_000).optional() }), req.body, res);
  if (!data) return;
  try {
    const bill = await prisma.bill.findUnique({ where: { billId: data.billId } });
    if (!bill) return res.status(404).json({ error: "Bill not found" });
    if (!["APPROVED", "POSTED", "PARTIALLY_PAID"].includes(bill.status)) return res.status(409).json({ error: "Adjustments require an approved or posted bill" });
    if (["CREDIT_NOTE", "CANCELLATION"].includes(data.adjustmentType) && data.amount > Number(bill.totalCurrentCharges)) return res.status(400).json({ error: "Credit adjustment cannot exceed current bill charges" });
    const adjustmentNumber = `ADJ-${Date.now()}-${String(data.billId).slice(-4)}`;
    const adjustment = await prisma.billingAdjustment.create({ data: { ...data, adjustmentNumber, requestedBy: uid(req)!, status: "PENDING" } });
    await event({ billId: bill.billId, adjustmentId: adjustment.adjustmentId, eventType: "ADJUSTMENT_REQUESTED", newStatus: "PENDING", details: data.reason, performedBy: uid(req) });
    res.status(201).json(adjustment);
  } catch (error) { next(error); }
});

billingRouter.patch("/adjustments/decision", requireRole("BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"), async (req, res, next) => {
  const data = parse(z.object({ adjustmentIds: z.array(id).min(1).max(500), decision: z.enum(["APPROVE", "REJECT", "RETURN"]), comments: z.string().trim().min(3).max(2000) }), req.body, res);
  if (!data) return;
  try {
    const adjustments = await prisma.billingAdjustment.findMany({ where: { adjustmentId: { in: data.adjustmentIds } }, include: { bill: true } });
    if (adjustments.length !== data.adjustmentIds.length) return res.status(404).json({ error: "One or more adjustment requests were not found" });
    if (adjustments.some((adjustment: any) => adjustment.status !== "PENDING")) return res.status(409).json({ error: "Only pending adjustment requests can be decided" });
    const selfApprovals = adjustments.filter((adjustment: any) => adjustment.requestedBy === uid(req));
    if (selfApprovals.length) {
      await prisma.billingSecurityAlert.createMany({ data: selfApprovals.map((adjustment: any) => ({ billId: adjustment.billId, alertType: "SELF_APPROVAL", attemptedAction: data.decision, details: "Adjustment requester attempted batch self-approval", attemptedBy: uid(req) })) });
      return res.status(403).json({ error: "Maker-checker control: a requester cannot decide their own adjustment. No selected requests were changed." });
    }
    const nextStatus = data.decision === "APPROVE" ? "POSTED" : data.decision === "RETURN" ? "RETURNED" : "REJECTED";
    await prisma.$transaction(async (tx) => {
      for (const adjustment of adjustments) {
        if (data.decision === "APPROVE") {
          const signed = ["CREDIT_NOTE", "CANCELLATION"].includes(adjustment.adjustmentType) ? -Number(adjustment.amount) : Number(adjustment.amount);
          await tx.bill.update({ where: { billId: adjustment.billId }, data: { adjustmentAmount: { increment: signed }, totalCurrentCharges: { increment: signed }, totalAmountDue: { increment: signed }, updatedAt: new Date() } });
          if (["POSTED", "PARTIALLY_PAID"].includes(adjustment.bill.status)) await tx.customerAccount.update({ where: { accountId: adjustment.bill.accountId }, data: { currentBalance: { increment: signed }, updatedAt: new Date() } });
        }
        await tx.billingAdjustment.update({ where: { adjustmentId: adjustment.adjustmentId }, data: { status: nextStatus, approvedBy: uid(req), approvedAt: new Date(), decisionComments: data.comments, updatedAt: new Date() } });
        await tx.billingEvent.create({ data: { billId: adjustment.billId, adjustmentId: adjustment.adjustmentId, eventType: `ADJUSTMENT_${nextStatus}`, previousStatus: "PENDING", newStatus: nextStatus, details: data.comments, performedBy: uid(req) } });
      }
    });
    res.json({ updated: adjustments.length, status: nextStatus });
  } catch (error) { next(error); }
});

billingRouter.patch("/adjustments/:id/decision", requireRole("BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"), async (req, res, next) => {
  const adjustmentId = parse(id, req.params.id, res);
  const data = parse(z.object({ decision: z.enum(["APPROVE", "REJECT", "RETURN"]), comments: z.string().trim().min(3).max(2000) }), req.body, res);
  if (!adjustmentId || !data) return;
  try {
    const adjustment = await prisma.billingAdjustment.findUnique({ where: { adjustmentId }, include: { bill: true } });
    if (!adjustment) return res.status(404).json({ error: "Adjustment not found" });
    if (adjustment.status !== "PENDING") return res.status(409).json({ error: "This adjustment has already been decided" });
    if (adjustment.requestedBy === uid(req)) {
      await prisma.billingSecurityAlert.create({ data: { billId: adjustment.billId, alertType: "SELF_APPROVAL", attemptedAction: data.decision, details: "Adjustment requester attempted self-approval", attemptedBy: uid(req) } });
      return res.status(403).json({ error: "Maker-checker control: the requester cannot approve their own adjustment" });
    }
    const nextStatus = data.decision === "APPROVE" ? "POSTED" : data.decision === "RETURN" ? "RETURNED" : "REJECTED";
    await prisma.$transaction(async (tx) => {
      if (data.decision === "APPROVE") {
        const signed = ["CREDIT_NOTE", "CANCELLATION"].includes(adjustment.adjustmentType) ? -Number(adjustment.amount) : Number(adjustment.amount);
        await tx.bill.update({ where: { billId: adjustment.billId }, data: { adjustmentAmount: { increment: signed }, totalCurrentCharges: { increment: signed }, totalAmountDue: { increment: signed }, updatedAt: new Date() } });
        if (["POSTED", "PARTIALLY_PAID"].includes(adjustment.bill.status)) await tx.customerAccount.update({ where: { accountId: adjustment.bill.accountId }, data: { currentBalance: { increment: signed }, updatedAt: new Date() } });
      }
      await tx.billingAdjustment.update({ where: { adjustmentId }, data: { status: nextStatus, approvedBy: uid(req), approvedAt: new Date(), decisionComments: data.comments, updatedAt: new Date() } });
      await tx.billingEvent.create({ data: { billId: adjustment.billId, adjustmentId, eventType: `ADJUSTMENT_${nextStatus}`, previousStatus: "PENDING", newStatus: nextStatus, details: data.comments, performedBy: uid(req) } });
    });
    res.json({ status: nextStatus });
  } catch (error) { next(error); }
});

billingRouter.get("/alerts", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "OPEN");
    res.json(await prisma.billingSecurityAlert.findMany({ where: status ? { status } : undefined, include: { bill: true, attempter: true, resolver: true }, orderBy: { createdAt: "desc" } }));
  } catch (error) { next(error); }
});

billingRouter.patch("/alerts/:id/resolve", requireRole("SYSTEM_ADMIN", "BILLING_SUPERVISOR", "FINANCE_MANAGER"), async (req, res, next) => {
  const alertId = parse(id, req.params.id, res); if (!alertId) return;
  try { res.json(await prisma.billingSecurityAlert.update({ where: { alertId }, data: { status: "RESOLVED", resolvedBy: uid(req), resolvedAt: new Date() } })); }
  catch (error) { next(error); }
});

billingRouter.get("/audit", async (req, res, next) => {
  try {
    const cycleId = req.query.billingCycleId ? BigInt(String(req.query.billingCycleId)) : undefined;
    res.json(await prisma.billingEvent.findMany({ where: cycleId ? { billingCycleId: cycleId } : undefined, include: { billingCycle: true, bill: true, adjustment: true, performer: true }, orderBy: { createdAt: "desc" }, take: 3000 }));
  } catch (error) { next(error); }
});

billingRouter.get("/dashboard", async (req, res, next) => {
  try {
    const cycleId = req.query.billingCycleId ? BigInt(String(req.query.billingCycleId)) : undefined;
    const cycle = cycleId ? await prisma.billingCycle.findUnique({ where: { billingCycleId: cycleId } }) : await prisma.billingCycle.findFirst({ orderBy: { periodStart: "desc" } });
    const where = cycle ? { billingCycleId: cycle.billingCycleId } : { billingCycleId: -1n };
    const [bills, alerts, adjustments, recent] = await Promise.all([
      prisma.bill.findMany({ where, select: { status: true, totalCurrentCharges: true, notificationStatus: true } }),
      prisma.billingSecurityAlert.count({ where: { status: "OPEN", ...(cycle ? { bill: { billingCycleId: cycle.billingCycleId } } : {}) } }),
      prisma.billingAdjustment.count({ where: { status: "PENDING", ...(cycle ? { bill: { billingCycleId: cycle.billingCycleId } } : {}) } }),
      prisma.billingEvent.findMany({ where: cycle ? { billingCycleId: cycle.billingCycleId } : undefined, include: { bill: { include: { account: { include: { customer: true } } } }, performer: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    ]);
    const approved = bills.filter((bill) => ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"].includes(bill.status)).length;
    res.json({ cycle, customersToBill: bills.length, billsGenerated: bills.length, pending: bills.filter((bill) => bill.status === "PENDING_APPROVAL").length, approved, totalBilling: round(bills.reduce((sum, bill) => sum + Number(bill.totalCurrentCharges), 0)), notified: bills.filter((bill) => bill.notificationStatus === "SENT").length, cancelled: bills.filter((bill) => bill.status === "CANCELLED").length, alerts, adjustments, recent: recent.map((row: any) => ({ ...row, customerName: customerName(row.bill?.account?.customer) })) });
  } catch (error) { next(error); }
});
