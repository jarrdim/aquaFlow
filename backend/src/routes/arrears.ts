import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const arrearsRouter = Router();
arrearsRouter.use(requireAuth);

const id = z.coerce.bigint().positive();
const amount = z.coerce.number().positive().max(999_999_999);
const manager = requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER");
const supervisor = requireRole(
  "SYSTEM_ADMIN",
  "FINANCE_MANAGER",
  "CREDIT_CONTROL_SUPERVISOR",
);
const officer = requireRole(
  "SYSTEM_ADMIN",
  "FINANCE_MANAGER",
  "CREDIT_CONTROL_SUPERVISOR",
  "CREDIT_CONTROL_OFFICER",
);
const customerStaff = requireRole(
  "SYSTEM_ADMIN",
  "FINANCE_MANAGER",
  "CREDIT_CONTROL_SUPERVISOR",
  "CREDIT_CONTROL_OFFICER",
  "CUSTOMER_CARE_OFFICER",
);
const uid = (req: any) => BigInt(req.user.userId);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = () => {
  const value = new Date();
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
};
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const customerName = (customer: any) =>
  customer?.organizationName ||
  [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ");
function parse<T>(schema: z.ZodType<T>, value: unknown, res: any): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return;
  }
  return result.data;
}
function ageDays(dueDate: Date, asOf: Date) {
  return Math.max(
    0,
    Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000),
  );
}
function ageBucket(days: number) {
  if (days <= 30) return "0_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  if (days <= 120) return "91_120";
  return "120_PLUS";
}
const accountInclude = {
  customer: true,
  category: true,
  property: { include: { zone: true, route: true } },
  route: true,
  bills: {
    where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } },
    include: { billingCycle: true },
    orderBy: { dueDate: "asc" as const },
  },
  payments: {
    where: { paymentStatus: "POSTED" },
    orderBy: { paymentDate: "desc" as const },
    take: 1,
  },
} satisfies Prisma.CustomerAccountInclude;

async function arrearsRows(asOf: Date, filters: any = {}) {
  const accounts = await prisma.customerAccount.findMany({
    where: {
      currentBalance: { gt: 0 },
      ...(filters.zoneId
        ? { property: { zoneId: BigInt(filters.zoneId) } }
        : {}),
      ...(filters.categoryId ? { categoryId: BigInt(filters.categoryId) } : {}),
    },
    include: accountInclude,
    orderBy: { accountNumber: "asc" },
  });
  return accounts
    .map((account: any) => {
      const overdueBills = account.bills.filter(
        (bill: any) =>
          bill.dueDate < asOf &&
          Number(bill.totalCurrentCharges) - Number(bill.paidAmount) > 0,
      );
      const currentBills = account.bills.filter((bill: any) => bill.dueDate >= asOf);
      const overdueBillBalance = round(
        overdueBills.reduce(
          (sum: number, bill: any) =>
            sum +
            Math.max(
              0,
              Number(bill.totalCurrentCharges) - Number(bill.paidAmount),
            ),
          0,
        ),
      );
      const outstanding = round(
        Math.min(Number(account.currentBalance), overdueBillBalance),
      );
      const oldestDueDate = overdueBills[0]?.dueDate as Date | undefined;
      const days = oldestDueDate ? ageDays(oldestDueDate, asOf) : 0;
      return {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        customerName: customerName(account.customer),
        phoneNumber: account.customer.phoneNumber,
        emailAddress: account.customer.emailAddress,
        zone: account.property?.zone,
        category: account.category,
        accountStatus: account.accountStatus,
        currentBalance: Number(account.currentBalance),
        arrearsBalance: outstanding,
        currentBillBalance: round(
          currentBills.reduce(
            (sum: number, bill: any) =>
              sum +
              Math.max(
                0,
                Number(bill.totalCurrentCharges) - Number(bill.paidAmount),
              ),
            0,
          ),
        ),
        penalties: round(
          overdueBills.reduce(
            (sum: number, bill: any) => sum + Number(bill.penalties),
            0,
          ),
        ),
        oldestDueDate,
        ageDays: days,
        ageBucket: ageBucket(days),
        lastPayment: account.payments[0] ?? null,
      };
    })
    .filter((row) => row.arrearsBalance > 0)
    .filter((row) => !filters.minimumBalance || row.arrearsBalance >= Number(filters.minimumBalance))
    .filter((row) => !filters.minimumAgeDays || row.ageDays >= Number(filters.minimumAgeDays))
    .filter((row) => !filters.ageBucket || row.ageBucket === filters.ageBucket);
}

async function action(
  accountId: bigint | null,
  actionType: string,
  details: string,
  actor: bigint | null,
  referenceType?: string,
  referenceId?: bigint,
  metadata?: any,
) {
  return prisma.arrearsAction.create({
    data: {
      accountId,
      actionType,
      details,
      performedBy: actor,
      referenceType,
      referenceId,
      metadata,
    },
  });
}

async function refreshStatuses() {
  const now = today();
  await prisma.promiseToPay.updateMany({
    where: { status: "OPEN", expectedPaymentDate: { lt: now } },
    data: { status: "BROKEN", updatedAt: new Date() },
  });
  await prisma.paymentPlanInstallment.updateMany({
    where: { status: { in: ["PENDING", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });
}

arrearsRouter.get("/dashboard", async (req, res, next) => {
  try {
    await refreshStatuses();
    const asOf = req.query.asOf ? day(String(req.query.asOf)) : today();
    const rows = await arrearsRows(asOf, req.query);
    const buckets = {
      "0_30": 0,
      "31_60": 0,
      "61_90": 0,
      "91_120": 0,
      "120_PLUS": 0,
    } as Record<string, number>;
    rows.forEach((row) => {
      buckets[row.ageBucket] = round(buckets[row.ageBucket] + row.arrearsBalance);
    });
    const [notices, eligible, plans, promises, recent] = await Promise.all([
      prisma.debtNotice.count({
        where: { noticeStatus: { in: ["APPROVED", "SENT", "EXPIRED"] } },
      }),
      arrearsRows(asOf, {
        ...req.query,
        minimumAgeDays: 90,
        minimumBalance: 1,
      }),
      prisma.paymentPlan.count({ where: { status: { in: ["APPROVED", "ACTIVE"] } } }),
      prisma.promiseToPay.count({ where: { status: "OPEN" } }),
      prisma.arrearsAction.findMany({
        include: { account: { include: { customer: true } }, performer: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    res.json({
      asOf,
      totalArrears: round(rows.reduce((sum, row) => sum + row.arrearsBalance, 0)),
      customersInArrears: rows.length,
      buckets,
      demandNotices: notices,
      disconnectionEligible: eligible.length,
      activePlans: plans,
      openPromises: promises,
      recent,
    });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/accounts", async (req, res, next) => {
  try {
    const asOf = req.query.asOf ? day(String(req.query.asOf)) : today();
    const rows = await arrearsRows(asOf, req.query);
    const search = String(req.query.search ?? "").toLowerCase();
    res.json(
      search
        ? rows.filter((row) =>
            `${row.accountNumber} ${row.customerName} ${row.phoneNumber}`
              .toLowerCase()
              .includes(search),
          )
        : rows,
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/accounts/:id", async (req, res, next) => {
  const accountId = parse(id, req.params.id, res);
  if (!accountId) return;
  try {
    await refreshStatuses();
    const asOf = req.query.asOf ? day(String(req.query.asOf)) : today();
    const account = await prisma.customerAccount.findUnique({
      where: { accountId },
      include: {
        ...accountInclude,
        paymentPlans: {
          include: { installments: { orderBy: { installmentNumber: "asc" } } },
          orderBy: { createdAt: "desc" },
        },
        promisesToPay: { orderBy: { createdAt: "desc" } },
        debtNotices: { orderBy: { createdAt: "desc" } },
        debtWriteOffs: { orderBy: { createdAt: "desc" } },
        arrearsActions: {
          include: { performer: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    const row = (await arrearsRows(asOf)).find(
      (value) => value.accountId === accountId,
    );
    res.json({
      account,
      customerName: customerName(account.customer),
      summary: row ?? {
        arrearsBalance: 0,
        currentBillBalance: Number(account.currentBalance),
        ageDays: 0,
        ageBucket: "0_30",
      },
    });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.post("/reminders", officer, async (req, res, next) => {
  const data = parse(
    z.object({
      accountIds: z.array(id).min(1).max(1000),
      channels: z.array(z.enum(["SMS", "EMAIL", "PUSH"])).min(1),
      message: z.string().trim().min(10).max(3000),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const accounts = await prisma.customerAccount.findMany({
      where: { accountId: { in: data.accountIds } },
      include: { customer: true },
    });
    let queued = 0;
    await prisma.$transaction(async (tx) => {
      for (const account of accounts) {
        for (const channel of data.channels) {
          const recipient =
            channel === "SMS"
              ? account.customer.phoneNumber
              : channel === "EMAIL"
                ? account.customer.emailAddress
                : account.accountNumber;
          if (!recipient) continue;
          const provider = await tx.notificationProvider.findFirst({
            where: { channel, status: "ACTIVE", isDefault: true },
          });
          await tx.notification.create({
            data: {
              providerId: provider?.providerId,
              customerId: account.customerId,
              accountId: account.accountId,
              notificationType: "BALANCE_REMINDER",
              channel,
              recipient,
              subject: channel === "EMAIL" ? "Outstanding water account balance" : null,
              messageBody: data.message
                .replace(/\{\{customerName\}\}/g, customerName(account.customer))
                .replace(/\{\{accountNumber\}\}/g, account.accountNumber)
                .replace(/\{\{balance\}\}/g, Number(account.currentBalance).toFixed(2)),
              deliveryStatus: "QUEUED",
              requestedBy: uid(req),
            },
          });
          queued++;
        }
        await tx.debtNotice.create({
          data: {
            noticeNumber: `REM-${Date.now()}-${String(account.accountId)}`,
            accountId: account.accountId,
            noticeType: "REMINDER",
            outstandingAmount: account.currentBalance,
            deliveryChannel: data.channels.join("+"),
            deliveryStatus: "PENDING",
            noticeStatus: "APPROVED",
            messageBody: data.message,
            createdBy: uid(req),
            approvedBy: uid(req),
            approvedAt: new Date(),
          },
        });
        await tx.arrearsAction.create({
          data: {
            accountId: account.accountId,
            actionType: "REMINDER_QUEUED",
            details: `${data.channels.join(", ")} reminder queued`,
            performedBy: uid(req),
          },
        });
      }
    });
    res.status(201).json({ accounts: accounts.length, queued });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/notices", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    res.json(
      await prisma.debtNotice.findMany({
        where: status ? { noticeStatus: status } : undefined,
        include: {
          account: { include: { customer: true, property: { include: { zone: true } } } },
          creator: true,
          approver: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.post("/notices", officer, async (req, res, next) => {
  const data = parse(
    z.object({
      accountId: id,
      noticeType: z.enum(["DEMAND", "FINAL_DEMAND", "DISCONNECTION_NOTICE"]),
      paymentDeadline: z.string().min(1),
      deliveryChannel: z.enum(["SMS", "EMAIL", "PUSH", "PRINT", "SMS_PDF"]),
      messageBody: z.string().trim().min(10).max(5000),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: data.accountId },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (Number(account.currentBalance) <= 0)
      return res.status(409).json({ error: "This account has no outstanding balance" });
    const notice = await prisma.debtNotice.create({
      data: {
        noticeNumber: `DN-${Date.now()}-${String(data.accountId)}`,
        accountId: data.accountId,
        noticeType: data.noticeType,
        paymentDeadline: day(data.paymentDeadline),
        outstandingAmount: account.currentBalance,
        deliveryChannel: data.deliveryChannel,
        deliveryStatus: "PENDING",
        noticeStatus: "PENDING_APPROVAL",
        messageBody: data.messageBody,
        createdBy: uid(req),
      },
    });
    await action(
      data.accountId,
      "DEBT_NOTICE_SUBMITTED",
      `${data.noticeType} submitted for approval`,
      uid(req),
      "DEBT_NOTICE",
      notice.noticeId,
    );
    res.status(201).json(notice);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.patch("/notices/:id/decision", supervisor, async (req, res, next) => {
  const noticeId = parse(id, req.params.id, res);
  const data = parse(
    z.object({
      decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
      comments: z.string().trim().min(3).max(2000),
    }),
    req.body,
    res,
  );
  if (!noticeId || !data) return;
  try {
    const notice = await prisma.debtNotice.findUnique({ where: { noticeId } });
    if (!notice) return res.status(404).json({ error: "Notice not found" });
    if (notice.noticeStatus !== "PENDING_APPROVAL")
      return res.status(409).json({ error: "Only pending notices can be decided" });
    if (notice.createdBy === uid(req))
      return res.status(403).json({
        error: "Maker-checker control: the notice creator cannot approve their own notice",
      });
    const status =
      data.decision === "APPROVE"
        ? "APPROVED"
        : data.decision === "RETURN"
          ? "RETURNED"
          : "REJECTED";
    const updated = await prisma.debtNotice.update({
      where: { noticeId },
      data: {
        noticeStatus: status,
        approvedBy: uid(req),
        approvedAt: new Date(),
        decisionComments: data.comments,
        updatedAt: new Date(),
      },
    });
    await action(
      notice.accountId,
      `DEBT_NOTICE_${status}`,
      data.comments,
      uid(req),
      "DEBT_NOTICE",
      noticeId,
    );
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/plans", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    res.json(
      await prisma.paymentPlan.findMany({
        where: status ? { status } : undefined,
        include: {
          account: { include: { customer: true } },
          creator: true,
          approver: true,
          installments: { orderBy: { installmentNumber: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.post("/plans", officer, async (req, res, next) => {
  const data = parse(
    z.object({
      accountId: id,
      depositAmount: z.coerce.number().min(0),
      numberOfInstallments: z.coerce.number().int().min(1).max(60),
      startDate: z.string().min(1),
      frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY"]),
      remarks: z.string().max(2000).optional(),
      agreementFileName: z.string().max(255).optional(),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: data.accountId },
    });
    if (!account || Number(account.currentBalance) <= 0)
      return res.status(409).json({ error: "Select an account with outstanding debt" });
    const active = await prisma.paymentPlan.findFirst({
      where: {
        accountId: data.accountId,
        status: { in: ["PROPOSED", "APPROVED", "ACTIVE"] },
      },
    });
    if (active)
      return res.status(409).json({ error: "This account already has a current payment plan" });
    const totalDebt = Number(account.currentBalance);
    if (data.depositAmount >= totalDebt)
      return res.status(400).json({ error: "Deposit must be less than the total debt" });
    const remaining = round(totalDebt - data.depositAmount);
    const installmentAmount = round(remaining / data.numberOfInstallments);
    const start = day(data.startDate);
    const addPeriod = (date: Date, index: number) => {
      const value = new Date(date);
      if (data.frequency === "WEEKLY") value.setUTCDate(value.getUTCDate() + index * 7);
      else if (data.frequency === "QUARTERLY")
        value.setUTCMonth(value.getUTCMonth() + index * 3);
      else value.setUTCMonth(value.getUTCMonth() + index);
      return value;
    };
    const endDate = addPeriod(start, data.numberOfInstallments - 1);
    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentPlan.create({
        data: {
          planReference: `PLAN-${Date.now()}-${String(data.accountId)}`,
          accountId: data.accountId,
          totalDebt,
          depositAmount: data.depositAmount,
          installmentAmount,
          numberOfInstallments: data.numberOfInstallments,
          frequency: data.frequency,
          startDate: start,
          endDate,
          remarks: data.remarks,
          agreementFileName: data.agreementFileName,
          status: "PROPOSED",
          createdBy: uid(req),
        },
      });
      let allocated = 0;
      for (let index = 1; index <= data.numberOfInstallments; index++) {
        const due =
          index === data.numberOfInstallments
            ? round(remaining - allocated)
            : installmentAmount;
        allocated = round(allocated + due);
        await tx.paymentPlanInstallment.create({
          data: {
            paymentPlanId: created.paymentPlanId,
            installmentNumber: index,
            dueDate: addPeriod(start, index - 1),
            amountDue: due,
          },
        });
      }
      return created;
    });
    await action(
      data.accountId,
      "PAYMENT_PLAN_PROPOSED",
      `${data.numberOfInstallments} installment plan proposed`,
      uid(req),
      "PAYMENT_PLAN",
      plan.paymentPlanId,
    );
    res.status(201).json(plan);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.patch("/plans/:id/decision", supervisor, async (req, res, next) => {
  const paymentPlanId = parse(id, req.params.id, res);
  const data = parse(
    z.object({
      decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
      comments: z.string().trim().min(3).max(2000),
    }),
    req.body,
    res,
  );
  if (!paymentPlanId || !data) return;
  try {
    const plan = await prisma.paymentPlan.findUnique({ where: { paymentPlanId } });
    if (!plan) return res.status(404).json({ error: "Payment plan not found" });
    if (plan.status !== "PROPOSED")
      return res.status(409).json({ error: "Only proposed plans can be decided" });
    if (plan.createdBy === uid(req))
      return res.status(403).json({
        error: "Maker-checker control: the plan creator cannot approve their own plan",
      });
    const status =
      data.decision === "APPROVE"
        ? "ACTIVE"
        : data.decision === "RETURN"
          ? "RETURNED"
          : "REJECTED";
    const result = await prisma.paymentPlan.update({
      where: { paymentPlanId },
      data: {
        status,
        approvedBy: uid(req),
        approvedAt: new Date(),
        decisionComments: data.comments,
        updatedAt: new Date(),
      },
    });
    await action(
      plan.accountId,
      `PAYMENT_PLAN_${status}`,
      data.comments,
      uid(req),
      "PAYMENT_PLAN",
      paymentPlanId,
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.patch("/plans/:id/cancel", supervisor, async (req, res, next) => {
  const paymentPlanId = parse(id, req.params.id, res);
  if (!paymentPlanId) return;
  try {
    const plan = await prisma.paymentPlan.update({
      where: { paymentPlanId },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
    await action(
      plan.accountId,
      "PAYMENT_PLAN_CANCELLED",
      String(req.body?.reason ?? "Payment plan cancelled"),
      uid(req),
      "PAYMENT_PLAN",
      paymentPlanId,
    );
    res.json(plan);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/promises", async (req, res, next) => {
  try {
    await refreshStatuses();
    const status = String(req.query.status ?? "");
    res.json(
      await prisma.promiseToPay.findMany({
        where: status ? { status } : undefined,
        include: {
          account: {
            include: {
              customer: true,
              property: { include: { zone: true } },
            },
          },
          recorder: true,
        },
        orderBy: { expectedPaymentDate: "asc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.post("/promises", customerStaff, async (req, res, next) => {
  const data = parse(
    z.object({
      accountId: id,
      promisedAmount: amount,
      expectedPaymentDate: z.string().min(1),
      followUpDate: z.string().optional(),
      contactMethod: z.enum(["PHONE", "WALK_IN", "EMAIL", "SMS"]),
      notes: z.string().trim().min(3).max(2000),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: data.accountId },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (data.promisedAmount > Number(account.currentBalance))
      return res.status(400).json({ error: "Promise amount cannot exceed the balance" });
    const promise = await prisma.promiseToPay.create({
      data: {
        promiseReference: `PTP-${Date.now()}-${String(data.accountId)}`,
        accountId: data.accountId,
        promisedAmount: data.promisedAmount,
        expectedPaymentDate: day(data.expectedPaymentDate),
        followUpDate: data.followUpDate ? day(data.followUpDate) : null,
        contactMethod: data.contactMethod,
        notes: data.notes,
        recordedBy: uid(req),
      },
    });
    await action(
      data.accountId,
      "PROMISE_RECORDED",
      `Promise of KSh ${data.promisedAmount.toFixed(2)} recorded`,
      uid(req),
      "PROMISE_TO_PAY",
      promise.promiseId,
    );
    res.status(201).json(promise);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.patch("/promises/:id/status", customerStaff, async (req, res, next) => {
  const promiseId = parse(id, req.params.id, res);
  const data = parse(
    z.object({ status: z.enum(["KEPT", "BROKEN", "CANCELLED"]) }),
    req.body,
    res,
  );
  if (!promiseId || !data) return;
  try {
    const promise = await prisma.promiseToPay.update({
      where: { promiseId },
      data: { status: data.status, resolvedAt: new Date(), updatedAt: new Date() },
    });
    await action(
      promise.accountId,
      `PROMISE_${data.status}`,
      `Promise marked ${data.status.toLowerCase()}`,
      uid(req),
      "PROMISE_TO_PAY",
      promiseId,
    );
    res.json(promise);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/disconnections/eligible", async (req, res, next) => {
  try {
    const asOf = req.query.asOf ? day(String(req.query.asOf)) : today();
    const rows = await arrearsRows(asOf, {
      ...req.query,
      minimumAgeDays: req.query.minimumAgeDays ?? 90,
      minimumBalance: req.query.minimumBalance ?? 1,
    });
    const notices = await prisma.debtNotice.findMany({
      where: {
        accountId: { in: rows.map((row) => row.accountId) },
        noticeType: { in: ["FINAL_DEMAND", "DISCONNECTION_NOTICE"] },
        noticeStatus: { in: ["APPROVED", "SENT", "EXPIRED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      rows
        .map((row) => ({
          ...row,
          lastNotice: notices.find((notice) => notice.accountId === row.accountId),
        }))
        .filter((row) => row.lastNotice),
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/disconnections", async (_req, res, next) => {
  try {
    res.json(
      await prisma.disconnectionList.findMany({
        include: {
          zone: true,
          creator: true,
          approver: true,
          items: {
            include: { account: { include: { customer: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.post("/disconnections", officer, async (req, res, next) => {
  const data = parse(
    z.object({
      accountIds: z.array(id).min(1).max(1000),
      zoneId: id.optional(),
      minimumBalance: z.coerce.number().min(0),
      minimumAgeDays: z.coerce.number().int().min(1),
      remarks: z.string().max(2000).optional(),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const rows = await arrearsRows(today(), data);
    const selected = rows.filter((row) => data.accountIds.includes(row.accountId));
    const notices = await prisma.debtNotice.findMany({
      where: {
        accountId: { in: selected.map((row) => row.accountId) },
        noticeType: { in: ["FINAL_DEMAND", "DISCONNECTION_NOTICE"] },
        noticeStatus: { in: ["APPROVED", "SENT", "EXPIRED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    const eligible = selected.filter((row) =>
      notices.some((notice) => notice.accountId === row.accountId),
    );
    if (!eligible.length)
      return res.status(409).json({
        error: "Selected accounts require an approved final demand or disconnection notice",
      });
    const list = await prisma.$transaction(async (tx) => {
      const created = await tx.disconnectionList.create({
        data: {
          listReference: `DISC-${Date.now()}`,
          zoneId: data.zoneId,
          minimumBalance: data.minimumBalance,
          minimumAgeDays: data.minimumAgeDays,
          status: "PENDING_APPROVAL",
          remarks: data.remarks,
          createdBy: uid(req),
        },
      });
      for (const row of eligible) {
        const lastNotice = notices.find(
          (notice) => notice.accountId === row.accountId,
        );
        await tx.disconnectionListItem.create({
          data: {
            disconnectionListId: created.disconnectionListId,
            accountId: row.accountId,
            outstandingAmount: row.arrearsBalance,
            arrearsAgeDays: row.ageDays,
            lastNoticeId: lastNotice?.noticeId,
          },
        });
      }
      return created;
    });
    for (const row of eligible)
      await action(
        row.accountId,
        "DISCONNECTION_LIST_SUBMITTED",
        `${list.listReference} submitted for approval`,
        uid(req),
        "DISCONNECTION_LIST",
        list.disconnectionListId,
      );
    res.status(201).json({ ...list, count: eligible.length });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.patch("/disconnections/:id/decision", manager, async (req, res, next) => {
  const disconnectionListId = parse(id, req.params.id, res);
  const data = parse(
    z.object({
      decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
      comments: z.string().trim().min(3).max(2000),
    }),
    req.body,
    res,
  );
  if (!disconnectionListId || !data) return;
  try {
    const list = await prisma.disconnectionList.findUnique({
      where: { disconnectionListId },
      include: { items: true },
    });
    if (!list) return res.status(404).json({ error: "Disconnection list not found" });
    if (list.status !== "PENDING_APPROVAL")
      return res.status(409).json({ error: "Only pending lists can be decided" });
    if (list.createdBy === uid(req))
      return res.status(403).json({
        error: "Maker-checker control: the list creator cannot approve their own list",
      });
    const status =
      data.decision === "APPROVE"
        ? "APPROVED"
        : data.decision === "RETURN"
          ? "RETURNED"
          : "REJECTED";
    await prisma.$transaction(async (tx) => {
      await tx.disconnectionList.update({
        where: { disconnectionListId },
        data: {
          status,
          approvedBy: uid(req),
          approvedAt: new Date(),
          decisionComments: data.comments,
          updatedAt: new Date(),
        },
      });
      await tx.disconnectionListItem.updateMany({
        where: { disconnectionListId },
        data: { status: status === "APPROVED" ? "APPROVED" : status },
      });
    });
    for (const item of list.items)
      await action(
        item.accountId,
        `DISCONNECTION_LIST_${status}`,
        data.comments,
        uid(req),
        "DISCONNECTION_LIST",
        disconnectionListId,
      );
    res.json({ status });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/write-offs", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    res.json(
      await prisma.debtWriteOff.findMany({
        where: status ? { status } : undefined,
        include: {
          account: { include: { customer: true, property: { include: { zone: true } } } },
          requester: true,
          approver: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (error) {
    next(error);
  }
});

arrearsRouter.post("/write-offs", officer, async (req, res, next) => {
  const data = parse(
    z.object({
      accountId: id,
      amount,
      debtAgeDays: z.coerce.number().int().min(120),
      recoveryActions: z.string().trim().min(10).max(5000),
      reason: z.string().trim().min(5).max(2000),
      supportingFileName: z.string().max(255).optional(),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: data.accountId },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (data.amount > Number(account.currentBalance))
      return res.status(400).json({ error: "Write-off cannot exceed the account balance" });
    const request = await prisma.debtWriteOff.create({
      data: {
        writeOffReference: `WO-${Date.now()}-${String(data.accountId)}`,
        ...data,
        requestedBy: uid(req),
      },
    });
    await action(
      data.accountId,
      "WRITE_OFF_REQUESTED",
      data.reason,
      uid(req),
      "DEBT_WRITE_OFF",
      request.writeOffId,
    );
    res.status(201).json(request);
  } catch (error) {
    next(error);
  }
});

arrearsRouter.patch("/write-offs/:id/decision", manager, async (req, res, next) => {
  const writeOffId = parse(id, req.params.id, res);
  const data = parse(
    z.object({
      decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
      comments: z.string().trim().min(3).max(2000),
    }),
    req.body,
    res,
  );
  if (!writeOffId || !data) return;
  try {
    const request = await prisma.debtWriteOff.findUnique({
      where: { writeOffId },
    });
    if (!request) return res.status(404).json({ error: "Write-off request not found" });
    if (request.status !== "PENDING")
      return res.status(409).json({ error: "Only pending requests can be decided" });
    if (request.requestedBy === uid(req))
      return res.status(403).json({
        error: "Maker-checker control: the requester cannot decide their own write-off",
      });
    const status =
      data.decision === "APPROVE"
        ? "APPROVED"
        : data.decision === "RETURN"
          ? "RETURNED"
          : "REJECTED";
    await prisma.debtWriteOff.update({
      where: { writeOffId },
      data: {
        status,
        approvedBy: uid(req),
        decisionComments: data.comments,
        decidedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await action(
      request.accountId,
      `WRITE_OFF_${status}`,
      data.comments,
      uid(req),
      "DEBT_WRITE_OFF",
      writeOffId,
    );
    res.json({ status });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/recovery-report", async (req, res, next) => {
  try {
    const from = req.query.from ? day(String(req.query.from)) : new Date("2000-01-01");
    const to = req.query.to
      ? new Date(`${String(req.query.to)}T23:59:59.999Z`)
      : new Date();
    const [openingBills, openingPayments, newBills, recovered, writtenOff, rows] =
      await Promise.all([
        prisma.bill.aggregate({
          where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] }, dueDate: { lt: from } },
          _sum: { totalCurrentCharges: true },
        }),
        prisma.payment.aggregate({
          where: { paymentStatus: "POSTED", paymentDate: { lt: from } },
          _sum: { amount: true },
        }),
        prisma.bill.aggregate({
          where: {
            status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
            dueDate: { gte: from, lte: to },
          },
          _sum: { totalCurrentCharges: true },
        }),
        prisma.payment.aggregate({
          where: { paymentStatus: "POSTED", paymentDate: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        prisma.debtWriteOff.aggregate({
          where: { status: { in: ["APPROVED", "POSTED"] }, decidedAt: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        arrearsRows(to, req.query),
      ]);
    const openingArrears = round(
      Number(openingBills._sum.totalCurrentCharges ?? 0) -
        Number(openingPayments._sum.amount ?? 0),
    );
    const newArrears = Number(newBills._sum.totalCurrentCharges ?? 0);
    const amountRecovered = Number(recovered._sum.amount ?? 0);
    const writtenOffAmount = Number(writtenOff._sum.amount ?? 0);
    const closingArrears = round(
      rows.reduce((sum, row) => sum + row.arrearsBalance, 0),
    );
    res.json({
      from,
      to,
      openingArrears: Math.max(0, openingArrears),
      newArrears,
      amountRecovered,
      writtenOff: writtenOffAmount,
      closingArrears,
      recoveryRate:
        openingArrears + newArrears > 0
          ? round((amountRecovered / (openingArrears + newArrears)) * 100)
          : 0,
      rows,
    });
  } catch (error) {
    next(error);
  }
});

arrearsRouter.get("/audit", async (req, res, next) => {
  try {
    const accountId = req.query.accountId
      ? BigInt(String(req.query.accountId))
      : undefined;
    res.json(
      await prisma.arrearsAction.findMany({
        where: accountId ? { accountId } : undefined,
        include: { account: { include: { customer: true } }, performer: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    );
  } catch (error) {
    next(error);
  }
});
