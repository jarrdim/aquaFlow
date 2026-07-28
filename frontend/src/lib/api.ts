const TOKEN_KEY = "aquaflow_token";
const USER_KEY = "aquaflow_user";
let redirectingToLogin = false;

export type SessionUser = {
  userId: string;
  username: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
};

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function setSessionUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getSessionUser(): SessionUser | null {
  try {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) return JSON.parse(stored) as SessionUser;
    const token = getToken();
    if (!token) return null;
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return {
      userId: String(payload.userId),
      username: String(payload.username),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
  } catch {
    return null;
  }
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithReadRetry(path: string, options: RequestInit) {
  const method = String(options.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 4 : 1;
  const retryDelays = [250, 750, 1500];
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`/api${path}`, options);
      const transientServerFailure = [502, 503, 504].includes(response.status);
      if (
        method === "GET" &&
        transientServerFailure &&
        attempt < maxAttempts - 1
      ) {
        await wait(retryDelays[attempt]);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (method !== "GET" || attempt === maxAttempts - 1) break;
      await wait(retryDelays[attempt]);
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Could not connect to the server. Please try again. (${lastError.message})`
      : "Could not connect to the server. Please try again.",
  );
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const requestOptions: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  };
  const res = await fetchWithReadRetry(path, requestOptions);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // A token can remain in localStorage after its JWT expiry. Treat a 401 from
    // an authenticated request as a session boundary, clear it once, and send
    // the user through login while preserving the page they were viewing.
    if (res.status === 401 && token && path !== "/auth/login") {
      clearToken();
      if (!redirectingToLogin && window.location.pathname !== "/login") {
        redirectingToLogin = true;
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(
          `/login?reason=expired&next=${encodeURIComponent(next)}`,
        );
      }
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (body.error) {
      // Zod flatten returns { fieldErrors: { field: string[] }, formErrors: string[] }
      // Parse it into a readable message and attach structured fieldErrors for inline display
      if (
        typeof body.error === "object" &&
        (body.error.fieldErrors || body.error.formErrors)
      ) {
        const msgs: string[] = [];
        for (const [field, errs] of Object.entries(
          body.error.fieldErrors ?? ({} as Record<string, string[]>),
        )) {
          const label = field
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (s) => s.toUpperCase());
          msgs.push(`${label}: ${(errs as string[]).join(", ")}`);
        }
        if ((body.error.formErrors as string[])?.length) {
          msgs.push(...(body.error.formErrors as string[]));
        }
        const err: any = new Error(msgs.join("\n") || "Validation failed");
        err.fieldErrors = body.error.fieldErrors ?? {};
        throw err;
      }
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : JSON.stringify(body.error),
      );
    }
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  listCustomers: (search = "", page = 1, status = "", meterAssignment = "") =>
    request(
      `/customers?search=${encodeURIComponent(search)}&page=${page}${status ? `&status=${encodeURIComponent(status)}` : ""}${meterAssignment ? `&meterAssignment=${encodeURIComponent(meterAssignment)}` : ""}`,
    ),
  getCustomer: (id: string) => request(`/customers/${id}`),
  createCustomer: (data: Record<string, unknown>) =>
    request("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: Record<string, unknown>) =>
    request(`/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  bulkUpdateCustomerStatus: (customerIds: string[], status: string) =>
    request("/customers/bulk-status", {
      method: "PATCH",
      body: JSON.stringify({ customerIds, status }),
    }),

  listZones: () => request("/lookups/zones"),
  listServiceAreas: (zoneId?: string) =>
    request(`/lookups/service-areas${zoneId ? `?zoneId=${zoneId}` : ""}`),
  listRoutes: (zoneId?: string) =>
    request(`/lookups/routes${zoneId ? `?zoneId=${zoneId}` : ""}`),
  listCategories: () => request("/lookups/customer-categories"),

  listProperties: (customerId?: string) =>
    request(`/properties${customerId ? `?customerId=${customerId}` : ""}`),
  createProperty: (data: Record<string, unknown>) =>
    request("/properties", { method: "POST", body: JSON.stringify(data) }),

  createAccount: (data: Record<string, unknown>) =>
    request("/accounts", { method: "POST", body: JSON.stringify(data) }),
  listAccounts: (search = "", take = 8) =>
    request(
      `/accounts?search=${encodeURIComponent(search)}&take=${encodeURIComponent(String(take))}`,
    ),

  meterDashboard: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/meters/dashboard${query ? `?${query}` : ""}`);
  },
  listMeters: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/meters${query ? `?${query}` : ""}`);
  },
  getMeter: (id: string) => request(`/meters/${id}`),
  getMeterHistory: (id: string) => request(`/meters/${id}/history`),
  updateMeter: (id: string, data: Record<string, unknown>) =>
    request(`/meters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  createMeter: (data: Record<string, unknown>) =>
    request("/meters", { method: "POST", body: JSON.stringify(data) }),
  bulkCreateMeters: (items: Record<string, unknown>[]) =>
    request("/meters/bulk", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  validateMeterImport: (items: Record<string, unknown>[]) =>
    request("/meters/bulk/validate", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  updateMeterStatus: (id: string, data: Record<string, unknown>) =>
    request(`/meters/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  updateMeterInstallation: (id: string, data: Record<string, unknown>) =>
    request(`/meters/${id}/installation`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  listMeterAccounts: (q = "") =>
    request(`/meters/accounts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  listBoreholes: () => request("/meters/boreholes"),
  assignMeter: (data: Record<string, unknown>) =>
    request("/meters/assign", { method: "POST", body: JSON.stringify(data) }),
  listMeterAlerts: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/meters/alerts${query ? `?${query}` : ""}`);
  },
  dismissMeterAlert: (id: string) =>
    request(`/meters/alerts/${id}/dismiss`, { method: "PATCH" }),
  createMeterWorkOrder: (data: Record<string, unknown>) =>
    request("/meters/work-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listMeterReplacements: (status = "") =>
    request(`/meters/replacements${status ? `?status=${status}` : ""}`),
  createMeterReplacement: (data: Record<string, unknown>) =>
    request("/meters/replacements", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideMeterReplacement: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/meters/replacements/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),

  readingDashboard: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/readings/dashboard/summary${query ? `?${query}` : ""}`);
  },
  listReadingCycles: (status = "") =>
    request(
      `/readings/cycles${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  createReadingCycle: (data: Record<string, unknown>) =>
    request("/readings/cycles", { method: "POST", body: JSON.stringify(data) }),
  updateReadingCycle: (id: string, data: Record<string, unknown>) =>
    request(`/readings/cycles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  updateReadingCycleStatus: (id: string, status: string) =>
    request(`/readings/cycles/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  listReadingOfficers: () => request("/readings/officers"),
  listReadingStaffCandidates: () => request("/readings/staff-candidates"),
  createReadingOfficer: (data: Record<string, unknown>) =>
    request("/readings/officers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listRouteAssignments: (cycleId = "") =>
    request(
      `/readings/assignments${cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : ""}`,
    ),
  assignReadingRoute: (data: Record<string, unknown>) =>
    request("/readings/assignments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  assignReadingRoutesBulk: (data: Record<string, unknown>) =>
    request("/readings/assignments/bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRouteAssignmentStatus: (id: string, status: string) =>
    request(`/readings/assignments/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  readingWorklist: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/readings/worklist${query ? `?${query}` : ""}`);
  },
  listReadings: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/readings${query ? `?${query}` : ""}`);
  },
  captureReading: (data: Record<string, unknown>) =>
    request("/readings", { method: "POST", body: JSON.stringify(data) }),
  syncReadings: (readings: Record<string, unknown>[]) =>
    request("/readings/sync", {
      method: "POST",
      body: JSON.stringify({ readings }),
    }),
  decideReading: (
    id: string,
    decision: "APPROVED" | "REJECTED",
    comments: string,
  ) =>
    request(`/readings/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  bulkDecideReadings: (
    readingIds: string[],
    decision: "APPROVED" | "REJECTED",
    comments: string,
  ) =>
    request("/readings/bulk-decision", {
      method: "PATCH",
      body: JSON.stringify({ readingIds, decision, comments }),
    }),
  readingProgress: (cycleId: string) =>
    request(
      `/readings/reports/progress?cycleId=${encodeURIComponent(cycleId)}`,
    ),
  tariffDashboard: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/tariffs/dashboard${query ? `?${query}` : ""}`);
  },
  listTariffs: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/tariffs${query ? `?${query}` : ""}`);
  },
  getTariff: (id: string) => request(`/tariffs/${id}`),
  createTariff: (data: Record<string, unknown>) =>
    request("/tariffs", { method: "POST", body: JSON.stringify(data) }),
  updateTariff: (id: string, data: Record<string, unknown>) =>
    request(`/tariffs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  saveTariffBands: (id: string, bands: Record<string, unknown>[]) =>
    request(`/tariffs/${id}/bands`, {
      method: "PUT",
      body: JSON.stringify({ bands }),
    }),
  simulateTariff: (id: string, data: Record<string, unknown>) =>
    request(`/tariffs/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  simulateTariffBulk: (id: string, fallbackConsumption: number) =>
    request(`/tariffs/${id}/simulate/bulk`, {
      method: "POST",
      body: JSON.stringify({ fallbackConsumption }),
    }),
  submitTariff: (id: string) =>
    request(`/tariffs/${id}/submit`, { method: "POST" }),
  listTariffApprovals: () => request("/tariffs/approvals"),
  decideTariff: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/tariffs/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  activateTariff: (id: string, mode: "NOW" | "AUTO_ON_DATE", reason: string) =>
    request(`/tariffs/${id}/activate`, {
      method: "POST",
      body: JSON.stringify({ mode, reason }),
    }),
  listTariffAssignments: () => request("/tariffs/assignments"),

  billingDashboard: (billingCycleId = "") =>
    request(
      `/billing/dashboard${billingCycleId ? `?billingCycleId=${encodeURIComponent(billingCycleId)}` : ""}`,
    ),
  listBillingCycles: (status = "") =>
    request(
      `/billing/cycles${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  createBillingCycle: (data: Record<string, unknown>) =>
    request("/billing/cycles", { method: "POST", body: JSON.stringify(data) }),
  updateBillingCycleStatus: (id: string, status: string, reason: string) =>
    request(`/billing/cycles/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    }),
  previewBills: (filters: Record<string, string | boolean> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters)
        .filter(([, value]) => value !== "" && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ).toString();
    return request(`/billing/preview${query ? `?${query}` : ""}`);
  },
  generateBills: (data: Record<string, unknown>) =>
    request("/billing/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listBills: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/billing/bills${query ? `?${query}` : ""}`);
  },
  getBill: (id: string) => request(`/billing/bills/${id}`),
  decideBills: (
    billIds: string[],
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request("/billing/bills/decision", {
      method: "PATCH",
      body: JSON.stringify({ billIds, decision, comments }),
    }),
  postBillingCycle: (id: string, reason: string) =>
    request(`/billing/cycles/${id}/post`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  sendBillNotifications: (data: Record<string, unknown>) =>
    request("/billing/notifications", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getCustomerStatement: (accountId: string, from = "", to = "") =>
    request(
      `/billing/statements/${accountId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  listBillingAdjustments: (status = "") =>
    request(
      `/billing/adjustments${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  createBillingAdjustment: (data: Record<string, unknown>) =>
    request("/billing/adjustments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideBillingAdjustment: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/billing/adjustments/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  decideBillingAdjustments: (
    adjustmentIds: string[],
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request("/billing/adjustments/decision", {
      method: "PATCH",
      body: JSON.stringify({ adjustmentIds, decision, comments }),
    }),
  listBillingAlerts: (status = "OPEN") =>
    request(`/billing/alerts?status=${encodeURIComponent(status)}`),
  resolveBillingAlert: (id: string) =>
    request(`/billing/alerts/${id}/resolve`, { method: "PATCH" }),
  billingAudit: (billingCycleId = "") =>
    request(
      `/billing/audit${billingCycleId ? `?billingCycleId=${encodeURIComponent(billingCycleId)}` : ""}`,
    ),
  paymentDashboard: (from = "", to = "") => {
    const query = new URLSearchParams(
      Object.entries({ from, to }).filter(([, value]) => value),
    ).toString();
    return request(`/payments/dashboard/summary${query ? `?${query}` : ""}`);
  },
  listPaymentChannels: () => request("/payments/channels"),
  createPaymentChannel: (data: Record<string, unknown>) =>
    request("/payments/channels", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updatePaymentChannel: (id: string, data: Record<string, unknown>) =>
    request(`/payments/channels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  listPaymentAccounts: (q = "") =>
    request(`/payments/accounts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  listPayments: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/payments${query ? `?${query}` : ""}`);
  },
  recordPayment: (data: Record<string, unknown>) =>
    request("/payments/record", { method: "POST", body: JSON.stringify(data) }),
  ingestMpesaPayment: (data: Record<string, unknown>) =>
    request("/payments/mpesa", { method: "POST", body: JSON.stringify(data) }),
  getMpesaConfig: () => request("/payments/mpesa/config"),
  initiateMpesaStk: (data: Record<string, unknown>) =>
    request("/payments/mpesa/stk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listMpesaStkRequests: (accountId = "") =>
    request(
      `/payments/mpesa/stk${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`,
    ),
  getMpesaStkRequest: (id: string) => request(`/payments/mpesa/stk/${id}`),
  allocatePayment: (id: string, accountId: string, reason: string) =>
    request(`/payments/${id}/allocate`, {
      method: "PATCH",
      body: JSON.stringify({ accountId, reason }),
    }),
  getReceipt: (id: string) => request(`/payments/receipts/${id}`),
  listPaymentReversals: (status = "") =>
    request(
      `/payments/reversals/list${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  requestPaymentReversal: (data: Record<string, unknown>) =>
    request("/payments/reversals", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decidePaymentReversal: (
    id: string,
    decision: "APPROVE" | "REJECT",
    comments: string,
  ) =>
    request(`/payments/reversals/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  paymentAudit: () => request("/payments/audit/events"),
  listReconciliationBatches: () => request("/payments/reconciliation/batches"),
  createReconciliationBatch: (data: Record<string, unknown>) =>
    request("/payments/reconciliation/batches", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  notificationDashboard: () => request("/notifications/dashboard"),
  notificationTargets: () => request("/notifications/targets"),
  notificationAudience: (filters: Record<string, string>) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== ""),
    ).toString();
    return request(`/notifications/audience?${query}`);
  },
  listNotifications: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/notifications${query ? `?${query}` : ""}`);
  },
  sendNotification: (data: Record<string, unknown>) =>
    request("/notifications/send", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  sendBulkNotification: (data: Record<string, unknown>) =>
    request("/notifications/send-bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  processNotifications: (notificationIds?: string[]) =>
    request("/notifications/process", {
      method: "POST",
      body: JSON.stringify({ notificationIds }),
    }),
  retryNotification: (id: string) =>
    request(`/notifications/${id}/retry`, { method: "POST" }),
  listNotificationTemplates: () => request("/notifications/templates"),
  createNotificationTemplate: (data: Record<string, unknown>) =>
    request("/notifications/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateNotificationTemplate: (id: string, data: Record<string, unknown>) =>
    request(`/notifications/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  listNotificationProviders: () => request("/notifications/providers"),
  createNotificationProvider: (data: Record<string, unknown>) =>
    request("/notifications/providers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateNotificationProvider: (id: string, data: Record<string, unknown>) =>
    request(`/notifications/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  configureSmtpProvider: (id: string, data: Record<string, unknown>) =>
    request(`/notifications/providers/${id}/smtp`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  testNotificationProvider: (id: string, recipient: string) =>
    request(`/notifications/providers/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ recipient }),
    }),
  arrearsDashboard: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/arrears/dashboard${query ? `?${query}` : ""}`);
  },
  listArrearsAccounts: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/arrears/accounts${query ? `?${query}` : ""}`);
  },
  getDebtProfile: (id: string, asOf = "") =>
    request(`/arrears/accounts/${id}${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`),
  sendArrearsReminders: (data: Record<string, unknown>) =>
    request("/arrears/reminders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listDebtNotices: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/arrears/notices${query ? `?${query}` : ""}`);
  },
  createDebtNotice: (data: Record<string, unknown>) =>
    request("/arrears/notices", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideDebtNotice: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/arrears/notices/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  decideDebtNotices: (
    noticeIds: string[],
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request("/arrears/notices/decision", {
      method: "PATCH",
      body: JSON.stringify({ noticeIds, decision, comments }),
    }),
  listPaymentPlans: (status = "") =>
    request(`/arrears/plans${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createPaymentPlan: (data: Record<string, unknown>) =>
    request("/arrears/plans", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decidePaymentPlan: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/arrears/plans/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  cancelPaymentPlan: (id: string, reason: string) =>
    request(`/arrears/plans/${id}/cancel`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    }),
  listPromisesToPay: (status = "") =>
    request(`/arrears/promises${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createPromiseToPay: (data: Record<string, unknown>) =>
    request("/arrears/promises", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updatePromiseStatus: (id: string, status: "KEPT" | "BROKEN" | "CANCELLED") =>
    request(`/arrears/promises/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  disconnectionEligible: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/arrears/disconnections/eligible${query ? `?${query}` : ""}`);
  },
  listDisconnectionLists: () => request("/arrears/disconnections"),
  createDisconnectionList: (data: Record<string, unknown>) =>
    request("/arrears/disconnections", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideDisconnectionList: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/arrears/disconnections/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  listDebtWriteOffs: (status = "") =>
    request(`/arrears/write-offs${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createDebtWriteOff: (data: Record<string, unknown>) =>
    request("/arrears/write-offs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideDebtWriteOff: (
    id: string,
    decision: "APPROVE" | "REJECT" | "RETURN",
    comments: string,
  ) =>
    request(`/arrears/write-offs/${id}/decision`, {
      method: "PATCH",
      body: JSON.stringify({ decision, comments }),
    }),
  debtRecoveryReport: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value),
    ).toString();
    return request(`/arrears/recovery-report${query ? `?${query}` : ""}`);
  },
  arrearsAudit: (accountId = "") =>
    request(`/arrears/audit${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`),
  adminDashboard: () => request("/admin/dashboard"),
  listAdminUsers: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    return request(`/admin/users${query ? `?${query}` : ""}`);
  },
  createAdminUser: (data: Record<string, unknown>) => request("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateAdminUser: (id: string, data: Record<string, unknown>) => request(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateAdminUserRoles: (id: string, roleIds: string[]) => request(`/admin/users/${id}/roles`, { method: "PUT", body: JSON.stringify({ roleIds }) }),
  listAdminRoles: () => request("/admin/roles"),
  createAdminRole: (data: Record<string, unknown>) => request("/admin/roles", { method: "POST", body: JSON.stringify(data) }),
  updateAdminRole: (id: string, data: Record<string, unknown>) => request(`/admin/roles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateRolePermissions: (id: string, permissionIds: string[]) => request(`/admin/roles/${id}/permissions`, { method: "PUT", body: JSON.stringify({ permissionIds }) }),
  listAdminPermissions: () => request("/admin/permissions"),
  createAdminPermission: (data: Record<string, unknown>) => request("/admin/permissions", { method: "POST", body: JSON.stringify(data) }),
  updateAdminPermission: (id: string, data: Record<string, unknown>) => request(`/admin/permissions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  serviceRequestDashboard: () => request("/service-requests/dashboard"),
  listServiceRequestTargets: (q = "") => request(`/service-requests/targets${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  listServiceOfficers: () => request("/service-requests/officers"),
  listServiceRequests: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    return request(`/service-requests${query ? `?${query}` : ""}`);
  },
  getServiceRequest: (id: string) => request(`/service-requests/${id}`),
  createServiceRequest: (data: Record<string, unknown>) => request("/service-requests", { method: "POST", body: JSON.stringify(data) }),
  assignServiceRequest: (id: string, data: Record<string, unknown>) => request(`/service-requests/${id}/assign`, { method: "PATCH", body: JSON.stringify(data) }),
  updateServiceRequestStatus: (id: string, data: Record<string, unknown>) => request(`/service-requests/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  addServiceRequestComment: (id: string, comments: string) => request(`/service-requests/${id}/comments`, { method: "POST", body: JSON.stringify({ comments }) }),
  workOrderDashboard: () => request("/work-orders/dashboard"),
  workOrderLookups: () => request("/work-orders/lookups"),
  listWorkOrderTargets: (q = "") => request(`/work-orders/targets${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  listWorkOrders: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    return request(`/work-orders${query ? `?${query}` : ""}`);
  },
  getWorkOrder: (id: string) => request(`/work-orders/${id}`),
  createWorkOrder: (data: Record<string, unknown>) => request("/work-orders", { method: "POST", body: JSON.stringify(data) }),
  assignWorkOrder: (id: string, data: Record<string, unknown>) => request(`/work-orders/${id}/assign`, { method: "PATCH", body: JSON.stringify(data) }),
  updateWorkOrderStatus: (id: string, data: Record<string, unknown>) => request(`/work-orders/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  addWorkOrderEvidence: (id: string, data: Record<string, unknown>) => request(`/work-orders/${id}/evidence`, { method: "POST", body: JSON.stringify(data) }),
  addWorkOrderConsumable: (id: string, data: Record<string, unknown>) => request(`/work-orders/${id}/consumables`, { method: "POST", body: JSON.stringify(data) }),
  verifyWorkOrder: (id: string, data: Record<string, unknown>) => request(`/work-orders/${id}/verify`, { method: "PATCH", body: JSON.stringify(data) }),
  closeWorkOrder: (id: string, notes: string) => request(`/work-orders/${id}/close`, { method: "PATCH", body: JSON.stringify({ notes }) }),
  connectionDashboard: () => request("/connections/dashboard"),
  connectionLookups: () => request("/connections/lookups"),
  listConnections: (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    return request(`/connections${query ? `?${query}` : ""}`);
  },
  getConnection: (id: string) => request(`/connections/${id}`),
  createConnection: (data: Record<string, unknown>) =>
    request("/connections", { method: "POST", body: JSON.stringify(data) }),
  updateConnection: (id: string, data: Record<string, unknown>) =>
    request(`/connections/${id}/action`, { method: "PATCH", body: JSON.stringify(data) }),
  linkConnectionCustomer: (id: string, customerId: string) =>
    request(`/connections/${id}/link-customer`, {
      method: "POST",
      body: JSON.stringify({ customerId }),
    }),
  getSystemSettings: () => request("/settings"),
  updateSystemSettings: (data: Record<string, unknown>) =>
    request("/settings", { method: "PUT", body: JSON.stringify(data) }),
};
