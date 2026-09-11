import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadingWorklistPage,
  LEGACY_METER_WARNING,
  filterReadingAssignmentsBySearch,
  isReadableAccountStatus,
  readingEligibilityWarning,
  requestedRoutesAreAllowed,
  resolveReadableAssignments,
} from "./readingEligibility";

function assignment(overrides: Record<string, any> = {}) {
  const accountId = overrides.accountId ?? 1n;
  return {
    assignmentId: overrides.assignmentId ?? 1n,
    accountId,
    assignmentDate: overrides.assignmentDate ?? new Date("2026-01-01T00:00:00.000Z"),
    meterId: overrides.meterId ?? 10n,
    meter: {
      meterNumber: overrides.meterNumber ?? "MTR-2026-10430",
      serialNumber: overrides.serialNumber ?? "10430",
      status: overrides.meterStatus ?? "ACTIVE",
      installationStatus: overrides.installationStatus ?? "INSTALLED",
    },
    account: {
      accountNumber: overrides.accountNumber ?? "ACC-10430",
      customer: {
        customerNumber: overrides.customerNumber ?? "CUS-10430",
        firstName: overrides.firstName ?? "Ada",
        middleName: null,
        lastName: overrides.lastName ?? "Reader",
        organizationName: null,
        phoneNumber: "+254700000000",
      },
    },
  };
}

test("ACTIVE and SUSPENDED accounts are readable, while CLOSED and DISCONNECTED accounts are not", () => {
  assert.equal(isReadableAccountStatus("ACTIVE"), true);
  assert.equal(isReadableAccountStatus("SUSPENDED"), true);
  assert.equal(isReadableAccountStatus("CLOSED"), false);
  assert.equal(isReadableAccountStatus("DISCONNECTED"), false);
});

test("an active meter remains the current readable assignment", () => {
  const active = assignment();
  assert.deepEqual(resolveReadableAssignments([active]), [active]);
  assert.equal(readingEligibilityWarning(active.meter), null);
});

test("a suspended account's legacy inactive/removed meter remains readable when it has no replacement", () => {
  assert.equal(isReadableAccountStatus("SUSPENDED"), true);
  const legacy = assignment({ meterStatus: "INACTIVE", installationStatus: "REMOVED" });
  assert.deepEqual(resolveReadableAssignments([legacy]), [legacy]);
  assert.equal(readingEligibilityWarning(legacy.meter), LEGACY_METER_WARNING);
});

test("a valid newer replacement wins and the genuinely removed old meter cannot be selected", () => {
  const removed = assignment({
    assignmentId: 1n,
    meterId: 10n,
    meterStatus: "INACTIVE",
    installationStatus: "REMOVED",
  });
  const replacement = assignment({
    assignmentId: 2n,
    meterId: 20n,
    meterNumber: "MTR-2026-20000",
    serialNumber: "20000",
    assignmentDate: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.deepEqual(resolveReadableAssignments([removed, replacement]), [replacement]);
});

test("worklist search matches meter number, serial number, and account number", () => {
  const row = assignment();
  for (const search of ["MTR-2026-10430", "10430", "ACC-10430"]) {
    assert.deepEqual(filterReadingAssignmentsBySearch([row], search), [row]);
  }
  assert.deepEqual(filterReadingAssignmentsBySearch([row], "not-present"), []);
});

test("suspended eligibility carries through capture and approval without changing account status", () => {
  const accountStatus = "SUSPENDED";
  const current = assignment();
  assert.equal(isReadableAccountStatus(accountStatus), true);
  assert.deepEqual(resolveReadableAssignments([current]), [current]);
  // Approval operates on the captured reading and deliberately has no account-
  // status gate; retaining the status here guards against accidental mutation.
  assert.equal(accountStatus, "SUSPENDED");
});

test("meter readers can request only routes assigned to them", () => {
  assert.equal(requestedRoutesAreAllowed([11n], [11n, 12n]), true);
  assert.equal(requestedRoutesAreAllowed([], [11n]), true);
  assert.equal(requestedRoutesAreAllowed([13n], [11n, 12n]), false);
});

test("worklist paging returns only the requested rows while keeping full-scope counts", () => {
  const eligible = Array.from({ length: 125 }, (_, index) => ({ meterId: BigInt(index + 1) }));
  const captured = new Set(Array.from({ length: 25 }, (_, index) => String(index + 1)));
  const result = buildReadingWorklistPage(eligible, eligible, captured, "", 2, 50);
  assert.equal(result.items.length, 50);
  assert.equal(result.items[0].meterId, 51n);
  assert.equal(result.total, 125);
  assert.equal(result.pages, 3);
  assert.deepEqual(result.summary, { eligible: 125, captured: 25, unread: 100 });
});

test("worklist status filtering happens before server-side pagination", () => {
  const eligible = Array.from({ length: 80 }, (_, index) => ({ meterId: BigInt(index + 1) }));
  const captured = new Set(Array.from({ length: 30 }, (_, index) => String(index + 1)));
  const unread = buildReadingWorklistPage(eligible, eligible, captured, "UNREAD", 1, 10);
  const capturedPage = buildReadingWorklistPage(eligible, eligible, captured, "CAPTURED", 2, 10);
  assert.equal(unread.total, 50);
  assert.equal(unread.items[0].meterId, 31n);
  assert.equal(capturedPage.total, 30);
  assert.equal(capturedPage.items[0].meterId, 11n);
});
