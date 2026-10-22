import { getSessionUser, type SessionUser } from "./api";

export const RESTRICTED_STAFF_ROLES = new Set([
  "FIELD_OPERATIONS_TECHNICIAN",
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
  if (!user.roles.length) return false;
  const [path, query = ""] = pathname.split("?", 2);
  const params = new URLSearchParams(query);
  if (path.startsWith("/arrears/disconnections")) {
    return user.userType
      ? ["STAFF", "SYSTEM"].includes(user.userType)
      : !user.roles.includes("CUSTOMER");
  }
  if (user.roles.includes("SYSTEM_ADMIN") || !isRestrictedStaff(user)) return true;

  if (path === "/billing/statements") return hasPermission("CUSTOMER_STATEMENT_VIEW", user);
  if (path.startsWith("/service-requests/new")) return hasPermission("SERVICE_REQUEST_CREATE", user);
  if (path.startsWith("/service-requests") || path.startsWith("/reconnections")) {
    return hasPermission("SERVICE_REQUEST_VIEW", user);
  }
  if (path.startsWith("/readings/worklist")) return hasPermission("READING_WORKLIST_VIEW", user);
  if (path.startsWith("/arrears/promises")) return hasPermission("PROMISE_TO_PAY_VIEW", user);
  if (path === "/customers/new" && params.has("connectionId")) {
    return hasPermission("CUSTOMER_MANAGE", user) || hasPermission("CONNECTION_PROCESS", user);
  }
  if (path.startsWith("/customers")) return hasPermission("CUSTOMER_VIEW", user);
  if (path.startsWith("/connections/new")) return hasPermission("CONNECTION_CREATE", user);
  if (path.startsWith("/connections")) return hasPermission("CONNECTION_VIEW", user);
  if (path.startsWith("/meters/assign/non-customer")) return false;
  if (path.startsWith("/meters/assign")) return hasPermission("METER_ASSIGN_CUSTOMER", user);
  if (path.startsWith("/meters/direct-replacement")) return hasPermission("METER_DIRECT_REPLACE", user);
  if (path.startsWith("/meters/direct-service")) {
    return hasAnyPermission(["METER_DIRECT_DISCONNECT", "METER_DIRECT_RECONNECT"], user);
  }
  if (path === "/work-orders/new" && params.has("connectionId")) {
    return hasPermission("WORK_ORDER_CREATE", user) || hasPermission("CONNECTION_PROCESS", user);
  }
  if (path.startsWith("/work-orders")) return hasPermission("WORK_ORDER_VIEW", user);

  if (path === "/payments") return hasPermission("PAYMENT_DASHBOARD_VIEW", user);
  if (path.startsWith("/payments/mpesa/c2b")) return hasPermission("PAYMENT_C2B_MANAGE", user);
  if (path.startsWith("/payments/channels")) return hasPermission("PAYMENT_CHANNEL_MANAGE", user);
  if (path.startsWith("/payments/unmatched")) return hasPermission("PAYMENT_UNMATCHED_VIEW", user);
  if (path.startsWith("/payments/reports/receipt-detail")) {
    return hasPermission("PAYMENT_DAILY_RECEIPTS_VIEW", user);
  }
  if (path.startsWith("/payments")) return hasPermission("PAYMENT_OPERATIONS", user);

  return false;
}

export function defaultAuthorizedPath(user: SessionUser | null = getSessionUser()) {
  if (!user || !user.roles.length) return "/login";
  if (!isRestrictedStaff(user)) return "/dashboard";
  const candidates = [
    "/connections",
    "/payments/record",
    "/customers",
    "/payments/unmatched",
    "/billing/statements",
    "/service-requests",
    "/work-orders",
    "/arrears/disconnections",
    "/readings/worklist",
  ];
  return candidates.find((path) => canAccessPath(path, user)) ?? "/login";
}
