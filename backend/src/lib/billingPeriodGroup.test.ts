import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateBillingGroupStatus,
  billingCompletionStatus,
  billingCycleLabel,
  billingCycleType,
  billingPeriodGroupIdentity,
  ensureBillingPeriodGroup,
  hasPostingEvidence,
  isEligibleApprovedBill,
  isFinalBillNotificationEligible,
  notificationRequiresPostedBill,
  summarizeBillStatuses,
} from "./billingPeriodGroup";

test("billing period labels concatenate cycle code and cycle name with safe fallbacks", () => {
  assert.equal(billingCycleLabel({ cycleCode: "BC-2026-12", cycleName: "Late readings" }), "BC-2026-12 · Late readings");
  assert.equal(billingCycleLabel({ cycleCode: "BC-2026-12", cycleName: "" }), "BC-2026-12");
  assert.equal(billingCycleLabel({ cycleCode: "", cycleName: "December billing" }), "December billing");
  assert.equal(billingCycleLabel(null), "-");
});

test("billing periods are grouped by the month in which payment is due", () => {
  assert.deepEqual(billingPeriodGroupIdentity(new Date("2026-09-10T00:00:00.000Z")), {
    groupCode: "BPG-2026-09",
    groupName: "September 2026 Billing",
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-30T00:00:00.000Z"),
  });
});

test("billing cycle types distinguish replacements and late readings", () => {
  assert.equal(billingCycleType("MR-15"), "METER_REPLACEMENT");
  assert.equal(billingCycleType("BC-2026-08-LATE"), "LATE_READING");
  assert.equal(billingCycleType("BC-2026-09"), "ROUTINE");
});

test("a group exposes its most actionable member status", () => {
  assert.equal(aggregateBillingGroupStatus(["POSTED", "POSTED"]), "POSTED");
  assert.equal(aggregateBillingGroupStatus(["POSTED", "PENDING_APPROVAL"]), "PARTIALLY_POSTED");
  assert.equal(aggregateBillingGroupStatus(["EMPTY", "EMPTY"]), "EMPTY");
  assert.equal(aggregateBillingGroupStatus(["CANCELLED", "EMPTY"]), "CANCELLED");
});

test("dashboard counts keep approved-awaiting-posting separate from posted bills", () => {
  const bills = [
    { status: "PENDING_APPROVAL" },
    { status: "APPROVED" },
    { status: "POSTED", postedAt: new Date() },
    { status: "PARTIALLY_PAID", postedAt: new Date() },
    { status: "PAID", postedAt: new Date() },
    { status: "CANCELLED" },
  ];
  assert.deepEqual(summarizeBillStatuses(bills), {
    generated: 6,
    pendingApproval: 1,
    approvedAwaitingPosting: 1,
    posted: 3,
    cancelled: 1,
    postingInconsistencies: 0,
    other: 0,
  });
});

test("late-added approved bills make a previously posted period partially posted", () => {
  const originallyPosted = [
    { status: "POSTED" },
    { status: "PAID" },
    { status: "PARTIALLY_PAID" },
  ];
  assert.equal(billingCompletionStatus(originallyPosted), "POSTED");
  assert.equal(billingCompletionStatus([...originallyPosted, { status: "APPROVED" }]), "PARTIALLY_POSTED");
  assert.equal(billingCompletionStatus([]), "EMPTY");
  assert.equal(billingCompletionStatus([{ status: "CANCELLED" }]), "CANCELLED");
});

test("final bill notifications require posting even when an approved bill was previously notified", () => {
  const approvedWithSentNotification = { status: "APPROVED", notificationStatus: "SENT" };
  assert.equal(isFinalBillNotificationEligible(approvedWithSentNotification), false);
  assert.equal(isEligibleApprovedBill(approvedWithSentNotification), true);
  for (const status of ["POSTED", "PARTIALLY_PAID", "PAID"]) {
    assert.equal(isFinalBillNotificationEligible({ status }), true);
  }
  assert.equal(notificationRequiresPostedBill("BILL_ISSUED", true), true);
  assert.equal(notificationRequiresPostedBill("DUE_DATE_REMINDER", true), true);
  assert.equal(notificationRequiresPostedBill("BALANCE_REMINDER", false), false);
  assert.equal(notificationRequiresPostedBill("GENERAL", true), false);
});

test("posting evidence excludes inconsistent approved bills and protects retries", () => {
  const fresh = { status: "APPROVED", postedAt: null, postedBy: null, events: [] };
  assert.equal(isEligibleApprovedBill(fresh), true);

  const afterFirstPosting = { status: "POSTED", postedAt: new Date(), postedBy: 7n, events: [{ eventType: "BILL_POSTED" }] };
  assert.equal(isEligibleApprovedBill(afterFirstPosting), false);

  const inconsistent = { ...afterFirstPosting, status: "APPROVED" };
  assert.equal(hasPostingEvidence(inconsistent), true);
  assert.equal(isEligibleApprovedBill(inconsistent), false);
  assert.equal(summarizeBillStatuses([inconsistent]).postingInconsistencies, 1);
});

test("serialized concurrent posting attempts recheck eligibility and charge once", async () => {
  let bill: any = { status: "APPROVED", postedAt: null, postedBy: null, events: [] };
  let balance = 0;
  let lock = Promise.resolve();
  const attempt = async () => {
    const previous = lock;
    let release = () => {};
    lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!isEligibleApprovedBill(bill)) return false;
      balance += 25;
      bill = { status: "POSTED", postedAt: new Date(), postedBy: 7n, events: [{ eventType: "BILL_POSTED" }] };
      return true;
    } finally {
      release();
    }
  };
  const outcomes = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(balance, 25);
});

test("automatic periods reuse a group whose date range contains the due date", async () => {
  const existing = {
    billingPeriodGroupId: 9n,
    groupCode: "CUSTOM-SEPTEMBER",
    groupName: "September billing",
    periodStart: new Date("2026-09-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-30T00:00:00.000Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let upsertCalled = false;
  const result = await ensureBillingPeriodGroup({ billingPeriodGroup: {
    findFirst: async () => existing,
    upsert: async () => { upsertCalled = true; return existing; },
  } as any }, new Date("2026-09-15T00:00:00.000Z"));
  assert.equal(result, existing);
  assert.equal(upsertCalled, false);
});
