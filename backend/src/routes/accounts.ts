import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

const ledgerBillStatuses = ["POSTED", "PARTIALLY_PAID", "PAID"];
const nonLedgerPaymentTypes = ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"];
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

async function accountLedgerBalance(client: any, accountId: bigint, openingBalance: number) {
  const [bills, payments] = await Promise.all([
    client.bill.aggregate({
      where: { accountId, status: { in: ledgerBillStatuses } },
      _sum: { totalCurrentCharges: true },
    }),
    client.payment.aggregate({
      where: {
        accountId,
        paymentStatus: "POSTED",
        paymentType: { notIn: nonLedgerPaymentTypes },
      },
      _sum: { amount: true },
    }),
  ]);
  const postedBillTotal = roundMoney(Number(bills._sum.totalCurrentCharges ?? 0));
  const postedPaymentTotal = roundMoney(Number(payments._sum.amount ?? 0));
  return {
    openingBalance: roundMoney(openingBalance),
    postedBillTotal,
    postedPaymentTotal,
    calculatedBalance: roundMoney(openingBalance + postedBillTotal - postedPaymentTotal),
  };
}

function accountCustomerName(customer: {
  customerType: string;
  organizationName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}) {
  return customer.customerType === "ORGANIZATION"
    ? customer.organizationName || "Unnamed organization"
    : [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
}

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
        select: { accountId: true, accountNumber: true, openingBalance: true, currentBalance: true },
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

      const accountIds = existing.map((row) => row.accountId);
      const [billTotals, paymentTotals] = await Promise.all([
        prisma.bill.groupBy({
          by: ["accountId"],
          where: { accountId: { in: accountIds }, status: { in: ledgerBillStatuses } },
          _sum: { totalCurrentCharges: true },
        }),
        prisma.payment.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: accountIds },
            paymentStatus: "POSTED",
            paymentType: { notIn: nonLedgerPaymentTypes },
          },
          _sum: { amount: true },
        }),
      ]);
      const accountsByNumber = new Map(existing.map((row) => [row.accountNumber, row]));
      const billsByAccount = new Map(billTotals.map((row) => [row.accountId, Number(row._sum.totalCurrentCharges ?? 0)]));
      const paymentsByAccount = new Map(paymentTotals.map((row) => [row.accountId, Number(row._sum.amount ?? 0)]));
      const inconsistent = rows.flatMap((row) => {
        const account = accountsByNumber.get(row.accountNumber)!;
        const calculated = roundMoney(
          row.openingBalance +
          (billsByAccount.get(account.accountId) ?? 0) -
          (paymentsByAccount.get(account.accountId) ?? 0),
        );
        return calculated === roundMoney(row.currentBalance)
          ? []
          : [`${row.accountNumber}: imported current balance ${row.currentBalance.toFixed(2)} does not match ledger balance ${calculated.toFixed(2)}`];
      });
      if (inconsistent.length) {
        return res.status(409).json({
          error: `Balance import rejected. Current balances must equal opening balance + posted bills - posted bill payments. ${inconsistent.slice(0, 25).join("; ")}${inconsistent.length > 25 ? "..." : ""}`,
        });
      }

      const changed = rows.filter((row) => {
        const account = accountsByNumber.get(row.accountNumber)!;
        return roundMoney(Number(account.openingBalance)) !== roundMoney(row.openingBalance) ||
          roundMoney(Number(account.currentBalance)) !== roundMoney(row.currentBalance);
      });
      await prisma.$transaction([
        ...rows.map((row) => prisma.customerAccount.update({
          where: { accountNumber: row.accountNumber },
          data: {
            openingBalance: row.openingBalance,
            currentBalance: row.currentBalance,
          },
        })),
        ...(changed.length ? [prisma.accountBalanceReconciliation.createMany({
          data: changed.map((row) => {
            const account = accountsByNumber.get(row.accountNumber)!;
            const postedBillTotal = roundMoney(billsByAccount.get(account.accountId) ?? 0);
            const postedPaymentTotal = roundMoney(paymentsByAccount.get(account.accountId) ?? 0);
            return {
              accountId: account.accountId,
              storedBalance: account.currentBalance,
              calculatedBalance: row.currentBalance,
              variance: roundMoney(row.currentBalance - Number(account.currentBalance)),
              openingBalance: row.openingBalance,
              postedBillTotal,
              postedPaymentTotal,
              reason: "Validated bulk balance import",
              source: "BALANCE_IMPORT",
              reconciledBy: BigInt(req.user!.userId),
            };
          }),
        })] : []),
      ]);

      res.json({ updated: rows.length });
    } catch (error) {
      next(error);
    }
  },
);

accountsRouter.get(
  "/:accountNumber/balance-reconciliation",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res, next) => {
    try {
      const account = await prisma.customerAccount.findUnique({
        where: { accountNumber: req.params.accountNumber.trim() },
        include: {
          customer: true,
          balanceReconciliations: {
            include: { reconciler: { select: { username: true, firstName: true, lastName: true } } },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });
      if (!account) return res.status(404).json({ error: "Account was not found" });

      const ledger = await accountLedgerBalance(prisma, account.accountId, Number(account.openingBalance));
      const storedBalance = roundMoney(Number(account.currentBalance));
      res.json({
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        customerName: accountCustomerName(account.customer),
        storedBalance,
        ...ledger,
        variance: roundMoney(ledger.calculatedBalance - storedBalance),
        balanced: ledger.calculatedBalance === storedBalance,
        history: account.balanceReconciliations,
      });
    } catch (error) {
      next(error);
    }
  },
);

accountsRouter.post(
  "/:accountNumber/balance-reconciliation",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res, next) => {
    const parsed = z.object({ reason: z.string().trim().min(10).max(1000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{
          account_id: bigint;
          opening_balance: unknown;
          current_balance: unknown;
        }>>`
          SELECT account_id, opening_balance, current_balance
          FROM aquaflow.customer_accounts
          WHERE account_number = ${req.params.accountNumber.trim()}
          FOR UPDATE
        `;
        const account = rows[0];
        if (!account) return null;

        const ledger = await accountLedgerBalance(tx, account.account_id, Number(account.opening_balance));
        const storedBalance = roundMoney(Number(account.current_balance));
        const variance = roundMoney(ledger.calculatedBalance - storedBalance);
        if (variance === 0) return { changed: false, storedBalance, ...ledger, variance };

        await tx.customerAccount.update({
          where: { accountId: account.account_id },
          data: { currentBalance: ledger.calculatedBalance, updatedAt: new Date() },
        });
        const audit = await tx.accountBalanceReconciliation.create({
          data: {
            accountId: account.account_id,
            storedBalance,
            calculatedBalance: ledger.calculatedBalance,
            variance,
            openingBalance: ledger.openingBalance,
            postedBillTotal: ledger.postedBillTotal,
            postedPaymentTotal: ledger.postedPaymentTotal,
            reason: parsed.data.reason,
            reconciledBy: BigInt(req.user!.userId),
          },
        });
        return { changed: true, storedBalance, ...ledger, variance, audit };
      });
      if (!result) return res.status(404).json({ error: "Account was not found" });
      res.json(result);
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
  try {
    const account = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aquaflow-account-number'))`;
      const year = new Date().getFullYear();
      const pattern = `ACC-${year}-%`;
      const [sequence] = await tx.$queryRaw<Array<{ maxSequence: number }>>`
        SELECT COALESCE(
          MAX(CAST(substring(account_number FROM '[0-9]+$') AS INTEGER)),
          0
        )::INTEGER AS "maxSequence"
        FROM aquaflow.customer_accounts
        WHERE account_number LIKE ${pattern}`;
      const accountNumber = `ACC-${year}-${String(sequence.maxSequence + 1).padStart(5, "0")}`;

      return tx.customerAccount.create({
        data: {
          accountNumber,
          customerId: BigInt(data.customerId),
          propertyId: BigInt(data.propertyId),
          categoryId: BigInt(data.categoryId),
          routeId: data.routeId ? BigInt(data.routeId) : undefined,
          openingBalance: data.openingBalance ?? 0,
          currentBalance: data.openingBalance ?? 0,
          accountStatus: "ACTIVE",
          connectionDate: new Date(),
        },
      });
    });

    res.status(201).json(account);
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "An account already exists with the generated account number. Please retry." });
    }
    console.error("Account creation failed", error);
    return res.status(500).json({ error: "Account creation failed. The customer and property were saved." });
  }
});

accountsRouter.patch(
  "/:id/activate",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res) => {
    const accountId = z.coerce.bigint().positive().safeParse(req.params.id);
    if (!accountId.success) return res.status(400).json({ error: "Invalid account ID" });

    const existing = await prisma.customerAccount.findUnique({ where: { accountId: accountId.data } });
    if (!existing) return res.status(404).json({ error: "Account was not found" });
    if (existing.accountStatus !== "PENDING") {
      return res.status(409).json({ error: `Only pending accounts can be activated. This account is ${existing.accountStatus.toLowerCase()}.` });
    }

    const account = await prisma.customerAccount.update({
      where: { accountId: accountId.data },
      data: { accountStatus: "ACTIVE", connectionDate: existing.connectionDate ?? new Date() },
    });
    res.json(account);
  },
);
