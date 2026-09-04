import assert from "node:assert/strict";
import test from "node:test";
import {
  billStateAfterReversal,
  paymentPersistenceError,
  planBillAllocations,
  validatePaymentSplits,
} from "./paymentAllocation";

test("credit-covered bill has no allocatable outstanding amount", () => {
  const result = planBillAllocations(100, [
    { billId: 1n, totalAmountDue: 0, paidAmount: 0 },
  ]);
  assert.deepEqual(result, { allocations: [], allocated: 0, remaining: 100 });
});

test("partial payment updates paid amount and leaves bill partially paid", () => {
  const result = planBillAllocations(100, [
    { billId: 1n, totalAmountDue: 300, paidAmount: 0 },
  ]);
  assert.equal(result.allocated, 100);
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.allocations[0], {
    billId: 1n,
    amount: 100,
    paidAmount: 100,
    status: "PARTIALLY_PAID",
  });
});

test("payment above bill outstanding leaves the excess as account credit", () => {
  const result = planBillAllocations(500, [
    { billId: 1n, totalAmountDue: 300, paidAmount: 100 },
  ]);
  assert.equal(result.allocated, 200);
  assert.equal(result.remaining, 300);
  assert.equal(result.allocations[0].status, "PAID");
});

test("manual split accepts exact totals and rejects invalid splits", () => {
  const splits = [
    { accountId: 1n, amount: 40 },
    { accountId: 2n, amount: 60 },
  ];
  assert.doesNotThrow(() => validatePaymentSplits(100, splits));
  const first = planBillAllocations(splits[0].amount, [
    { billId: 10n, totalAmountDue: 25, paidAmount: 0 },
  ]);
  const second = planBillAllocations(splits[1].amount, [
    { billId: 20n, totalAmountDue: 100, paidAmount: 10 },
  ]);
  assert.deepEqual(
    { allocated: first.allocated + second.allocated, accountCredit: first.remaining + second.remaining },
    { allocated: 85, accountCredit: 15 },
  );
  assert.throws(
    () => validatePaymentSplits(100, [{ accountId: 1n, amount: 99 }]),
    /must total KSh 100.00/,
  );
  assert.throws(
    () => validatePaymentSplits(100, [{ accountId: 1n, amount: 50 }, { accountId: 1n, amount: 50 }]),
    /only once/,
  );
});

test("reversing an allocation restores the correct bill state", () => {
  assert.deepEqual(billStateAfterReversal(300, 300, 100), {
    paidAmount: 200,
    status: "PARTIALLY_PAID",
  });
  assert.deepEqual(billStateAfterReversal(300, 100, 100), {
    paidAmount: 0,
    status: "POSTED",
  });
});

test("allocation persistence and timeout failures become clear HTTP errors", () => {
  assert.deepEqual(
    paymentPersistenceError({ message: "Payment allocation exceeds bill amount due" }),
    {
      status: 409,
      message: "A selected bill no longer has enough outstanding balance. The payment was not posted; refresh and try again.",
    },
  );
  assert.equal(paymentPersistenceError({ code: "P2028" })?.status, 503);
});
