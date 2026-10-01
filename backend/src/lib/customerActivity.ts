export type CustomerProfileChange = {
  field: string;
  previousValue: string | null;
  newValue: string | null;
};

const AUDITED_CUSTOMER_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "organizationName",
  "nationalId",
  "registrationNumber",
  "phoneNumber",
  "alternativePhone",
  "emailAddress",
  "preferredLanguage",
  "status",
] as const;

function auditValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

export function buildCustomerProfileChanges(
  before: Record<string, unknown>,
  updates: Record<string, unknown>,
): CustomerProfileChange[] {
  return AUDITED_CUSTOMER_FIELDS.flatMap((field) => {
    if (!(field in updates)) return [];
    const previousValue = auditValue(before[field]);
    const newValue = auditValue(updates[field]);
    return previousValue === newValue
      ? []
      : [{ field, previousValue, newValue }];
  });
}

export type CustomerActivityRow = {
  id: string;
  group: string;
  occurredAt: Date | string;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export function normalizeCustomerActivity(row: CustomerActivityRow) {
  if (row.group !== "NOTIFICATION") return row;
  const data = row.data ?? {};
  return {
    ...row,
    data: {
      kind: "NOTIFICATION",
      notificationType: data.notificationType ?? null,
      channel: data.channel ?? null,
      recipient: data.recipient ?? null,
      deliveryStatus: data.deliveryStatus ?? null,
      createdAt: data.createdAt ?? row.occurredAt,
      sentAt: data.sentAt ?? null,
      accountNumber: data.accountNumber ?? null,
      messageBody: data.messageBody ?? "",
      isResend: data.isResend === true,
      originalNotificationId: data.originalNotificationId ?? null,
    },
  };
}

export function compareCustomerActivityNewestFirst(a: CustomerActivityRow, b: CustomerActivityRow) {
  const timeDifference = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  return timeDifference || String(b.id).localeCompare(String(a.id));
}

export function customerActivityPagination(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
