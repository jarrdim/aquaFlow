export const READING_ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export const LEGACY_READABLE_METER_STATUSES = ["INACTIVE", "REMOVED"] as const;
export const LEGACY_METER_WARNING = "Meter marked inactive/removed";

export type ReadingEligibilityAssignment = {
  assignmentId: bigint;
  accountId: bigint | null;
  assignmentDate: Date;
  meter: {
    status: string;
    installationStatus: string;
  };
};

type SearchableReadingAssignment = {
  meter: { meterNumber: string; serialNumber: string | null };
  account: {
    accountNumber: string;
    customer: {
      customerNumber: string;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      organizationName: string | null;
      phoneNumber: string | null;
    };
  } | null;
};

export function isReadableAccountStatus(status: string) {
  return READING_ACCOUNT_STATUSES.includes(status as (typeof READING_ACCOUNT_STATUSES)[number]);
}

export function isRoutineReadableMeter(meter: ReadingEligibilityAssignment["meter"]) {
  return meter.status === "ACTIVE" && meter.installationStatus !== "REMOVED";
}

export function isLegacyReadableMeter(meter: ReadingEligibilityAssignment["meter"]) {
  return (
    LEGACY_READABLE_METER_STATUSES.includes(
      meter.status as (typeof LEGACY_READABLE_METER_STATUSES)[number],
    ) ||
    (meter.status === "ACTIVE" && meter.installationStatus === "REMOVED")
  );
}

function newestAssignment<T extends ReadingEligibilityAssignment>(left: T, right: T) {
  const byDate = right.assignmentDate.getTime() - left.assignmentDate.getTime();
  if (byDate) return byDate;
  return right.assignmentId > left.assignmentId ? 1 : right.assignmentId < left.assignmentId ? -1 : 0;
}

/**
 * Resolves one readable current assignment per account. A normal active meter
 * always takes precedence over legacy inconsistent assignments, regardless of
 * the search term or requested meter ID, so an old meter cannot be revived when
 * a valid replacement/current meter exists.
 */
export function resolveReadableAssignments<T extends ReadingEligibilityAssignment>(assignments: T[]) {
  const byAccount = new Map<string, T[]>();
  for (const assignment of assignments) {
    if (assignment.accountId == null) continue;
    const key = assignment.accountId.toString();
    byAccount.set(key, [...(byAccount.get(key) ?? []), assignment]);
  }

  return Array.from(byAccount.values()).flatMap((accountAssignments) => {
    const routine = accountAssignments.filter((assignment) => isRoutineReadableMeter(assignment.meter));
    const candidates = routine.length
      ? routine
      : accountAssignments.filter((assignment) => isLegacyReadableMeter(assignment.meter));
    const selected = candidates.sort(newestAssignment)[0];
    return selected ? [selected] : [];
  });
}

export function readingEligibilityWarning(meter: ReadingEligibilityAssignment["meter"]) {
  return isRoutineReadableMeter(meter) ? null : LEGACY_METER_WARNING;
}

export function filterReadingAssignmentsBySearch<T extends SearchableReadingAssignment>(assignments: T[], search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch) return assignments;
  const terms = normalizedSearch.split(/\s+/).filter(Boolean);
  const values = (assignment: T) => [
    assignment.meter.meterNumber,
    assignment.meter.serialNumber,
    assignment.account?.accountNumber,
    assignment.account?.customer.customerNumber,
    assignment.account?.customer.firstName,
    assignment.account?.customer.middleName,
    assignment.account?.customer.lastName,
    assignment.account?.customer.organizationName,
    assignment.account?.customer.phoneNumber,
  ].filter(Boolean).map((value) => String(value).toLocaleLowerCase());
  const exact = assignments.filter((assignment) =>
    values(assignment).some((value) => value === normalizedSearch),
  );
  return exact.length
    ? exact
    : assignments.filter((assignment) => {
        const searchableValues = values(assignment);
        return terms.every((term) => searchableValues.some((value) => value.includes(term)));
      });
}

export function requestedRoutesAreAllowed(requestedRouteIds: bigint[], allowedRouteIds: bigint[]) {
  return requestedRouteIds.every((requested) => allowedRouteIds.some((allowed) => allowed === requested));
}
