import { Router } from "express";
import { existsSync } from "fs";
import jwt from "jsonwebtoken";
import path from "path";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { initiateMpesaStk } from "../lib/mpesaStk";

export const mobileRouter = Router();

const fallbackBranding = {
  utilityName: "AquaFlow",
  utilityCode: "AQUAFLOW",
  emailAddress: null,
  phoneNumber: null,
  physicalAddress: null,
  currencyCode: "KES",
  timezone: "Africa/Nairobi",
  locale: "en-KE",
  maintenanceMode: false,
};

mobileRouter.get("/bootstrap", async (_req, res, next) => {
  try {
    const settings =
      (await prisma.systemSetting.findUnique({ where: { settingId: 1n } })) ??
      fallbackBranding;
    res.json({
      apiVersion: 1,
      branding: {
        appName: settings.utilityName,
        organizationCode: settings.utilityCode,
        supportEmail: settings.emailAddress,
        supportPhone: settings.phoneNumber,
        physicalAddress: settings.physicalAddress,
      },
      regional: {
        currencyCode: settings.currencyCode,
        timezone: settings.timezone,
        locale: settings.locale,
      },
      maintenanceMode: settings.maintenanceMode,
      capabilities: {
        fieldReadings: true,
        offlineSync: true,
        gpsCapture: true,
        photoEvidence: true,
        maximumSyncBatch: 100,
        maximumEvidencePerReading: 3,
        maximumEvidenceCharacters: 6_000_000,
      },
    });
  } catch (error) {
    next(error);
  }
});

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function isLegacyImportReference(value: string) {
  return /^ReceiptsData(?:Current|History):/i.test(value);
}

mobileRouter.post("/customer/login", async (req, res, next) => {
  try {
    const parsed = z.object({ phoneNumber: z.string().trim().min(7).max(30) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter your registered phone number" });
    const requested = normalizedPhone(parsed.data.phoneNumber);
    const candidates = await prisma.customer.findMany({
      where: { status: "ACTIVE", phoneNumber: { not: "" } },
    });
    const matches = candidates.filter((customer) => normalizedPhone(customer.phoneNumber) === requested);
    if (matches.length !== 1) {
      return res.status(401).json({
        error: matches.length ? "This phone number belongs to more than one customer record" : "No active customer was found with this phone number",
      });
    }
    const customer = matches[0];
    const customerName = customer.organizationName ||
      [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
    const identity = {
      userId: customer.customerId.toString(),
      username: customer.phoneNumber,
      userType: "CUSTOMER",
      roles: ["CUSTOMER"],
    };
    const secret = process.env.JWT_SECRET as string;
    res.json({
      token: jwt.sign({ ...identity, tokenType: "access" }, secret, { expiresIn: "8h" }),
      refreshToken: jwt.sign({ ...identity, tokenType: "refresh" }, secret, { expiresIn: "30d" }),
      expiresIn: 8 * 60 * 60,
      user: {
        userId: customer.customerId,
        username: customer.phoneNumber,
        firstName: customerName,
        lastName: "",
        userType: "CUSTOMER",
        roles: ["CUSTOMER"],
      },
    });
  } catch (error) {
    next(error);
  }
});

mobileRouter.use(requireAuth);

mobileRouter.post("/customer/pay", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.object({
    accountId: z.coerce.bigint().positive(),
    amount: z.coerce.number().positive().max(250_000),
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const customerId = BigInt(req.user!.userId);
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: parsed.data.accountId },
      include: { customer: true },
    });
    if (!account) {
      return res.status(404).json({ error: "Customer account not found" });
    }
    if (account.customer.customerId !== customerId) {
      return res.status(403).json({ error: "This account does not belong to the authenticated customer" });
    }
    if (account.accountStatus !== "ACTIVE") {
      return res.status(409).json({ error: "Customer account is not active" });
    }

    const outstandingBalance = Number(account.currentBalance);
    if (!Number.isFinite(outstandingBalance) || outstandingBalance <= 0) {
      return res.status(409).json({ error: "This account has no outstanding balance" });
    }
    if (parsed.data.amount > outstandingBalance) {
      return res.status(400).json({
        error: "Payment amount cannot exceed the outstanding balance",
        outstandingBalance,
      });
    }

    const row = await initiateMpesaStk({
      account,
      phoneNumber: account.customer.phoneNumber,
      amount: parsed.data.amount,
      // Customer identities are not User rows, so this nullable staff-audit FK
      // must remain null. Ownership is enforced through account.customerId.
      initiatedBy: null,
    });
    res.status(201).json(row);
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({
        error: error.message,
        ...(error.stkRequestId ? { stkRequestId: error.stkRequestId } : {}),
        ...(error.daraja ? { details: error.daraja } : {}),
      });
    }
    next(error);
  }
});

mobileRouter.get("/customer/pay/:id", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.coerce.bigint().positive().safeParse(req.params.id);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid STK request ID" });
  }

  try {
    const customerId = BigInt(req.user!.userId);
    const row = await prisma.mpesaStkRequest.findUnique({
      where: { stkRequestId: parsed.data },
      include: {
        account: { include: { customer: true } },
        payment: { include: { receipt: true } },
      },
    });
    if (!row) return res.status(404).json({ error: "STK request not found" });
    if (row.account.customer.customerId !== customerId) {
      return res.status(403).json({ error: "This payment request does not belong to the authenticated customer" });
    }
    res.json(row);
  } catch (error) {
    next(error);
  }
});

const customerServiceRequestInput = z.object({
  accountId: z.coerce.bigint().positive(),
  subject: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(500),
  location: z.string().trim().max(300).optional().nullable(),
  photoEvidence: z.string().trim().max(6_000_000).optional().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

async function ownedCustomerAccount(customerId: bigint, accountId: bigint) {
  const account = await prisma.customerAccount.findUnique({
    where: { accountId },
    include: { customer: true },
  });
  if (!account) {
    const error = new Error("Customer account not found") as Error & { status: number };
    error.status = 404;
    throw error;
  }
  if (account.customerId !== customerId) {
    const error = new Error("This account does not belong to the authenticated customer") as Error & { status: number };
    error.status = 403;
    throw error;
  }
  return account;
}

async function createCustomerServiceRequest(
  customerId: bigint,
  data: z.infer<typeof customerServiceRequestInput>,
  category: string,
  requestType: "COMPLAINT" | "SERVICE_REQUEST",
) {
  const account = await ownedCustomerAccount(customerId, data.accountId);
  const hours = category === "LEAKAGE" ? 4 : 72;
  const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const requestNumber = `SR-${Date.now()}-${account.accountNumber}`.slice(0, 60);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<any[]>`
      INSERT INTO aquaflow.service_requests
        (request_number, request_type, customer_id, account_id, category,
         subject, description, contact_channel, priority, status, due_at,
         location_details, photo_evidence, created_by)
      VALUES
        (${requestNumber}, ${requestType}, ${customerId}, ${account.accountId}, ${category},
         ${data.subject}, ${data.description}, 'OTHER',
         ${category === "LEAKAGE" ? (data.severity === "CRITICAL" ? "URGENT" : data.severity || "MEDIUM") : "MEDIUM"}, 'OPEN', ${dueAt},
         ${data.location || null}, ${data.photoEvidence || null}, NULL)
      RETURNING service_request_id AS "serviceRequestId", request_number AS "requestNumber",
        request_type AS "requestType", category, subject, status, created_at AS "createdAt"`;
    await tx.$executeRaw`
      INSERT INTO aquaflow.service_request_events
        (service_request_id, event_type, new_status, comments, performed_by)
      VALUES (${rows[0].serviceRequestId}, 'CUSTOMER_SUBMITTED', 'OPEN',
        ${data.description}, NULL)`;
    return rows[0];
  });
}

mobileRouter.post("/customer/complaint", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = customerServiceRequestInput.extend({
    category: z.enum(["BILLING", "WATER_SUPPLY", "METER", "WATER_QUALITY", "CONNECTION", "PAYMENT", "STAFF_CONDUCT", "OTHER"]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const row = await createCustomerServiceRequest(
      BigInt(req.user!.userId),
      parsed.data,
      parsed.data.category,
      "COMPLAINT",
    );
    res.status(201).json(row);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

const customerComplaintSelect = {
  serviceRequestId: true,
  requestNumber: true,
  requestType: true,
  category: true,
  subject: true,
  description: true,
  priority: true,
  status: true,
  locationDetails: true,
  photoEvidence: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

mobileRouter.get("/customer/complaints", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const complaints = await prisma.serviceRequest.findMany({
      where: {
        customerId: BigInt(req.user!.userId),
        OR: [{ requestType: "COMPLAINT" }, { category: "LEAKAGE" }],
      },
      select: customerComplaintSelect,
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: complaints });
  } catch (error) {
    next(error);
  }
});

mobileRouter.get("/customer/complaints/:id", requireRole("CUSTOMER"), async (req, res, next) => {
  const requestId = z.coerce.bigint().positive().safeParse(req.params.id);
  if (!requestId.success) return res.status(400).json({ error: "Invalid complaint id" });
  try {
    const complaint = await prisma.serviceRequest.findFirst({
      where: {
        serviceRequestId: requestId.data,
        customerId: BigInt(req.user!.userId),
        OR: [{ requestType: "COMPLAINT" }, { category: "LEAKAGE" }],
      },
      select: customerComplaintSelect,
    });
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });
    res.json(complaint);
  } catch (error) {
    next(error);
  }
});

mobileRouter.post("/customer/leak-report", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = customerServiceRequestInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const row = await createCustomerServiceRequest(
      BigInt(req.user!.userId),
      parsed.data,
      "LEAKAGE",
      "SERVICE_REQUEST",
    );
    res.status(201).json(row);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.post("/customer/reconnection", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.object({
    accountId: z.coerce.bigint().positive(),
    reason: z.string().trim().min(10).max(1000),
    contactPhone: z.string().trim().min(7).max(40).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const customerId = BigInt(req.user!.userId);
    const account = await ownedCustomerAccount(customerId, parsed.data.accountId);
    const settings = await prisma.systemSetting.findUnique({ where: { settingId: 1n } });
    const number = `RC-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO aquaflow.reconnection_requests
        (request_number, customer_id, account_id, reason, contact_phone, reconnection_fee)
      VALUES (${number}, ${customerId}, ${account.accountId}, ${parsed.data.reason},
        ${parsed.data.contactPhone || account.customer.phoneNumber},
        ${Number(settings?.reconnectionFee ?? 0)})
      RETURNING reconnection_request_id AS "reconnectionRequestId",
        request_number AS "requestNumber", status, reconnection_fee AS "reconnectionFee",
        created_at AS "createdAt"`;
    res.status(201).json(rows[0]);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.post("/customer/reconnection/:reconnectionId/pay", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsedId = z.coerce.bigint().positive().safeParse(req.params.reconnectionId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid reconnection request" });
  try {
    const customerId = BigInt(req.user!.userId);
    const rows = await prisma.$queryRaw<any[]>`
      SELECT r.reconnection_request_id AS "reconnectionRequestId",
        r.request_number AS "requestNumber", r.customer_id AS "customerId",
        r.reconnection_fee AS "reconnectionFee",
        r.fee_payment_status AS "feePaymentStatus", r.status,
        a.account_id AS "accountId", a.account_number AS "accountNumber",
        c.phone_number AS "phoneNumber"
      FROM aquaflow.reconnection_requests r
      JOIN aquaflow.customer_accounts a ON a.account_id=r.account_id
      JOIN aquaflow.customers c ON c.customer_id=r.customer_id
      WHERE r.reconnection_request_id=${parsedId.data}`;
    const request = rows[0];
    if (!request) return res.status(404).json({ error: "Reconnection request not found" });
    if (BigInt(request.customerId) !== customerId) {
      return res.status(403).json({ error: "This reconnection request does not belong to the authenticated customer" });
    }
    if (["REJECTED", "CANCELLED", "COMPLETED"].includes(request.status)) {
      return res.status(409).json({ error: `A ${request.status.toLowerCase()} reconnection request cannot be paid` });
    }
    if (request.feePaymentStatus === "PAID") {
      return res.status(409).json({ error: "The reconnection fee has already been paid" });
    }
    const fee = Number(request.reconnectionFee);
    if (!Number.isInteger(fee) || fee <= 0) {
      return res.status(409).json({ error: "A positive whole-number reconnection fee is not configured" });
    }
    const row = await initiateMpesaStk({
      account: { accountId: BigInt(request.accountId), accountNumber: request.accountNumber },
      phoneNumber: request.phoneNumber,
      amount: fee,
      initiatedBy: null,
      accountReference: request.requestNumber,
      description: "AquaFlow reconnection fee",
      purposeType: "RECONNECTION_FEE",
      purposeReference: request.requestNumber,
    });
    await prisma.$executeRaw`
      UPDATE aquaflow.reconnection_requests
      SET fee_payment_status='PENDING', updated_at=NOW()
      WHERE reconnection_request_id=${parsedId.data}`;
    res.status(201).json({
      stkRequestId: row.stkRequestId,
      reconnectionRequestId: request.reconnectionRequestId,
      requestNumber: request.requestNumber,
      amount: row.amount,
      status: row.status,
      feePaymentStatus: "PENDING",
      customerMessage: row.customerMessage,
    });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({
      error: error.message,
      ...(error.stkRequestId ? { stkRequestId: error.stkRequestId } : {}),
      ...(error.daraja ? { details: error.daraja } : {}),
    });
    next(error);
  }
});

mobileRouter.get("/customer/reconnection/:reconnectionId/pay/:stkRequestId", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsedReconnectionId = z.coerce.bigint().positive().safeParse(req.params.reconnectionId);
  const parsedStkId = z.coerce.bigint().positive().safeParse(req.params.stkRequestId);
  if (!parsedReconnectionId.success || !parsedStkId.success) {
    return res.status(400).json({ error: "Invalid reconnection payment request" });
  }
  try {
    const customerId = BigInt(req.user!.userId);
    const requests = await prisma.$queryRaw<any[]>`
      SELECT reconnection_request_id AS "reconnectionRequestId", request_number AS "requestNumber",
        customer_id AS "customerId", fee_payment_status AS "feePaymentStatus"
      FROM aquaflow.reconnection_requests
      WHERE reconnection_request_id=${parsedReconnectionId.data}`;
    const reconnection = requests[0];
    if (!reconnection) return res.status(404).json({ error: "Reconnection request not found" });
    if (BigInt(reconnection.customerId) !== customerId) {
      return res.status(403).json({ error: "This reconnection request does not belong to the authenticated customer" });
    }
    const row = await prisma.mpesaStkRequest.findUnique({
      where: { stkRequestId: parsedStkId.data },
      include: { payment: { include: { receipt: true } } },
    });
    if (!row || row.purposeType !== "RECONNECTION_FEE" || row.purposeReference !== reconnection.requestNumber) {
      return res.status(404).json({ error: "Reconnection payment request not found" });
    }
    res.json({
      stkRequestId: row.stkRequestId,
      reconnectionRequestId: reconnection.reconnectionRequestId,
      requestNumber: reconnection.requestNumber,
      amount: row.amount,
      status: row.status,
      feePaymentStatus: reconnection.feePaymentStatus,
      customerMessage: row.customerMessage,
      resultDescription: row.status === "COMPLETED"
        ? "Your reconnection fee payment was successful."
        : row.resultDescription,
      mpesaReceiptNumber: row.mpesaReceiptNumber,
      receiptNumber: row.payment?.receipt?.receiptNumber ?? null,
    });
  } catch (error) {
    next(error);
  }
});

const newConnectionStatusOrder = [
  "SUBMITTED", "INSPECTION_SCHEDULED", "INSPECTED", "QUOTED", "PARTIALLY_PAID",
  "PAID", "APPROVED", "CUSTOMER_CREATED", "INSTALLATION_ORDERED",
  "INSTALLATION_COMPLETED", "ACTIVE",
];

function newConnectionTimeline(application: any, activities: any[]) {
  const activityDate = (...types: string[]) =>
    activities.find((activity) => types.includes(activity.activityType))?.performedAt ?? null;
  const rank = newConnectionStatusOrder.indexOf(application.status);
  const stages = [
    { key: "APPLICATION_SUBMITTED", label: "Application Submitted", threshold: 0, timestamp: activityDate("CUSTOMER_SUBMITTED", "APPLICATION_SUBMITTED") ?? application.createdAt },
    { key: "INSPECTION_SCHEDULED", label: "Site Inspection Scheduled", threshold: 1, timestamp: activityDate("SCHEDULE_INSPECTION") ?? application.inspectionScheduledAt },
    { key: "INSPECTION_COMPLETED", label: "Site Inspection Completed", threshold: 2, timestamp: activityDate("RECORD_INSPECTION") },
    { key: "QUOTATION_GENERATED", label: "Quotation Generated", threshold: 3, timestamp: activityDate("ISSUE_QUOTATION") },
    { key: "PAYMENT_PENDING", label: "Payment Pending", threshold: 5, timestamp: activityDate("MPESA_PAYMENT", "RECORD_PAYMENT") },
    { key: "APPROVAL_PENDING", label: "Approval Pending", threshold: 6, timestamp: activityDate("APPROVE") },
    { key: "INSTALLATION_PENDING", label: "Installation Pending", threshold: 8, timestamp: activityDate("MARK_INSTALLATION_ORDERED") },
    { key: "ACCOUNT_ACTIVATION", label: "Account Activation", threshold: 10, timestamp: activityDate("ACTIVATE") },
  ];
  return stages.map((stage) => {
    const done = rank >= stage.threshold && application.status !== "REJECTED";
    return {
      key: stage.key,
      label: stage.label,
      state: done ? "DONE" : "PENDING",
      done,
      pending: !done,
      timestamp: done ? stage.timestamp : null,
    };
  });
}

async function customerNewConnection(applicationId: bigint) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT a.connection_application_id AS "connectionApplicationId",
      a.application_number AS "applicationNumber", a.customer_id AS "customerId",
      a.applicant_name AS "applicantName", a.phone_number AS "phoneNumber",
      a.identification_number AS "identificationNumber", a.physical_address AS "physicalAddress",
      a.plot_number AS "plotNumber", a.connection_type AS "connectionType", a.status,
      a.connection_fee AS "connectionFee", a.materials_cost AS "materialsCost",
      a.labour_cost AS "labourCost", a.quotation_total AS "quotationTotal",
      a.amount_paid AS "amountPaid", a.payment_reference AS "paymentReference",
      a.inspection_scheduled_at AS "inspectionScheduledAt",
      a.created_at AS "createdAt", a.updated_at AS "updatedAt"
    FROM aquaflow.new_connection_applications a
    WHERE a.connection_application_id=${applicationId}`;
  return rows[0] ?? null;
}

mobileRouter.get("/customer/new-connections", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const customerId = BigInt(req.user!.userId);
    const rows = await prisma.$queryRaw<any[]>`
      SELECT connection_application_id AS "connectionApplicationId",
        application_number AS "applicationNumber", status,
        connection_type AS "connectionType", connection_fee AS "connectionFee",
        quotation_total AS "quotationTotal", amount_paid AS "amountPaid",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM aquaflow.new_connection_applications
      WHERE customer_id=${customerId}
      ORDER BY created_at DESC`;
    res.json({ rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

mobileRouter.get("/customer/new-connections/:applicationId", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsedId = z.coerce.bigint().positive().safeParse(req.params.applicationId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid connection application" });
  try {
    const application = await customerNewConnection(parsedId.data);
    if (!application) return res.status(404).json({ error: "Connection application not found" });
    if (BigInt(application.customerId) !== BigInt(req.user!.userId)) {
      return res.status(403).json({ error: "This connection application does not belong to the authenticated customer" });
    }
    const activities = await prisma.$queryRaw<any[]>`
      SELECT activity_type AS "activityType", performed_at AS "performedAt"
      FROM aquaflow.new_connection_activities
      WHERE connection_application_id=${parsedId.data}
      ORDER BY performed_at ASC`;
    res.json({
      ...application,
      outstandingAmount: Math.max(0, Number(application.quotationTotal) - Number(application.amountPaid)),
      paymentStatus: Number(application.amountPaid) <= 0 ? "UNPAID"
        : Number(application.amountPaid) >= Number(application.quotationTotal) ? "PAID" : "PARTIALLY_PAID",
      timeline: newConnectionTimeline(application, activities),
    });
  } catch (error) {
    next(error);
  }
});

mobileRouter.post("/customer/new-connections/:applicationId/pay", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsedId = z.coerce.bigint().positive().safeParse(req.params.applicationId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid connection application" });
  try {
    const customerId = BigInt(req.user!.userId);
    const application = await customerNewConnection(parsedId.data);
    if (!application) return res.status(404).json({ error: "Connection application not found" });
    if (BigInt(application.customerId) !== customerId) {
      return res.status(403).json({ error: "This connection application does not belong to the authenticated customer" });
    }
    if (!["QUOTED", "PARTIALLY_PAID"].includes(application.status)) {
      return res.status(409).json({ error: "The connection quotation must be issued before payment can be requested" });
    }
    const amount = Number(application.quotationTotal) - Number(application.amountPaid);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(409).json({ error: "There is no positive whole-number outstanding connection amount to pay" });
    }
    const account = await prisma.customerAccount.findFirst({
      where: { customerId, accountStatus: { not: "CLOSED" } },
      orderBy: { accountId: "asc" },
      include: { customer: true },
    });
    if (!account) return res.status(409).json({ error: "An active customer account is required to initiate M-Pesa payment" });
    const row = await initiateMpesaStk({
      account: { accountId: account.accountId, accountNumber: account.accountNumber },
      phoneNumber: application.phoneNumber || account.customer.phoneNumber,
      amount,
      initiatedBy: null,
      accountReference: application.applicationNumber,
      description: "AquaFlow new connection payment",
      purposeType: "NEW_CONNECTION_FEE",
      purposeReference: application.applicationNumber,
    });
    res.status(201).json({
      stkRequestId: row.stkRequestId,
      connectionApplicationId: application.connectionApplicationId,
      applicationNumber: application.applicationNumber,
      amount: row.amount,
      status: row.status,
      paymentStatus: "PENDING",
      customerMessage: row.customerMessage,
    });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({
      error: error.message,
      ...(error.stkRequestId ? { stkRequestId: error.stkRequestId } : {}),
      ...(error.daraja ? { details: error.daraja } : {}),
    });
    next(error);
  }
});

mobileRouter.get("/customer/new-connections/:applicationId/pay/:stkRequestId", requireRole("CUSTOMER"), async (req, res, next) => {
  const applicationId = z.coerce.bigint().positive().safeParse(req.params.applicationId);
  const stkRequestId = z.coerce.bigint().positive().safeParse(req.params.stkRequestId);
  if (!applicationId.success || !stkRequestId.success) return res.status(400).json({ error: "Invalid connection payment request" });
  try {
    const application = await customerNewConnection(applicationId.data);
    if (!application) return res.status(404).json({ error: "Connection application not found" });
    if (BigInt(application.customerId) !== BigInt(req.user!.userId)) {
      return res.status(403).json({ error: "This connection application does not belong to the authenticated customer" });
    }
    const row = await prisma.mpesaStkRequest.findUnique({
      where: { stkRequestId: stkRequestId.data },
      include: { payment: { include: { receipt: true } } },
    });
    if (!row || row.purposeType !== "NEW_CONNECTION_FEE" || row.purposeReference !== application.applicationNumber) {
      return res.status(404).json({ error: "Connection payment request not found" });
    }
    res.json({
      stkRequestId: row.stkRequestId,
      connectionApplicationId: application.connectionApplicationId,
      applicationNumber: application.applicationNumber,
      amount: row.amount,
      status: row.status,
      paymentStatus: row.status === "COMPLETED" ? "PAID" : row.status,
      customerMessage: row.customerMessage,
      resultDescription: row.status === "COMPLETED" ? "Your new connection payment was successful." : row.resultDescription,
      mpesaReceiptNumber: row.mpesaReceiptNumber,
      receiptNumber: row.payment?.receipt?.receiptNumber ?? null,
    });
  } catch (error) {
    next(error);
  }
});

mobileRouter.post("/customer/new-connection", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.object({
    applicantName: z.string().trim().min(2).max(200),
    identificationNumber: z.string().trim().min(1).max(80),
    phoneNumber: z.string().trim().min(7).max(40),
    emailAddress: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
    physicalAddress: z.string().trim().min(3).max(300),
    plotNumber: z.string().trim().min(1).max(100),
    zoneId: z.coerce.bigint().positive().optional().nullable(),
    connectionType: z.enum(["DOMESTIC", "COMMERCIAL", "INSTITUTIONAL", "PUBLIC"]),
    remarks: z.string().trim().max(1000).optional().nullable(),
    gpsLatitude: z.number().min(-90).max(90).optional().nullable(),
    gpsLongitude: z.number().min(-180).max(180).optional().nullable(),
    documents: z.array(z.object({
      name: z.string().trim().min(1).max(180),
      mimeType: z.string().trim().min(1).max(100),
      data: z.string().startsWith("data:").max(7_000_000),
    })).max(6).default([]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const customerId = BigInt(req.user!.userId);
    const customer = await prisma.customer.findUnique({ where: { customerId } });
    if (!customer || customer.status !== "ACTIVE") {
      return res.status(404).json({ error: "Active customer profile not found" });
    }
    if (parsed.data.zoneId) {
      const zone = await prisma.zone.findUnique({ where: { zoneId: parsed.data.zoneId } });
      if (!zone || zone.status !== "ACTIVE") return res.status(400).json({ error: "Select an active service zone" });
    }
    const settings = await prisma.systemSetting.findUnique({ where: { settingId: 1n } });
    if (settings?.defaultConnectionFee == null) {
      return res.status(409).json({ error: "The default connection fee is not configured" });
    }
    const number = `NC-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
    const rows = await prisma.$transaction(async (tx) => {
      const created = await tx.$queryRaw<any[]>`
        INSERT INTO aquaflow.new_connection_applications
          (application_number, customer_id, applicant_type, applicant_name,
           identification_number, phone_number, email_address, physical_address,
           plot_number, zone_id, connection_type, connection_fee, remarks, created_by)
        VALUES (${number}, ${customerId}, 'INDIVIDUAL', ${parsed.data.applicantName},
          ${parsed.data.identificationNumber || null}, ${parsed.data.phoneNumber},
          ${parsed.data.emailAddress || null}, ${parsed.data.physicalAddress},
          ${parsed.data.plotNumber || null}, ${parsed.data.zoneId ?? null},
          ${parsed.data.connectionType}, ${Number(settings.defaultConnectionFee)},
          ${parsed.data.remarks || null}, NULL)
        RETURNING connection_application_id AS "connectionApplicationId",
          application_number AS "applicationNumber", status, created_at AS "createdAt"`;
      await tx.$executeRaw`
        INSERT INTO aquaflow.new_connection_activities
          (connection_application_id, activity_type, notes, performed_by)
        VALUES (${created[0].connectionApplicationId}, 'CUSTOMER_SUBMITTED',
          'Application submitted through the customer mobile channel', NULL)`;
      if (parsed.data.gpsLatitude != null && parsed.data.gpsLongitude != null) {
        await tx.$executeRaw`
          INSERT INTO aquaflow.new_connection_activities
            (connection_application_id, activity_type, notes, performed_by)
          VALUES (${created[0].connectionApplicationId}, 'GPS_CAPTURED',
            ${JSON.stringify({ latitude: parsed.data.gpsLatitude, longitude: parsed.data.gpsLongitude })}, NULL)`;
      }
      for (const document of parsed.data.documents) {
        await tx.$executeRaw`
          INSERT INTO aquaflow.new_connection_activities
            (connection_application_id, activity_type, notes, performed_by)
          VALUES (${created[0].connectionApplicationId}, 'DOCUMENT_ATTACHED',
            ${JSON.stringify(document)}, NULL)`;
      }
      return created[0];
    });
    res.status(201).json({
      ...rows,
      connectionFee: Number(settings.defaultConnectionFee),
      documentsAttached: parsed.data.documents.length,
      gpsCaptured: parsed.data.gpsLatitude != null,
    });
  } catch (error) {
    next(error);
  }
});

type StatementEntry = {
  date: Date;
  particulars: string;
  reference: string;
  period: string;
  details: string;
  debit: number;
  credit: number;
  balance: number;
};

type OtherServicePayment = {
  type: "RECONNECTION_FEE" | "NEW_CONNECTION_FEE";
  label: string;
  reference: string;
  receiptNumber: string | null;
  transactionReference: string;
  date: Date;
  amount: number;
  paymentStatus: string;
};

type CustomerStatementData = {
  utility: {
    name: string;
    phone: string | null;
    secondaryPhone: string | null;
    email: string | null;
    address: string;
  };
  account: {
    customerName: string;
    phone: string;
    email: string | null;
    accountNumber: string;
    status: string;
    meterNumber: string | null;
    zone: string | null;
    route: string | null;
    tariff: string;
    address: string | null;
  };
  from: string;
  to: string;
  openingBalance: number;
  totalBills: number;
  totalPayments: number;
  closingBalance: number;
  entries: StatementEntry[];
  otherServicePayments: OtherServicePayment[];
  otherServicePaymentsSubtotal: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function statementDate(value: unknown, endOfDay = false) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

function customerDisplayName(customer: {
  organizationName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}) {
  return customer.organizationName ||
    [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
}

function statementPdf(data: CustomerStatementData & { printedAt: Date }) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    const chunks: Buffer[] = [];
    const money = (value: number) =>
      `KSh ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const logoPath = path.resolve(__dirname, "../../assets/samdamte-water-logo-print.png");
    const labelValue = (label: string, value: string, x: number, y: number, width = 225) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#132036").text(label, x, y, { width: 75 });
      doc.font("Helvetica").text(value || "-", x + 78, y, { width: width - 78 });
    };
    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(42, y, 511, 20).fill("#1262B3");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
      doc.text("Date", 47, y + 6, { width: 55 });
      doc.text("Particulars / Reference", 105, y + 6, { width: 166 });
      doc.text("Period", 274, y + 6, { width: 55 });
      doc.text("Credits", 332, y + 6, { width: 65, align: "right" });
      doc.text("Debits", 400, y + 6, { width: 65, align: "right" });
      doc.text("Balance", 468, y + 6, { width: 80, align: "right" });
      doc.y = y + 25;
    };

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    if (existsSync(logoPath)) {
      doc.image(logoPath, 42, 38, { fit: [260, 78], valign: "center" });
    } else {
      doc.fillColor("#1262B3").font("Helvetica-Bold").fontSize(20).text(data.utility.name, 42, 52);
    }
    const contactX = 340;
    doc.font("Helvetica").fontSize(8.5).fillColor("#132036");
    const phones = [data.utility.phone, data.utility.secondaryPhone].filter(Boolean).join(" / ");
    doc.text(`Tel: ${phones || "-"}`, contactX, 42, { width: 213 });
    doc.text(`Email: ${data.utility.email || "-"}`, contactX, 57, { width: 213 });
    doc.text(`Address: ${data.utility.address || "-"}`, contactX, 72, { width: 213 });
    doc.fillColor("#60708A").fontSize(7.5)
      .text(`Printed: ${data.printedAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`, contactX, 96, { width: 213 });
    doc.strokeColor("#1262B3").lineWidth(2).moveTo(42, 122).lineTo(553, 122).stroke();

    doc.fillColor("#132036").font("Helvetica-Bold").fontSize(16)
      .text("ACCOUNT STATEMENT", 42, 138, { width: 511, align: "center" });
    const leftX = 42;
    const rightX = 310;
    let detailsY = 174;
    labelValue("To:", data.account.customerName, leftX, detailsY, 245);
    labelValue("Account:", data.account.accountNumber, rightX, detailsY, 243);
    detailsY += 16;
    labelValue("Mobile:", data.account.phone, leftX, detailsY, 245);
    labelValue("Zone:", data.account.zone || "-", rightX, detailsY, 243);
    detailsY += 16;
    labelValue("Email:", data.account.email || "-", leftX, detailsY, 245);
    labelValue("Route:", data.account.route || "-", rightX, detailsY, 243);
    detailsY += 16;
    labelValue("Account status:", data.account.status.replace(/_/g, " "), leftX, detailsY, 245);
    labelValue("Tariff:", data.account.tariff, rightX, detailsY, 243);
    detailsY += 16;
    labelValue("Meter number:", data.account.meterNumber || "-", leftX, detailsY, 245);

    const periodY = detailsY + 24;
    doc.strokeColor("#DCE4EF").lineWidth(0.7).moveTo(42, periodY - 6).lineTo(553, periodY - 6).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#132036")
      .text("Statement period:", 42, periodY, { continued: true })
      .font("Helvetica").text(` ${data.from} - ${data.to}`);
    if (data.account.address) {
      doc.font("Helvetica-Bold").text("Service address:", 310, periodY, { continued: true })
        .font("Helvetica").text(` ${data.account.address}`, { width: 243 });
    }
    doc.strokeColor("#DCE4EF").moveTo(42, periodY + 16).lineTo(553, periodY + 16).stroke();
    doc.y = periodY + 28;

    drawTableHeader();
    const openingY = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#132036")
      .text("Opening balance", 105, openingY + 5, { width: 224 });
    doc.text(money(data.openingBalance), 468, openingY + 5, { width: 80, align: "right" });
    doc.strokeColor("#B9C6D8").moveTo(42, openingY + 23).lineTo(553, openingY + 23).stroke();
    doc.y = openingY + 27;
    if (!data.entries.length) {
      doc.fillColor("#60708A").font("Helvetica-Oblique").fontSize(9)
        .text("No posted bills or payments in this period.", 47, doc.y, { width: 500 });
      doc.moveDown(1.5);
    } else {
      for (const entry of data.entries) {
        if (doc.y > 748) {
          doc.addPage();
          drawTableHeader();
        }
        const y = doc.y;
        const particulars = `${entry.particulars}\n${entry.reference}`;
        const rowHeight = Math.max(30, doc.heightOfString(`${particulars}\n${entry.details}`, { width: 162 }) + 8);
        doc.fillColor("#132036").font("Helvetica").fontSize(8);
        doc.text(entry.date.toISOString().slice(0, 10), 47, y + 5, { width: 55 });
        doc.font("Helvetica-Bold").text(entry.particulars, 105, y + 5, { width: 166 });
        doc.font("Helvetica").fontSize(7).fillColor("#60708A")
          .text(entry.reference, 105, y + 15, { width: 166 })
          .text(entry.details, 105, y + 24, { width: 166 });
        doc.fontSize(8).fillColor("#132036").text(entry.period || "-", 274, y + 5, { width: 55 });
        doc.text(entry.credit ? money(entry.credit) : "-", 332, y + 5, { width: 65, align: "right" });
        doc.text(entry.debit ? money(entry.debit) : "-", 400, y + 5, { width: 65, align: "right" });
        doc.font("Helvetica-Bold").text(money(entry.balance), 468, y + 5, { width: 80, align: "right" });
        doc.strokeColor("#DCE4EF").moveTo(42, y + rowHeight).lineTo(553, y + rowHeight).stroke();
        doc.y = y + rowHeight + 3;
      }
    }

    if (doc.y > 700) doc.addPage();
    const totalsY = doc.y + 6;
    doc.strokeColor("#132036").lineWidth(1.2).moveTo(42, totalsY).lineTo(553, totalsY).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#132036");
    doc.text("Total", 274, totalsY + 7, { width: 55, align: "right" });
    doc.text(money(data.totalPayments), 332, totalsY + 7, { width: 65, align: "right" });
    doc.text(money(data.totalBills), 400, totalsY + 7, { width: 65, align: "right" });
    doc.text(money(data.closingBalance), 468, totalsY + 7, { width: 80, align: "right" });
    doc.y = totalsY + 38;
    doc.strokeColor("#132036").lineWidth(1.2).moveTo(330, doc.y).lineTo(553, doc.y).stroke();
    const balanceForwardY = doc.y + 8;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#132036");
    doc.text("Balance B/F", 330, balanceForwardY, { width: 100, lineBreak: false });
    doc.text(money(data.closingBalance), 433, balanceForwardY, {
      width: 115,
      align: "right",
      lineBreak: false,
    });
    doc.y = balanceForwardY + 30;
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#60708A")
      .text("Positive balances are amounts owed. Negative balances represent customer credit.");

    if (data.otherServicePayments.length) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(2);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#132036")
        .text("OTHER SERVICE PAYMENTS");
      doc.font("Helvetica").fontSize(8).fillColor("#60708A")
        .text("Informational only — these payments do not affect the water account balance.");
      doc.moveDown(0.7);
      const drawOtherHeader = () => {
        const y = doc.y;
        doc.rect(42, y, 511, 20).fill("#3B647E");
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
        doc.text("Date", 47, y + 6, { width: 62 });
        doc.text("Service / Reference", 112, y + 6, { width: 175 });
        doc.text("Receipt", 290, y + 6, { width: 95 });
        doc.text("Status", 388, y + 6, { width: 70 });
        doc.text("Amount", 461, y + 6, { width: 87, align: "right" });
        doc.y = y + 25;
      };
      drawOtherHeader();
      for (const payment of data.otherServicePayments) {
        if (doc.y > 748) {
          doc.addPage();
          drawOtherHeader();
        }
        const y = doc.y;
        const height = 30;
        doc.font("Helvetica").fontSize(8).fillColor("#132036");
        doc.text(payment.date.toISOString().slice(0, 10), 47, y + 5, { width: 62 });
        doc.font("Helvetica-Bold").text(payment.label, 112, y + 5, { width: 175 });
        doc.font("Helvetica").fontSize(7).fillColor("#60708A")
          .text(payment.reference, 112, y + 16, { width: 175 });
        doc.fontSize(8).fillColor("#132036")
          .text(payment.receiptNumber || "-", 290, y + 5, { width: 95 })
          .text(payment.paymentStatus.replace(/_/g, " "), 388, y + 5, { width: 70 })
          .text(money(payment.amount), 461, y + 5, { width: 87, align: "right" });
        doc.strokeColor("#DCE4EF").moveTo(42, y + height).lineTo(553, y + height).stroke();
        doc.y = y + height + 3;
      }
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#132036")
        .text("Other service payments subtotal", 290, doc.y + 5, { width: 168, align: "right" })
        .text(money(data.otherServicePaymentsSubtotal), 461, doc.y + 5, { width: 87, align: "right" });
    }
    doc.end();
  });
}

const statementRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function statementHttpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

async function loadCustomerStatement(
  customerId: bigint,
  from: Date,
  to: Date,
  fromText: string,
  toText: string,
): Promise<CustomerStatementData> {
  // Ownership is resolved from the authenticated customer ID only. No client
  // supplied account or customer ID is trusted by either statement endpoint.
  const customer = await prisma.customer.findUnique({
    where: { customerId },
    include: {
      accounts: {
        include: {
          category: true,
          route: { include: { zone: true } },
          property: { include: { zone: true, route: true, serviceArea: true } },
          meterAssignments: {
            where: { assignmentStatus: "ACTIVE" },
            include: { meter: true },
            orderBy: { assignmentDate: "desc" },
            take: 1,
          },
        },
        orderBy: { accountNumber: "asc" },
      },
    },
  });
  if (!customer || customer.status !== "ACTIVE") {
    throw statementHttpError(404, "Active customer profile not found");
  }
  if (!customer.accounts.length) throw statementHttpError(404, "Customer account not found");
  const accountIds = customer.accounts.map((account) => account.accountId);
  const primaryAccount = customer.accounts[0];
  const [bills, payments, otherServicePayments, priorBills, priorPayments, latestBill, settings] = await Promise.all([
    prisma.bill.findMany({
      where: {
        accountId: { in: accountIds },
        status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
        issueDate: { gte: from, lte: to },
      },
      include: {
        account: { select: { accountNumber: true } },
        billingCycle: true,
        tariff: true,
        reading: true,
      },
      orderBy: { issueDate: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        accountId: { in: accountIds },
        paymentStatus: "POSTED",
        paymentType: { notIn: ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"] },
        paymentDate: { gte: from, lte: to },
      },
      include: { account: { select: { accountNumber: true } }, channel: true },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        accountId: { in: accountIds },
        paymentType: { in: ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"] },
        paymentDate: { gte: from, lte: to },
      },
      include: { receipt: true },
      orderBy: { paymentDate: "asc" },
    }),
    prisma.bill.aggregate({
      where: {
        accountId: { in: accountIds },
        status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
        issueDate: { lt: from },
      },
      _sum: { totalCurrentCharges: true },
    }),
    prisma.payment.aggregate({
      where: {
        accountId: { in: accountIds }, paymentStatus: "POSTED",
        paymentType: { notIn: ["RECONNECTION_FEE", "NEW_CONNECTION_FEE"] },
        paymentDate: { lt: from },
      },
      _sum: { amount: true },
    }),
    prisma.bill.findFirst({
      where: {
        accountId: primaryAccount.accountId,
        status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
      },
      include: { tariff: true },
      orderBy: { issueDate: "desc" },
    }),
    prisma.systemSetting.findFirst(),
  ]);
  const storedOpeningBalance = customer.accounts.reduce(
    (sum, account) => sum + Number(account.openingBalance),
    0,
  );
  // Debit-positive convention: positive is owed; negative is genuine credit.
  const openingBalance = roundMoney(
    storedOpeningBalance +
    Number(priorBills._sum.totalCurrentCharges ?? 0) -
    Number(priorPayments._sum.amount ?? 0),
  );
  const rawEntries = [
    ...bills.map((bill) => ({
      date: bill.issueDate,
      particulars: "Water bill",
      reference: bill.billNumber,
      period: bill.billingCycle.cycleCode || bill.billingCycle.cycleName,
      details: bill.reading
        ? `Prev: ${Number(bill.reading.previousReading)} - Curr: ${Number(bill.reading.currentReading)} - Units: ${Number(bill.reading.consumption)} - Due: ${bill.dueDate.toISOString().slice(0, 10)}`
        : `Units: ${Number(bill.consumptionUnits)} - Due: ${bill.dueDate.toISOString().slice(0, 10)}`,
      debit: Number(bill.totalCurrentCharges),
      credit: 0,
    })),
    ...payments.map((payment) => ({
      date: payment.paymentDate,
      particulars: "Payment",
      reference: payment.transactionReference,
      period: payment.paymentDate.toISOString().slice(0, 7),
      details: [payment.channel.channelName, payment.remarks].filter(Boolean).join(" - "),
      debit: 0,
      credit: Number(payment.amount),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  let runningBalance = openingBalance;
  const entries: StatementEntry[] = rawEntries.map((entry) => {
    runningBalance = roundMoney(runningBalance + entry.debit - entry.credit);
    return { ...entry, balance: runningBalance };
  });
  const totalBills = roundMoney(entries.reduce((sum, entry) => sum + entry.debit, 0));
  const totalPayments = roundMoney(entries.reduce((sum, entry) => sum + entry.credit, 0));
  const closingBalance = roundMoney(openingBalance + totalBills - totalPayments);
  const servicePayments: OtherServicePayment[] = otherServicePayments.map((payment) => ({
    type: payment.paymentType as OtherServicePayment["type"],
    label: payment.paymentType === "RECONNECTION_FEE" ? "Reconnection fee" : "New Connection payment",
    reference: payment.customerReference || payment.transactionReference,
    receiptNumber: payment.receipt?.receiptNumber ?? null,
    transactionReference: payment.transactionReference,
    date: payment.paymentDate,
    amount: Number(payment.amount),
    paymentStatus: payment.paymentStatus,
  }));
  return {
    utility: {
      name: settings?.utilityName ?? "Samdamte Water Utility Management",
      phone: settings?.phoneNumber ?? null,
      secondaryPhone: settings?.secondaryPhoneNumber ?? null,
      email: settings?.emailAddress ?? null,
      address: [settings?.physicalAddress, settings?.postalAddress, settings?.postalCode]
        .filter(Boolean).join(", "),
    },
    account: {
      customerName: customerDisplayName(customer),
      phone: customer.phoneNumber,
      email: customer.emailAddress,
      accountNumber: customer.accounts.map((account) => account.accountNumber).join(", "),
      status: primaryAccount.accountStatus,
      meterNumber: primaryAccount.meterAssignments[0]?.meter.meterNumber ?? null,
      zone: primaryAccount.property?.zone?.zoneName ?? primaryAccount.route?.zone.zoneName ?? null,
      route: primaryAccount.route?.routeName ?? primaryAccount.property?.route?.routeName ?? null,
      tariff: latestBill?.tariff.tariffName ?? primaryAccount.category.categoryName,
      address: primaryAccount.property?.physicalAddress ?? null,
    },
    from: fromText,
    to: toText,
    openingBalance,
    totalBills,
    totalPayments,
    closingBalance,
    entries,
    otherServicePayments: servicePayments,
    otherServicePaymentsSubtotal: roundMoney(servicePayments.reduce((sum, payment) => sum + payment.amount, 0)),
  };
}

function parseStatementRange(query: unknown) {
  const parsed = statementRangeSchema.safeParse(query);
  if (!parsed.success) throw statementHttpError(400, "Use valid from/to dates in YYYY-MM-DD format.");
  const from = statementDate(parsed.data.from);
  const to = statementDate(parsed.data.to, true);
  if (!from || !to) throw statementHttpError(400, "Statement dates must be valid calendar dates.");
  if (from > to) throw statementHttpError(400, "Statement start date cannot be after the end date.");
  return { ...parsed.data, fromDate: from, toDate: to };
}

function sendStatementError(error: unknown, res: any, next: (error: unknown) => void) {
  if (error instanceof Error && "status" in error) {
    return res.status(Number((error as any).status)).json({ error: error.message });
  }
  next(error);
}

mobileRouter.get("/customer/statement/summary", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const range = parseStatementRange(req.query);
    const statement = await loadCustomerStatement(
      BigInt(req.user!.userId),
      range.fromDate,
      range.toDate,
      range.from,
      range.to,
    );
    res.json({
      period: { from: statement.from, to: statement.to },
      openingBalance: statement.openingBalance,
      totalBills: statement.totalBills,
      totalPayments: statement.totalPayments,
      closingBalance: statement.closingBalance,
      otherServicePayments: statement.otherServicePayments,
      otherServicePaymentsSubtotal: statement.otherServicePaymentsSubtotal,
    });
  } catch (error) {
    sendStatementError(error, res, next);
  }
});

mobileRouter.get("/customer/statement", requireRole("CUSTOMER"), async (req, res, next) => {
  const format = z.enum(["pdf"]).default("pdf").safeParse(req.query.format);
  if (!format.success) return res.status(400).json({ error: "Only format=pdf is supported." });
  try {
    const range = parseStatementRange(req.query);
    const statement = await loadCustomerStatement(
      BigInt(req.user!.userId),
      range.fromDate,
      range.toDate,
      range.from,
      range.to,
    );
    const pdf = await statementPdf({ ...statement, printedAt: new Date() });
    const filename = `statement-${range.from}-to-${range.to}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdf.length.toString());
    res.status(200).send(pdf);
  } catch (error) {
    sendStatementError(error, res, next);
  }
});

mobileRouter.get("/customer/overview", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const customerId = BigInt(req.user!.userId);
    const customer = await prisma.customer.findUnique({
      where: { customerId },
      include: {
        accounts: {
          include: {
            property: { include: { zone: true } },
            bills: { orderBy: { issueDate: "desc" }, take: 24 },
            payments: {
              include: { channel: true, receipt: true },
              orderBy: { paymentDate: "desc" },
              take: 24,
            },
          },
          orderBy: { accountNumber: "asc" },
        },
        serviceRequests: { orderBy: { createdAt: "desc" }, take: 20 },
        notifications: {
          where: { deliveryStatus: { in: ["SENT", "DELIVERED"] } },
          orderBy: { createdAt: "desc" },
          take: 30,
        },
      },
    });
    if (!customer || customer.status !== "ACTIVE") {
      return res.status(404).json({ error: "Active customer profile not found" });
    }
    const name = customer.organizationName ||
      [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
    const connections = await prisma.newConnectionApplication.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const settings = await prisma.systemSetting.findUnique({ where: { settingId: 1n } });
    const accounts = customer.accounts.map((account) => ({
      accountId: account.accountId,
      accountNumber: account.accountNumber,
      status: account.accountStatus,
      currentBalance: account.currentBalance,
      connectionDate: account.connectionDate,
      property: {
        propertyNumber: account.property.propertyCode,
        address: account.property.physicalAddress,
        zoneName: account.property.zone?.zoneName,
      },
      bills: account.bills.map((bill) => ({
        billId: bill.billId,
        billNumber: bill.billNumber,
        issueDate: bill.issueDate,
        dueDate: bill.dueDate,
        consumptionUnits: bill.consumptionUnits,
        totalCurrentCharges: bill.totalCurrentCharges,
        totalAmountDue: bill.totalAmountDue,
        paidAmount: bill.paidAmount,
        status: bill.status,
      })),
      payments: account.payments.map((payment) => {
        const legacyImport = isLegacyImportReference(payment.transactionReference);
        return {
          paymentId: payment.paymentId,
          // Keep the raw import key in the database/staff workflows, but never
          // expose staging-table identifiers through the customer API.
          transactionReference: legacyImport ? null : payment.transactionReference,
          referenceNote: legacyImport ? "Imported record — reference not available" : null,
          legacyImport,
          amount: payment.amount,
          paymentDate: payment.paymentDate,
          // Preserve the real workflow status. Clients can use presentationStatus
          // for badge copy/color without treating RECEIVED as ledger-applied.
          status: payment.paymentStatus,
          presentationStatus:
            payment.paymentStatus === "POSTED"
              ? "SUCCESSFUL"
              : payment.paymentStatus === "RECEIVED"
                ? "PENDING"
                : payment.paymentStatus,
          ledgerApplied: payment.paymentStatus === "POSTED",
          channelName: payment.channel.channelName,
          receiptNumber: legacyImport ? null : payment.receipt?.receiptNumber,
        };
      }),
    }));
    res.json({
      customer: {
        customerId: customer.customerId,
        customerNumber: customer.customerNumber,
        name,
        customerType: customer.customerType,
        nationalId: customer.nationalId,
        registrationNumber: customer.registrationNumber,
        phoneNumber: customer.phoneNumber,
        alternativePhone: customer.alternativePhone,
        emailAddress: customer.emailAddress,
        preferredLanguage: customer.preferredLanguage,
        status: customer.status,
        registrationDate: customer.registrationDate,
      },
      summary: {
        accounts: accounts.length,
        balance: accounts.reduce((sum, account) => sum + Number(account.currentBalance), 0),
        openRequests: customer.serviceRequests.filter((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status)).length,
        unreadNotifications: customer.notifications.filter((item) => item.deliveryStatus !== "DELIVERED").length,
      },
      reconnectionFee: Number(settings?.reconnectionFee ?? 0),
      accounts,
      serviceRequests: customer.serviceRequests,
      connections,
      notifications: customer.notifications,
    });
  } catch (error) {
    next(error);
  }
});

mobileRouter.get("/customer/notifications", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const customerId = BigInt(req.user!.userId);
    const customer = await prisma.customer.findUnique({
      where: { customerId },
      select: { status: true },
    });
    if (!customer || customer.status !== "ACTIVE") {
      return res.status(404).json({ error: "Active customer profile not found" });
    }
    const rows = await prisma.notification.findMany({
      where: {
        customerId,
        deliveryStatus: { in: ["SENT", "DELIVERED"] },
      },
      select: {
        notificationId: true,
        notificationType: true,
        subject: true,
        messageBody: true,
        deliveryStatus: true,
        sentAt: true,
        deliveredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

mobileRouter.patch("/customer/profile", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const parsed = z.object({
      phoneNumber: z.string().trim().min(7).max(30),
      alternativePhone: z.string().trim().max(30).optional(),
      emailAddress: z.union([z.string().trim().email(), z.literal("")]).optional(),
      preferredLanguage: z.enum(["EN", "SW"]),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Check the phone number, email address, and preferred language." });
    }
    const customerId = BigInt(req.user!.userId);
    const duplicate = await prisma.customer.findFirst({
      where: {
        phoneNumber: parsed.data.phoneNumber,
        customerId: { not: customerId },
      },
      select: { customerId: true },
    });
    if (duplicate) return res.status(409).json({ error: "That phone number is already registered to another customer." });

    await prisma.customer.update({
      where: { customerId },
      data: {
        phoneNumber: parsed.data.phoneNumber,
        alternativePhone: parsed.data.alternativePhone || null,
        emailAddress: parsed.data.emailAddress || null,
        preferredLanguage: parsed.data.preferredLanguage,
      },
    });
    res.json({ message: "Contact details updated successfully" });
  } catch (error) {
    next(error);
  }
});

mobileRouter.get("/me", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { userId: BigInt(req.user!.userId) },
      select: {
        userId: true,
        username: true,
        firstName: true,
        lastName: true,
        emailAddress: true,
        phoneNumber: true,
        userType: true,
        status: true,
        fieldOfficer: {
          include: { homeZone: true },
        },
        userRoles: {
          where: { status: "ACTIVE" },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user || user.status !== "ACTIVE") {
      return res.status(404).json({ error: "Active user profile not found" });
    }

    const roles = user.userRoles.map(({ role }) => ({
      roleCode: role.roleCode,
      roleName: role.roleName,
    }));
    const permissions = [
      ...new Set(
        user.userRoles.flatMap(({ role }) =>
          role.rolePermissions.map(({ permission }) => permission.permissionCode),
        ),
      ),
    ].sort();

    res.json({
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      emailAddress: user.emailAddress,
      phoneNumber: user.phoneNumber,
      userType: user.userType,
      fieldOfficer: user.fieldOfficer,
      roles,
      permissions,
    });
  } catch (error) {
    next(error);
  }
});

mobileRouter.get(
  "/field/dashboard",
  requireRole("METER_READER", "METER_SUPERVISOR", "SUPERVISOR"),
  async (req, res, next) => {
    try {
      const officer = await prisma.fieldOfficer.findUnique({
        where: { userId: BigInt(req.user!.userId) },
        include: {
          homeZone: true,
          routeAssignments: {
            where: {
              status: { in: ["ASSIGNED", "ACCEPTED"] },
              cycle: { status: "OPEN" },
            },
            include: {
              cycle: true,
              route: { include: { zone: true } },
            },
            orderBy: { assignedDate: "desc" },
          },
        },
      });
      if (!officer || officer.status !== "ACTIVE") {
        return res.status(409).json({
          error: "This user is not linked to an active field officer profile",
        });
      }

      const assignments = await Promise.all(
        officer.routeAssignments.map(async (assignment) => {
          const accountRoute = {
            OR: [
              { routeId: assignment.routeId },
              { property: { routeId: assignment.routeId } },
            ],
          };
          const [meters, captured, pending, exceptions] = await Promise.all([
            prisma.meterAssignment.count({
              where: {
                assignmentStatus: "ACTIVE",
                removalDate: null,
                accountId: { not: null },
                meter: { status: "ACTIVE" },
                account: { accountStatus: "ACTIVE", ...accountRoute },
              },
            }),
            prisma.meterReading.count({
              where: {
                readingCycleId: assignment.readingCycleId,
                fieldOfficerId: officer.fieldOfficerId,
                account: accountRoute,
              },
            }),
            prisma.meterReading.count({
              where: {
                readingCycleId: assignment.readingCycleId,
                fieldOfficerId: officer.fieldOfficerId,
                approvalStatus: "PENDING",
                account: accountRoute,
              },
            }),
            prisma.meterReading.count({
              where: {
                readingCycleId: assignment.readingCycleId,
                fieldOfficerId: officer.fieldOfficerId,
                abnormalFlag: true,
                account: accountRoute,
              },
            }),
          ]);
          return {
            routeAssignmentId: assignment.routeAssignmentId,
            status: assignment.status,
            cycle: assignment.cycle,
            route: assignment.route,
            meters,
            captured,
            unread: Math.max(0, meters - captured),
            pendingApproval: pending,
            exceptions,
          };
        }),
      );

      res.json({
        officer: {
          fieldOfficerId: officer.fieldOfficerId,
          employeeNumber: officer.employeeNumber,
          officerType: officer.officerType,
          availabilityStatus: officer.availabilityStatus,
          homeZone: officer.homeZone,
        },
        summary: assignments.reduce(
          (total, item) => ({
            routes: total.routes + 1,
            meters: total.meters + item.meters,
            captured: total.captured + item.captured,
            unread: total.unread + item.unread,
            pendingApproval: total.pendingApproval + item.pendingApproval,
            exceptions: total.exceptions + item.exceptions,
          }),
          {
            routes: 0,
            meters: 0,
            captured: 0,
            unread: 0,
            pendingApproval: 0,
            exceptions: 0,
          },
        ),
        assignments,
      });
    } catch (error) {
      next(error);
    }
  },
);
