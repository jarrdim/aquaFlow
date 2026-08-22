import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isSystemAdmin, requireAuth, requireRole } from "../middleware/auth";

export const tariffsRouter = Router();
tariffsRouter.use(requireAuth);

const id = z.coerce.bigint().positive();
const money = z.coerce.number().min(0).max(999_999_999);
const tariffInput = z
  .object({
    tariffCode: z.string().trim().min(2).max(40),
    tariffName: z.string().trim().min(3).max(150),
    categoryId: id,
    billingMethod: z.enum(["CONSUMPTION", "FLAT", "TIERED", "BULK"]),
    minimumCharge: money.default(0),
    standingCharge: money.default(0),
    meterRent: money.default(0),
    flatAmount: money.default(0),
    ratePerUnit: money.default(0),
    penaltyRule: z.string().trim().max(1000).optional(),
    effectiveFrom: z.string().min(1),
    effectiveTo: z.string().optional(),
    remarks: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom)
      ctx.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Effective-to date cannot be before effective-from date",
      });
    if (value.billingMethod === "FLAT" && value.flatAmount <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["flatAmount"],
        message: "Flat amount must be greater than zero",
      });
    if (
      ["CONSUMPTION", "BULK"].includes(value.billingMethod) &&
      value.ratePerUnit <= 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["ratePerUnit"],
        message: "Rate per unit must be greater than zero",
      });
  });
const bandInput = z.object({
  lowerLimit: z.coerce.number().min(0),
  upperLimit: z.coerce.number().min(0).nullable().optional(),
  ratePerUnit: z.coerce.number().positive(),
});

function uid(req: any) {
  return req.user?.userId ? BigInt(req.user.userId) : undefined;
}
function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}
function previousDay(value: Date) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - 1);
  return result;
}
function parse<T>(
  schema: z.ZodType<T>,
  input: unknown,
  res: any,
): T | undefined {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return undefined;
  }
  return parsed.data;
}
function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

const includeTariff = {
  category: true,
  creator: true,
  approver: true,
  bands: { orderBy: { bandSequence: "asc" as const } },
  simulations: {
    orderBy: { createdAt: "desc" as const },
    take: 10,
    include: { simulator: true },
  },
  events: {
    orderBy: { createdAt: "desc" as const },
    include: { performer: true },
  },
  assignments: { orderBy: { createdAt: "desc" as const } },
};

type PriceTariff = {
  billingMethod: string;
  minimumCharge: any;
  standingCharge: any;
  meterRent: any;
  flatAmount: any;
  ratePerUnit: any;
  bands: { lowerLimit: any; upperLimit: any; ratePerUnit: any }[];
};
function calculate(
  tariff: PriceTariff,
  consumption: number,
  includeStanding = true,
  includeMinimum = true,
) {
  let variableCharge = 0;
  const breakdown: {
    description: string;
    units: number;
    rate: number;
    amount: number;
  }[] = [];
  if (tariff.billingMethod === "FLAT") {
    variableCharge = Number(tariff.flatAmount);
    breakdown.push({
      description: "Flat charge",
      units: 1,
      rate: variableCharge,
      amount: variableCharge,
    });
  } else if (tariff.billingMethod === "TIERED") {
    const bands = [...tariff.bands].sort(
      (a, b) => Number(a.lowerLimit) - Number(b.lowerLimit),
    );
    for (const [index, band] of bands.entries()) {
      const lower = Number(band.lowerLimit);
      const upper =
        band.upperLimit == null ? consumption : Number(band.upperLimit);
      const units = Math.max(0, Math.min(consumption, upper) - lower);
      if (!units) continue;
      const rate = Number(band.ratePerUnit);
      const amount = units * rate;
      variableCharge += amount;
      breakdown.push({
        description: `Band ${index + 1}: ${lower}–${band.upperLimit ?? "above"}`,
        units: round(units, 3),
        rate,
        amount: round(amount),
      });
    }
  } else {
    const rate = Number(tariff.ratePerUnit);
    variableCharge = consumption * rate;
    breakdown.push({
      description: "Consumption charge",
      units: consumption,
      rate,
      amount: round(variableCharge),
    });
  }
  const minimumApplied = includeMinimum
    ? Math.max(variableCharge, Number(tariff.minimumCharge))
    : variableCharge;
  const standing = includeStanding ? Number(tariff.standingCharge) : 0;
  const meterRent = includeStanding ? Number(tariff.meterRent) : 0;
  return {
    consumption,
    variableCharge: round(variableCharge),
    minimumAdjustment: round(minimumApplied - variableCharge),
    standingCharge: standing,
    meterRent,
    total: round(minimumApplied + standing + meterRent),
    breakdown,
  };
}

async function activateTariff(
  tariffId: bigint,
  performedBy?: bigint,
  details = "Tariff activated",
) {
  return prisma.$transaction(
    async (tx) => {
      const tariff = await tx.tariff.findUnique({
        where: { tariffId },
        include: { bands: true },
      });
      if (!tariff)
        throw Object.assign(new Error("Tariff not found"), { status: 404 });
      if (tariff.status !== "APPROVED")
        throw Object.assign(
          new Error("Only approved tariffs can be activated"),
          { status: 409 },
        );
      if (!tariff.simulationCompleted)
        throw Object.assign(
          new Error("A successful simulation is required before activation"),
          { status: 409 },
        );
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${tariff.categoryId})::text AS lock`;
      const active = await tx.tariff.findFirst({
        where: {
          categoryId: tariff.categoryId,
          status: "ACTIVE",
          tariffId: { not: tariffId },
        },
      });
      const cutoff = previousDay(tariff.effectiveFrom);
      if (active) {
        await tx.tariff.update({
          where: { tariffId: active.tariffId },
          data: {
            status: "EXPIRED",
            effectiveTo: cutoff,
            updatedAt: new Date(),
          },
        });
        await tx.tariffCategoryAssignment.updateMany({
          where: { tariffId: active.tariffId, status: "ACTIVE" },
          data: { status: "EXPIRED", effectiveTo: cutoff },
        });
        await tx.tariffEvent.create({
          data: {
            tariffId: active.tariffId,
            eventType: "EXPIRED",
            previousStatus: "ACTIVE",
            newStatus: "EXPIRED",
            details: `Superseded by ${tariff.tariffName}`,
            performedBy,
          },
        });
      }
      const updated = await tx.tariff.update({
        where: { tariffId },
        data: {
          status: "ACTIVE",
          activationMode: tariff.activationMode ?? "MANUAL",
          activatedAt: new Date(),
          updatedAt: new Date(),
        },
        include: includeTariff,
      });
      await tx.tariffCategoryAssignment.create({
        data: {
          categoryId: tariff.categoryId,
          tariffId,
          effectiveFrom: tariff.effectiveFrom,
          effectiveTo: tariff.effectiveTo,
          reason: details,
          assignedBy: performedBy,
        },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId,
          eventType: "ACTIVATED",
          previousStatus: "APPROVED",
          newStatus: "ACTIVE",
          details,
          performedBy,
        },
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function activateDueTariffs() {
  const now = new Date();
  const due = await prisma.tariff.findMany({
    where: {
      status: "APPROVED",
      activationMode: "AUTO_ON_DATE",
      scheduledActivation: { lte: now },
      effectiveFrom: { lte: now },
    },
    select: { tariffId: true },
  });
  for (const item of due) {
    try {
      await activateTariff(
        item.tariffId,
        undefined,
        "Automatically activated on effective date",
      );
    } catch (error) {
      console.error("Scheduled tariff activation failed", item.tariffId, error);
    }
  }
}

tariffsRouter.get("/dashboard", async (req, res, next) => {
  try {
    await activateDueTariffs();
    const year = req.query.year ? Number(req.query.year) : undefined;
    const categoryId = req.query.categoryId
      ? BigInt(String(req.query.categoryId))
      : undefined;
    const dateWhere = year
      ? {
          effectiveFrom: { lte: new Date(`${year}-12-31T00:00:00Z`) },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
          ],
        }
      : {};
    const where: Prisma.TariffWhereInput = {
      ...(categoryId ? { categoryId } : {}),
      ...dateWhere,
    };
    const [
      active,
      pending,
      expired,
      bands,
      simulations,
      categories,
      activeTariffs,
      recentEvents,
    ] = await Promise.all([
      prisma.tariff.count({ where: { ...where, status: "ACTIVE" } }),
      prisma.tariff.count({ where: { ...where, status: "PENDING_APPROVAL" } }),
      prisma.tariff.count({ where: { ...where, status: "EXPIRED" } }),
      prisma.tariffBand.count({ where: { tariff: where } }),
      prisma.tariffSimulation.count({ where: { tariff: where } }),
      prisma.customerCategory.count({ where: { status: "ACTIVE" } }),
      prisma.tariff.findMany({
        where: { ...where, status: "ACTIVE" },
        include: { category: true, bands: true },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.tariffEvent.findMany({
        where: { tariff: where },
        include: { tariff: true, performer: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    res.json({
      active,
      pending,
      expired,
      bands,
      simulations,
      categories,
      activeTariffs,
      recentEvents,
    });
  } catch (error) {
    next(error);
  }
});

tariffsRouter.get("/", async (req, res, next) => {
  try {
    await activateDueTariffs();
    const status = String(req.query.status ?? "");
    const method = String(req.query.method ?? "");
    const search = String(req.query.search ?? "");
    const categoryId = req.query.categoryId
      ? BigInt(String(req.query.categoryId))
      : undefined;
    const where: Prisma.TariffWhereInput = {
      ...(status ? { status } : {}),
      ...(method ? { billingMethod: method } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { tariffCode: { contains: search, mode: "insensitive" } },
              { tariffName: { contains: search, mode: "insensitive" } },
              {
                category: {
                  categoryName: { contains: search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    res.json(
      await prisma.tariff.findMany({
        where,
        include: { ...includeTariff, events: false },
        orderBy: [{ effectiveFrom: "desc" }, { tariffName: "asc" }],
      }),
    );
  } catch (error) {
    next(error);
  }
});

tariffsRouter.get("/assignments", async (req, res, next) => {
  try {
    res.json(
      await prisma.tariffCategoryAssignment.findMany({
        include: { category: true, tariff: true, assigner: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

tariffsRouter.get("/approvals", async (_req, res, next) => {
  try {
    res.json(
      await prisma.tariff.findMany({
        where: { status: "PENDING_APPROVAL" },
        include: includeTariff,
        orderBy: { submittedAt: "asc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

tariffsRouter.get("/:id", async (req, res, next) => {
  const tariffId = parse(id, req.params.id, res);
  if (!tariffId) return;
  try {
    const tariff = await prisma.tariff.findUnique({
      where: { tariffId },
      include: includeTariff,
    });
    if (!tariff) return res.status(404).json({ error: "Tariff not found" });
    res.json(tariff);
  } catch (error) {
    next(error);
  }
});

tariffsRouter.post("/", async (req, res, next) => {
  const data = parse(tariffInput, req.body, res);
  if (!data) return;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const tariff = await tx.tariff.create({
        data: {
          ...data,
          effectiveFrom: day(data.effectiveFrom),
          effectiveTo: data.effectiveTo ? day(data.effectiveTo) : null,
          createdBy: uid(req),
          status: "DRAFT",
        },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId: tariff.tariffId,
          eventType: "CREATED",
          newStatus: "DRAFT",
          details: data.remarks ?? "Draft tariff created",
          performedBy: uid(req),
        },
      });
      return tariff;
    });
    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === "P2002")
      return res
        .status(409)
        .json({ error: "Tariff code or name already exists" });
    next(error);
  }
});

tariffsRouter.patch("/:id", async (req, res, next) => {
  const tariffId = parse(id, req.params.id, res);
  const data = parse(tariffInput, req.body, res);
  if (!tariffId || !data) return;
  try {
    const existing = await prisma.tariff.findUnique({ where: { tariffId } });
    if (!existing) return res.status(404).json({ error: "Tariff not found" });
    if (!["DRAFT", "RETURNED", "REJECTED"].includes(existing.status))
      return res
        .status(409)
        .json({
          error: "Only draft, returned or rejected tariffs can be edited",
        });
    const updated = await prisma.$transaction(async (tx) => {
      const tariff = await tx.tariff.update({
        where: { tariffId },
        data: {
          ...data,
          effectiveFrom: day(data.effectiveFrom),
          effectiveTo: data.effectiveTo ? day(data.effectiveTo) : null,
          status: "DRAFT",
          simulationCompleted: false,
          approvedBy: null,
          approvedAt: null,
          approvalComments: null,
          updatedAt: new Date(),
        },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId,
          eventType: "UPDATED",
          previousStatus: existing.status,
          newStatus: "DRAFT",
          details: "Tariff definition updated; simulation reset",
          performedBy: uid(req),
        },
      });
      return tariff;
    });
    res.json(updated);
  } catch (error: any) {
    if (error.code === "P2002")
      return res
        .status(409)
        .json({ error: "Tariff code or name already exists" });
    next(error);
  }
});

tariffsRouter.put("/:id/bands", async (req, res, next) => {
  const tariffId = parse(id, req.params.id, res);
  const data = parse(
    z.object({ bands: z.array(bandInput).min(1).max(50) }),
    req.body,
    res,
  );
  if (!tariffId || !data) return;
  const bands = [...data.bands].sort((a, b) => a.lowerLimit - b.lowerLimit);
  if (bands[0].lowerLimit !== 0)
    return res
      .status(400)
      .json({ error: "The first tariff band must start at 0 units" });
  for (let index = 0; index < bands.length; index++) {
    const band = bands[index];
    const previous = bands[index - 1];
    if (band.upperLimit != null && band.upperLimit <= band.lowerLimit)
      return res
        .status(400)
        .json({
          error: `Band ${index + 1} upper limit must be greater than its lower limit`,
        });
    if (band.upperLimit == null && index !== bands.length - 1)
      return res
        .status(400)
        .json({ error: "Only the final band may have no upper limit" });
    if (
      previous &&
      (previous.upperLimit == null || band.lowerLimit !== previous.upperLimit)
    )
      return res
        .status(400)
        .json({
          error: `Band ${index + 1} must begin at ${previous.upperLimit}; tariff bands cannot overlap or leave gaps`,
        });
  }
  try {
    const tariff = await prisma.tariff.findUnique({ where: { tariffId } });
    if (!tariff) return res.status(404).json({ error: "Tariff not found" });
    if (tariff.billingMethod !== "TIERED")
      return res
        .status(409)
        .json({ error: "Bands can only be configured for tiered tariffs" });
    if (!["DRAFT", "RETURNED", "REJECTED"].includes(tariff.status))
      return res
        .status(409)
        .json({ error: "Bands cannot be changed after submission" });
    await prisma.$transaction(async (tx) => {
      await tx.tariffBand.deleteMany({ where: { tariffId } });
      await tx.tariffBand.createMany({
        data: bands.map((band, index) => ({
          tariffId,
          bandSequence: index + 1,
          lowerLimit: band.lowerLimit,
          upperLimit: band.upperLimit ?? null,
          ratePerUnit: band.ratePerUnit,
        })),
      });
      await tx.tariff.update({
        where: { tariffId },
        data: {
          simulationCompleted: false,
          status: "DRAFT",
          updatedAt: new Date(),
        },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId,
          eventType: "BANDS_UPDATED",
          details: `${bands.length} tariff band(s) configured; simulation reset`,
          performedBy: uid(req),
        },
      });
    });
    res.json(
      await prisma.tariff.findUnique({
        where: { tariffId },
        include: includeTariff,
      }),
    );
  } catch (error) {
    next(error);
  }
});

tariffsRouter.post("/:id/simulate", async (req, res, next) => {
  const tariffId = parse(id, req.params.id, res);
  const data = parse(
    z.object({
      consumption: z.coerce.number().min(0),
      includeStanding: z.boolean().default(true),
      includeMinimum: z.boolean().default(true),
    }),
    req.body,
    res,
  );
  if (!tariffId || !data) return;
  try {
    const proposed = await prisma.tariff.findUnique({
      where: { tariffId },
      include: { bands: true, category: true },
    });
    if (!proposed) return res.status(404).json({ error: "Tariff not found" });
    if (proposed.billingMethod === "TIERED" && !proposed.bands.length)
      return res
        .status(409)
        .json({ error: "Configure tariff bands before simulation" });
    const current = await prisma.tariff.findFirst({
      where: {
        categoryId: proposed.categoryId,
        status: "ACTIVE",
        tariffId: { not: tariffId },
      },
      include: { bands: true },
    });
    const proposedResult = calculate(
      proposed,
      data.consumption,
      data.includeStanding,
      data.includeMinimum,
    );
    const currentResult = current
      ? calculate(
          current,
          data.consumption,
          data.includeStanding,
          data.includeMinimum,
        )
      : { total: 0, breakdown: [] };
    const difference = round(proposedResult.total - currentResult.total);
    const percentage = currentResult.total
      ? round((difference / currentResult.total) * 100, 4)
      : 0;
    const simulation = await prisma.$transaction(async (tx) => {
      const created = await tx.tariffSimulation.create({
        data: {
          tariffId,
          simulationType: "SINGLE",
          sampleConsumption: data.consumption,
          currentAmount: currentResult.total,
          proposedAmount: proposedResult.total,
          differenceAmount: difference,
          percentageChange: percentage,
          resultData: {
            currentTariffId: current?.tariffId.toString() ?? null,
            current: currentResult,
            proposed: proposedResult,
          },
          simulatedBy: uid(req),
        },
      });
      await tx.tariff.update({
        where: { tariffId },
        data: { simulationCompleted: true, updatedAt: new Date() },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId,
          eventType: "SIMULATED",
          details: `Simulation completed at ${data.consumption} units`,
          performedBy: uid(req),
          metadata: {
            simulationId: created.simulationId.toString(),
            difference,
            percentage,
          },
        },
      });
      return created;
    });
    res.json({
      simulation,
      currentTariff: current,
      current: currentResult,
      proposed: proposedResult,
      difference,
      percentageChange: percentage,
    });
  } catch (error) {
    next(error);
  }
});

tariffsRouter.post("/:id/simulate/bulk", async (req, res, next) => {
  const tariffId = parse(id, req.params.id, res);
  const data = parse(
    z.object({ fallbackConsumption: z.coerce.number().min(0).default(15) }),
    req.body,
    res,
  );
  if (!tariffId || !data) return;
  try {
    const fallbackConsumption = data.fallbackConsumption ?? 15;
    const proposed = await prisma.tariff.findUnique({
      where: { tariffId },
      include: { bands: true, category: true },
    });
    if (!proposed) return res.status(404).json({ error: "Tariff not found" });
    if (proposed.billingMethod === "TIERED" && !proposed.bands.length)
      return res
        .status(409)
        .json({ error: "Configure tariff bands before simulation" });
    const current = await prisma.tariff.findFirst({
      where: {
        categoryId: proposed.categoryId,
        status: "ACTIVE",
        tariffId: { not: tariffId },
      },
      include: { bands: true },
    });
    const accounts = await prisma.customerAccount.findMany({
      where: { categoryId: proposed.categoryId, accountStatus: "ACTIVE" },
      include: {
        meterReadings: {
          where: { approvalStatus: "APPROVED" },
          orderBy: { readingDate: "desc" },
          take: 1,
        },
      },
    });
    const consumptions = accounts.length
      ? accounts.map((a) =>
          Number(a.meterReadings[0]?.consumption ?? fallbackConsumption),
        )
      : [fallbackConsumption];
    let currentTotal = 0;
    let proposedTotal = 0;
    const groups = {
      low: { customers: 0, difference: 0 },
      medium: { customers: 0, difference: 0 },
      high: { customers: 0, difference: 0 },
    };
    for (const consumption of consumptions) {
      const oldAmount = current ? calculate(current, consumption).total : 0;
      const newAmount = calculate(proposed, consumption).total;
      currentTotal += oldAmount;
      proposedTotal += newAmount;
      const group =
        consumption <= 10
          ? groups.low
          : consumption <= 30
            ? groups.medium
            : groups.high;
      group.customers++;
      group.difference += newAmount - oldAmount;
    }
    currentTotal = round(currentTotal);
    proposedTotal = round(proposedTotal);
    const difference = round(proposedTotal - currentTotal);
    const percentage = currentTotal
      ? round((difference / currentTotal) * 100, 4)
      : 0;
    const simulation = await prisma.$transaction(async (tx) => {
      const created = await tx.tariffSimulation.create({
        data: {
          tariffId,
          simulationType: "BULK",
          sampleConsumption: fallbackConsumption,
          currentAmount: currentTotal,
          proposedAmount: proposedTotal,
          differenceAmount: difference,
          percentageChange: percentage,
          customerCount: accounts.length,
          resultData: {
            groups,
            fallbackUsed: accounts.filter((a) => !a.meterReadings.length)
              .length,
          },
          simulatedBy: uid(req),
        },
      });
      await tx.tariff.update({
        where: { tariffId },
        data: { simulationCompleted: true, updatedAt: new Date() },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId,
          eventType: "BULK_SIMULATED",
          details: `${accounts.length} customer account(s) simulated`,
          performedBy: uid(req),
          metadata: {
            simulationId: created.simulationId.toString(),
            difference,
            percentage,
          },
        },
      });
      return created;
    });
    res.json({
      simulation,
      currentTariff: current,
      customerCount: accounts.length,
      currentTotal,
      proposedTotal,
      difference,
      percentageChange: percentage,
      groups,
    });
  } catch (error) {
    next(error);
  }
});

tariffsRouter.post("/:id/submit", async (req, res, next) => {
  const tariffId = parse(id, req.params.id, res);
  if (!tariffId) return;
  try {
    const tariff = await prisma.tariff.findUnique({
      where: { tariffId },
      include: { bands: true },
    });
    if (!tariff) return res.status(404).json({ error: "Tariff not found" });
    if (!["DRAFT", "RETURNED", "REJECTED"].includes(tariff.status))
      return res
        .status(409)
        .json({ error: "Tariff is not editable or ready for submission" });
    if (!tariff.simulationCompleted)
      return res
        .status(409)
        .json({ error: "Run a tariff simulation before submission" });
    if (tariff.billingMethod === "TIERED" && !tariff.bands.length)
      return res.status(409).json({ error: "Tiered tariffs require bands" });
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tariff.update({
        where: { tariffId },
        data: {
          status: "PENDING_APPROVAL",
          submittedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await tx.tariffEvent.create({
        data: {
          tariffId,
          eventType: "SUBMITTED",
          previousStatus: tariff.status,
          newStatus: "PENDING_APPROVAL",
          details: "Submitted for maker-checker approval",
          performedBy: uid(req),
        },
      });
      return value;
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

tariffsRouter.patch(
  "/:id/decision",
  requireRole(
    "SYSTEM_ADMIN",
    "BILLING_SUPERVISOR",
    "FINANCE_MANAGER",
    "SUPERVISOR",
  ),
  async (req, res, next) => {
    const tariffId = parse(id, req.params.id, res);
    const data = parse(
      z.object({
        decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
        comments: z.string().trim().min(3).max(2000),
      }),
      req.body,
      res,
    );
    if (!tariffId || !data) return;
    try {
      const tariff = await prisma.tariff.findUnique({ where: { tariffId } });
      if (!tariff) return res.status(404).json({ error: "Tariff not found" });
      if (tariff.status !== "PENDING_APPROVAL")
        return res
          .status(409)
          .json({ error: "Tariff is not pending approval" });
      if (tariff.createdBy && tariff.createdBy === uid(req) && !isSystemAdmin(req))
        return res
          .status(409)
          .json({
            error:
              "Maker-checker control: the tariff creator cannot approve their own tariff",
          });
      const nextStatus =
        data.decision === "APPROVE"
          ? "APPROVED"
          : data.decision === "RETURN"
            ? "RETURNED"
            : "REJECTED";
      const updated = await prisma.$transaction(async (tx) => {
        const value = await tx.tariff.update({
          where: { tariffId },
          data: {
            status: nextStatus,
            approvedBy: uid(req),
            approvedAt: new Date(),
            approvalComments: data.comments,
            updatedAt: new Date(),
          },
        });
        await tx.tariffEvent.create({
          data: {
            tariffId,
            eventType:
              data.decision === "APPROVE"
                ? "APPROVED"
                : data.decision === "RETURN"
                  ? "RETURNED"
                  : "REJECTED",
            previousStatus: "PENDING_APPROVAL",
            newStatus: nextStatus,
            details: data.comments,
            performedBy: uid(req),
          },
        });
        return value;
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

tariffsRouter.post(
  "/:id/activate",
  requireRole(
    "SYSTEM_ADMIN",
    "BILLING_SUPERVISOR",
    "FINANCE_MANAGER",
    "SUPERVISOR",
  ),
  async (req, res, next) => {
    const tariffId = parse(id, req.params.id, res);
    const data = parse(
      z.object({
        mode: z.enum(["NOW", "AUTO_ON_DATE"]),
        reason: z.string().trim().min(3).max(1000),
      }),
      req.body,
      res,
    );
    if (!tariffId || !data) return;
    try {
      const tariff = await prisma.tariff.findUnique({ where: { tariffId } });
      if (!tariff) return res.status(404).json({ error: "Tariff not found" });
      if (tariff.status !== "APPROVED")
        return res
          .status(409)
          .json({ error: "Only approved tariffs can be activated" });
      if (data.mode === "NOW") {
        if (tariff.effectiveFrom > new Date())
          return res
            .status(409)
            .json({
              error:
                "Effective date is in the future; schedule activation instead",
            });
        return res.json(await activateTariff(tariffId, uid(req), data.reason));
      }
      const scheduled = new Date(
        `${isoDay(tariff.effectiveFrom)}T00:00:00.000Z`,
      );
      const updated = await prisma.$transaction(async (tx) => {
        const value = await tx.tariff.update({
          where: { tariffId },
          data: {
            activationMode: "AUTO_ON_DATE",
            scheduledActivation: scheduled,
            updatedAt: new Date(),
          },
        });
        await tx.tariffEvent.create({
          data: {
            tariffId,
            eventType: "ACTIVATION_SCHEDULED",
            previousStatus: "APPROVED",
            newStatus: "APPROVED",
            details: data.reason,
            performedBy: uid(req),
            metadata: { scheduledActivation: scheduled.toISOString() },
          },
        });
        return value;
      });
      res.json(updated);
    } catch (error: any) {
      if (error.status)
        return res.status(error.status).json({ error: error.message });
      next(error);
    }
  },
);
