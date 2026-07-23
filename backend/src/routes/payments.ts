import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isSystemAdmin, requireAuth, requireRole } from "../middleware/auth";
import {
  getMpesaConfig,
  normalizeKenyanPhone,
  parseMpesaDate,
  requestStkPush,
} from "../lib/mpesa";

export const paymentsRouter = Router();

// Daraja calls this endpoint directly, so it must remain outside JWT authentication.
// The CheckoutRequestID and unique M-Pesa receipt protect the financial posting path
// against spoofed, duplicate and retried callbacks.
paymentsRouter.post("/mpesa/callback", async (req, res, next) => {
  const expectedToken = process.env.MPESA_CALLBACK_TOKEN?.trim();
  if (expectedToken && req.query.token !== expectedToken)
    return res
      .status(401)
      .json({ ResultCode: 1, ResultDesc: "Unauthorized callback" });
  const callback = req.body?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID)
    return res
      .status(400)
      .json({ ResultCode: 1, ResultDesc: "Invalid callback" });
  try {
    const request = await prisma.mpesaStkRequest.findUnique({
      where: { checkoutRequestId: String(callback.CheckoutRequestID) },
    });
    // Acknowledge unknown or already processed callbacks without creating money.
    if (
      !request ||
      ["COMPLETED", "FAILED", "CANCELLED"].includes(request.status)
    )
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    const resultCode = Number(callback.ResultCode);
    if (resultCode !== 0) {
      await prisma.mpesaStkRequest.update({
        where: { stkRequestId: request.stkRequestId },
        data: {
          status: resultCode === 1032 ? "CANCELLED" : "FAILED",
          resultCode,
          resultDescription: String(
            callback.ResultDesc ?? "M-Pesa request failed",
          ),
          callbackPayload: req.body,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
    const items = Array.isArray(callback.CallbackMetadata?.Item)
      ? callback.CallbackMetadata.Item
      : [];
    const value = (key: string) =>
      items.find((item: any) => item?.Name === key)?.Value;
    const receiptNumber = String(value("MpesaReceiptNumber") ?? "").trim();
    const paidAmount = Number(value("Amount"));
    const phoneNumber = String(value("PhoneNumber") ?? request.phoneNumber);
    const transactionDate = parseMpesaDate(value("TransactionDate"));
    if (!receiptNumber || !Number.isFinite(paidAmount) || paidAmount <= 0)
      throw Object.assign(
        new Error("Successful M-Pesa callback is missing receipt details"),
        { status: 400 },
      );
    if (Math.abs(paidAmount - Number(request.amount)) >= 0.01)
      throw Object.assign(
        new Error(
          "M-Pesa callback amount does not match the initiated request",
        ),
        { status: 409 },
      );

    await prisma.$transaction(async (tx) => {
      const locked = await tx.mpesaStkRequest.findUniqueOrThrow({
        where: { stkRequestId: request.stkRequestId },
      });
      if (locked.status === "COMPLETED") return;
      const existing = await tx.payment.findUnique({
        where: { transactionReference: receiptNumber },
      });
      if (existing) {
        await tx.mpesaStkRequest.update({
          where: { stkRequestId: request.stkRequestId },
          data: {
            paymentId: existing.paymentId,
            status: "COMPLETED",
            resultCode: 0,
            resultDescription: String(callback.ResultDesc ?? "Completed"),
            mpesaReceiptNumber: receiptNumber,
            transactionDate,
            callbackPayload: req.body,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        return;
      }
      const channel = await tx.paymentChannel.findFirst({
        where: {
          OR: [
            { channelCode: "MPESA" },
            { channelName: { equals: "MPESA", mode: "insensitive" } },
          ],
        },
      });
      if (!channel || channel.status !== "ACTIVE")
        throw Object.assign(
          new Error("Active M-Pesa payment channel is not configured"),
          { status: 409 },
        );
      const account = await tx.customerAccount.findUniqueOrThrow({
        where: { accountId: request.accountId },
      });
      const payment = await tx.payment.create({
        data: {
          transactionReference: receiptNumber,
          accountId: account.accountId,
          channelId: channel.channelId,
          amount: paidAmount,
          paymentDate: transactionDate,
          valueDate: new Date(
            Date.UTC(
              transactionDate.getUTCFullYear(),
              transactionDate.getUTCMonth(),
              transactionDate.getUTCDate(),
            ),
          ),
          payerPhone: phoneNumber,
          customerReference: account.accountNumber,
          paymentType: "BILL_PAYMENT",
          remarks: "M-Pesa Express STK Push",
          matchingStatus: "UNMATCHED",
          paymentStatus: "RECEIVED",
          unallocatedAmount: paidAmount,
          externalPayload: req.body,
          receivedBy: request.initiatedBy,
        },
      });
      const allocation = await allocate(
        tx,
        payment,
        account.accountId,
        request.initiatedBy,
      );
      const receipt = await tx.receipt.create({
        data: {
          receiptNumber: `RCT-${new Date().getFullYear()}-${String(payment.paymentId).padStart(6, "0")}`,
          paymentId: payment.paymentId,
          accountId: account.accountId,
          amount: paidAmount,
          issuedBy: request.initiatedBy,
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.paymentId,
          eventType: "MPESA_STK_PAYMENT_POSTED",
          previousStatus: "RECEIVED",
          newStatus: "POSTED",
          details: `M-Pesa Express ${receiptNumber}; KSh ${allocation.allocated.toFixed(2)} allocated`,
          performedBy: request.initiatedBy,
          metadata: {
            stkRequestId: String(request.stkRequestId),
            checkoutRequestId: request.checkoutRequestId,
            receiptId: String(receipt.receiptId),
          },
        },
      });
      await tx.mpesaStkRequest.update({
        where: { stkRequestId: request.stkRequestId },
        data: {
          paymentId: payment.paymentId,
          status: "COMPLETED",
          resultCode: 0,
          resultDescription: String(callback.ResultDesc ?? "Completed"),
          mpesaReceiptNumber: receiptNumber,
          transactionDate,
          callbackPayload: req.body,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.use(requireAuth);
const id = z.coerce.bigint().positive();
const amount = z.coerce.number().positive().max(999_999_999);
const staff = requireRole(
  "SYSTEM_ADMIN",
  "FINANCE_MANAGER",
  "CASHIER",
  "ACCOUNTANT",
);
const checker = requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER", "ACCOUNTANT");
const uid = (req: any) => (req.user?.userId ? BigInt(req.user.userId) : null);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const name = (customer: any) =>
  customer?.organizationName ||
  [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ");
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  res: any,
): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return;
  }
  return result.data;
}

const paymentInclude = {
  account: { include: { customer: true, category: true } },
  channel: true,
  receiver: true,
  allocations: {
    include: { bill: { include: { billingCycle: true } }, allocator: true },
    orderBy: { createdAt: "asc" as const },
  },
  receipt: true,
  reversals: {
    include: { requester: true, approver: true },
    orderBy: { createdAt: "desc" as const },
  },
  suspense: true,
  events: {
    include: { performer: true },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

async function allocate(
  tx: any,
  payment: any,
  accountId: bigint,
  actor: bigint | null,
) {
  const bills = await tx.bill.findMany({
    where: { accountId, status: { in: ["POSTED", "PARTIALLY_PAID"] } },
    orderBy: [{ dueDate: "asc" }, { billId: "asc" }],
  });
  let remaining = Number(payment.amount);
  let allocated = 0;
  for (const bill of bills) {
    const outstanding = Math.max(
      0,
      Number(bill.totalCurrentCharges) - Number(bill.paidAmount),
    );
    const applied = round(Math.min(remaining, outstanding));
    if (applied <= 0) continue;
    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.paymentId,
        billId: bill.billId,
        allocatedAmount: applied,
        allocatedBy: actor,
      },
    });
    const newPaid = round(Number(bill.paidAmount) + applied);
    await tx.bill.update({
      where: { billId: bill.billId },
      data: {
        paidAmount: newPaid,
        status:
          newPaid >= Number(bill.totalCurrentCharges)
            ? "PAID"
            : "PARTIALLY_PAID",
        updatedAt: new Date(),
      },
    });
    allocated = round(allocated + applied);
    remaining = round(remaining - applied);
    if (remaining <= 0) break;
  }
  await tx.customerAccount.update({
    where: { accountId },
    data: {
      currentBalance: { decrement: Number(payment.amount) },
      updatedAt: new Date(),
    },
  });
  // Reaching this function means the payment has already been matched to a
  // verified customer account. A payment can have no bill allocation when the
  // account has no open bill; that remainder is valid account credit, not an
  // unmatched payment.
  const matchingStatus =
    allocated > 0 && remaining > 0 ? "PARTIALLY_MATCHED" : "MATCHED";
  await tx.payment.update({
    where: { paymentId: payment.paymentId },
    data: {
      accountId,
      matchingStatus,
      paymentStatus: "POSTED",
      unallocatedAmount: remaining,
      postedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return { allocated, remaining, matchingStatus };
}

paymentsRouter.get("/channels", async (_req, res, next) => {
  try {
    res.json(
      await prisma.paymentChannel.findMany({ orderBy: { channelName: "asc" } }),
    );
  } catch (e) {
    next(e);
  }
});
paymentsRouter.post(
  "/channels",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res, next) => {
    const data = parse(
      z.object({
        channelCode: z.string().trim().min(2).max(30),
        channelName: z.string().trim().min(2).max(100),
        requiresReference: z.boolean().default(true),
        accountIdentifier: z.string().max(100).optional(),
        bankName: z.string().max(120).optional(),
        branchName: z.string().max(120).optional(),
        bankAccountNumber: z.string().max(100).optional(),
        autoAllocation: z.boolean().default(true),
        receiptRequired: z.boolean().default(true),
        status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
        remarks: z.string().max(1000).optional(),
      }),
      req.body,
      res,
    );
    if (!data) return;
    try {
      res
        .status(201)
        .json(
          await prisma.paymentChannel.create({
            data: { ...data, channelCode: data.channelCode.toUpperCase() },
          }),
        );
    } catch (e) {
      next(e);
    }
  },
);
paymentsRouter.patch(
  "/channels/:id",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res, next) => {
    const channelId = parse(id, req.params.id, res);
    if (!channelId) return;
    const data = parse(
      z.object({
        accountIdentifier: z.string().max(100).nullable().optional(),
        bankName: z.string().max(120).nullable().optional(),
        branchName: z.string().max(120).nullable().optional(),
        bankAccountNumber: z.string().max(100).nullable().optional(),
        autoAllocation: z.boolean().optional(),
        receiptRequired: z.boolean().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        remarks: z.string().max(1000).nullable().optional(),
      }),
      req.body,
      res,
    );
    if (!data) return;
    try {
      res.json(
        await prisma.paymentChannel.update({
          where: { channelId },
          data: { ...data, updatedAt: new Date() },
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

paymentsRouter.get("/accounts", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "");
    const rows = await prisma.customerAccount.findMany({
      where: {
        accountStatus: "ACTIVE",
        ...(q
          ? {
              OR: [
                { accountNumber: { contains: q, mode: "insensitive" } },
                {
                  customer: {
                    OR: [
                      { firstName: { contains: q, mode: "insensitive" } },
                      { lastName: { contains: q, mode: "insensitive" } },
                      {
                        organizationName: { contains: q, mode: "insensitive" },
                      },
                      { phoneNumber: { contains: q } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: { customer: true },
      orderBy: { accountNumber: "asc" },
      take: 100,
    });
    res.json(rows.map((a: any) => ({ ...a, customerName: name(a.customer) })));
  } catch (e) {
    next(e);
  }
});

paymentsRouter.get("/mpesa/config", (_req, res) => {
  try {
    const config = getMpesaConfig();
    res.json({
      configured: true,
      environment: config.environment,
      shortCode: config.shortCode,
      callbackSecured: Boolean(config.callbackToken),
    });
  } catch (e: any) {
    res.json({
      configured: false,
      environment: process.env.MPESA_ENVIRONMENT ?? "sandbox",
      error: e.message,
    });
  }
});

paymentsRouter.get("/mpesa/stk", async (req, res, next) => {
  try {
    const accountId = req.query.accountId
      ? BigInt(String(req.query.accountId))
      : undefined;
    res.json(
      await prisma.mpesaStkRequest.findMany({
        where: accountId ? { accountId } : undefined,
        include: {
          account: { include: { customer: true } },
          payment: { include: { receipt: true } },
          initiator: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  } catch (e) {
    next(e);
  }
});

paymentsRouter.get("/mpesa/stk/:id", async (req, res, next) => {
  const stkRequestId = parse(id, req.params.id, res);
  if (!stkRequestId) return;
  try {
    const row = await prisma.mpesaStkRequest.findUnique({
      where: { stkRequestId },
      include: {
        account: { include: { customer: true } },
        payment: { include: { receipt: true } },
      },
    });
    if (!row) return res.status(404).json({ error: "STK request not found" });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post("/mpesa/stk", staff, async (req, res, next) => {
  const data = parse(
    z.object({
      accountId: id,
      phoneNumber: z.string().trim().min(9).max(20),
      amount: z.coerce.number().positive().max(250_000),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const phoneNumber = normalizeKenyanPhone(data.phoneNumber);
    if (!Number.isInteger(data.amount))
      return res
        .status(400)
        .json({
          error:
            "M-Pesa Express amount must be a whole number of Kenya shillings",
        });
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: data.accountId },
      include: { customer: true },
    });
    if (!account || account.accountStatus !== "ACTIVE")
      return res
        .status(404)
        .json({ error: "Active customer account not found" });
    const recent = await prisma.mpesaStkRequest.findFirst({
      where: {
        accountId: data.accountId,
        phoneNumber,
        amount: data.amount,
        status: "PENDING",
        createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent)
      return res
        .status(409)
        .json({
          error: "A matching M-Pesa prompt is already pending for this account",
          stkRequestId: String(recent.stkRequestId),
        });
    const response = await requestStkPush({
      phoneNumber,
      amount: data.amount,
      accountReference: account.accountNumber,
      description: "AquaFlow water bill",
    });
    if (String(response.ResponseCode) !== "0" || !response.CheckoutRequestID)
      return res
        .status(400)
        .json({
          error:
            response.ResponseDescription ||
            "M-Pesa did not accept the STK request",
        });
    const row = await prisma.mpesaStkRequest.create({
      data: {
        accountId: data.accountId,
        initiatedBy: uid(req),
        phoneNumber,
        amount: data.amount,
        merchantRequestId: String(response.MerchantRequestID),
        checkoutRequestId: String(response.CheckoutRequestID),
        customerMessage: String(response.CustomerMessage ?? ""),
        responseCode: String(response.ResponseCode),
        responseDescription: String(response.ResponseDescription ?? ""),
        status: "PENDING",
      },
    });
    res.status(201).json(row);
  } catch (e: any) {
    if (e.status)
      return res.status(e.status).json({ error: e.message, details: e.daraja });
    next(e);
  }
});

paymentsRouter.get("/", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? ""),
      channelId = req.query.channelId
        ? BigInt(String(req.query.channelId))
        : undefined,
      accountId = req.query.accountId
        ? BigInt(String(req.query.accountId))
        : undefined,
      q = String(req.query.search ?? "");
    const paginated = req.query.page !== undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 50));
    const where: Prisma.PaymentWhereInput = {
      ...(status ? { paymentStatus: status } : {}),
      ...(channelId ? { channelId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(q
        ? {
            OR: [
              { transactionReference: { contains: q, mode: "insensitive" } },
              { payerName: { contains: q, mode: "insensitive" } },
              { payerPhone: { contains: q } },
              { customerReference: { contains: q, mode: "insensitive" } },
              { account: { accountNumber: { contains: q, mode: "insensitive" } } },
              { account: { customer: { firstName: { contains: q, mode: "insensitive" } } } },
              { account: { customer: { middleName: { contains: q, mode: "insensitive" } } } },
              { account: { customer: { lastName: { contains: q, mode: "insensitive" } } } },
              { account: { customer: { organizationName: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.PaymentOrderByWithRelationInput[] = [
      { paymentDate: "desc" },
      { paymentId: "desc" },
    ];
    if (paginated) {
      const [rows, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          include: paymentInclude,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.payment.count({ where }),
      ]);
      return res.json({
        items: rows.map((p: any) => ({
          ...p,
          customerName: name(p.account?.customer),
        })),
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }
    const rows = await prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy,
      take: 3000,
    });
    res.json(
      rows.map((p: any) => ({ ...p, customerName: name(p.account?.customer) })),
    );
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post("/record", staff, async (req, res, next) => {
  const data = parse(
    z.object({
      accountId: id,
      channelId: id,
      transactionReference: z.string().trim().min(2).max(100),
      amount,
      paymentDate: z.string().min(10),
      payerName: z.string().max(200).optional(),
      payerPhone: z.string().max(30).optional(),
      paymentType: z
        .enum(["BILL_PAYMENT", "ADVANCE_PAYMENT", "DEPOSIT"])
        .default("BILL_PAYMENT"),
      autoAllocate: z.boolean().default(true),
      remarks: z.string().max(1000).optional(),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const channel = await tx.paymentChannel.findUnique({
        where: { channelId: data.channelId },
      });
      if (!channel || channel.status !== "ACTIVE")
        throw Object.assign(new Error("Select an active payment channel"), {
          status: 400,
        });
      const account = await tx.customerAccount.findUnique({
        where: { accountId: data.accountId },
      });
      if (!account)
        throw Object.assign(new Error("Customer account not found"), {
          status: 404,
        });
      const payment = await tx.payment.create({
        data: {
          transactionReference: data.transactionReference,
          accountId: data.accountId,
          channelId: data.channelId,
          amount: data.amount,
          paymentDate: new Date(data.paymentDate),
          valueDate: day(data.paymentDate.slice(0, 10)),
          payerName: data.payerName,
          payerPhone: data.payerPhone,
          customerReference: account.accountNumber,
          paymentType: data.paymentType,
          remarks: data.remarks,
          matchingStatus: "UNMATCHED",
          paymentStatus: "RECEIVED",
          unallocatedAmount: data.amount,
          receivedBy: uid(req),
        },
      });
      const allocation = data.autoAllocate
        ? await allocate(tx, payment, data.accountId, uid(req))
        : { allocated: 0, remaining: data.amount, matchingStatus: "UNMATCHED" };
      if (!data.autoAllocate) {
        await tx.customerAccount.update({
          where: { accountId: data.accountId },
          data: { currentBalance: { decrement: data.amount } },
        });
        await tx.payment.update({
          where: { paymentId: payment.paymentId },
          data: {
            matchingStatus: "MATCHED",
            paymentStatus: "POSTED",
            postedAt: new Date(),
          },
        });
      }
      const receipt = await tx.receipt.create({
        data: {
          receiptNumber: `RCT-${new Date().getFullYear()}-${String(payment.paymentId).padStart(6, "0")}`,
          paymentId: payment.paymentId,
          accountId: data.accountId,
          amount: data.amount,
          issuedBy: uid(req),
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.paymentId,
          eventType: "PAYMENT_POSTED",
          previousStatus: "RECEIVED",
          newStatus: "POSTED",
          details: `${channel.channelName} payment recorded; KSh ${allocation.allocated.toFixed(2)} allocated`,
          performedBy: uid(req),
        },
      });
      return {
        paymentId: payment.paymentId,
        receiptId: receipt.receiptId,
        ...allocation,
      };
    });
    res.status(201).json(result);
  } catch (e: any) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === "P2002")
      return res
        .status(409)
        .json({ error: "Payment reference already exists" });
    next(e);
  }
});

paymentsRouter.post(
  "/mpesa",
  requireRole("SYSTEM_ADMIN", "FINANCE_MANAGER"),
  async (req, res, next) => {
    const data = parse(
      z.object({
        transactionReference: z.string().trim().min(5),
        customerReference: z.string().trim().min(1),
        payerName: z.string().optional(),
        payerPhone: z.string().optional(),
        amount,
        paymentDate: z.string().min(10),
      }),
      req.body,
      res,
    );
    if (!data) return;
    try {
      const channel = await prisma.paymentChannel.findFirst({
        where: {
          OR: [
            { channelCode: "MPESA" },
            { channelName: { equals: "MPESA", mode: "insensitive" } },
          ],
        },
      });
      if (!channel)
        return res
          .status(409)
          .json({ error: "M-Pesa channel is not configured" });
      const account = await prisma.customerAccount.findUnique({
        where: { accountNumber: data.customerReference },
      });
      if (account) {
        const result = await prisma.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              ...data,
              accountId: account.accountId,
              channelId: channel.channelId,
              paymentDate: new Date(data.paymentDate),
              valueDate: day(data.paymentDate.slice(0, 10)),
              matchingStatus: "UNMATCHED",
              paymentStatus: "RECEIVED",
              unallocatedAmount: data.amount,
              receivedBy: uid(req),
            },
          });
          const allocation = await allocate(
            tx,
            payment,
            account.accountId,
            uid(req),
          );
          const receipt = await tx.receipt.create({
            data: {
              receiptNumber: `RCT-${new Date().getFullYear()}-${String(payment.paymentId).padStart(6, "0")}`,
              paymentId: payment.paymentId,
              accountId: account.accountId,
              amount: data.amount,
              issuedBy: uid(req),
            },
          });
          await tx.paymentEvent.create({
            data: {
              paymentId: payment.paymentId,
              eventType: "MPESA_PAYMENT_POSTED",
              previousStatus: "RECEIVED",
              newStatus: "POSTED",
              details: `M-Pesa payment received; KSh ${allocation.allocated.toFixed(2)} allocated`,
              performedBy: uid(req),
            },
          });
          return {
            paymentId: payment.paymentId,
            receiptId: receipt.receiptId,
            ...allocation,
          };
        });
        return res.status(201).json(result);
      }
      const payment = await prisma.payment.create({
        data: {
          ...data,
          channelId: channel.channelId,
          paymentDate: new Date(data.paymentDate),
          valueDate: day(data.paymentDate.slice(0, 10)),
          matchingStatus: "UNMATCHED",
          paymentStatus: "RECEIVED",
          unallocatedAmount: data.amount,
          receivedBy: uid(req),
        },
      });
      await prisma.suspensePayment.create({
        data: {
          paymentId: payment.paymentId,
          suspenseReason: "Customer reference did not match an active account",
          receivedReference: data.customerReference,
        },
      });
      await prisma.paymentEvent.create({
        data: {
          paymentId: payment.paymentId,
          eventType: "MPESA_PAYMENT_UNMATCHED",
          newStatus: "UNMATCHED",
          details: `Unmatched customer reference ${data.customerReference}`,
          performedBy: uid(req),
        },
      });
      res.status(201).json(payment);
    } catch (e: any) {
      if (e.code === "P2002")
        return res
          .status(409)
          .json({ error: "M-Pesa transaction reference already exists" });
      next(e);
    }
  },
);

paymentsRouter.patch("/:id/allocate", checker, async (req, res, next) => {
  const paymentId = parse(id, req.params.id, res);
  const data = parse(
    z.object({ accountId: id, reason: z.string().trim().min(5).max(1000) }),
    req.body,
    res,
  );
  if (!paymentId || !data) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { paymentId } });
      if (!payment || payment.paymentStatus !== "RECEIVED")
        throw Object.assign(
          new Error("Only received unmatched payments can be allocated"),
          { status: 409 },
        );
      const allocation = await allocate(tx, payment, data.accountId, uid(req));
      await tx.suspensePayment.updateMany({
        where: { paymentId },
        data: {
          status: "RESOLVED",
          resolvedAccountId: data.accountId,
          resolvedBy: uid(req),
          resolutionDate: new Date(),
        },
      });
      const receipt = await tx.receipt.create({
        data: {
          receiptNumber: `RCT-${new Date().getFullYear()}-${String(payment.paymentId).padStart(6, "0")}`,
          paymentId,
          accountId: data.accountId,
          amount: payment.amount,
          issuedBy: uid(req),
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId,
          eventType: "UNMATCHED_PAYMENT_ALLOCATED",
          previousStatus: "UNMATCHED",
          newStatus: allocation.matchingStatus,
          details: data.reason,
          performedBy: uid(req),
        },
      });
      return { ...allocation, receiptId: receipt.receiptId };
    });
    res.json(result);
  } catch (e: any) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

paymentsRouter.get("/receipts/:id", async (req, res, next) => {
  const receiptId = parse(id, req.params.id, res);
  if (!receiptId) return;
  try {
    const receipt = await prisma.receipt.findUnique({
      where: { receiptId },
      include: {
        payment: { include: paymentInclude },
        account: { include: { customer: true } },
        issuer: true,
      },
    });
    if (!receipt) return res.status(404).json({ error: "Receipt not found" });
    res.json({ ...receipt, customerName: name(receipt.account?.customer) });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.get("/reversals/list", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    res.json(
      await prisma.paymentReversal.findMany({
        where: status ? { status } : undefined,
        include: {
          payment: { include: paymentInclude },
          requester: true,
          approver: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (e) {
    next(e);
  }
});
paymentsRouter.post("/reversals", staff, async (req, res, next) => {
  const data = parse(
    z.object({
      paymentId: id,
      reversalReason: z.string().trim().min(3),
      detailedExplanation: z.string().trim().min(5).max(2000),
      supportingFileName: z.string().max(255).optional(),
      supportingContent: z.string().max(6_000_000).optional(),
    }),
    req.body,
    res,
  );
  if (!data) return;
  try {
    const payment = await prisma.payment.findUnique({
      where: { paymentId: data.paymentId },
    });
    if (!payment || payment.paymentStatus !== "POSTED")
      return res
        .status(409)
        .json({ error: "Only posted payments can be reversed" });
    if (
      await prisma.paymentReversal.findFirst({
        where: { paymentId: data.paymentId, status: "PENDING" },
      })
    )
      return res
        .status(409)
        .json({ error: "A reversal request is already pending" });
    const reversal = await prisma.paymentReversal.create({
      data: {
        ...data,
        reversalReference: `REV-${Date.now()}-${String(data.paymentId).slice(-4)}`,
        reversalAmount: payment.amount,
        requestedBy: uid(req)!,
      },
    });
    await prisma.paymentEvent.create({
      data: {
        paymentId: data.paymentId,
        reversalId: reversal.reversalId,
        eventType: "REVERSAL_REQUESTED",
        newStatus: "PENDING",
        details: data.detailedExplanation,
        performedBy: uid(req),
      },
    });
    res.status(201).json(reversal);
  } catch (e) {
    next(e);
  }
});
paymentsRouter.patch(
  "/reversals/:id/decision",
  checker,
  async (req, res, next) => {
    const reversalId = parse(id, req.params.id, res);
    const data = parse(
      z.object({
        decision: z.enum(["APPROVE", "REJECT"]),
        comments: z.string().trim().min(3).max(2000),
      }),
      req.body,
      res,
    );
    if (!reversalId || !data) return;
    try {
      const reversal = await prisma.paymentReversal.findUnique({
        where: { reversalId },
        include: { payment: { include: { allocations: true } } },
      });
      if (!reversal || reversal.status !== "PENDING")
        return res
          .status(409)
          .json({ error: "Only pending reversals can be decided" });
      if (reversal.requestedBy === uid(req) && !isSystemAdmin(req))
        return res
          .status(403)
          .json({
            error:
              "Maker-checker control: the requester cannot approve their own reversal",
          });
      if (data.decision === "REJECT") {
        await prisma.paymentReversal.update({
          where: { reversalId },
          data: {
            status: "REJECTED",
            approvedBy: uid(req),
            decidedAt: new Date(),
            decisionComments: data.comments,
          },
        });
        return res.json({ status: "REJECTED" });
      }
      await prisma.$transaction(async (tx) => {
        for (const allocation of reversal.payment.allocations) {
          const bill = await tx.bill.findUniqueOrThrow({
            where: { billId: allocation.billId },
          });
          const paid = Math.max(
            0,
            round(Number(bill.paidAmount) - Number(allocation.allocatedAmount)),
          );
          await tx.bill.update({
            where: { billId: bill.billId },
            data: {
              paidAmount: paid,
              status: paid <= 0 ? "POSTED" : "PARTIALLY_PAID",
              updatedAt: new Date(),
            },
          });
        }
        await tx.$executeRaw`UPDATE aquaflow.payment_allocations SET status = 'REVERSED' WHERE payment_id = ${reversal.paymentId}`;
        if (reversal.payment.accountId)
          await tx.customerAccount.update({
            where: { accountId: reversal.payment.accountId },
            data: {
              currentBalance: { increment: reversal.payment.amount },
              updatedAt: new Date(),
            },
          });
        await tx.payment.update({
          where: { paymentId: reversal.paymentId },
          data: {
            paymentStatus: "REVERSED",
            unallocatedAmount: 0,
            updatedAt: new Date(),
          },
        });
        await tx.receipt.updateMany({
          where: { paymentId: reversal.paymentId },
          data: { receiptStatus: "REVERSED" },
        });
        await tx.paymentReversal.update({
          where: { reversalId },
          data: {
            status: "POSTED",
            approvedBy: uid(req),
            decidedAt: new Date(),
            decisionComments: data.comments,
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: reversal.paymentId,
            reversalId,
            eventType: "PAYMENT_REVERSED",
            previousStatus: "POSTED",
            newStatus: "REVERSED",
            details: data.comments,
            performedBy: uid(req),
          },
        });
      });
      res.json({ status: "POSTED" });
    } catch (e) {
      next(e);
    }
  },
);

paymentsRouter.get("/reconciliation/batches", async (_req, res, next) => {
  try {
    res.json(
      await prisma.paymentReconciliationBatch.findMany({
        include: { channel: true, creator: true, completer: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (e) {
    next(e);
  }
});
paymentsRouter.post(
  "/reconciliation/batches",
  checker,
  async (req, res, next) => {
    const data = parse(
      z.object({
        channelId: id,
        periodStart: z.string().min(10),
        periodEnd: z.string().min(10),
        statementTotal: z.coerce.number().nonnegative(),
        statementFileName: z.string().max(255).optional(),
        remarks: z.string().max(1000).optional(),
      }),
      req.body,
      res,
    );
    if (!data) return;
    try {
      const start = day(data.periodStart),
        end = new Date(`${data.periodEnd}T23:59:59.999Z`);
      const aggregate = await prisma.payment.aggregate({
        where: {
          channelId: data.channelId,
          paymentStatus: "POSTED",
          paymentDate: { gte: start, lte: end },
        },
        _sum: { amount: true },
      });
      const systemTotal = round(Number(aggregate._sum.amount ?? 0)),
        matchedAmount = round(Math.min(systemTotal, data.statementTotal)),
        variance = round(data.statementTotal - systemTotal),
        status = Math.abs(variance) < 0.01 ? "RECONCILED" : "REVIEW_REQUIRED";
      const batch = await prisma.paymentReconciliationBatch.create({
        data: {
          batchReference: `REC-${Date.now()}`,
          channelId: data.channelId,
          periodStart: start,
          periodEnd: day(data.periodEnd),
          statementTotal: data.statementTotal,
          systemTotal,
          matchedAmount,
          variance,
          statementFileName: data.statementFileName,
          remarks: data.remarks,
          status,
          createdBy: uid(req),
          ...(status === "RECONCILED"
            ? { completedBy: uid(req), completedAt: new Date() }
            : {}),
        },
      });
      await prisma.paymentEvent.create({
        data: {
          eventType: "RECONCILIATION_CREATED",
          newStatus: status,
          details: `${batch.batchReference}; variance KSh ${variance.toFixed(2)}`,
          performedBy: uid(req),
        },
      });
      res.status(201).json(batch);
    } catch (e) {
      next(e);
    }
  },
);

paymentsRouter.get("/dashboard/summary", async (req, res, next) => {
  try {
    const from = req.query.from
        ? day(String(req.query.from))
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      to = req.query.to
        ? new Date(`${req.query.to}T23:59:59.999Z`)
        : new Date("9999-12-31T23:59:59.999Z");
    const payments = await prisma.payment.findMany({
      where: { paymentDate: { gte: from, lte: to } },
      include: paymentInclude,
      orderBy: { paymentDate: "desc" },
    });
    const valid = payments.filter((p: any) => p.paymentStatus === "POSTED");
    const channels: Record<string, number> = {};
    valid.forEach(
      (p: any) =>
        (channels[p.channel.channelName] = round(
          (channels[p.channel.channelName] ?? 0) + Number(p.amount),
        )),
    );
    res.json({
      total: round(
        valid.reduce((s: number, p: any) => s + Number(p.amount), 0),
      ),
      channels,
      payments: valid.length,
      unmatched: payments.filter(
        (p: any) =>
          p.paymentStatus !== "REVERSED" && p.matchingStatus === "UNMATCHED",
      ).length,
      pendingReversals: await prisma.paymentReversal.count({
        where: { status: "PENDING" },
      }),
      receipts: await prisma.receipt.count({
        where: { issueDate: { gte: from, lte: to } },
      }),
      recent: payments
        .slice(0, 10)
        .map((p: any) => ({
          ...p,
          customerName: name(p.account?.customer),
        })),
    });
  } catch (e) {
    next(e);
  }
});
paymentsRouter.get("/audit/events", async (req, res, next) => {
  try {
    res.json(
      await prisma.paymentEvent.findMany({
        include: { payment: true, reversal: true, performer: true },
        orderBy: { createdAt: "desc" },
        take: 3000,
      }),
    );
  } catch (e) {
    next(e);
  }
});
