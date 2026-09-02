import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isSystemAdmin, requireAuth, requireRole } from "../middleware/auth";
import { createPaymentLinkToken, publicAppUrl } from "../lib/paymentLink";

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
function batchesOf<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    batches.push(values.slice(offset, offset + size));
  }
  return batches;
}
const postedBillStatuses = ["POSTED", "PARTIALLY_PAID", "PAID"];

async function ensureEarlierReadingsAreBilled(billingCycleId: bigint, accountIds: bigint[]) {
  const currentPeriod = await prisma.billingCycle.findUnique({
    where: { billingCycleId },
    include: { readingCycles: { orderBy: { endDate: "desc" }, take: 1 } },
  });
  const currentReadingCycle = currentPeriod?.readingCycles[0];
  if (!currentPeriod || !currentReadingCycle || !accountIds.length) return;

  const earlierReadings = await prisma.meterReading.findMany({
    where: {
      accountId: { in: accountIds },
      approvalStatus: "APPROVED",
      cycle: { status: "CLOSED", endDate: { lt: currentReadingCycle.endDate } },
    },
    select: {
      readingId: true,
      accountId: true,
      cycle: { select: { readingCycleId: true, cycleCode: true, billingCycleId: true } },
      account: { select: { accountNumber: true } },
      bills: { where: { status: { in: postedBillStatuses } }, select: { billId: true } },
    },
  });
  const linkedBillingCycleIds = Array.from(new Set(earlierReadings
    .map((reading) => reading.cycle?.billingCycleId)
    .filter((value): value is bigint => value != null)));
  const postedBills = linkedBillingCycleIds.length ? await prisma.bill.findMany({
    where: {
      accountId: { in: accountIds },
      billingCycleId: { in: linkedBillingCycleIds },
      status: { in: postedBillStatuses },
    },
    select: { accountId: true, billingCycleId: true },
  }) : [];
  const postedKeys = new Set(postedBills.map((bill) => `${bill.accountId}:${bill.billingCycleId}`));
  const blockers = earlierReadings.filter((reading) =>
    !reading.bills.length && (!reading.cycle?.billingCycleId || !postedKeys.has(`${reading.accountId}:${reading.cycle.billingCycleId}`)),
  );
  if (!blockers.length) return;

  const examples = Array.from(new Set(blockers.map((reading) =>
    `${reading.account?.accountNumber ?? `account ${reading.accountId}`} (${reading.cycle?.cycleCode ?? "older cycle"})`,
  ))).slice(0, 5);
  throw Object.assign(new Error(
    `Posting blocked: older approved readings are still unbilled for ${examples.join(", ")}${blockers.length > examples.length ? " and others" : ""}. Post the older bills first.`,
  ), { status: 409 });
}
function smsDate(value: Date) {
  // Keep customer messages unambiguous across servers and SMS providers.
  // Billing dates are stored as UTC calendar dates and must be DD/MM/YYYY.
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${value.getUTCFullYear()}`;
}
function smsNumber(value: number, places = 2) {
  return value.toLocaleString("en-KE", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}
function smsReading(value: number | null) {
  if (value === null) return "N/A";
  return value.toLocaleString("en-KE", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 3,
    maximumFractionDigits: 3,
  });
}

function customerFacingAccountNumber(value: string) {
  return value.trim().replace(/^ACC-/i, "");
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
  generalNotifications: {
    where: { notificationType: "BILL_ISSUED", channel: "SMS" },
    select: { deliveryStatus: true, sentAt: true, deliveredAt: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
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

function hasValidBillAmounts(calculation: ReturnType<typeof calculateTariff>) {
  return [
    calculation.consumptionCharge,
    calculation.minimumChargeAdjustment,
    calculation.standingCharge,
    calculation.meterRent,
    calculation.fixedCharges,
    calculation.totalCurrentCharges,
    ...calculation.items.flatMap((item) => [item.quantity, item.unitRate, item.amount]),
  ].every((value) => Number.isFinite(value) && value >= 0);
}

function isSkippableBillRowError(error: any) {
  const text = `${error?.message ?? ""} ${error?.meta?.message ?? ""}`;
  return error?.code === "P2002" || text.includes("23514") || text.includes("ck_bill_amounts");
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
      ...(filters.accountIds?.length ? { accountId: { in: filters.accountIds.map((value: bigint | string) => BigInt(value)) } } : {}),
      ...(filters.zoneId ? { property: { zoneId: BigInt(filters.zoneId) } } : {}),
      ...(filters.routeId ? { OR: [{ routeId: BigInt(filters.routeId) }, { property: { routeId: BigInt(filters.routeId) } }] } : {}),
      ...(filters.categoryId ? { categoryId: BigInt(filters.categoryId) } : {}),
      // Billing follows the approved cycle reading, even if the account or
      // assignment status changed after that reading was captured.
      meterReadings: { some: { readingCycleId: readingCycle.readingCycleId, approvalStatus: "APPROVED", bills: { none: {} } } },
    },
    include: {
      customer: true,
      category: true,
      property: { include: { zone: true, route: true } },
      route: true,
      meterAssignments: {
        where: { assignmentStatus: "ACTIVE", removalDate: null },
        take: 1,
        include: { meter: { include: { readings: { where: { readingCycleId: readingCycle.readingCycleId, approvalStatus: "APPROVED", bills: { none: {} } }, take: 1 } } } },
      },
      meterReadings: {
        where: { readingCycleId: readingCycle.readingCycleId, approvalStatus: "APPROVED", bills: { none: {} } },
        include: { meter: true },
        orderBy: [{ readingDate: "asc" }, { readingId: "asc" }],
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
    // A replacement can legitimately produce two approved readings in one
    // cycle: the old meter's final reading and the new meter's cycle reading.
    // Bill their combined consumption once against the customer account.
    const cycleReadings = account.meterReadings ?? [];
    const reading = cycleReadings[cycleReadings.length - 1] ?? assignment?.meter?.readings?.[0];
    const tariff = tariffs.find((value: any) => value.categoryId === account.categoryId);
    let issue = "NONE";
    if (account.bills.length) issue = "DUPLICATE_BILL";
    else if (!tariff) issue = "MISSING_TARIFF";
    else if (!reading) issue = "MISSING_READING";
    else {
      const exception = cycleReadings.find((value: any) => value.exceptionType && value.exceptionType !== "NONE")?.exceptionType;
      if (exception) issue = exception === "HIGH" ? "HIGH_USAGE" : exception;
    }
    const consumption = cycleReadings.length
      ? cycleReadings.reduce((sum: number, value: any) => sum + Number(value.consumption), 0)
      : Number(reading?.consumption ?? 0);
    const calculation = tariff ? calculateTariff(tariff, consumption) : null;
    if (!["DUPLICATE_BILL", "MISSING_TARIFF", "MISSING_READING"].includes(issue)) {
      if (!Number.isFinite(consumption)) issue = "INVALID_READING";
      else if (consumption < 0) issue = "NEGATIVE";
      else if (calculation && !hasValidBillAmounts(calculation)) issue = "INVALID_CALCULATION";
    }
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
      eligible: !["DUPLICATE_BILL", "MISSING_TARIFF", "MISSING_READING", "NEGATIVE", "INVALID_READING", "INVALID_CALCULATION"].includes(issue),
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
    const rawAccountIds = String(req.query.accountIds ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (rawAccountIds.some((value) => !/^\d+$/.test(value))) return res.status(400).json({ error: "accountIds must contain valid account IDs" });
    const result = await cycleCandidates(cycleId, {
      zoneId: req.query.zoneId, routeId: req.query.routeId, categoryId: req.query.categoryId,
      accountIds: Array.from(new Set(rawAccountIds)).map((value) => BigInt(value)),
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
        meterNumber: row.assignment?.meter?.meterNumber ?? row.reading?.meter?.meterNumber,
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
  const data = parse(z.object({ billingCycleId: id, includePreviousBalance: z.boolean().default(true), includePenalties: z.boolean().default(true), sendForApproval: z.boolean().default(true), zoneId: optionalId, routeId: optionalId, categoryId: optionalId, accountIds: z.array(id).min(1).max(500).optional() }), req.body, res);
  if (!data) return;
  try {
    const result = await cycleCandidates(data.billingCycleId, data);
    const isPostedBackfill = result.cycle.status === "POSTED";
    const acceptsTargetedGeneration = data.accountIds?.length && result.cycle.status === "PENDING_APPROVAL";
    if (!["DRAFT", "OPEN", "PROCESSING", "RETURNED"].includes(result.cycle.status) && !acceptsTargetedGeneration && !isPostedBackfill) return res.status(409).json({ error: "This billing period no longer accepts bill generation" });
    if (isPostedBackfill && !data.sendForApproval) return res.status(409).json({ error: "Bills backfilled into a posted period must be sent for approval" });
    const eligible = result.rows.filter((row) => row.eligible);
    if (!eligible.length) return res.status(409).json({ error: "No eligible accounts. Review missing tariffs, readings, account status and duplicate bills in the preview." });
    const generated: any[] = [];
    const generationSkipped: Array<{ accountNumber: string; issue: string }> = [];
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
        if (!isSkippableBillRowError(error)) throw error;
        const issue = error.code === "P2002" ? "DUPLICATE_BILL" : "INVALID_BILL_AMOUNTS";
        generationSkipped.push({ accountNumber: row.account.accountNumber, issue });
        console.warn(`Skipped bill generation for ${row.account.accountNumber}: ${issue}`);
      }
    }
    // A posted period may receive a controlled missing-bill backfill. Keep the
    // period posted while the new bills follow their own approval/posting flow.
    const nextStatus = isPostedBackfill ? "POSTED" : data.sendForApproval ? "PENDING_APPROVAL" : "PROCESSING";
    await prisma.billingCycle.update({ where: { billingCycleId: data.billingCycleId }, data: { status: nextStatus, updatedAt: new Date() } });
    await event({ billingCycleId: data.billingCycleId, eventType: "BATCH_GENERATED", previousStatus: result.cycle.status, newStatus: nextStatus, details: `${generated.length} bill(s) generated${isPostedBackfill ? " as a posted-period backfill" : ""}`, performedBy: uid(req) });
    const validationIssues = result.rows.filter((row) => !row.eligible).length;
    res.status(201).json({
      generated: generated.length,
      skipped: validationIssues + generationSkipped.length,
      issues: validationIssues,
      generationSkipped,
    });
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
    const take = Math.min(10_000, Math.max(1, Number(req.query.limit) || 2_000));
    const rows = await prisma.bill.findMany({
      where: {
        ...(cycleId ? { billingCycleId: cycleId } : {}),
        ...(accountId ? { accountId } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ billNumber: { contains: search, mode: "insensitive" } }, { account: { accountNumber: { contains: search, mode: "insensitive" } } }, { account: { customer: { firstName: { contains: search, mode: "insensitive" } } } }, { account: { customer: { lastName: { contains: search, mode: "insensitive" } } } }] } : {}),
      },
      include: billInclude,
      orderBy: { createdAt: "desc" }, take,
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
  const data = parse(z.object({ billIds: z.array(id).min(1).max(10_000), decision: z.enum(["APPROVE", "REJECT", "RETURN"]), comments: z.string().trim().min(3).max(2000) }), req.body, res);
  if (!data) return;
  try {
    const bills = await prisma.bill.findMany({ where: { billId: { in: data.billIds } } });
    if (bills.length !== data.billIds.length) return res.status(404).json({ error: "One or more bills were not found" });
    if (bills.some((bill: any) => bill.status !== "PENDING_APPROVAL")) return res.status(409).json({ error: "Only pending bills can be decided" });
    if (!isSystemAdmin(req) && bills.some((bill: any) => bill.generatedBy === uid(req))) {
      await prisma.billingSecurityAlert.createMany({ data: bills.filter((value: any) => value.generatedBy === uid(req)).map((bill: any) => ({ billId: bill.billId, alertType: "SELF_APPROVAL", attemptedAction: data.decision, details: "Bill generator attempted to approve their own bill", attemptedBy: uid(req) })) });
      return res.status(403).json({ error: "Maker-checker control: a bill generator cannot approve their own bills" });
    }
    const status = data.decision === "APPROVE" ? "APPROVED" : data.decision === "RETURN" ? "RETURNED" : "REJECTED";
    const decidedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.bill.updateMany({ where: { billId: { in: data.billIds }, status: "PENDING_APPROVAL" }, data: { status, approvedBy: uid(req), approvedAt: decidedAt, approvalComments: data.comments, updatedAt: decidedAt } });
      await tx.billingEvent.createMany({ data: bills.map((bill: any) => ({ billingCycleId: bill.billingCycleId, billId: bill.billId, eventType: `BILL_${status}`, previousStatus: bill.status, newStatus: status, details: data.comments, performedBy: uid(req), createdAt: decidedAt })) });
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
    await ensureEarlierReadingsAreBilled(cycleId, Array.from(new Set(approved.map((bill: any) => bill.accountId))));
    const postedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE aquaflow.customer_accounts AS account
        SET current_balance = account.current_balance + charges.total,
            updated_at = ${postedAt}
        FROM (
          SELECT account_id, SUM(total_current_charges) AS total
          FROM aquaflow.bills
          WHERE billing_cycle_id = ${cycleId} AND status = 'APPROVED'
          GROUP BY account_id
        ) AS charges
        WHERE account.account_id = charges.account_id
      `;
      await tx.bill.updateMany({ where: { billingCycleId: cycleId, status: "APPROVED" }, data: { status: "POSTED", postedBy: uid(req), postedAt, updatedAt: postedAt } });
      await tx.billingEvent.createMany({ data: approved.map((bill: any) => ({ billingCycleId: cycleId, billId: bill.billId, eventType: "BILL_POSTED", previousStatus: "APPROVED", newStatus: "POSTED", details: data.reason, performedBy: uid(req), createdAt: postedAt })) });
      await tx.billingCycle.update({ where: { billingCycleId: cycleId }, data: { status: "POSTED", postedBy: uid(req), postedAt, updatedAt: postedAt } });
      await tx.billingEvent.create({ data: { billingCycleId: cycleId, eventType: "PERIOD_POSTED", previousStatus: cycle.status, newStatus: "POSTED", details: `${approved.length} bill(s) posted. ${data.reason}`, performedBy: uid(req) } });
    });
    res.json({ posted: approved.length });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

billingRouter.post("/bills/post", requireRole("FINANCE_MANAGER", "SYSTEM_ADMIN"), async (req, res, next) => {
  const data = parse(z.object({
    billIds: z.array(id).min(1).max(500),
    reason: z.string().trim().min(3).max(1000),
  }), req.body, res);
  if (!data) return;
  try {
    const bills = await prisma.bill.findMany({
      where: { billId: { in: data.billIds } },
      select: { billId: true, accountId: true, billingCycleId: true, status: true },
    });
    if (bills.length !== data.billIds.length) return res.status(404).json({ error: "One or more bills were not found" });
    if (bills.some((bill) => bill.status !== "APPROVED")) return res.status(409).json({ error: "Only approved bills can be posted" });
    const cycleIds = [...new Set(bills.map((bill) => bill.billingCycleId.toString()))];
    if (cycleIds.length !== 1) return res.status(409).json({ error: "Selected bills must belong to the same billing period" });
    const cycleId = bills[0].billingCycleId;
    const cycle = await prisma.billingCycle.findUnique({ where: { billingCycleId: cycleId }, select: { status: true } });
    if (!cycle) return res.status(404).json({ error: "Billing period not found" });
    await ensureEarlierReadingsAreBilled(cycleId, Array.from(new Set(bills.map((bill) => bill.accountId))));
    const postedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE aquaflow.customer_accounts AS account
        SET current_balance = account.current_balance + charges.total,
            updated_at = ${postedAt}
        FROM (
          SELECT account_id, SUM(total_current_charges) AS total
          FROM aquaflow.bills
          WHERE bill_id IN (${Prisma.join(data.billIds)}) AND status = 'APPROVED'
          GROUP BY account_id
        ) AS charges
        WHERE account.account_id = charges.account_id
      `);
      const updated = await tx.bill.updateMany({
        where: { billId: { in: data.billIds }, status: "APPROVED" },
        data: { status: "POSTED", postedBy: uid(req), postedAt, updatedAt: postedAt },
      });
      if (updated.count !== data.billIds.length) throw Object.assign(new Error("Some bills changed before posting. Refresh and try again."), { status: 409 });
      await tx.billingEvent.createMany({
        data: bills.map((bill) => ({ billingCycleId: bill.billingCycleId, billId: bill.billId, eventType: "BILL_POSTED", previousStatus: "APPROVED", newStatus: "POSTED", details: data.reason, performedBy: uid(req), createdAt: postedAt })),
      });
      await tx.billingCycle.update({
        where: { billingCycleId: cycleId },
        data: { status: cycle.status === "POSTED" ? "POSTED" : "PROCESSING", updatedAt: postedAt },
      });
    }, { maxWait: 10_000, timeout: 30_000 });
    res.json({ posted: bills.length, billingCycleId: cycleId });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

billingRouter.post("/notifications", requireRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR"), async (req, res, next) => {
  const data = parse(z.object({ billingCycleId: id, channels: z.array(z.enum(["SMS", "APP"])).min(1), billIds: z.array(id).optional(), resend: z.boolean().default(false) }), req.body, res);
  if (!data) return;
  try {
    const billingCycle = await prisma.billingCycle.findUnique({
      where: { billingCycleId: data.billingCycleId },
      include: { readingCycles: true },
    });
    if (!billingCycle) return res.status(404).json({ error: "Billing period was not found" });
    const readingCycle = billingCycle.readingCycles[0];
    if (!readingCycle) return res.status(409).json({ error: "This billing period has no linked reading cycle" });
    if (readingCycle.status !== "CLOSED") return res.status(409).json({ error: "Close the linked reading cycle before sending bill notifications" });

    // A bill notification is also the customer's reading statement. Send it
    // for zero balances as long as the bill came from an approved reading.
    const bills = await prisma.bill.findMany({ where: { billingCycleId: data.billingCycleId, status: { in: ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"] }, readingId: { not: null }, ...(data.billIds ? { billId: { in: data.billIds } } : {}) }, include: { account: { include: { customer: true } }, billingCycle: true, reading: true } });
    const settings = await prisma.systemSetting.findUnique({
      where: { settingId: 1n },
      select: { reconnectionFee: true },
    });
    const requestedBy = uid(req);
    const existingNotifications = bills.length ? await prisma.notification.findMany({
      where: {
        billId: { in: bills.map((bill) => bill.billId) },
        notificationType: "BILL_ISSUED",
        deliveryStatus: { in: ["QUEUED", "SENT", "DELIVERED"] },
      },
      select: { billId: true, channel: true },
    }) : [];
    const existingNotificationKeys = new Set(
      existingNotifications.map((notification) => `${notification.billId}:${notification.channel}`),
    );
    const notificationRows: Prisma.NotificationCreateManyInput[] = [];
    const billNotificationRows: Prisma.BillNotificationCreateManyInput[] = [];
    const billingEventRows: Prisma.BillingEventCreateManyInput[] = [];
    const queuedBillIds = new Set<bigint>();
    const updatedAt = new Date();

    for (const bill of bills) {
      const name = customerName(bill.account.customer);
      const accountNumber = customerFacingAccountNumber(bill.account.accountNumber);
      const previousReading = bill.reading ? Number(bill.reading.previousReading) : null;
      const currentReading = bill.reading ? Number(bill.reading.currentReading) : null;
      const amountPaid = Number(bill.paidAmount);
      // Preserve account credits in the customer-facing balance. The persisted
      // amount due is floored at zero for collection controls, but the bill SMS
      // must still show the true balance carried forward (for example, -300).
      const totalAmount = round(
        Number(bill.previousBalance) +
        Number(bill.totalCurrentCharges) +
        Number(bill.penalties) -
        amountPaid,
      );
      const expiresAt = new Date(Date.now() + 30 * 86_400_000);
      const paymentToken = createPaymentLinkToken({
        accountId: bill.accountId.toString(),
        expiresAt: expiresAt.toISOString(),
      });
      const paymentUrl = `${publicAppUrl()}/pay/${paymentToken}`;
      const billDate = bill.billingCycle?.periodEnd ?? bill.issueDate;
      const dueDate = bill.billingCycle?.dueDate ?? bill.dueDate;
      const message = `Dear ${name} A/C ${accountNumber} your bill as at ${smsDate(billDate)}. Prev Read ${smsReading(previousReading)} Curr Read ${smsReading(currentReading)} Consumption ${smsReading(Number(bill.consumptionUnits))} Arrears KSh ${smsNumber(Number(bill.previousBalance))} Amount Paid KSh ${smsNumber(amountPaid)} Current Bill KSh ${smsNumber(Number(bill.totalCurrentCharges))} Total Amount KSh ${smsNumber(totalAmount)}. Due date is ${smsDate(dueDate)}. Reconnection Fee is KSh ${smsNumber(Number(settings?.reconnectionFee ?? 1155), 0)}. Bills payable through PayBill No 823496 using ${accountNumber} as the account number. WE MAKE IT SAFE BECAUSE WATER IS LIFE. THANK YOU.\n\nPay now: ${paymentUrl}`;
      for (const channel of data.channels) {
        const deliveryChannel = channel === "APP" ? "PUSH" : "SMS";
        if (!data.resend && existingNotificationKeys.has(`${bill.billId}:${deliveryChannel}`)) continue;
        const recipient = channel === "SMS" ? bill.account.customer.phoneNumber : bill.account.customer.customerNumber;
        if (!recipient) continue;
        notificationRows.push({
          customerId: bill.account.customerId,
          accountId: bill.accountId,
          billId: bill.billId,
          notificationType: "BILL_ISSUED",
          channel: deliveryChannel,
          recipient,
          subject: `Water bill - ${bill.billingCycle.cycleName}`,
          messageBody: message,
          requestedBy,
          metadata: { source: "BILLING", billingCycleId: bill.billingCycleId.toString(), requestedChannel: channel, resend: data.resend },
        });
        billNotificationRows.push({ billId: bill.billId, channel, recipient, message, status: "QUEUED", sentBy: requestedBy });
        queuedBillIds.add(bill.billId);
      }
      if (queuedBillIds.has(bill.billId)) {
        billingEventRows.push({
          billingCycleId: bill.billingCycleId,
          billId: bill.billId,
          eventType: data.resend ? "NOTIFICATION_REQUEUED" : "NOTIFICATION_QUEUED",
          details: data.channels.join(", "),
          performedBy: requestedBy,
          createdAt: updatedAt,
        });
      }

      // console.log(billNotificationRows, notificationRows, billingEventRows);
    }

    const notificationIds: bigint[] = [];
    await prisma.$transaction(async (tx) => {
      for (const batch of batchesOf(notificationRows, 500)) {
        const created = await tx.notification.createManyAndReturn({
          data: batch,
          select: { notificationId: true },
        });
        notificationIds.push(...created.map((notification) => notification.notificationId));
      }
      for (const batch of batchesOf(billNotificationRows, 500)) {
        await tx.billNotification.createMany({ data: batch });
      }
      if (queuedBillIds.size) {
        await tx.bill.updateMany({
          where: { billId: { in: [...queuedBillIds] } },
          data: { notificationStatus: "QUEUED", updatedAt },
        });
      }
      for (const batch of batchesOf(billingEventRows, 500)) {
        await tx.billingEvent.createMany({ data: batch });
      }
    }, { maxWait: 10_000, timeout: 120_000 });
    res.json({ bills: queuedBillIds.size, notifications: notificationRows.length, notificationIds });
  } catch (error) { next(error); }
});

billingRouter.get("/statements/:accountId", async (req, res, next) => {
  const accountId = parse(id, req.params.accountId, res); if (!accountId) return;
  try {
    const account = await prisma.customerAccount.findUnique({
      where: { accountId },
      include: {
        customer: true,
        category: true,
        route: { include: { zone: true } },
        property: { include: { zone: true, route: true, serviceArea: true } },
        meterAssignments: {
          where: { assignmentStatus: "ACTIVE" },
          include: { meter: true },
          orderBy: { assignmentDate: "desc" },
          take: 1,
        },
      },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    const fromText = String(req.query.from ?? "");
    const toText = String(req.query.to ?? "");
    const from = fromText ? day(fromText) : new Date("2000-01-01T00:00:00.000Z");
    // Blank date filters mean the complete account history. This also keeps a
    // newly posted, future-dated period visible immediately after posting.
    const to = toText ? new Date(`${toText}T23:59:59.999Z`) : new Date("9999-12-31T23:59:59.999Z");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: "Statement dates must be valid dates." });
    }
    if (from > to) {
      return res.status(400).json({ error: "Statement start date cannot be after the end date." });
    }
    const [bills, payments, otherServicePayments, priorBills, priorPayments, latestBill, settings,
      disconnectionPostings, priorDisconnectionPostings, meterReplacements, accountAdjustments,
      priorAccountAdjustments] = await Promise.all([
      prisma.bill.findMany({
        where: { accountId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, issueDate: { gte: from, lte: to } },
        include: { billingCycle: true, tariff: true, reading: true },
        orderBy: { issueDate: "asc" },
      }),
      prisma.payment.findMany({
        where: {
          accountId, paymentStatus: "POSTED",
          paymentType: { notIn: ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"] },
          paymentDate: { gte: from, lte: to },
        },
        include: { channel: true },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.payment.findMany({
        where: {
          accountId,
          paymentType: { in: ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"] },
          paymentDate: { gte: from, lte: to },
        },
        include: { receipt: true },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.bill.aggregate({ where: { accountId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, issueDate: { lt: from } }, _sum: { totalCurrentCharges: true } }),
      prisma.payment.aggregate({
        where: {
          accountId, paymentStatus: "POSTED",
          paymentType: { notIn: ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"] },
          paymentDate: { lt: from },
        },
        _sum: { amount: true },
      }),
      prisma.bill.findFirst({
        where: { accountId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } },
        include: { tariff: true },
        orderBy: { issueDate: "desc" },
      }),
      prisma.systemSetting.findFirst(),
      prisma.$queryRaw<any[]>`
        SELECT dp.*,wo.work_order_number,m.meter_number
        FROM aquaflow.disconnection_postings dp
        JOIN aquaflow.work_orders wo ON wo.work_order_id=dp.work_order_id
        JOIN aquaflow.meters m ON m.meter_id=dp.meter_id
        WHERE dp.account_id=${accountId} AND dp.posted_at>=${from} AND dp.posted_at<=${to}
        ORDER BY dp.posted_at`,
      prisma.$queryRaw<any[]>`
        SELECT COALESCE(SUM(disconnection_fee + fine_amount),0) AS total
        FROM aquaflow.disconnection_postings
        WHERE account_id=${accountId} AND posted_at<${from}`,
      prisma.$queryRaw<any[]>`
        SELECT mr.replacement_id,mr.replacement_date,mr.old_final_reading,
          mr.new_opening_reading,mr.replacement_reason,
          old_meter.meter_number AS old_meter_number,
          new_meter.meter_number AS new_meter_number,
          final_reading.previous_reading,
          final_reading.consumption AS final_consumption,
          wo.work_order_number
        FROM aquaflow.meter_replacements mr
        JOIN aquaflow.meters old_meter ON old_meter.meter_id=mr.old_meter_id
        JOIN aquaflow.meters new_meter ON new_meter.meter_id=mr.new_meter_id
        LEFT JOIN aquaflow.meter_readings final_reading
          ON final_reading.sync_id='METER_REPLACEMENT:' || mr.replacement_id::text
        LEFT JOIN aquaflow.work_orders wo ON wo.work_order_id=mr.work_order_id
        WHERE mr.account_id=${accountId} AND mr.request_status='APPROVED'
          AND mr.replacement_date>=${from} AND mr.replacement_date<=${to}
        ORDER BY mr.replacement_date,mr.replacement_id`,
      prisma.accountAdjustment.findMany({
        where: { accountId, status: "APPROVED", approvedAt: { gte: from, lte: to } },
        orderBy: { approvedAt: "asc" },
      }),
      prisma.accountAdjustment.findMany({
        where: { accountId, status: "APPROVED", approvedAt: { lt: from } },
        select: { adjustmentType: true, amount: true },
      }),
    ]);
    const entries = [
      ...bills.map((bill: any) => ({
        id: `B${bill.billId}`,
        date: bill.issueDate,
        particulars: "Water bill",
        reference: bill.billNumber,
        period: bill.billingCycle.cycleCode || bill.billingCycle.cycleName,
        details: bill.reading
          ? `Prev: ${Number(bill.reading.previousReading)} - Curr: ${Number(bill.reading.currentReading)} - Units billed: ${Number(bill.consumptionUnits)}${Number(bill.consumptionUnits) !== Number(bill.reading.consumption) ? " (includes meter replacement final consumption)" : ""} (${String(bill.reading.readingType).replace(/_/g, " ")}) - Due: ${bill.dueDate.toISOString().slice(0, 10)}`
          : `Units: ${Number(bill.consumptionUnits)} - Due: ${bill.dueDate.toISOString().slice(0, 10)}`,
        description: `Water bill ${bill.billNumber}`,
        debit: Number(bill.totalCurrentCharges),
        credit: 0,
      })),
      ...payments.map((payment: any) => ({
        id: `P${payment.paymentId}`,
        date: payment.paymentDate,
        particulars: "Payment",
        reference: payment.transactionReference,
        period: payment.paymentDate.toISOString().slice(0, 7),
        details: [payment.channel.channelName, payment.remarks].filter(Boolean).join(" - "),
        description: `Payment ${payment.transactionReference}`,
        debit: 0,
        credit: Number(payment.amount),
      })),
      ...otherServicePayments
        .filter((payment: any) => payment.paymentStatus === "POSTED")
        .flatMap((payment: any) => {
          const isReconnection = payment.paymentType === "RECONNECTION_FEE";
          const service = isReconnection ? "Reconnection fee" : "New connection fee";
          const receipt = payment.receipt?.receiptNumber ?? payment.transactionReference;
          const amount = Number(payment.amount);
          const common = {
            date: payment.paymentDate,
            period: payment.paymentDate.toISOString().slice(0, 7),
          };
          return [{
            ...common,
            id: `S${payment.paymentId}-CHARGE`,
            particulars: service,
            reference: payment.customerReference || payment.transactionReference,
            details: `${service} settled under receipt ${receipt}`,
            description: `${service} charge`,
            debit: amount,
            credit: 0,
          }, {
            ...common,
            id: `S${payment.paymentId}-PAYMENT`,
            particulars: `${service} payment`,
            reference: receipt,
            details: `Transaction ${payment.transactionReference}`,
            description: `${service} payment ${receipt}`,
            debit: 0,
            credit: amount,
          }];
        }),
      ...disconnectionPostings.flatMap((posting: any) => {
        const readingDetails = `Meter ${posting.meter_number} - Prev: ${Number(posting.previous_reading)} - Curr: ${Number(posting.current_reading)} - Units: ${Number(posting.current_reading) - Number(posting.previous_reading)}`;
        const rows = [{
          id: `D${posting.disconnection_posting_id}`,
          date: posting.posted_at,
          particulars: "Disconnection reading charge",
          reference: posting.work_order_number,
          period: new Date(posting.posted_at).toISOString().slice(0, 7),
          details: `${readingDetails}${posting.fee_overridden ? ` - Amount override: ${posting.fee_override_reason}` : ""}`,
          description: `Final disconnection reading charge ${posting.work_order_number}`,
          debit: Number(posting.disconnection_fee),
          credit: 0,
        }];
        if (Number(posting.fine_amount) > 0) rows.push({
          id: `F${posting.disconnection_posting_id}`,
          date: posting.posted_at,
          particulars: "Disconnection fine",
          reference: posting.work_order_number,
          period: new Date(posting.posted_at).toISOString().slice(0, 7),
          details: posting.fine_reason || "Fine applied during disconnection",
          description: `Disconnection fine ${posting.work_order_number}`,
          debit: Number(posting.fine_amount),
          credit: 0,
        });
        return rows;
      }),
      ...meterReplacements.map((replacement: any) => ({
        id: `MR${replacement.replacement_id}`,
        date: replacement.replacement_date,
        particulars: "Meter replacement",
        reference: replacement.work_order_number ?? `REP-${replacement.replacement_id}`,
        period: new Date(replacement.replacement_date).toISOString().slice(0, 7),
        details: `Old meter ${replacement.old_meter_number} - Prev: ${Number(replacement.previous_reading)} - Final: ${Number(replacement.old_final_reading)} → New meter ${replacement.new_meter_number} - Opening: ${Number(replacement.new_opening_reading)} - ${Number(replacement.final_consumption ?? 0)} units carried to the next bill`,
        description: `Meter replacement REP-${replacement.replacement_id}`,
        debit: 0,
        credit: 0,
      })),
      ...accountAdjustments.map((adjustment: any) => ({
        id: `A${adjustment.accountAdjustmentId}`,
        date: adjustment.approvedAt,
        particulars: adjustment.adjustmentType === "DEBIT" ? "Account debit adjustment" : "Account credit adjustment",
        reference: adjustment.adjustmentNumber,
        period: adjustment.approvedAt.toISOString().slice(0, 7),
        details: adjustment.reason,
        description: `${adjustment.adjustmentType === "DEBIT" ? "Debit" : "Credit"} adjustment ${adjustment.adjustmentNumber}`,
        debit: adjustment.adjustmentType === "DEBIT" ? Number(adjustment.amount) : 0,
        credit: adjustment.adjustmentType === "CREDIT" ? Number(adjustment.amount) : 0,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const priorAccountAdjustmentTotal = priorAccountAdjustments.reduce(
      (total, adjustment) => total + (adjustment.adjustmentType === "DEBIT" ? Number(adjustment.amount) : -Number(adjustment.amount)),
      0,
    );
    const openingBalance = round(Number(account.openingBalance) + Number(priorBills._sum.totalCurrentCharges ?? 0)
      + Number(priorDisconnectionPostings[0]?.total ?? 0) + priorAccountAdjustmentTotal
      - Number(priorPayments._sum.amount ?? 0));
    let balance = openingBalance;
    const statement = entries.map((entry) => { balance = round(balance + entry.debit - entry.credit); return { ...entry, balance }; });
    const totalDebits = round(entries.reduce((sum, entry) => sum + entry.debit, 0));
    const totalCredits = round(entries.reduce((sum, entry) => sum + entry.credit, 0));
    const servicePayments = otherServicePayments.map((payment: any) => ({
      type: payment.paymentType,
      label: payment.paymentType === "RECONNECTION_FEE" ? "Reconnection fee" : "New Connection payment",
      reference: payment.customerReference || payment.transactionReference,
      receiptNumber: payment.receipt?.receiptNumber ?? null,
      transactionReference: payment.transactionReference,
      date: payment.paymentDate,
      amount: Number(payment.amount),
      paymentStatus: payment.paymentStatus,
    }));
    res.json({
      utility: {
        name: settings?.utilityName ?? "Samdamte Water Utility Management",
        code: settings?.utilityCode ?? "SAMDAMTE",
        email: settings?.emailAddress ?? null,
        phone: settings?.phoneNumber ?? null,
        secondaryPhone: settings?.secondaryPhoneNumber ?? null,
        postalAddress: settings?.postalAddress ?? null,
        postalCode: settings?.postalCode ?? null,
        physicalAddress: settings?.physicalAddress ?? null,
        currencyCode: settings?.currencyCode ?? "KES",
      },
      account: {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        customerName: customerName(account.customer),
        phone: account.customer.phoneNumber,
        email: account.customer.emailAddress,
        status: account.accountStatus,
        category: account.category.categoryName,
        region: account.property?.serviceArea?.areaName ?? account.property?.zone?.zoneName ?? account.route?.zone.zoneName ?? null,
        zone: account.property?.zone?.zoneName ?? account.route?.zone.zoneName ?? null,
        route: account.route?.routeName ?? account.property?.route?.routeName ?? null,
        meterNumber: account.meterAssignments[0]?.meter.meterNumber ?? null,
        tariff: latestBill?.tariff.tariffName ?? account.category.categoryName,
        address: account.property?.physicalAddress ?? null,
      },
      period: { from: fromText || null, to: toText || null },
      openingBalance,
      totalDebits,
      totalCredits,
      netMovement: round(totalDebits - totalCredits),
      closingBalance: balance,
      currentBalance: Number(account.currentBalance),
      entries: statement,
      otherServicePayments: servicePayments,
      otherServicePaymentsSubtotal: round(servicePayments.reduce((sum: number, payment: any) => sum + payment.amount, 0)),
    });
  } catch (error) { next(error); }
});

const accountAdjustmentSelect = {
  accountAdjustmentId: true,
  adjustmentNumber: true,
  accountId: true,
  adjustmentType: true,
  amount: true,
  reason: true,
  status: true,
  requestedBy: true,
  approvedBy: true,
  adjustmentDate: true,
  supportingFileName: true,
  decisionComments: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  account: { include: { customer: true, category: true } },
  requester: true,
  approver: true,
} satisfies Prisma.AccountAdjustmentSelect;

billingRouter.get("/account-adjustments", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "").trim().toUpperCase();
    const search = String(req.query.search ?? "").trim();
    const accountId = req.query.accountId ? BigInt(String(req.query.accountId)) : undefined;
    const adjustments = await prisma.accountAdjustment.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(accountId ? { accountId } : {}),
        ...(search ? {
          OR: [
            { adjustmentNumber: { contains: search, mode: "insensitive" as const } },
            { account: { accountNumber: { contains: search, mode: "insensitive" as const } } },
            { account: { customer: { firstName: { contains: search, mode: "insensitive" as const } } } },
            { account: { customer: { lastName: { contains: search, mode: "insensitive" as const } } } },
            { account: { customer: { organizationName: { contains: search, mode: "insensitive" as const } } } },
          ],
        } : {}),
      },
      select: accountAdjustmentSelect,
      orderBy: { createdAt: "desc" },
      take: 2_000,
    });
    res.json(adjustments);
  } catch (error) { next(error); }
});

billingRouter.post(
  "/account-adjustments",
  requireRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR", "FINANCE_MANAGER"),
  async (req, res, next) => {
    const data = parse(z.object({
      accountId: id,
      adjustmentType: z.enum(["DEBIT", "CREDIT"]),
      amount: money,
      reason: z.string().trim().min(5).max(2000),
      supportingFileName: z.string().trim().max(255).optional(),
      supportingContent: z.string().max(6_000_000).optional(),
    }), req.body, res);
    if (!data) return;
    try {
      const account = await prisma.customerAccount.findUnique({ where: { accountId: data.accountId } });
      if (!account) return res.status(404).json({ error: "Customer account not found" });
      if (account.accountStatus === "CLOSED") {
        return res.status(409).json({ error: "A closed customer account cannot be adjusted" });
      }
      const adjustmentNumber = `AADJ-${Date.now()}-${String(data.accountId).slice(-5)}`;
      const adjustment = await prisma.accountAdjustment.create({
        data: { ...data, adjustmentNumber, requestedBy: uid(req)!, status: "PENDING" },
        select: accountAdjustmentSelect,
      });
      res.status(201).json(adjustment);
    } catch (error) { next(error); }
  },
);

billingRouter.patch(
  "/account-adjustments/decision",
  requireRole("BILLING_SUPERVISOR", "FINANCE_MANAGER", "SYSTEM_ADMIN"),
  async (req, res, next) => {
    const data = parse(z.object({
      adjustmentIds: z.array(id).min(1).max(500),
      decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
      comments: z.string().trim().min(3).max(2000),
    }), req.body, res);
    if (!data) return;
    const actorId = uid(req)!;
    try {
      const selected = await prisma.accountAdjustment.findMany({
        where: { accountAdjustmentId: { in: data.adjustmentIds } },
        select: { accountAdjustmentId: true, requestedBy: true, status: true },
      });
      if (selected.length !== data.adjustmentIds.length) {
        return res.status(404).json({ error: "One or more account adjustment requests were not found" });
      }
      if (selected.some((adjustment) => adjustment.status !== "PENDING")) {
        return res.status(409).json({ error: "Only pending account adjustment requests can be decided" });
      }
      if (!isSystemAdmin(req) && selected.some((adjustment) => adjustment.requestedBy === actorId)) {
        return res.status(403).json({
          error: "Maker-checker control: a requester cannot decide their own account adjustment. No selected requests were changed.",
        });
      }

      const nextStatus = data.decision === "APPROVE" ? "APPROVED" : data.decision === "RETURN" ? "RETURNED" : "REJECTED";
      await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{
          account_adjustment_id: bigint;
          account_id: bigint;
          adjustment_type: string;
          amount: Prisma.Decimal;
          status: string;
        }>>(Prisma.sql`
          SELECT account_adjustment_id, account_id, adjustment_type, amount, status
          FROM aquaflow.account_adjustments
          WHERE account_adjustment_id IN (${Prisma.join(data.adjustmentIds)})
          FOR UPDATE
        `);
        if (locked.length !== data.adjustmentIds.length || locked.some((adjustment) => adjustment.status !== "PENDING")) {
          const conflict = new Error("One or more account adjustments changed while you were reviewing them. Refresh and try again.");
          (conflict as any).statusCode = 409;
          throw conflict;
        }
        const decidedAt = new Date();
        for (const adjustment of locked) {
          if (data.decision === "APPROVE") {
            const signedAmount = adjustment.adjustment_type === "DEBIT"
              ? Number(adjustment.amount)
              : -Number(adjustment.amount);
            await tx.customerAccount.update({
              where: { accountId: adjustment.account_id },
              data: { currentBalance: { increment: signedAmount }, updatedAt: decidedAt },
            });
          }
          await tx.accountAdjustment.update({
            where: { accountAdjustmentId: adjustment.account_adjustment_id },
            data: {
              status: nextStatus,
              approvedBy: actorId,
              approvedAt: decidedAt,
              decisionComments: data.comments,
              updatedAt: decidedAt,
            },
          });
        }
      }, { maxWait: 10_000, timeout: 30_000 });
      res.json({ updated: data.adjustmentIds.length, status: nextStatus });
    } catch (error: any) {
      if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
      next(error);
    }
  },
);

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
    if (selfApprovals.length && !isSystemAdmin(req)) {
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
    if (adjustment.requestedBy === uid(req) && !isSystemAdmin(req)) {
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
    const candidatesPromise = cycle
      ? cycleCandidates(cycle.billingCycleId, { includePreviousBalance: true }).catch((error: any) => {
          if (error.status === 409) return null;
          throw error;
        })
      : Promise.resolve(null);
    const [bills, alerts, adjustments, recent, candidates] = await Promise.all([
      prisma.bill.findMany({
        where,
        select: {
          status: true,
          previousBalance: true,
          totalCurrentCharges: true,
          penalties: true,
          paidAmount: true,
          notificationStatus: true,
          readingId: true,
        },
      }),
      prisma.billingSecurityAlert.count({ where: { status: "OPEN", ...(cycle ? { bill: { billingCycleId: cycle.billingCycleId } } : {}) } }),
      prisma.billingAdjustment.count({ where: { status: "PENDING", ...(cycle ? { bill: { billingCycleId: cycle.billingCycleId } } : {}) } }),
      prisma.billingEvent.findMany({ where: cycle ? { billingCycleId: cycle.billingCycleId } : undefined, include: { bill: { include: { account: { include: { customer: true } } } }, performer: true }, orderBy: { createdAt: "desc" }, take: 8 }),
      candidatesPromise,
    ]);
    const approved = bills.filter((bill) => ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"].includes(bill.status)).length;
    const readyToPost = bills.filter((bill) => bill.status === "APPROVED").length;
    const eligibleNotBilled = candidates?.rows.filter((row) => row.eligible).length ?? 0;
    const eligibleNotNotified = bills.filter((bill) =>
      bill.readingId != null &&
      ["APPROVED", "POSTED", "PARTIALLY_PAID", "PAID"].includes(bill.status) &&
      !["QUEUED", "SENT"].includes(bill.notificationStatus),
    ).length;
    const totalAmount = round(bills.reduce((sum, bill) => sum +
      Number(bill.previousBalance) +
      Number(bill.totalCurrentCharges) +
      Number(bill.penalties) -
      Number(bill.paidAmount), 0));
    res.json({ cycle, customersToBill: bills.length + eligibleNotBilled, billsGenerated: bills.length, eligibleNotBilled, eligibleNotNotified, pending: bills.filter((bill) => bill.status === "PENDING_APPROVAL").length, approved, readyToPost, totalBilling: totalAmount, notified: bills.filter((bill) => bill.notificationStatus === "SENT").length, cancelled: bills.filter((bill) => bill.status === "CANCELLED").length, alerts, adjustments, recent: recent.map((row: any) => ({ ...row, customerName: customerName(row.bill?.account?.customer) })) });
  } catch (error) { next(error); }
});
