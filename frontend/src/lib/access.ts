import { getSessionUser, type SessionUser } from "./api";

export const RESTRICTED_STAFF_ROLES = new Set([
  "REVENUE_FIELD_OPERATIONS",
  "CUSTOMER_METER_SERVICES",
  "GENERAL_STAFF_VIEWER",
  "PAYMENT_RECONCILIATION",
]);

export function isRestrictedStaff(user: SessionUser | null = getSessionUser()) {
  return Boolean(user?.roles.some((role) => RESTRICTED_STAFF_ROLES.has(role)));
}

export function hasPermission(code: string, user: SessionUser | null = getSessionUser()) {
  return Boolean(
    user?.roles.includes("SYSTEM_ADMIN") || user?.permissions?.includes(code),
  );
}

function hasAnyPermission(codes: string[], user: SessionUser) {
  return codes.some((code) => hasPermission(code, user));
}

export function canAccessPath(pathname: string, user: SessionUser | null = getSessionUser()) {
  if (!user) return false;
  if (user.roles.includes("SYSTEM_ADMIN") || !isRestrictedStaff(user)) return true;

  if (pathname === "/billing/statements") return hasPermission("CUSTOMER_STATEMENT_VIEW", user);
  if (pathname.startsWith("/service-requests/new")) return hasPermission("SERVICE_REQUEST_CREATE", user);
  if (pathname.startsWith("/service-requests") || pathname.startsWith("/reconnections")) {
    return hasPermission("SERVICE_REQUEST_VIEW", user);
  }
  if (pathname.startsWith("/readings/worklist")) return hasPermission("READING_WORKLIST_VIEW", user);
  if (pathname.startsWith("/arrears/disconnections")) return hasPermission("DISCONNECTION_LIST_VIEW", user);
  if (pathname.startsWith("/arrears/promises")) return hasPermission("PROMISE_TO_PAY_VIEW", user);
  if (pathname.startsWith("/customers")) return hasPermission("CUSTOMER_VIEW", user);
  if (pathname.startsWith("/connections/new")) return hasPermission("CONNECTION_CREATE", user);
  if (pathname.startsWith("/connections")) return hasPermission("CONNECTION_VIEW", user);
  if (pathname.startsWith("/meters/assign/non-customer")) return false;
  if (pathname.startsWith("/meters/assign")) return hasPermission("METER_ASSIGN_CUSTOMER", user);
  if (pathname.startsWith("/meters/direct-replacement")) return hasPermission("METER_DIRECT_REPLACE", user);
  if (pathname.startsWith("/meters/direct-service")) {
    return hasAnyPermission(["METER_DIRECT_DISCONNECT", "METER_DIRECT_RECONNECT"], user);
  }

  if (pathname === "/payments") return hasPermission("PAYMENT_DASHBOARD_VIEW", user);
  if (pathname.startsWith("/payments/mpesa/c2b")) return hasPermission("PAYMENT_C2B_MANAGE", user);
  if (pathname.startsWith("/payments/channels")) return hasPermission("PAYMENT_CHANNEL_MANAGE", user);
  if (pathname.startsWith("/payments/unmatched")) return hasPermission("PAYMENT_UNMATCHED_VIEW", user);
  if (pathname.startsWith("/payments/reports/receipt-detail")) {
    return hasPermission("PAYMENT_DAILY_RECEIPTS_VIEW", user);
  }
  if (pathname.startsWith("/payments")) return hasPermission("PAYMENT_OPERATIONS", user);

  return false;
}

export function defaultAuthorizedPath(user: SessionUser | null = getSessionUser()) {
  if (!user || !isRestrictedStaff(user)) return "/dashboard";
  const candidates = [
    "/payments/record",
    "/customers",
    "/payments/unmatched",
    "/billing/statements",
    "/service-requests",
    "/arrears/disconnections",
    "/readings/worklist",
  ];
  return candidates.find((path) => canAccessPath(path, user)) ?? "/login";
}
