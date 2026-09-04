import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExistingC2bNewConnectionPayment,
  postOfflineNewConnectionPayment,
} from "./newConnectionPayment";

test("KSh 15,000 offline new-connection payment creates payment, receipt, event, and paid application", async () => {
  const calls: Record<string, any>[] = [];
  const tx = {
    payment: { create: async (args: any) => {
      calls.push({ operation: "payment.create", args });
      return { paymentId: 41n, ...args.data };
    } },
    receipt: { create: async (args: any) => {
      calls.push({ operation: "receipt.create", args });
      return { receiptId: 51n, ...args.data };
    } },
    newConnectionApplication: { update: async (args: any) => {
      calls.push({ operation: "application.update", args });
      return args.data;
    } },
    newConnectionActivity: { create: async (args: any) => {
      calls.push({ operation: "activity.create", args });
      return args.data;
    } },
    paymentEvent: { create: async (args: any) => {
      calls.push({ operation: "event.create", args });
      return args.data;
    } },
  };
  const now = new Date("2026-09-04T08:00:00.000Z");
  const result = await postOfflineNewConnectionPayment(tx as any, {
    applicationId: 10n,
    applicationNumber: "NC-2026-00010",
    accountId: null,
    quotationTotal: 15_000,
    amountPaid: 0,
    amount: 15_000,
    reference: "CASH-NC-00010",
    actor: 2n,
    channelId: 3n,
    now,
  });

  assert.equal(result.status, "PAID");
  assert.equal(result.paidAmount, 15_000);
  assert.equal(result.receipt.receiptNumber, "RCT-2026-000041");
  assert.deepEqual(calls.map((call) => call.operation), [
    "payment.create",
    "receipt.create",
    "application.update",
    "activity.create",
    "event.create",
  ]);
  assert.equal(calls[0].args.data.paymentType, "NEW_CONNECTION_FEE");
  assert.equal(calls[0].args.data.paymentStatus, "POSTED");
  assert.equal(calls[0].args.data.matchingStatus, "MATCHED");
  assert.equal(calls[1].args.data.amount, 15_000);
  assert.equal(calls[2].args.data.status, "PAID");
});

test("offline new-connection persistence stops before application update when receipt creation fails", async () => {
  let applicationUpdated = false;
  const tx = {
    payment: { create: async () => ({ paymentId: 41n }) },
    receipt: { create: async () => { throw new Error("receipt failed"); } },
    newConnectionApplication: { update: async () => { applicationUpdated = true; } },
  };
  await assert.rejects(() => postOfflineNewConnectionPayment(tx as any, {
    applicationId: 10n,
    applicationNumber: "NC-2026-00010",
    accountId: null,
    quotationTotal: 15_000,
    amountPaid: 0,
    amount: 15_000,
    reference: "CASH-NC-00010",
    actor: 2n,
    channelId: 3n,
  }), /receipt failed/);
  assert.equal(applicationUpdated, false);
});

test("an unmatched C2B payment is posted, receipted, removed from suspense, and applied to a connection", async () => {
  const calls: Record<string, any>[] = [];
  const operation = (name: string, result: Record<string, unknown> = {}) => async (args: any) => {
    calls.push({ operation: name, args });
    return { ...result, ...args.data };
  };
  const tx = {
    payment: { update: operation("payment.update", { paymentId: 72n }) },
    receipt: { create: operation("receipt.create", { receiptId: 82n }) },
    suspensePayment: { updateMany: operation("suspense.updateMany") },
    newConnectionApplication: { update: operation("application.update") },
    newConnectionActivity: { create: operation("activity.create") },
    paymentEvent: { create: operation("event.create") },
  };
  const result = await applyExistingC2bNewConnectionPayment(tx as any, {
    applicationId: 20n,
    applicationNumber: "NC-2026-00020",
    quotationTotal: 12_000,
    amountPaid: 1_000,
    paymentId: 72n,
    transactionReference: "UI3AB59S7S",
    amount: 5_000,
    actor: 2n,
    now: new Date("2026-09-04T12:00:00.000Z"),
  });

  assert.equal(result.status, "PARTIALLY_PAID");
  assert.equal(result.paidAmount, 6_000);
  assert.deepEqual(calls.map((call) => call.operation), [
    "payment.update",
    "receipt.create",
    "suspense.updateMany",
    "application.update",
    "activity.create",
    "event.create",
  ]);
  assert.equal(calls[0].args.data.paymentType, "NEW_CONNECTION_FEE");
  assert.equal(calls[0].args.data.matchingStatus, "MATCHED");
  assert.equal(calls[0].args.data.paymentStatus, "POSTED");
  assert.equal(calls[2].args.data.status, "RESOLVED");
  assert.equal(calls[3].args.data.amountPaid, 6_000);
  assert.equal(calls[5].args.data.eventType, "MPESA_C2B_NEW_CONNECTION_PAYMENT_POSTED");
});
