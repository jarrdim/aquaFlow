import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerProfileChanges,
  compareCustomerActivityNewestFirst,
  customerActivityPagination,
  normalizeCustomerActivity,
} from "./customerActivity";
import { requireScopedPermission, SCOPED_STAFF_ROLES } from "../middleware/auth";
import { prisma } from "./prisma";

test("notification activity preserves the exact historical message after the current name changes", () => {
  const historicalMessage = "Dear MERCY MWONGELI, your bill is ready.";
  const currentProfileName = "MARGARET NTHAMBI";
  const activity = normalizeCustomerActivity({
    id: "notification-10",
    group: "NOTIFICATION",
    occurredAt: "2026-10-01T07:39:54.000Z",
    data: { messageBody: historicalMessage, notificationType: "BILL_ISSUED" },
  });

  assert.ok(activity.data);
  assert.equal(activity.data.messageBody, historicalMessage);
  assert.equal(activity.data.messageBody.includes(currentProfileName), false);
});

test("resend notification activity links to its original notification", () => {
  const activity = normalizeCustomerActivity({
    id: "notification-11",
    group: "NOTIFICATION",
    occurredAt: "2026-10-01T08:17:53.000Z",
    data: {
      messageBody: "Stored resend body",
      isResend: true,
      originalNotificationId: "10",
    },
  });

  assert.ok(activity.data);
  assert.equal(activity.data.isResend, true);
  assert.equal(activity.data.originalNotificationId, "10");
});

test("customer profile changes contain correct before and after values", () => {
  const changes = buildCustomerProfileChanges(
    { firstName: "MERCY", lastName: "MWONGELI", phoneNumber: "+254700000001", status: "ACTIVE" },
    { firstName: "MARGARET", lastName: "NTHAMBI", phoneNumber: "+254700000001", status: "ACTIVE" },
  );

  assert.deepEqual(changes, [
    { field: "firstName", previousValue: "MERCY", newValue: "MARGARET" },
    { field: "lastName", previousValue: "MWONGELI", newValue: "NTHAMBI" },
  ]);
});

test("customer activity permission rejects unauthenticated users", async () => {
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const middleware = requireScopedPermission(SCOPED_STAFF_ROLES, ["CUSTOMER_VIEW"]);
  await middleware(
    { user: undefined } as any,
    {
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as any,
    (() => { nextCalled = true; }) as any,
  );

  assert.equal(statusCode, 401);
  assert.deepEqual(body, { error: "Not authenticated" });
  assert.equal(nextCalled, false);
});

test("customer activity permission rejects a scoped role without CUSTOMER_VIEW", async () => {
  let statusCode = 200;
  let nextCalled = false;
  const rolePermission = prisma.rolePermission as any;
  const originalCount = rolePermission.count;
  rolePermission.count = async () => 0;
  try {
    const middleware = requireScopedPermission(SCOPED_STAFF_ROLES, ["CUSTOMER_VIEW"]);
    await middleware(
      {
        user: {
          userId: "99",
          username: "restricted",
          userType: "STAFF",
          roles: ["GENERAL_STAFF_VIEWER"],
        },
      } as any,
      {
        status(code: number) { statusCode = code; return this; },
        json() { return this; },
      } as any,
      (() => { nextCalled = true; }) as any,
    );
  } finally {
    rolePermission.count = originalCount;
  }

  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);
});

test("activity events use deterministic newest-first ordering and pagination metadata", () => {
  const events = [
    { id: "notification-2", group: "NOTIFICATION", occurredAt: "2026-10-01T08:00:00.000Z" },
    { id: "customer-change-1", group: "CUSTOMER", occurredAt: "2026-10-01T09:00:00.000Z" },
    { id: "notification-1", group: "NOTIFICATION", occurredAt: "2026-10-01T08:00:00.000Z" },
  ].sort(compareCustomerActivityNewestFirst);

  assert.deepEqual(events.map((event) => event.id), [
    "customer-change-1",
    "notification-2",
    "notification-1",
  ]);
  assert.deepEqual(customerActivityPagination(51, 2, 25), {
    total: 51,
    page: 2,
    pageSize: 25,
    pages: 3,
  });
});
