import { Prisma } from "@prisma/client";

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
  const identity = billingPeriodGroupIdentity(dueDate);
  return tx.billingPeriodGroup.upsert({
    where: { groupCode: identity.groupCode },
    update: {},
    create: identity,
  });
}

export function aggregateBillingGroupStatus(statuses: string[]) {
  if (!statuses.length) return "EMPTY";
  const priority = ["RETURNED", "PENDING_APPROVAL", "PROCESSING", "OPEN", "DRAFT", "APPROVED", "POSTED", "CLOSED", "CANCELLED"];
  return priority.find((status) => statuses.includes(status)) ?? statuses[0];
}
