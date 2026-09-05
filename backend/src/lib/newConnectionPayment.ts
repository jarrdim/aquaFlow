import { Prisma } from "@prisma/client";
import { roundMoney } from "./paymentAllocation";

export function newConnectionPaymentState(quotationTotal: unknown, amountPaid: unknown, paymentAmount: number) {
  const paidAmount = roundMoney(Number(amountPaid) + paymentAmount);
  return {
    paidAmount,
    status: paidAmount >= Number(quotationTotal) ? "PAID" : "PARTIALLY_PAID",
  };
}

export async function postOfflineNewConnectionPayment(
  tx: Prisma.TransactionClient,
  input: {
    applicationId: bigint;
    applicationNumber: string;
    accountId: bigint | null;
    quotationTotal: unknown;
    amountPaid: unknown;
    amount: number;
    reference: string;
    paymentMethod?: "CASH" | "BANK";
    actor: bigint;
    channelId: bigint;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const paymentLabel = input.paymentMethod === "BANK" ? "Bank direct" : "Cash";
  const next = newConnectionPaymentState(input.quotationTotal, input.amountPaid, input.amount);
  const payment = await tx.payment.create({
    data: {
      transactionReference: input.reference,
      accountId: input.accountId,
      channelId: input.channelId,
      amount: input.amount,
      paymentDate: now,
      valueDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      customerReference: input.applicationNumber,
      paymentType: "NEW_CONNECTION_FEE",
      remarks: `${paymentLabel} new connection payment for ${input.applicationNumber}`,
      matchingStatus: "MATCHED",
      paymentStatus: "POSTED",
      unallocatedAmount: 0,
      postedAt: now,
      receivedBy: input.actor,
    },
  });
  const receipt = await tx.receipt.create({
    data: {
      receiptNumber: `RCT-${now.getUTCFullYear()}-${String(payment.paymentId).padStart(6, "0")}`,
      paymentId: payment.paymentId,
      accountId: input.accountId,
      amount: input.amount,
      issueDate: now,
      issuedBy: input.actor,
    },
  });
  await tx.newConnectionApplication.update({
    where: { connectionApplicationId: input.applicationId },
    data: {
      amountPaid: next.paidAmount,
      paymentReference: input.reference,
      status: next.status,
      updatedAt: now,
    },
  });
  await tx.newConnectionActivity.create({
    data: {
      connectionApplicationId: input.applicationId,
      activityType: "RECORD_PAYMENT",
      notes: `${paymentLabel} payment ${input.reference}: KSh ${input.amount.toFixed(2)}; receipt ${receipt.receiptNumber}`,
      performedBy: input.actor,
    },
  });
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.paymentId,
      eventType: "NEW_CONNECTION_PAYMENT_POSTED",
      previousStatus: "RECEIVED",
      newStatus: "POSTED",
      details: `${paymentLabel} payment for ${input.applicationNumber}; receipt ${receipt.receiptNumber}`,
      performedBy: input.actor,
      metadata: { paymentMethod: input.paymentMethod ?? "CASH" },
    },
  });
  return { payment, receipt, ...next };
}

export async function applyExistingC2bNewConnectionPayment(
  tx: Prisma.TransactionClient,
  input: {
    applicationId: bigint;
    applicationNumber: string;
    quotationTotal: unknown;
    amountPaid: unknown;
    paymentId: bigint;
    transactionReference: string;
    amount: number;
    actor: bigint;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const next = newConnectionPaymentState(input.quotationTotal, input.amountPaid, input.amount);
  const payment = await tx.payment.update({
    where: { paymentId: input.paymentId },
    data: {
      customerReference: input.applicationNumber,
      paymentType: "NEW_CONNECTION_FEE",
      matchingStatus: "MATCHED",
      paymentStatus: "POSTED",
      unallocatedAmount: 0,
      postedAt: now,
      remarks: `M-Pesa PayBill C2B new connection payment for ${input.applicationNumber}`,
      updatedAt: now,
    },
  });
  const receipt = await tx.receipt.create({
    data: {
      receiptNumber: `RCT-${now.getUTCFullYear()}-${String(input.paymentId).padStart(6, "0")}`,
      paymentId: input.paymentId,
      accountId: null,
      amount: input.amount,
      issueDate: now,
      issuedBy: input.actor,
    },
  });
  await tx.suspensePayment.updateMany({
    where: { paymentId: input.paymentId, status: "OPEN" },
    data: { status: "RESOLVED", resolvedBy: input.actor, resolutionDate: now },
  });
  await tx.newConnectionApplication.update({
    where: { connectionApplicationId: input.applicationId },
    data: {
      amountPaid: next.paidAmount,
      paymentReference: input.transactionReference,
      status: next.status,
      updatedAt: now,
    },
  });
  await tx.newConnectionActivity.create({
    data: {
      connectionApplicationId: input.applicationId,
      activityType: "C2B_PAYMENT",
      notes: `C2B payment ${input.transactionReference}: KSh ${input.amount.toFixed(2)}; receipt ${receipt.receiptNumber}`,
      performedBy: input.actor,
    },
  });
  await tx.paymentEvent.create({
    data: {
      paymentId: input.paymentId,
      eventType: "MPESA_C2B_NEW_CONNECTION_PAYMENT_POSTED",
      previousStatus: "UNMATCHED",
      newStatus: "POSTED",
      details: `C2B payment applied to ${input.applicationNumber}; receipt ${receipt.receiptNumber}`,
      performedBy: input.actor,
      metadata: { connectionApplicationId: input.applicationId.toString() },
    },
  });
  return { payment, receipt, ...next };
}
