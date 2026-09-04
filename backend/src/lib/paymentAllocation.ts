export type BillPaymentState = {
  billId: bigint;
  totalAmountDue: unknown;
  paidAmount: unknown;
};

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function billOutstandingAmount(bill: Pick<BillPaymentState, "totalAmountDue" | "paidAmount">) {
  return roundMoney(Math.max(0, Number(bill.totalAmountDue) - Number(bill.paidAmount)));
}

export function billStatusAfterPayment(totalAmountDue: unknown, paidAmount: unknown) {
  const due = Math.max(0, Number(totalAmountDue));
  const paid = Math.max(0, Number(paidAmount));
  if (due === 0 || paid >= due) return "PAID";
  return paid > 0 ? "PARTIALLY_PAID" : "POSTED";
}

export function billStateAfterReversal(totalAmountDue: unknown, paidAmount: unknown, reversedAmount: unknown) {
  const paid = roundMoney(Math.max(0, Number(paidAmount) - Number(reversedAmount)));
  return { paidAmount: paid, status: billStatusAfterPayment(totalAmountDue, paid) };
}

export function planBillAllocations(paymentAmount: number, bills: BillPaymentState[]) {
  let remaining = roundMoney(paymentAmount);
  const allocations: Array<{ billId: bigint; amount: number; paidAmount: number; status: string }> = [];
  for (const bill of bills) {
    const amount = roundMoney(Math.min(remaining, billOutstandingAmount(bill)));
    if (amount <= 0) continue;
    const paidAmount = roundMoney(Number(bill.paidAmount) + amount);
    allocations.push({
      billId: bill.billId,
      amount,
      paidAmount,
      status: billStatusAfterPayment(bill.totalAmountDue, paidAmount),
    });
    remaining = roundMoney(remaining - amount);
    if (remaining <= 0) break;
  }
  return {
    allocations,
    allocated: roundMoney(paymentAmount - remaining),
    remaining,
  };
}

export function validatePaymentSplits(paymentAmount: number, splits: Array<{ accountId: bigint; amount: number }>) {
  if (splits.some((split) => !Number.isFinite(split.amount) || split.amount <= 0))
    throw Object.assign(new Error("Every split amount must be greater than zero"), { status: 400 });
  if (new Set(splits.map((split) => String(split.accountId))).size !== splits.length)
    throw Object.assign(new Error("Select each customer account only once"), { status: 400 });
  const paymentCents = Math.round(paymentAmount * 100);
  const splitCents = splits.reduce((sum, split) => sum + Math.round(split.amount * 100), 0);
  if (splitCents !== paymentCents)
    throw Object.assign(new Error(`Split amounts must total KSh ${paymentAmount.toFixed(2)}`), { status: 400 });
}

function errorText(error: any) {
  const parts = [error?.message, error?.meta?.message, error?.cause?.message]
    .filter((value): value is string => typeof value === "string");
  return parts.join(" ");
}

export function paymentPersistenceError(error: any): { status: number; message: string } | null {
  const text = errorText(error);
  if (error?.code === "P2028") {
    return {
      status: 503,
      message: "Payment allocation took too long and was rolled back. Please retry; for a large split, use fewer accounts.",
    };
  }
  if (/Payment allocation exceeds bill amount due/i.test(text)) {
    return {
      status: 409,
      message: "A selected bill no longer has enough outstanding balance. The payment was not posted; refresh and try again.",
    };
  }
  if (/Payment allocation exceeds payment amount/i.test(text)) {
    return {
      status: 409,
      message: "The requested allocations exceed the available payment amount. Refresh and try again.",
    };
  }
  return null;
}
