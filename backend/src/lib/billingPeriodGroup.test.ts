import assert from "node:assert/strict";
import test from "node:test";
import { aggregateBillingGroupStatus, billingCycleType, billingPeriodGroupIdentity, ensureBillingPeriodGroup } from "./billingPeriodGroup";

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
  assert.equal(aggregateBillingGroupStatus(["POSTED", "PENDING_APPROVAL"]), "PENDING_APPROVAL");
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
