import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isSystemAdmin, requireAuth, requireRole } from "../middleware/auth";
import { createPaymentLinkToken, publicAppUrl } from "../lib/paymentLink";
import { processOne } from "./notifications";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const manager = requireRole("SYSTEM_ADMIN", "BILLING_OFFICER", "BILLING_SUPERVISOR", "FINANCE_MANAGER");
const approver = requireRole("SYSTEM_ADMIN", "BILLING_SUPERVISOR", "FINANCE_MANAGER");
const id = z.coerce.bigint().positive();
const dayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.coerce.number().min(0).max(999_999_999);
const itemSchema = z.object({
  description: z.string().trim().min(2).max(500),
  quantity: z.coerce.number().positive().max(999_999),
  unitPrice: money,
  taxRate: z.coerce.number().min(0).max(100),
});
const invoiceSchema = z.object({
  accountId: id,
  invoiceDate: dayText,
  dueDate: dayText,
  customerReference: z.string().trim().max(120).optional(),
  discountAmount: money,
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  notifyOnIssue: z.boolean().default(false),
  notificationChannels: z.array(z.enum(["SMS", "EMAIL"])).min(1).max(2).default(["SMS"]),
  items: z.array(itemSchema).min(1).max(100),
}).refine((value) => value.dueDate >= value.invoiceDate, {
  path: ["dueDate"],
  message: "Due date must be on or after invoice date",
});

const invoiceInclude = {
  account: { include: { customer: true, category: true, property: true } },
  items: { orderBy: { sortOrder: "asc" as const } },
  payments: {
    include: { payment: { include: { channel: true, receipt: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  events: { orderBy: { createdAt: "desc" as const } },
} as const;

function actor(req: any) {
  return req.user?.userId ? BigInt(req.user.userId) : null;
}
function asDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function customerName(customer: any) {
  return customer?.organizationName || [customer?.firstName, customer?.middleName, customer?.lastName].filter(Boolean).join(" ") || customer?.customerNumber || "Customer";
}
function invoiceMoney(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function invoiceDate(value: Date) {
  return value.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" });
}
async function sendInvoiceNotifications(invoiceId: bigint, channels: Array<"SMS" | "EMAIL">, requestedBy: bigint | null) {
  const invoice = await prisma.manualInvoice.findUnique({
    where: { invoiceId },
    include: { account: { include: { customer: true } } },
  });
  if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
  if (!["ISSUED", "PARTIALLY_PAID", "PAID"].includes(invoice.status)) {
    throw Object.assign(new Error("Notifications can only be sent for an issued invoice"), { status: 409 });
  }
  const expiresAt = new Date(Math.max(invoice.dueDate.getTime() + 30 * 86_400_000, Date.now() + 14 * 86_400_000));
  const token = createPaymentLinkToken({ accountId: invoice.accountId.toString(), expiresAt: expiresAt.toISOString() });
  const paymentUrl = `${publicAppUrl()}/pay/${token}`;
  const name = customerName(invoice.account.customer);
  const message = `Dear ${name}, invoice ${invoice.invoiceNumber} for KSh ${invoiceMoney(invoice.totalAmount)} has been issued for account ${invoice.account.accountNumber}. Balance due: KSh ${invoiceMoney(invoice.balanceAmount)} by ${invoiceDate(invoice.dueDate)}. Pay securely: ${paymentUrl}. Thank you.`;
  const created: any[] = [];
  const skipped: Array<{ channel: string; reason: string }> = [];
  for (const channel of [...new Set(channels)]) {
    const recipient = channel === "SMS" ? invoice.account.customer.phoneNumber : invoice.account.customer.emailAddress;
    if (!recipient) {
      skipped.push({ channel, reason: `Customer has no ${channel === "SMS" ? "phone number" : "email address"}.` });
      continue;
    }
    const notification = await prisma.notification.create({ data: {
      customerId: invoice.account.customerId,
      accountId: invoice.accountId,
      notificationType: "INVOICE_ISSUED",
      channel,
      recipient,
      subject: channel === "EMAIL" ? `Invoice ${invoice.invoiceNumber}` : undefined,
      messageBody: message,
      requestedBy,
      metadata: { targetType: "MANUAL_INVOICE", targetId: invoice.invoiceId.toString(), invoiceNumber: invoice.invoiceNumber },
    } });
    const processed = await processOne(notification.notificationId);
    created.push(processed);
    if (processed?.deliveryStatus === "FAILED") {
      skipped.push({
        channel,
        reason: processed.failureReason || `${channel} delivery failed.`,
      });
    }
  }
  const sent = created.filter((entry) => entry && ["SENT", "DELIVERED"].includes(entry.deliveryStatus)).length;
  await prisma.manualInvoiceEvent.create({ data: {
    invoiceId,
    eventType: "INVOICE_NOTIFICATION_SENT",
    details: `${sent} sent; ${skipped.length} failed or skipped; channels: ${channels.join(", ")}`,
    performedBy: requestedBy,
  } });
  return { created, skipped };
}
function parse<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  res: any,
): z.output<T> | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return undefined;
  }
  return result.data;
}
function totals(data: z.infer<typeof invoiceSchema>) {
  const items = data.items.map((item, index) => {
    const lineSubtotal = round(item.quantity * item.unitPrice);
    const taxRate = Number(item.taxRate ?? 0);
    const taxAmount = round(lineSubtotal * taxRate / 100);
    return { ...item, taxRate, lineSubtotal, taxAmount, lineTotal: round(lineSubtotal + taxAmount), sortOrder: index };
  });
  const subtotal = round(items.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const taxAmount = round(items.reduce((sum, item) => sum + item.taxAmount, 0));
  const gross = round(subtotal + taxAmount);
  if (data.discountAmount > gross) throw Object.assign(new Error("Discount cannot exceed the invoice gross amount"), { status: 400 });
  const totalAmount = round(gross - data.discountAmount);
  if (totalAmount <= 0) throw Object.assign(new Error("Invoice total must be greater than zero"), { status: 400 });
  return { items, subtotal, taxAmount, totalAmount };
}

invoicesRouter.get("/", manager, async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const search = String(req.query.search ?? "").trim();
    const where: Prisma.ManualInvoiceWhereInput = {
      ...(status ? { status } : {}),
      ...(search ? { OR: [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { customerReference: { contains: search, mode: "insensitive" } },
        { account: { accountNumber: { contains: search, mode: "insensitive" } } },
        { account: { customer: { firstName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { lastName: { contains: search, mode: "insensitive" } } } },
        { account: { customer: { organizationName: { contains: search, mode: "insensitive" } } } },
      ] } : {}),
    };
    res.json(await prisma.manualInvoice.findMany({ where, include: invoiceInclude, orderBy: [{ invoiceDate: "desc" }, { invoiceId: "desc" }], take: 2000 }));
  } catch (error) { next(error); }
});

invoicesRouter.get("/:id", manager, async (req, res, next) => {
  const invoiceId = parse(id, req.params.id, res);
  if (!invoiceId) return;
  try {
    const invoice = await prisma.manualInvoice.findUnique({ where: { invoiceId }, include: invoiceInclude });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (error) { next(error); }
});

invoicesRouter.post("/", manager, async (req, res, next) => {
  const data = parse(invoiceSchema, req.body, res);
  if (!data) return;
  try {
    const account = await prisma.customerAccount.findUnique({ where: { accountId: data.accountId } });
    if (!account) return res.status(404).json({ error: "Customer account not found" });
    const calculated = totals(data);
    const created = await prisma.$transaction(async (tx) => {
      const draft = await tx.manualInvoice.create({
        data: {
          invoiceNumber: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          accountId: data.accountId,
          invoiceDate: asDay(data.invoiceDate),
          dueDate: asDay(data.dueDate),
          subtotal: calculated.subtotal,
          discountAmount: data.discountAmount,
          taxAmount: calculated.taxAmount,
          totalAmount: calculated.totalAmount,
          balanceAmount: calculated.totalAmount,
          customerReference: data.customerReference || undefined,
          notes: data.notes || undefined,
          terms: data.terms || undefined,
          notifyOnIssue: data.notifyOnIssue,
          notificationChannels: data.notificationChannels,
          createdBy: actor(req),
          items: { create: calculated.items },
        },
      });
      const invoiceNumber = `INV-${data.invoiceDate.slice(0, 4)}-${String(draft.invoiceId).padStart(6, "0")}`;
      await tx.manualInvoiceEvent.create({ data: { invoiceId: draft.invoiceId, eventType: "INVOICE_CREATED", newStatus: "DRAFT", details: `Draft ${invoiceNumber} created`, performedBy: actor(req) } });
      return tx.manualInvoice.update({ where: { invoiceId: draft.invoiceId }, data: { invoiceNumber }, include: invoiceInclude });
    });
    res.status(201).json(created);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

invoicesRouter.post("/:id/approve", approver, async (req, res, next) => {
  const invoiceId = parse(id, req.params.id, res);
  if (!invoiceId) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT invoice_id FROM aquaflow.manual_invoices WHERE invoice_id = ${invoiceId} FOR UPDATE`);
      const invoice = await tx.manualInvoice.findUnique({ where: { invoiceId } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (invoice.status !== "DRAFT") throw Object.assign(new Error("Only a draft invoice can be approved"), { status: 409 });
      if (invoice.createdBy === actor(req) && !isSystemAdmin(req)) throw Object.assign(new Error("Maker-checker control: the invoice creator cannot approve their own invoice"), { status: 403 });
      const updated = await tx.manualInvoice.update({ where: { invoiceId }, data: { status: "APPROVED", approvedBy: actor(req), approvedAt: new Date() }, include: invoiceInclude });
      await tx.manualInvoiceEvent.create({ data: { invoiceId, eventType: "INVOICE_APPROVED", previousStatus: "DRAFT", newStatus: "APPROVED", performedBy: actor(req) } });
      return updated;
    });
    res.json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

invoicesRouter.post("/:id/issue", manager, async (req, res, next) => {
  const invoiceId = parse(id, req.params.id, res);
  if (!invoiceId) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT invoice_id FROM aquaflow.manual_invoices WHERE invoice_id = ${invoiceId} FOR UPDATE`);
      const invoice = await tx.manualInvoice.findUnique({ where: { invoiceId } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (invoice.status !== "APPROVED") throw Object.assign(new Error("Only an approved invoice can be issued"), { status: 409 });
      const updated = await tx.manualInvoice.update({ where: { invoiceId }, data: { status: "ISSUED", issuedBy: actor(req), issuedAt: new Date() }, include: invoiceInclude });
      await tx.customerAccount.update({ where: { accountId: invoice.accountId }, data: { currentBalance: { increment: Number(invoice.totalAmount) }, updatedAt: new Date() } });
      await tx.manualInvoiceEvent.create({ data: { invoiceId, eventType: "INVOICE_ISSUED", previousStatus: "APPROVED", newStatus: "ISSUED", performedBy: actor(req) } });
      return updated;
    });
    const channels = Array.isArray(result.notificationChannels)
      ? result.notificationChannels.filter((value): value is "SMS" | "EMAIL" => value === "SMS" || value === "EMAIL")
      : [];
    let notificationResult = null;
    if (result.notifyOnIssue && channels.length) {
      try {
        notificationResult = await sendInvoiceNotifications(invoiceId, channels, actor(req));
      } catch (error: any) {
        notificationResult = { created: [], skipped: channels.map((channel) => ({ channel, reason: error.message ?? "Notification could not be sent." })) };
      }
    }
    res.json({ ...result, notificationResult });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

invoicesRouter.post("/:id/notifications", manager, async (req, res, next) => {
  const invoiceId = parse(id, req.params.id, res);
  const data = parse(z.object({ channels: z.array(z.enum(["SMS", "EMAIL"])).min(1).max(2) }), req.body, res);
  if (!invoiceId || !data) return;
  try {
    const result = await sendInvoiceNotifications(invoiceId, data.channels, actor(req));
    if (!result.created.length) return res.status(409).json({ error: result.skipped.map((item) => item.reason).join(" "), ...result });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

invoicesRouter.post("/:id/cancel", manager, async (req, res, next) => {
  const invoiceId = parse(id, req.params.id, res);
  const data = parse(z.object({ reason: z.string().trim().min(3).max(1000) }), req.body, res);
  if (!invoiceId || !data) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT invoice_id FROM aquaflow.manual_invoices WHERE invoice_id = ${invoiceId} FOR UPDATE`);
      const invoice = await tx.manualInvoice.findUnique({ where: { invoiceId } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (!["DRAFT", "APPROVED", "ISSUED"].includes(invoice.status) || Number(invoice.paidAmount) > 0) throw Object.assign(new Error("Only an unpaid draft, approved or issued invoice can be cancelled"), { status: 409 });
      const updated = await tx.manualInvoice.update({ where: { invoiceId }, data: { status: "CANCELLED", cancelledBy: actor(req), cancelledAt: new Date(), cancellationReason: data.reason }, include: invoiceInclude });
      if (invoice.status === "ISSUED") await tx.customerAccount.update({ where: { accountId: invoice.accountId }, data: { currentBalance: { decrement: Number(invoice.totalAmount) }, updatedAt: new Date() } });
      await tx.manualInvoiceEvent.create({ data: { invoiceId, eventType: "INVOICE_CANCELLED", previousStatus: invoice.status, newStatus: "CANCELLED", details: data.reason, performedBy: actor(req) } });
      return updated;
    });
    res.json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

invoicesRouter.post("/:id/payments", manager, async (req, res, next) => {
  const invoiceId = parse(id, req.params.id, res);
  const data = parse(z.object({
    channelId: id,
    amount: z.coerce.number().positive().max(999_999_999),
    transactionReference: z.string().trim().min(2).max(100),
    paymentDate: dayText,
  }), req.body, res);
  if (!invoiceId || !data) return;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT invoice_id FROM aquaflow.manual_invoices WHERE invoice_id = ${invoiceId} FOR UPDATE`);
      const invoice = await tx.manualInvoice.findUnique({ where: { invoiceId }, include: { account: true } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (!["ISSUED", "PARTIALLY_PAID"].includes(invoice.status)) throw Object.assign(new Error("Only an issued invoice with a balance can receive payment"), { status: 409 });
      if (data.amount > Number(invoice.balanceAmount) + 0.009) throw Object.assign(new Error(`Payment cannot exceed the invoice balance of KSh ${Number(invoice.balanceAmount).toFixed(2)}`), { status: 409 });
      const channel = await tx.paymentChannel.findUnique({ where: { channelId: data.channelId } });
      if (!channel || channel.status !== "ACTIVE") throw Object.assign(new Error("Select an active payment channel"), { status: 400 });
      const payment = await tx.payment.create({ data: {
        transactionReference: data.transactionReference,
        accountId: invoice.accountId,
        channelId: data.channelId,
        amount: data.amount,
        paymentDate: asDay(data.paymentDate),
        valueDate: asDay(data.paymentDate),
        customerReference: invoice.account.accountNumber,
        matchingStatus: "MATCHED",
        paymentStatus: "POSTED",
        paymentType: "INVOICE_PAYMENT",
        remarks: `Payment for ${invoice.invoiceNumber}`,
        unallocatedAmount: 0,
        postedAt: new Date(),
        receivedBy: actor(req),
      } });
      const receipt = await tx.receipt.create({ data: { receiptNumber: `RCT-${data.paymentDate.slice(0, 4)}-${String(payment.paymentId).padStart(6, "0")}`, paymentId: payment.paymentId, accountId: invoice.accountId, amount: data.amount, issueDate: asDay(data.paymentDate), issuedBy: actor(req) } });
      await tx.manualInvoicePayment.create({ data: { invoiceId, paymentId: payment.paymentId, amount: data.amount } });
      await tx.customerAccount.update({ where: { accountId: invoice.accountId }, data: { currentBalance: { decrement: data.amount }, updatedAt: new Date() } });
      const paidAmount = round(Number(invoice.paidAmount) + data.amount);
      const balanceAmount = round(Number(invoice.totalAmount) - paidAmount);
      const status = balanceAmount <= 0 ? "PAID" : "PARTIALLY_PAID";
      await tx.manualInvoice.update({ where: { invoiceId }, data: { paidAmount, balanceAmount, status } });
      await tx.manualInvoiceEvent.create({ data: { invoiceId, eventType: "PAYMENT_POSTED", previousStatus: invoice.status, newStatus: status, details: `${receipt.receiptNumber}; KSh ${data.amount.toFixed(2)}`, performedBy: actor(req) } });
      await tx.paymentEvent.create({ data: { paymentId: payment.paymentId, eventType: "INVOICE_PAYMENT_POSTED", previousStatus: "RECEIVED", newStatus: "POSTED", details: `Payment for ${invoice.invoiceNumber}; receipt ${receipt.receiptNumber}`, performedBy: actor(req), metadata: { invoiceId: String(invoiceId), invoiceNumber: invoice.invoiceNumber } } });
      return { invoice: await tx.manualInvoice.findUnique({ where: { invoiceId }, include: invoiceInclude }), receipt };
    });
    res.status(201).json(result);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === "P2002") return res.status(409).json({ error: "This payment reference already exists" });
    next(error);
  }
});
