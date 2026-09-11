import { Prisma } from "@prisma/client";

export const postedBillStatuses = ["POSTED", "PARTIALLY_PAID", "PAID"] as const;

export function billingCycleLabel(cycle?: { cycleCode?: string | null; cycleName?: string | null } | null, fallback = "-") {
  const code = String(cycle?.cycleCode ?? "").trim();
  const name = String(cycle?.cycleName ?? "").trim();
  if (code && name && code.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
    return `${code} · ${name}`;
  }
  return code || name || fallback;
}

type BillWorkflowRecord = {
  status: string;
  postedAt?: Date | string | null;
  postedBy?: bigint | string | number | null;
  events?: Array<{ eventType: string }>;
};

export function isPostedBillStatus(status: string) {
  return postedBillStatuses.includes(status as (typeof postedBillStatuses)[number]);
}

export function hasPostingEvidence(bill: BillWorkflowRecord) {
  return Boolean(
    bill.postedAt ||
    bill.postedBy ||
    bill.events?.some((event) => event.eventType === "BILL_POSTED"),
  );
}

export function isEligibleApprovedBill(bill: BillWorkflowRecord) {
  return bill.status === "APPROVED" && !hasPostingEvidence(bill);
}

export function isFinalBillNotificationEligible(bill: Pick<BillWorkflowRecord, "status">) {
  return isPostedBillStatus(bill.status);
}

export function notificationRequiresPostedBill(notificationType: string, hasBill: boolean) {
  return notificationType === "BILL_ISSUED" ||
    (hasBill && ["DUE_DATE_REMINDER", "BALANCE_REMINDER"].includes(notificationType));
}

export function summarizeBillStatuses(bills: BillWorkflowRecord[]) {
  const pendingApproval = bills.filter((bill) => bill.status === "PENDING_APPROVAL").length;
  const approvedAwaitingPosting = bills.filter(isEligibleApprovedBill).length;
  const posted = bills.filter((bill) => isPostedBillStatus(bill.status)).length;
  const cancelled = bills.filter((bill) => bill.status === "CANCELLED").length;
  const postingInconsistencies = bills.filter(
    (bill) => bill.status === "APPROVED" && hasPostingEvidence(bill),
  ).length;
  return {
    generated: bills.length,
    pendingApproval,
    approvedAwaitingPosting,
    posted,
    cancelled,
    postingInconsistencies,
    other: Math.max(
      0,
      bills.length - pendingApproval - approvedAwaitingPosting - posted - cancelled - postingInconsistencies,
    ),
  };
}

export function billingCompletionStatus(bills: Array<Pick<BillWorkflowRecord, "status">>) {
  if (!bills.length) return "EMPTY";
  const active = bills.filter((bill) => bill.status !== "CANCELLED");
  if (!active.length) return "CANCELLED";
  const posted = active.filter((bill) => isPostedBillStatus(bill.status)).length;
  if (posted === active.length) return "POSTED";
  if (posted > 0) return "PARTIALLY_POSTED";
  const statuses = active.map((bill) => bill.status);
  const priority = ["RETURNED", "PENDING_APPROVAL", "PROCESSING", "OPEN", "DRAFT", "APPROVED", "REJECTED"];
  return priority.find((status) => statuses.includes(status)) ?? statuses[0];
}

export function billingPeriodGroupIdentity(dueDate: Date) {
  const year = dueDate.getUTCFullYear();
  const month = dueDate.getUTCMonth();
  const monthNumber = String(month + 1).padStart(2, "0");
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  const groupName = `${periodStart.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" })} Billing`;
  return { groupCode: `BPG-${year}-${monthNumber}`, groupName, periodStart, periodEnd };
}

export function billingCycleType(cycleCode: string) {
  if (/^MR-/i.test(cycleCode)) return "METER_REPLACEMENT";
  if (/LATE/i.test(cycleCode)) return "LATE_READING";
  return "ROUTINE";
}

export async function ensureBillingPeriodGroup(
  tx: Pick<Prisma.TransactionClient, "billingPeriodGroup">,
  dueDate: Date,
) {
  const existing = await tx.billingPeriodGroup.findFirst({
    where: {
      periodStart: { lte: dueDate },
      periodEnd: { gte: dueDate },
    },
    orderBy: [{ periodStart: "desc" }, { billingPeriodGroupId: "asc" }],
  });
  if (existing) return existing;
  const identity = billingPeriodGroupIdentity(dueDate);
  return tx.billingPeriodGroup.upsert({
    where: { groupCode: identity.groupCode },
    update: {},
    create: identity,
  });
}

export function aggregateBillingGroupStatus(statuses: string[]) {
  if (!statuses.length) return "EMPTY";
  if (statuses.every((status) => status === "EMPTY")) return "EMPTY";
  if (statuses.every((status) => ["EMPTY", "CANCELLED"].includes(status))) return "CANCELLED";
  if (statuses.includes("PARTIALLY_POSTED")) return "PARTIALLY_POSTED";
  const active = statuses.filter((status) => !["EMPTY", "CANCELLED"].includes(status));
  const posted = active.filter((status) => ["POSTED", "CLOSED"].includes(status)).length;
  if (posted && posted < active.length) return "PARTIALLY_POSTED";
  if (active.length && posted === active.length) return "POSTED";
  const priority = ["RETURNED", "PENDING_APPROVAL", "PROCESSING", "OPEN", "DRAFT", "APPROVED", "REJECTED"];
  return priority.find((status) => active.includes(status)) ?? active[0] ?? statuses[0];
}
