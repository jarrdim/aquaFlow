import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

const createAccountSchema = z.object({
  customerId: z.string().min(1),
  propertyId: z.string().min(1),
  categoryId: z.string().min(1),
  routeId: z.string().optional(),
  openingBalance: z.number().optional(),
});

const bulkAccountSchema = z.object({
  accounts: z.array(z.object({
    accountNumber: z.string().trim().min(1).max(50),
    customerNumber: z.string().trim().min(1).max(50),
    propertyCode: z.string().trim().min(1).max(50),
    categoryCode: z.string().trim().min(1).max(50),
    openingBalance: z.coerce.number().default(0),
    currentBalance: z.coerce.number().default(0),
    connectionDate: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    accountStatus: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]),
    closureDate: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  })).min(1).max(1000),
});

const bulkBalanceSchema = z.object({
  balances: z.array(z.object({
    accountNumber: z.string().trim().min(1).max(50),
    openingBalance: z.coerce.number().finite().min(-999_999_999_999_999.99).max(999_999_999_999_999.99),
    currentBalance: z.coerce.number().finite().min(-999_999_999_999_999.99).max(999_999_999_999_999.99),
  })).min(1).max(1000),
});

accountsRouter.post(
  "/bulk-balance-import",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res, next) => {
    try {
      const parsed = bulkBalanceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const rows = parsed.data.balances;
      const seen = new Set<string>();
      const duplicates = rows
        .map((row) => row.accountNumber)
        .filter((accountNumber) => {
          if (seen.has(accountNumber)) return true;
          seen.add(accountNumber);
          return false;
        });
      if (duplicates.length) {
        return res.status(409).json({
          error: `Duplicate account number(s) in the file: ${[...new Set(duplicates)].slice(0, 50).join(", ")}`,
        });
      }

      const existing = await prisma.customerAccount.findMany({
        where: { accountNumber: { in: rows.map((row) => row.accountNumber) } },
        select: { accountNumber: true },
      });
      const existingNumbers = new Set(existing.map((row) => row.accountNumber));
      const missing = rows
        .map((row) => row.accountNumber)
        .filter((accountNumber) => !existingNumbers.has(accountNumber));
      if (missing.length) {
        return res.status(409).json({
          error: `${missing.length} account(s) were not found: ${missing.slice(0, 50).join(", ")}${missing.length > 50 ? "..." : ""}`,
        });
      }

      await prisma.$transaction(
        rows.map((row) => prisma.customerAccount.update({
          where: { accountNumber: row.accountNumber },
          data: {
            openingBalance: row.openingBalance,
            currentBalance: row.currentBalance,
          },
        })),
      );

      res.json({ updated: rows.length });
    } catch (error) {
      next(error);
    }
  },
);

accountsRouter.post("/bulk-import", async (req, res) => {
  const parsed = bulkAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rows = parsed.data.accounts;
  const [customers, properties, categories, existing] = await Promise.all([
    prisma.customer.findMany({
      where: { customerNumber: { in: rows.map((row) => row.customerNumber) } },
      select: { customerId: true, customerNumber: true },
    }),
    prisma.property.findMany({
      where: { propertyCode: { in: rows.map((row) => row.propertyCode) } },
      select: { propertyId: true, propertyCode: true, ownerCustomerId: true },
    }),
    prisma.customerCategory.findMany({
      where: { categoryCode: { in: rows.map((row) => row.categoryCode) } },
      select: { categoryId: true, categoryCode: true },
    }),
    prisma.customerAccount.findMany({
      where: { accountNumber: { in: rows.map((row) => row.accountNumber) } },
      select: { accountNumber: true },
    }),
  ]);
  const customerIds = new Map(customers.map((row) => [row.customerNumber, row.customerId]));
  const propertyByCode = new Map(properties.map((row) => [row.propertyCode, row]));
  const categoryIds = new Map(categories.map((row) => [row.categoryCode, row.categoryId]));
  const existingNumbers = new Set(existing.map((row) => row.accountNumber));
  const seen = new Set<string>();
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const customerId = customerIds.get(row.customerNumber);
    const property = propertyByCode.get(row.propertyCode);
    if (!customerId) errors.push(`Row ${line}: customer ${row.customerNumber} was not found.`);
    if (!property) errors.push(`Row ${line}: property ${row.propertyCode} was not found.`);
    if (customerId && property && property.ownerCustomerId !== customerId) errors.push(`Row ${line}: property ${row.propertyCode} does not belong to customer ${row.customerNumber}.`);
    if (!categoryIds.has(row.categoryCode)) errors.push(`Row ${line}: category ${row.categoryCode} was not found.`);
    if (seen.has(row.accountNumber)) errors.push(`Row ${line}: account ${row.accountNumber} is duplicated in this file.`);
    seen.add(row.accountNumber);
  });
  if (errors.length) return res.status(409).json({ error: errors.slice(0, 100).join("\n") });

  const newRows = rows.filter((row) => !existingNumbers.has(row.accountNumber));
  const result = await prisma.customerAccount.createMany({
    data: newRows.map((row) => ({
      accountNumber: row.accountNumber,
      customerId: customerIds.get(row.customerNumber)!,
      propertyId: propertyByCode.get(row.propertyCode)!.propertyId,
      categoryId: categoryIds.get(row.categoryCode)!,
      openingBalance: row.openingBalance,
      currentBalance: row.currentBalance,
      connectionDate: row.connectionDate ? new Date(`${row.connectionDate}T00:00:00.000Z`) : null,
      accountStatus: row.accountStatus,
      closureDate: row.closureDate ? new Date(`${row.closureDate}T00:00:00.000Z`) : null,
    })),
  });
  res.status(201).json({ imported: result.count, skipped: rows.length - newRows.length });
});

async function nextAccountNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.customerAccount.count();
  return `ACC-${year}-${String(count + 1).padStart(5, "0")}`;
}

accountsRouter.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    // Larger callers such as Customer Statements need the complete account
    // directory; compact autocomplete callers retain their small default.
    const take = Math.min(20_000, Math.max(1, Number(req.query.take) || 8));
    const accounts = await prisma.customerAccount.findMany({
      where: search
        ? {
            OR: [
              {
                accountNumber: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  firstName: { contains: search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  middleName: { contains: search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  lastName: { contains: search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  organizationName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
              { customer: { phoneNumber: { contains: search } } },
            ],
          }
        : undefined,
      include: { customer: true, category: true },
      orderBy: { accountNumber: "asc" },
      take,
    });
    res.json(accounts);
  } catch (error) {
    next(error);
  }
});

accountsRouter.post("/", async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  // FRS business rule: an account shall not be activated without a valid
  // customer, property and customer category — enforced by the required FKs below.
  const account = await prisma.customerAccount.create({
    data: {
      accountNumber: await nextAccountNumber(),
      customerId: BigInt(data.customerId),
      propertyId: BigInt(data.propertyId),
      categoryId: BigInt(data.categoryId),
      routeId: data.routeId ? BigInt(data.routeId) : undefined,
      openingBalance: data.openingBalance ?? 0,
      currentBalance: data.openingBalance ?? 0,
      accountStatus: "PENDING",
    },
  });

  res.status(201).json(account);
});
