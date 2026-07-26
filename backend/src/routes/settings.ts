import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole("SYSTEM_ADMIN"));

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable();

const settingsInput = z.object({
  utilityName: z.string().trim().min(2).max(160),
  utilityCode: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  emailAddress: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
  phoneNumber: nullableText(40),
  secondaryPhoneNumber: nullableText(40),
  postalAddress: nullableText(250),
  postalCode: nullableText(30),
  physicalAddress: nullableText(250),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  timezone: z.string().trim().min(2).max(100),
  locale: z.string().trim().min(2).max(20),
  dateFormat: z.string().trim().min(2).max(30),
  billingDueDays: z.coerce.number().int().min(0).max(365),
  defaultBillingRate: z.coerce.number().min(0).optional().nullable(),
  subprojectDiscountRate: z.coerce.number().min(0).max(100).optional().nullable(),
  reconnectionFee: z.coerce.number().min(0).optional().nullable(),
  readingVariancePercent: z.coerce.number().min(0).max(999.99),
  minimumReadingValue: z.coerce.number().min(0),
  billingMessageLine1: nullableText(500),
  billingMessageLine2: nullableText(500),
  billingMessageLine3: nullableText(500),
  demandMessageLine1: nullableText(500),
  demandMessageLine2: nullableText(500),
  demandMessageLine3: nullableText(500),
  demandMessageLine4: nullableText(500),
  demandMessageLine5: nullableText(500),
  receiptMessage: nullableText(500),
  sessionTimeoutMinutes: z.coerce.number().int().min(5).max(1440),
  passwordMinimumLength: z.coerce.number().int().min(8).max(128),
  requireTwoFactor: z.boolean(),
  maintenanceMode: z.boolean(),
});

const defaultSettings = {
  utilityName: "AquaFlow",
  utilityCode: "AQUAFLOW",
  currencyCode: "KES",
  timezone: "Africa/Nairobi",
  locale: "en-KE",
  dateFormat: "DD/MM/YYYY",
  billingDueDays: 14,
  readingVariancePercent: 30,
  minimumReadingValue: 0,
  sessionTimeoutMinutes: 30,
  passwordMinimumLength: 8,
  requireTwoFactor: false,
  maintenanceMode: false,
};

settingsRouter.get("/", async (_req, res) => {
  const settings = await prisma.systemSetting.upsert({
    where: { settingId: 1n },
    create: { settingId: 1n, ...defaultSettings },
    update: {},
  });
  res.json(settings);
});

settingsRouter.put("/", async (req, res) => {
  const parsed = settingsInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const clean = {
    ...parsed.data,
    emailAddress: parsed.data.emailAddress || null,
    phoneNumber: parsed.data.phoneNumber || null,
    secondaryPhoneNumber: parsed.data.secondaryPhoneNumber || null,
    postalAddress: parsed.data.postalAddress || null,
    postalCode: parsed.data.postalCode || null,
    physicalAddress: parsed.data.physicalAddress || null,
    billingMessageLine1: parsed.data.billingMessageLine1 || null,
    billingMessageLine2: parsed.data.billingMessageLine2 || null,
    billingMessageLine3: parsed.data.billingMessageLine3 || null,
    demandMessageLine1: parsed.data.demandMessageLine1 || null,
    demandMessageLine2: parsed.data.demandMessageLine2 || null,
    demandMessageLine3: parsed.data.demandMessageLine3 || null,
    demandMessageLine4: parsed.data.demandMessageLine4 || null,
    demandMessageLine5: parsed.data.demandMessageLine5 || null,
    receiptMessage: parsed.data.receiptMessage || null,
    updatedBy: BigInt(req.user!.userId),
  };
  const settings = await prisma.systemSetting.upsert({
    where: { settingId: 1n },
    create: { settingId: 1n, ...clean },
    update: clean,
  });
  res.json(settings);
});
