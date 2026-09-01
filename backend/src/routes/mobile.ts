import { Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
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

function isLegacyImportReference(value: string) {
  return /^ReceiptsData(?:Current|History):/i.test(value);
}

mobileRouter.post("/customer/login", async (req, res, next) => {
  void req;
  void next;
  return res.status(410).json({
    error: "Phone-only login has been retired. Use the shared Login ID and password screen.",
  });
});

mobileRouter.use(requireAuth);

function credentialUserId(req: Request) {
  return BigInt(req.user!.authUserId ?? req.user!.userId);
}

async function accessibleAccountIds(req: Request) {
  if (req.user?.userType !== "CUSTOMER") return [] as bigint[];
  const access = await prisma.customerAccountAccess.findMany({
    where: { userId: credentialUserId(req), status: "ACTIVE" },
    select: { accountId: true },
  });
  return access.map((item) => item.accountId);
}

async function canAccessAccount(req: Request, accountId: bigint) {
  if (req.user?.userType !== "CUSTOMER") return false;
  return Boolean(await prisma.customerAccountAccess.findFirst({
    where: { userId: credentialUserId(req), accountId, status: "ACTIVE" },
    select: { accessId: true },
  }));
}

const customerReadingSubmissionSchema = z.object({
  accountId: z.coerce.bigint().positive(),
  meterId: z.coerce.bigint().positive(),
  currentReading: z.coerce.number().finite().min(0).max(999_999_999),
  photoEvidence: z.string().trim().min(100).max(6_000_000).refine(
    (value) => /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value),
    "A JPEG, PNG or WebP meter photo is required",
  ),
  photoName: z.string().trim().min(1).max(255).default("customer-meter-reading.jpg"),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional(),
  notes: z.string().trim().max(1000).optional(),
  submissionId: z.string().trim().min(8).max(100),
}).superRefine((value, ctx) => {
  if ((value.gpsLatitude == null) !== (value.gpsLongitude == null)) {
    ctx.addIssue({ code: "custom", path: ["gpsLatitude"], message: "Both GPS coordinates are required together" });
  }
});

async function customerReadingContext(req: Request, accountId: bigint) {
  if (!(await canAccessAccount(req, accountId))) {
    throw Object.assign(new Error("This account does not belong to the authenticated customer"), { status: 403 });
  }
  const [account, cycle] = await Promise.all([
    prisma.customerAccount.findUnique({
      where: { accountId },
      include: {
        meterAssignments: {
          where: { assignmentStatus: "ACTIVE", removalDate: null },
          include: { meter: true },
          orderBy: { assignmentDate: "desc" },
          take: 1,
        },
      },
    }),
    prisma.readingCycle.findFirst({ where: { status: "OPEN" }, orderBy: { startDate: "desc" } }),
  ]);
  if (!account) throw Object.assign(new Error("Customer account not found"), { status: 404 });
  const assignment = account.meterAssignments[0];
  const meter = assignment?.meter;
  if (!meter) {
    return { account, assignment: null, meter: null, cycle, activeReading: null, history: [], previousReading: null };
  }
  const [activeReading, history, latestApproved] = await Promise.all([
    cycle ? prisma.meterReading.findFirst({
      where: { meterId: meter.meterId, readingCycleId: cycle.readingCycleId, approvalStatus: { not: "REJECTED" } },
      include: { fieldOfficer: true, evidence: true, events: true, bills: { select: { billId: true, billNumber: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }) : null,
    prisma.meterReading.findMany({
      where: { meterId: meter.meterId },
      include: { cycle: true, fieldOfficer: true, events: { select: { eventType: true } }, evidence: { select: { evidenceId: true, evidenceType: true, mimeType: true } }, bills: { select: { billNumber: true, status: true } } },
      orderBy: [{ readingDate: "desc" }, { readingId: "desc" }],
      take: 24,
    }),
    prisma.meterReading.findFirst({
      where: { meterId: meter.meterId, approvalStatus: "APPROVED" },
      orderBy: [{ readingDate: "desc" }, { readingId: "desc" }],
    }),
  ]);
  return { account, assignment, meter, cycle, activeReading, history, previousReading: activeReading ? Number(activeReading.previousReading) : Number(latestApproved?.currentReading ?? meter.openingReading) };
}

mobileRouter.get("/customer/meter-readings", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const accountId = z.coerce.bigint().positive().parse(req.query.accountId);
    const context = await customerReadingContext(req, accountId);
    const active = context.activeReading;
    const customerEvidenceSubmitted = Boolean(active?.events.some((event) => event.eventType === "CUSTOMER_EVIDENCE_SUBMITTED"));
    const state = !context.meter
      ? "NO_ACTIVE_METER"
      : !context.cycle
        ? "NO_OPEN_CYCLE"
        : active?.bills.length
          ? "BILLED"
          : active?.approvalStatus === "APPROVED"
            ? "APPROVED"
            : active?.fieldOfficerId
              ? "STAFF_READING_PENDING"
              : active
                ? "CUSTOMER_READING_PENDING"
                : "OPEN_FOR_SUBMISSION";
    res.json({
      account: { accountId: context.account.accountId, accountNumber: context.account.accountNumber },
      meter: context.meter ? { meterId: context.meter.meterId, meterNumber: context.meter.meterNumber, serialNumber: context.meter.serialNumber } : null,
      cycle: context.cycle,
      previousReading: context.previousReading,
      state,
      canSubmit: state === "OPEN_FOR_SUBMISSION",
      canAttachEvidence: state === "STAFF_READING_PENDING" && !customerEvidenceSubmitted,
      activeReading: active ? {
        readingId: active.readingId,
        cycleName: context.cycle?.cycleName ?? context.cycle?.cycleCode ?? "Current reading",
        readingDate: active.readingDate,
        currentReading: Number(active.currentReading),
        previousReading: Number(active.previousReading),
        consumption: Number(active.consumption),
        approvalStatus: active.approvalStatus,
        source: active.events.some((event) => event.eventType === "CUSTOMER_SUBMITTED") ? "CUSTOMER" : active.fieldOfficerId ? "FIELD_STAFF" : "SYSTEM",
        hasEvidence: active.evidence.length > 0,
        billed: active.bills.length > 0,
      } : null,
      history: context.history.map((reading) => ({
        readingId: reading.readingId,
        cycleName: reading.cycle?.cycleName ?? reading.cycle?.cycleCode ?? "Reading",
        readingDate: reading.readingDate,
        previousReading: Number(reading.previousReading),
        currentReading: Number(reading.currentReading),
        consumption: Number(reading.consumption),
        approvalStatus: reading.approvalStatus,
        source: reading.events.some((event) => event.eventType === "CUSTOMER_SUBMITTED") ? "CUSTOMER" : reading.fieldOfficerId ? "FIELD_STAFF" : "SYSTEM",
        hasEvidence: reading.evidence.length > 0,
        billed: reading.bills.length > 0,
      })),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "A valid account is required" });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.post("/customer/meter-readings", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = customerReadingSubmissionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const data = parsed.data;
    const context = await customerReadingContext(req, data.accountId);
    const meter: any = context.meter;
    const assignment: any = context.assignment;
    const cycle: any = context.cycle;
    if (!meter || !assignment) return res.status(409).json({ error: "This account has no active meter" });
    if (meter.meterId !== data.meterId) return res.status(403).json({ error: "The selected meter is not assigned to this account" });
    if (!cycle) return res.status(409).json({ error: "There is no open meter-reading period" });
    const previousReading = Number(context.previousReading ?? meter.openingReading);
    if (data.currentReading < previousReading) {
      return res.status(409).json({ error: `Current reading cannot be below the verified previous reading of ${previousReading}` });
    }
    const existing = context.activeReading;
    if (existing?.bills.length || existing?.approvalStatus === "APPROVED") {
      return res.status(409).json({ error: existing.bills.length ? "This period has already been billed. Report a discrepancy instead." : "A reading has already been approved for this period." });
    }
    const mimeType = data.photoEvidence.slice(5, data.photoEvidence.indexOf(";"));
    const credentialId = credentialUserId(req);
    if (existing?.fieldOfficerId) {
      if (existing.events.some((event) => event.eventType === "CUSTOMER_EVIDENCE_SUBMITTED")) {
        return res.status(409).json({ error: "Supporting evidence has already been submitted for this staff reading" });
      }
      await prisma.$transaction(async (tx) => {
        await tx.meterReadingEvidence.create({ data: {
          readingId: existing.readingId,
          evidenceType: "SUPPORTING_DOCUMENT",
          fileName: data.photoName,
          mimeType,
          content: data.photoEvidence,
        } });
        await tx.meterReadingEvent.create({ data: {
          readingId: existing.readingId,
          eventType: "CUSTOMER_EVIDENCE_SUBMITTED",
          remarks: data.notes,
          performedBy: credentialId,
          metadata: { source: "CUSTOMER_APP", proposedReading: data.currentReading, previousReading, gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude },
        } });
      });
      return res.status(201).json({ status: "SUPPORTING_EVIDENCE_SUBMITTED", readingId: existing.readingId });
    }
    if (existing) return res.status(409).json({ error: "You already have a reading awaiting verification for this period" });

    const consumption = data.currentReading - previousReading;
    const exceptionType = consumption === 0 ? "ZERO" : consumption > 100 ? "HIGH" : "NONE";
    const syncId = `CUSTOMER:${credentialId}:${data.submissionId}`;
    const reading = await prisma.$transaction(async (tx) => {
      const created = await tx.meterReading.create({ data: {
        meterId: meter.meterId,
        accountId: context.account.accountId,
        readingCycleId: cycle.readingCycleId,
        previousReading,
        currentReading: data.currentReading,
        readingType: "ACTUAL",
        readingDate: new Date(),
        photoPath: data.photoName,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        abnormalFlag: exceptionType !== "NONE",
        exceptionType,
        approvalStatus: "PENDING",
        syncId,
        evidence: { create: { evidenceType: "METER_PHOTO", fileName: data.photoName, mimeType, content: data.photoEvidence } },
        events: { create: { eventType: "CUSTOMER_SUBMITTED", remarks: data.notes, performedBy: credentialId, metadata: { source: "CUSTOMER_APP" } } },
      } });
      await tx.meterEvent.create({ data: { meterId: meter.meterId, assignmentId: assignment.assignmentId, eventType: "CUSTOMER_READING_SUBMITTED", reading: data.currentReading, remarks: data.notes, gpsLatitude: data.gpsLatitude, gpsLongitude: data.gpsLongitude, performedBy: credentialId, metadata: { readingId: created.readingId.toString(), cycleId: cycle.readingCycleId.toString() } } });
      return created;
    });
    res.status(201).json({ status: "PENDING", readingId: reading.readingId });
  } catch (error: any) {
    if (error.code === "P2002") return res.status(409).json({ error: "A reading already exists for this meter and period" });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.post("/customer/pay", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.object({
    accountId: z.coerce.bigint().positive(),
    amount: z.coerce.number().positive().max(250_000),
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const account = await prisma.customerAccount.findUnique({
      where: { accountId: parsed.data.accountId },
      include: { customer: true },
    });
    if (!account) {
      return res.status(404).json({ error: "Customer account not found" });
    }
    if (!(await canAccessAccount(req, account.accountId))) {
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
    const row = await prisma.mpesaStkRequest.findUnique({
      where: { stkRequestId: parsed.data },
      include: {
        account: { include: { customer: true } },
        payment: { include: { receipt: true } },
      },
    });
    if (!row) return res.status(404).json({ error: "STK request not found" });
    if (!(await canAccessAccount(req, row.accountId))) {
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

async function ownedCustomerAccount(req: Request, accountId: bigint) {
  const account = await prisma.customerAccount.findUnique({
    where: { accountId },
    include: { customer: true },
  });
  if (!account) {
    const error = new Error("Customer account not found") as Error & { status: number };
    error.status = 404;
    throw error;
  }
  if (!(await canAccessAccount(req, accountId))) {
    const error = new Error("This account does not belong to the authenticated customer") as Error & { status: number };
    error.status = 403;
    throw error;
  }
  return account;
}

async function createCustomerServiceRequest(
  req: Request,
  data: z.infer<typeof customerServiceRequestInput>,
  category: string,
  requestType: "COMPLAINT" | "SERVICE_REQUEST",
) {
  const account = await ownedCustomerAccount(req, data.accountId);
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
        (${requestNumber}, ${requestType}, ${account.customerId}, ${account.accountId}, ${category},
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
      req,
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
    const accountIds = await accessibleAccountIds(req);
    const complaints = await prisma.serviceRequest.findMany({
      where: {
        accountId: { in: accountIds },
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
    const accountIds = await accessibleAccountIds(req);
    const complaint = await prisma.serviceRequest.findFirst({
      where: {
        serviceRequestId: requestId.data,
        accountId: { in: accountIds },
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
      req,
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
    const account = await ownedCustomerAccount(req, parsed.data.accountId);
    if (account.accountStatus !== "DISCONNECTED") {
      return res.status(409).json({ error: "Reconnection can only be requested for a disconnected account" });
    }
    const [priorDisconnections, openRequests] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT wo.work_order_id FROM aquaflow.work_orders wo
        JOIN aquaflow.work_order_types wt ON wt.work_order_type_id=wo.work_order_type_id
        WHERE wo.account_id=${account.accountId} AND wt.type_code='DISCONNECTION'
          AND wo.status IN ('COMPLETED','VERIFIED','CLOSED')
        ORDER BY wo.completed_at DESC NULLS LAST,wo.created_at DESC LIMIT 1`,
      prisma.$queryRaw<any[]>`
        SELECT reconnection_request_id,request_number,status
        FROM aquaflow.reconnection_requests
        WHERE account_id=${account.accountId}
          AND status IN ('SUBMITTED','APPROVED','WORK_ORDER_CREATED')
        ORDER BY created_at DESC LIMIT 1`,
    ]);
    if (!priorDisconnections[0]) {
      return res.status(409).json({ error: "No completed disconnection exists for this account" });
    }
    if (openRequests[0]) {
      return res.status(409).json({ error: `Open reconnection request ${openRequests[0].request_number} already exists` });
    }
    const settings = await prisma.systemSetting.findUnique({ where: { settingId: 1n } });
    const number = `RC-${new Date().getFullYear()}-${Date.now().toString().slice(-9)}`;
    const rows = await prisma.$queryRaw<any[]>`
      INSERT INTO aquaflow.reconnection_requests
        (request_number, customer_id, account_id, reason, contact_phone, reconnection_fee, disconnection_work_order_id)
      VALUES (${number}, ${account.customerId}, ${account.accountId}, ${parsed.data.reason},
        ${parsed.data.contactPhone || account.customer.phoneNumber},
        ${Number(settings?.reconnectionFee ?? 0)},
        ${priorDisconnections[0].work_order_id})
      RETURNING reconnection_request_id AS "reconnectionRequestId",
        request_number AS "requestNumber", status, reconnection_fee AS "reconnectionFee",
        created_at AS "createdAt"`;
    res.status(201).json(rows[0]);
  } catch (error: any) {
    if (error?.code === "P2010" && error?.meta?.code === "23505") {
      return res.status(409).json({ error: "An open reconnection request already exists for this account" });
    }
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.post("/customer/reconnection/:reconnectionId/pay", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsedId = z.coerce.bigint().positive().safeParse(req.params.reconnectionId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid reconnection request" });
  try {
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
    if (!(await canAccessAccount(req, BigInt(request.accountId)))) {
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
    const requests = await prisma.$queryRaw<any[]>`
      SELECT r.reconnection_request_id AS "reconnectionRequestId", r.request_number AS "requestNumber",
        r.customer_id AS "customerId", r.account_id AS "accountId", r.fee_payment_status AS "feePaymentStatus"
      FROM aquaflow.reconnection_requests r
      WHERE reconnection_request_id=${parsedReconnectionId.data}`;
    const reconnection = requests[0];
    if (!reconnection) return res.status(404).json({ error: "Reconnection request not found" });
    if (!(await canAccessAccount(req, BigInt(reconnection.accountId)))) {
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
    const labelValue = (label: string, value: string, x: number, y: number, width = 225) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000").text(label, x, y, { width: 75 });
      doc.font("Helvetica").text(value || "-", x + 78, y, { width: width - 78 });
    };
    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(42, y, 511, 20).lineWidth(0.8).stroke("#000000");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
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

    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(20).text(data.utility.name, 42, 52);
    const contactX = 340;
    doc.font("Helvetica").fontSize(8.5).fillColor("#000000");
    const phones = [data.utility.phone, data.utility.secondaryPhone].filter(Boolean).join(" / ");
    doc.text(`Tel: ${phones || "-"}`, contactX, 42, { width: 213 });
    doc.text(`Email: ${data.utility.email || "-"}`, contactX, 57, { width: 213 });
    doc.text(`Address: ${data.utility.address || "-"}`, contactX, 72, { width: 213 });
    doc.fillColor("#555555").fontSize(7.5)
      .text(`Printed: ${data.printedAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`, contactX, 96, { width: 213 });
    doc.strokeColor("#000000").lineWidth(2).moveTo(42, 122).lineTo(553, 122).stroke();

    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(16)
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
    doc.strokeColor("#BFBFBF").lineWidth(0.7).moveTo(42, periodY - 6).lineTo(553, periodY - 6).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000")
      .text("Statement period:", 42, periodY, { continued: true })
      .font("Helvetica").text(` ${data.from} - ${data.to}`);
    if (data.account.address) {
      doc.font("Helvetica-Bold").text("Service address:", 310, periodY, { continued: true })
        .font("Helvetica").text(` ${data.account.address}`, { width: 243 });
    }
    doc.strokeColor("#BFBFBF").moveTo(42, periodY + 16).lineTo(553, periodY + 16).stroke();
    doc.y = periodY + 28;

    drawTableHeader();
    const openingY = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000")
      .text("Opening balance", 105, openingY + 5, { width: 224 });
    doc.text(money(data.openingBalance), 468, openingY + 5, { width: 80, align: "right" });
    doc.strokeColor("#AFAFAF").moveTo(42, openingY + 23).lineTo(553, openingY + 23).stroke();
    doc.y = openingY + 27;
    if (!data.entries.length) {
      doc.fillColor("#555555").font("Helvetica-Oblique").fontSize(9)
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
        doc.fillColor("#000000").font("Helvetica").fontSize(8);
        doc.text(entry.date.toISOString().slice(0, 10), 47, y + 5, { width: 55 });
        doc.font("Helvetica-Bold").text(entry.particulars, 105, y + 5, { width: 166 });
        doc.font("Helvetica").fontSize(7).fillColor("#555555")
          .text(entry.reference, 105, y + 15, { width: 166 })
          .text(entry.details, 105, y + 24, { width: 166 });
        doc.fontSize(8).fillColor("#000000").text(entry.period || "-", 274, y + 5, { width: 55 });
        doc.text(entry.credit ? money(entry.credit) : "-", 332, y + 5, { width: 65, align: "right" });
        doc.text(entry.debit ? money(entry.debit) : "-", 400, y + 5, { width: 65, align: "right" });
        doc.font("Helvetica-Bold").text(money(entry.balance), 468, y + 5, { width: 80, align: "right" });
        doc.strokeColor("#BFBFBF").moveTo(42, y + rowHeight).lineTo(553, y + rowHeight).stroke();
        doc.y = y + rowHeight + 3;
      }
    }

    if (doc.y > 700) doc.addPage();
    const totalsY = doc.y + 6;
    doc.strokeColor("#000000").lineWidth(1.2).moveTo(42, totalsY).lineTo(553, totalsY).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000");
    doc.text("Total", 274, totalsY + 7, { width: 55, align: "right" });
    doc.text(money(data.totalPayments), 332, totalsY + 7, { width: 65, align: "right" });
    doc.text(money(data.totalBills), 400, totalsY + 7, { width: 65, align: "right" });
    doc.text(money(data.closingBalance), 468, totalsY + 7, { width: 80, align: "right" });
    doc.y = totalsY + 38;
    doc.strokeColor("#000000").lineWidth(1.2).moveTo(330, doc.y).lineTo(553, doc.y).stroke();
    const balanceForwardY = doc.y + 8;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000");
    doc.text("Balance B/F", 330, balanceForwardY, { width: 100, lineBreak: false });
    doc.text(money(data.closingBalance), 433, balanceForwardY, {
      width: 115,
      align: "right",
      lineBreak: false,
    });
    doc.y = balanceForwardY + 30;
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555555")
      .text("Positive balances are amounts owed. Negative balances represent customer credit.");

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
  accountId: bigint | null,
  from: Date,
  to: Date,
  fromText: string,
  toText: string,
): Promise<CustomerStatementData> {
  // The route verifies any supplied account against portal access before this
  // loader is called. The customer relation remains the billing identity.
  const customer = await prisma.customer.findUnique({
    where: { customerId },
    include: {
      accounts: {
        where: accountId ? { accountId } : undefined,
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
        ? `Prev: ${Number(bill.reading.previousReading)} - Curr: ${Number(bill.reading.currentReading)} - Units billed: ${Number(bill.consumptionUnits)}${Number(bill.consumptionUnits) !== Number(bill.reading.consumption) ? " (includes meter replacement final consumption)" : ""} - Due: ${bill.dueDate.toISOString().slice(0, 10)}`
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
    ...otherServicePayments
      .filter((payment) => payment.paymentStatus === "POSTED")
      .flatMap((payment) => {
        const isReconnection = payment.paymentType === "RECONNECTION_FEE";
        const service = isReconnection ? "Reconnection fee" : "New connection fee";
        const receipt = payment.receipt?.receiptNumber ?? payment.transactionReference;
        const amount = Number(payment.amount);
        const common = {
          date: payment.paymentDate,
          period: payment.paymentDate.toISOString().slice(0, 7),
        };
        return [{
          ...common,
          particulars: service,
          reference: payment.customerReference || payment.transactionReference,
          details: `${service} settled under receipt ${receipt}`,
          debit: amount,
          credit: 0,
        }, {
          ...common,
          particulars: `${service} payment`,
          reference: receipt,
          details: `Transaction ${payment.transactionReference}`,
          debit: 0,
          credit: amount,
        }];
      }),
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
    const requestedAccount = req.query.accountId
      ? z.coerce.bigint().positive().safeParse(req.query.accountId)
      : null;
    if (requestedAccount && !requestedAccount.success) throw statementHttpError(400, "Invalid account selection.");
    const account = requestedAccount?.success ? await ownedCustomerAccount(req, requestedAccount.data) : null;
    const statement = await loadCustomerStatement(
      account?.customerId ?? BigInt(req.user!.userId),
      account?.accountId ?? null,
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
    const requestedAccount = req.query.accountId
      ? z.coerce.bigint().positive().safeParse(req.query.accountId)
      : null;
    if (requestedAccount && !requestedAccount.success) throw statementHttpError(400, "Invalid account selection.");
    const account = requestedAccount?.success ? await ownedCustomerAccount(req, requestedAccount.data) : null;
    const statement = await loadCustomerStatement(
      account?.customerId ?? BigInt(req.user!.userId),
      account?.accountId ?? null,
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
    const accessRows = await prisma.customerAccountAccess.findMany({
      where: { userId: credentialUserId(req), status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { account: { accountNumber: "asc" } }],
      include: { account: { select: { accountId: true, customerId: true } } },
    });
    if (!accessRows.length) {
      return res.status(404).json({ error: "No verified water account is linked to this login" });
    }
    const accountIds = accessRows.map((access) => access.accountId);
    const customerIds = [...new Set(accessRows.map((access) => access.account.customerId))];
    const tokenCustomerId = BigInt(req.user!.customerId ?? req.user!.userId);
    const customerId = customerIds.some((id) => id === tokenCustomerId) ? tokenCustomerId : customerIds[0];
    const customer = await prisma.customer.findUnique({
      where: { customerId },
    });
    if (!customer || customer.status !== "ACTIVE") {
      return res.status(404).json({ error: "Active customer profile not found" });
    }
    const name = customer.organizationName ||
      [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
    const [accessibleAccounts, serviceRequests, notifications, connections] = await Promise.all([
      prisma.customerAccount.findMany({
        where: { accountId: { in: accountIds } },
        include: {
          customer: true,
          property: { include: { zone: true } },
          meterAssignments: {
            where: { assignmentStatus: "ACTIVE" },
            include: { meter: true },
            orderBy: { assignmentDate: "desc" },
          },
          bills: { orderBy: { issueDate: "desc" }, take: 24 },
          payments: {
            include: { channel: true, receipt: true },
            orderBy: { paymentDate: "desc" },
            take: 24,
          },
        },
        orderBy: { accountNumber: "asc" },
      }),
      prisma.serviceRequest.findMany({ where: { accountId: { in: accountIds } }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.notification.findMany({
        where: {
          deliveryStatus: { in: ["SENT", "DELIVERED"] },
          OR: [{ accountId: { in: accountIds } }, { customerId: { in: customerIds } }],
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.newConnectionApplication.findMany({
      where: { customerId: { in: customerIds } },
      orderBy: { createdAt: "desc" },
      take: 20,
      }),
    ]);
    const settings = await prisma.systemSetting.findUnique({ where: { settingId: 1n } });
    const accounts = accessibleAccounts.map((account) => ({
      accountId: account.accountId,
      accountNumber: account.accountNumber,
      customerNumber: account.customer.customerNumber,
      customerName: customerDisplayName(account.customer),
      status: account.accountStatus,
      currentBalance: account.currentBalance,
      connectionDate: account.connectionDate,
      property: {
        propertyNumber: account.property.propertyCode,
        address: account.property.physicalAddress,
        zoneName: account.property.zone?.zoneName,
      },
      meters: account.meterAssignments.map((assignment) => ({
        meterId: assignment.meter.meterId,
        meterNumber: assignment.meter.meterNumber,
        serialNumber: assignment.meter.serialNumber,
        status: assignment.meter.status,
      })),
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
        openRequests: serviceRequests.filter((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status)).length,
        unreadNotifications: notifications.filter((item) => !item.readAt).length,
      },
      reconnectionFee: Number(settings?.reconnectionFee ?? 0),
      accounts,
      serviceRequests,
      connections,
      notifications,
    });
  } catch (error) {
    next(error);
  }
});

mobileRouter.get("/customer/notifications", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const accessRows = await prisma.customerAccountAccess.findMany({
      where: { userId: credentialUserId(req), status: "ACTIVE" },
      select: { accountId: true, account: { select: { customerId: true } } },
    });
    if (!accessRows.length) {
      return res.status(404).json({ error: "No verified water account is linked to this login" });
    }
    const accountIds = accessRows.map((access) => access.accountId);
    const customerIds = [...new Set(accessRows.map((access) => access.account.customerId))];
    const rows = await prisma.notification.findMany({
      where: {
        deliveryStatus: { in: ["SENT", "DELIVERED"] },
        OR: [{ accountId: { in: accountIds } }, { customerId: { in: customerIds } }],
      },
      select: {
        notificationId: true,
        notificationType: true,
        subject: true,
        messageBody: true,
        deliveryStatus: true,
        sentAt: true,
        deliveredAt: true,
        readAt: true,
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

mobileRouter.patch("/customer/notifications/read", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const accessRows = await prisma.customerAccountAccess.findMany({
      where: { userId: credentialUserId(req), status: "ACTIVE" },
      select: { accountId: true, account: { select: { customerId: true } } },
    });
    if (!accessRows.length) {
      return res.status(404).json({ error: "No verified water account is linked to this login" });
    }
    const accountIds = accessRows.map((access) => access.accountId);
    const customerIds = [...new Set(accessRows.map((access) => access.account.customerId))];
    const result = await prisma.notification.updateMany({
      where: {
        readAt: null,
        deliveryStatus: { in: ["SENT", "DELIVERED"] },
        OR: [{ accountId: { in: accountIds } }, { customerId: { in: customerIds } }],
      },
      data: { readAt: new Date(), updatedAt: new Date() },
    });
    res.json({ updated: result.count, unreadNotifications: 0 });
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

const fieldWorkOrderRoles = requireRole("METER_READER", "FIELD_OFFICER", "METER_SUPERVISOR", "SUPERVISOR");
const workOrderIdSchema = z.coerce.bigint().positive();
const mobileWorkOrderStatuses = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "ESCALATED"] as const;
const activeWorkOrderAssignmentStatuses = ["ASSIGNED", "ACCEPTED", "COMPLETED"];
const escalationReasons = [
  { code: "CUSTOMER_UNAVAILABLE", label: "Customer unavailable" },
  { code: "SITE_INACCESSIBLE", label: "Site inaccessible" },
  { code: "SAFETY_RISK", label: "Safety risk" },
  { code: "METER_OR_EQUIPMENT_ISSUE", label: "Meter or equipment issue" },
  { code: "INCORRECT_TASK_DETAILS", label: "Incorrect task details" },
  { code: "REQUIRES_SUPERVISOR", label: "Requires supervisor" },
  { code: "OTHER", label: "Other" },
] as const;
const escalationReasonCodes: readonly string[] = escalationReasons.map((reason) => reason.code);

async function activeFieldOfficer(req: Request, res: Response) {
  const officer = await prisma.fieldOfficer.findUnique({
    where: { userId: BigInt(req.user!.userId) },
    select: { fieldOfficerId: true, status: true },
  });
  if (!officer || officer.status !== "ACTIVE") {
    res.status(403).json({ error: "No active field officer profile is linked to this user" });
    return null;
  }
  return officer;
}

async function ownedWorkOrder(req: Request, res: Response, workOrderId: bigint) {
  const officer = await activeFieldOfficer(req, res);
  if (!officer) return null;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT wo.work_order_id, wo.status, a.assignment_id, a.field_officer_id, a.status AS assignment_status
    FROM aquaflow.work_orders wo
    JOIN LATERAL (
      SELECT assignment_id, field_officer_id, status, assigned_at
      FROM aquaflow.work_order_assignments
      WHERE work_order_id = wo.work_order_id
      ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1
    ) a ON TRUE
    WHERE wo.work_order_id = ${workOrderId}`;
  if (!rows[0]) {
    res.status(404).json({ error: "Work order not found" });
    return null;
  }
  if (
    rows[0].field_officer_id !== officer.fieldOfficerId ||
    !activeWorkOrderAssignmentStatuses.includes(rows[0].assignment_status)
  ) {
    res.status(403).json({ error: "This work order is not assigned to you" });
    return null;
  }
  return { ...rows[0], fieldOfficerId: officer.fieldOfficerId };
}

function evidenceMetadata(row: any, workOrderId: bigint) {
  const dataUri = String(row.file_path ?? "");
  const mimeType = dataUri.match(/^data:([^;,]+)/)?.[1] ?? "image/jpeg";
  return {
    evidenceId: row.evidence_id,
    evidenceType: row.evidence_type,
    description: row.description,
    mimeType,
    gpsLatitude: row.gps_latitude,
    gpsLongitude: row.gps_longitude,
    capturedAt: row.captured_at,
    thumbnailUrl: `/api/mobile/field/work-orders/${workOrderId}/evidence/${row.evidence_id}/content`,
  };
}

function completionEligible(row: any) {
  return row?.requires_signature === true &&
    !["DISCONNECTION", "RECONNECTION", "NEW_CONNECTION"].includes(row.type_code ?? row.taskTypeCode);
}

async function completionDetail(workOrderId: bigint, eligible: boolean) {
  if (!eligible) return { eligible: false };
  const [reports, materials] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT r.*, u.first_name, u.last_name, e.evidence_id, e.file_path,
             e.captured_at AS signature_captured_at
      FROM aquaflow.field_work_order_completion_reports r
      JOIN aquaflow.field_officers fo ON fo.field_officer_id=r.field_officer_id
      JOIN aquaflow.users u ON u.user_id=fo.user_id
      LEFT JOIN aquaflow.work_order_evidence e ON e.evidence_id=r.signature_evidence_id
      WHERE r.work_order_id=${workOrderId}`,
    prisma.$queryRaw<any[]>`
      SELECT wom.usage_id AS "usageId", ii.inventory_item_id AS "materialId",
             ii.item_code AS "itemCode", ii.item_name AS "itemName",
             wom.quantity_used AS quantity, ii.unit_of_measure AS unit,
             wom.unit_cost AS "unitCost"
      FROM aquaflow.work_order_materials wom
      JOIN aquaflow.inventory_items ii ON ii.inventory_item_id=wom.inventory_item_id
      JOIN aquaflow.field_work_order_completion_reports r
        ON r.completion_report_id=wom.completion_report_id
      WHERE r.work_order_id=${workOrderId} ORDER BY ii.item_name`,
  ]);
  const report = reports[0];
  const signature = report?.evidence_id ? {
    evidenceId: report.evidence_id,
    mimeType: String(report.file_path ?? "").match(/^data:([^;,]+)/)?.[1] ?? "image/png",
    capturedAt: report.signature_captured_at,
    contentUrl: `/api/mobile/field/work-orders/${workOrderId}/completion/signature/content`,
  } : null;
  return {
    eligible: true,
    requiresSignature: false,
    status: report?.status ?? null,
    customerNameConfirmed: report?.customer_name_confirmed ?? false,
    customerIdentityConfirmed: report?.customer_identity_confirmed ?? false,
    noMaterialsUsed: report?.no_materials_used ?? false,
    completionNotes: report?.completion_notes ?? null,
    submittedAt: report?.submitted_at ?? null,
    completedBy: report ? String(`${report.first_name ?? ""} ${report.last_name ?? ""}`).trim() : null,
    materials,
    signature,
  };
}

mobileRouter.get("/field/work-orders/materials/catalogue", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    if (!(await activeFieldOfficer(req, res))) return;
    const items = await prisma.$queryRaw<any[]>`
      SELECT inventory_item_id AS "materialId", item_code AS "itemCode",
             item_name AS "itemName", item_category AS category,
             unit_of_measure AS unit
      FROM aquaflow.inventory_items WHERE status='ACTIVE' ORDER BY item_name`;
    res.json({ items });
  } catch (error) { next(error); }
});

mobileRouter.get("/field/work-orders/escalation-reasons", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    if (!(await activeFieldOfficer(req, res))) return;
    res.json({ items: escalationReasons });
  } catch (error) { next(error); }
});

mobileRouter.get("/field/work-orders", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const officer = await activeFieldOfficer(req, res);
    if (!officer) return;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT wo.work_order_id AS "workOrderId", wo.work_order_number AS "workOrderNumber",
             wt.type_name AS "taskType", wo.priority, wo.status, wo.scheduled_date AS "scheduledDate",
             wo.started_at AS "startTime", wo.completed_at AS "completionTime",
             z.zone_name AS "zoneName", ca.account_number AS "accountNumber",
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS "customerName",
             a.assignment_id AS "assignmentId", a.status AS "assignmentStatus"
      FROM aquaflow.work_orders wo
      JOIN aquaflow.work_order_types wt ON wt.work_order_type_id = wo.work_order_type_id
      JOIN aquaflow.zones z ON z.zone_id = wo.zone_id
      LEFT JOIN aquaflow.customer_accounts ca ON ca.account_id = wo.account_id
      LEFT JOIN aquaflow.customers c ON c.customer_id = ca.customer_id
      JOIN LATERAL (
        SELECT assignment_id, field_officer_id, status, assigned_at
        FROM aquaflow.work_order_assignments
        WHERE work_order_id = wo.work_order_id
        ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1
      ) a ON a.field_officer_id = ${officer.fieldOfficerId}
         AND (a.status IN ('ASSIGNED', 'ACCEPTED') OR
           (a.status='COMPLETED' AND EXISTS (
             SELECT 1 FROM aquaflow.field_work_order_completion_reports cr
             WHERE cr.work_order_id=wo.work_order_id AND cr.status='SUBMITTED')))
      ORDER BY wo.created_at DESC, wo.work_order_id DESC`;
    res.json({ items: rows });
  } catch (error) { next(error); }
});

mobileRouter.get("/field/work-orders/:id", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const parsed = workOrderIdSchema.safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: "Invalid work order id" });
    const owned = await ownedWorkOrder(req, res, parsed.data);
    if (!owned) return;
    const [details, updates, evidence] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT wo.work_order_id AS "workOrderId", wo.work_order_number AS "workOrderNumber",
               wt.type_name AS "taskType", wt.type_code AS "taskTypeCode",
               wt.requires_photo, wt.requires_gps, wt.requires_signature,
               COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS "customerName",
               c.customer_number AS "customerNumber", ca.account_number AS "accountNumber", z.zone_name AS "zoneName",
               CONCAT_WS(', ', p.plot_number, p.building_name, p.physical_address) AS location,
               p.gps_latitude AS "latitude", p.gps_longitude AS "longitude",
               wo.scheduled_date AS "scheduledDate", wo.due_date AS "dueDate", wo.priority,
               wo.description, wo.status, wo.started_at AS "startTime",
               wo.completed_at AS "completionTime", wo.completion_notes AS "completionNotes",
               wo.created_at AS "createdAt", wo.updated_at AS "updatedAt"
        FROM aquaflow.work_orders wo
        JOIN aquaflow.work_order_types wt ON wt.work_order_type_id = wo.work_order_type_id
        JOIN aquaflow.zones z ON z.zone_id = wo.zone_id
        LEFT JOIN aquaflow.customer_accounts ca ON ca.account_id = wo.account_id
        LEFT JOIN aquaflow.customers c ON c.customer_id = ca.customer_id
        LEFT JOIN aquaflow.properties p ON p.property_id = wo.property_id
        WHERE wo.work_order_id = ${parsed.data}`,
      prisma.$queryRaw<any[]>`
        SELECT update_id AS "updateId", previous_status AS "previousStatus", new_status AS "newStatus",
               reason_code AS "reasonCode", notes, updated_at AS "updatedAt" FROM aquaflow.work_order_updates
        WHERE work_order_id = ${parsed.data} ORDER BY updated_at DESC`,
      prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.work_order_evidence WHERE work_order_id = ${parsed.data} ORDER BY captured_at DESC`,
    ]);
    const eligible = completionEligible(details[0]);
    res.json({ ...details[0], completionEligible: eligible,
      assignmentId: owned.assignment_id, assignmentStatus: owned.assignment_status,
      notes: updates, evidence: evidence.map((row) => evidenceMetadata(row, parsed.data)),
      completion: await completionDetail(parsed.data, eligible) });
  } catch (error) { next(error); }
});

const mobileTransitionSchema = z.object({
  status: z.enum(mobileWorkOrderStatuses),
  reasonCode: z.string().trim().optional(),
  notes: z.string().optional(),
}).strict().superRefine((value, context) => {
  const notes = value.notes?.trim();
  if (value.status === "ESCALATED") {
    if (!value.reasonCode || !escalationReasonCodes.includes(value.reasonCode)) {
      context.addIssue({ code: "custom", path: ["reasonCode"], message: "Select a valid escalation reason" });
    }
    if (value.notes != null && notes!.length < 2) {
      context.addIssue({ code: "custom", path: ["notes"], message: "Notes must contain at least 2 characters when supplied" });
    }
    if ((notes?.length ?? 0) > 250) {
      context.addIssue({ code: "custom", path: ["notes"], message: "Notes must contain at most 250 characters" });
    }
    if (value.reasonCode === "OTHER" && (notes?.length ?? 0) < 2) {
      context.addIssue({ code: "custom", path: ["notes"], message: "Notes of at least 2 characters are required for Other" });
    }
  } else {
    if (!notes || notes.length < 2) {
      context.addIssue({ code: "custom", path: ["notes"], message: "Notes must contain at least 2 characters" });
    } else if (notes.length > 5000) {
      context.addIssue({ code: "custom", path: ["notes"], message: "Notes must contain at most 5000 characters" });
    }
    if (value.reasonCode != null) {
      context.addIssue({ code: "custom", path: ["reasonCode"], message: "reasonCode is only valid for escalation" });
    }
  }
});
const mobileTransitions: Record<string, string[]> = {
  ASSIGNED: ["ACCEPTED", "ESCALATED"],
  ACCEPTED: ["IN_PROGRESS", "ESCALATED"],
  IN_PROGRESS: ["COMPLETED", "ESCALATED"],
  COMPLETED: ["ESCALATED"],
};

mobileRouter.patch("/field/work-orders/:id/status", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const workOrderId = workOrderIdSchema.safeParse(req.params.id);
    const input = mobileTransitionSchema.safeParse(req.body);
    if (!workOrderId.success || !input.success) return res.status(400).json({ error: input.success ? "Invalid work order id" : input.error.issues[0].message });
    const owned = await ownedWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (input.data.status === "COMPLETED") {
      const types = await prisma.$queryRaw<any[]>`
        SELECT wt.type_code, wt.requires_signature
        FROM aquaflow.work_orders wo JOIN aquaflow.work_order_types wt
          ON wt.work_order_type_id=wo.work_order_type_id
        WHERE wo.work_order_id=${workOrderId.data}`;
      if (completionEligible(types[0])) return res.status(409).json({
        error: "Use the job completion screen to finish this task",
      });
    }
    if (!(mobileTransitions[owned.status] ?? []).includes(input.data.status)) {
      return res.status(409).json({ error: `Cannot change a ${owned.status} work order to ${input.data.status}` });
    }
    const notes = input.data.notes?.trim() || null;
    const reasonCode = input.data.status === "ESCALATED" ? input.data.reasonCode! : null;
    const update = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE aquaflow.work_orders SET status=${input.data.status},
        started_at=CASE WHEN ${input.data.status}='IN_PROGRESS' THEN CURRENT_TIMESTAMP ELSE started_at END,
        completed_at=CASE WHEN ${input.data.status}='COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        completion_notes=CASE WHEN ${input.data.status}='COMPLETED' THEN ${notes} ELSE completion_notes END,
        updated_at=CURRENT_TIMESTAMP WHERE work_order_id=${workOrderId.data}`;
      const updates = await tx.$queryRaw<any[]>`INSERT INTO aquaflow.work_order_updates
        (work_order_id, field_officer_id, previous_status, new_status, reason_code, notes)
        VALUES (${workOrderId.data}, ${owned.fieldOfficerId}, ${owned.status}, ${input.data.status}, ${reasonCode}, ${notes})
        RETURNING updated_at AS "updatedAt"`;
      if (input.data.status === "ACCEPTED") await tx.$executeRaw`UPDATE aquaflow.work_order_assignments SET status='ACCEPTED', accepted_at=CURRENT_TIMESTAMP WHERE assignment_id=${owned.assignment_id}`;
      return updates[0];
    });
    res.json({
      workOrderId: workOrderId.data,
      previousStatus: owned.status,
      status: input.data.status,
      ...(input.data.status === "ESCALATED" ? {
        reasonCode,
        notes,
        escalatedAt: update.updatedAt,
      } : {}),
    });
  } catch (error) { next(error); }
});

const mobileEvidenceSchema = z.object({
  evidenceType: z.enum(["BEFORE_PHOTO", "AFTER_PHOTO", "METER_PHOTO"]),
  content: z.string().trim().min(20).max(6_000_000),
  description: z.string().trim().max(500).optional(),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
});

mobileRouter.post("/field/work-orders/:id/evidence", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const workOrderId = workOrderIdSchema.safeParse(req.params.id);
    const input = mobileEvidenceSchema.safeParse(req.body);
    if (!workOrderId.success || !input.success) return res.status(400).json({ error: input.success ? "Invalid work order id" : input.error.issues[0].message });
    const owned = await ownedWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status))
      return res.status(409).json({ error: "Completed work-order evidence is read-only" });
    const rows = await prisma.$queryRaw<any[]>`INSERT INTO aquaflow.work_order_evidence
      (work_order_id, evidence_type, file_path, description, gps_latitude, gps_longitude, captured_by)
      VALUES (${workOrderId.data}, ${input.data.evidenceType}, ${input.data.content}, ${input.data.description ?? null},
      ${input.data.gpsLatitude ?? null}, ${input.data.gpsLongitude ?? null}, ${owned.fieldOfficerId}) RETURNING *`;
    res.status(201).json(evidenceMetadata(rows[0], workOrderId.data));
  } catch (error) { next(error); }
});

mobileRouter.get("/field/work-orders/:id/evidence/:evidenceId/content", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const workOrderId = workOrderIdSchema.safeParse(req.params.id);
    const evidenceId = workOrderIdSchema.safeParse(req.params.evidenceId);
    if (!workOrderId.success || !evidenceId.success) return res.status(400).json({ error: "Invalid evidence reference" });
    if (!(await ownedWorkOrder(req, res, workOrderId.data))) return;
    const rows = await prisma.$queryRaw<any[]>`SELECT file_path FROM aquaflow.work_order_evidence WHERE evidence_id=${evidenceId.data} AND work_order_id=${workOrderId.data}`;
    if (!rows[0]) return res.status(404).json({ error: "Evidence not found" });
    const match = String(rows[0].file_path).match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return res.status(422).json({ error: "Evidence content is unavailable" });
    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  } catch (error) { next(error); }
});

mobileRouter.delete("/field/work-orders/:id/evidence/:evidenceId", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const workOrderId = workOrderIdSchema.safeParse(req.params.id);
    const evidenceId = workOrderIdSchema.safeParse(req.params.evidenceId);
    if (!workOrderId.success || !evidenceId.success) return res.status(400).json({ error: "Invalid evidence reference" });
    const owned = await ownedWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status))
      return res.status(409).json({ error: "Completed work-order evidence is read-only" });
    const removed = await prisma.$executeRaw`DELETE FROM aquaflow.work_order_evidence WHERE evidence_id=${evidenceId.data} AND work_order_id=${workOrderId.data} AND captured_by=${owned.fieldOfficerId}`;
    if (!removed) return res.status(404).json({ error: "Evidence not found or was not captured by you" });
    res.json({ message: "Evidence removed" });
  } catch (error) { next(error); }
});

const completionMaterialInput = z.object({
  materialId: z.coerce.bigint().positive(),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(30),
});
const completionDraftInput = z.object({
  materials: z.array(completionMaterialInput).max(100).optional(),
  customerNameConfirmed: z.boolean().optional(),
  customerIdentityConfirmed: z.boolean().optional(),
  noMaterialsUsed: z.boolean().optional(),
  completionNotes: z.string().trim().max(5000).optional().nullable(),
}).strict();
const completionSubmitInput = z.object({
  materials: z.array(completionMaterialInput).max(100).optional().default([]),
  // Optional legacy fields keep older installed app versions compatible.
  customerNameConfirmed: z.boolean().optional(),
  customerIdentityConfirmed: z.boolean().optional(),
  noMaterialsUsed: z.boolean().optional(),
  completionNotes: z.string().trim().max(5000).optional().nullable(),
}).strict();
const completionSignatureInput = z.object({
  content: z.string().trim().min(100).max(3_000_000),
}).strict();

async function ownedCompletionWorkOrder(req: Request, res: Response, workOrderId: bigint) {
  const owned = await ownedWorkOrder(req, res, workOrderId);
  if (!owned) return null;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT wt.type_code, wt.type_name, wt.requires_signature
    FROM aquaflow.work_orders wo JOIN aquaflow.work_order_types wt
      ON wt.work_order_type_id=wo.work_order_type_id
    WHERE wo.work_order_id=${workOrderId}`;
  if (!completionEligible(rows[0])) {
    res.status(409).json({ error: "This work-order type does not use the detailed completion flow" });
    return null;
  }
  return { ...owned, ...rows[0] };
}

async function validateCompletionMaterials(
  materials: z.infer<typeof completionMaterialInput>[] | undefined,
) {
  if (materials === undefined) return undefined;
  const duplicate = materials.find((item, index) =>
    materials.findIndex((candidate) => candidate.materialId === item.materialId) !== index,
  );
  if (duplicate) throw Object.assign(new Error("Each material may only appear once"), { status: 400 });
  if (!materials.length) return [];
  const ids = materials.map((item) => item.materialId);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT inventory_item_id, item_code, item_name, unit_of_measure, unit_cost
    FROM aquaflow.inventory_items
    WHERE inventory_item_id IN (${Prisma.join(ids)}) AND status='ACTIVE'`;
  if (rows.length !== ids.length)
    throw Object.assign(new Error("Select valid active materials from the catalogue"), { status: 400 });
  return materials.map((material) => {
    const item = rows.find((row) => row.inventory_item_id === material.materialId)!;
    if (String(item.unit_of_measure).toLowerCase() !== material.unit.toLowerCase())
      throw Object.assign(new Error(`Use ${item.unit_of_measure} for ${item.item_name}`), { status: 400 });
    return { ...material, unit: item.unit_of_measure, unitCost: item.unit_cost };
  });
}

async function saveCompletionReport(
  tx: any,
  workOrderId: bigint,
  officerId: bigint,
  data: z.infer<typeof completionDraftInput>,
  materials: Awaited<ReturnType<typeof validateCompletionMaterials>>,
) {
  const noMaterialsUsed = data.noMaterialsUsed ?? (materials?.length ? false : undefined);
  if (noMaterialsUsed === true && materials?.length)
    throw Object.assign(new Error("Remove material rows when no materials were used"), { status: 400 });
  const reports = await tx.$queryRaw`
    INSERT INTO aquaflow.field_work_order_completion_reports
      (work_order_id,field_officer_id,customer_name_confirmed,customer_identity_confirmed,
       no_materials_used,completion_notes,status)
    VALUES (${workOrderId},${officerId},${data.customerNameConfirmed ?? false},
      ${data.customerIdentityConfirmed ?? false},${noMaterialsUsed ?? false},
      ${data.completionNotes ?? null},'DRAFT')
    ON CONFLICT(work_order_id) DO UPDATE SET
      field_officer_id=EXCLUDED.field_officer_id,
      customer_name_confirmed=COALESCE(${data.customerNameConfirmed ?? null},field_work_order_completion_reports.customer_name_confirmed),
      customer_identity_confirmed=COALESCE(${data.customerIdentityConfirmed ?? null},field_work_order_completion_reports.customer_identity_confirmed),
      no_materials_used=COALESCE(${noMaterialsUsed ?? null},field_work_order_completion_reports.no_materials_used),
      completion_notes=COALESCE(${data.completionNotes ?? null},field_work_order_completion_reports.completion_notes),
      updated_at=CURRENT_TIMESTAMP
    RETURNING completion_report_id`;
  const reportId = reports[0].completion_report_id as bigint;
  if (materials !== undefined || noMaterialsUsed === true) {
    await tx.$executeRaw`DELETE FROM aquaflow.work_order_materials WHERE completion_report_id=${reportId}`;
    if (noMaterialsUsed !== true) {
      for (const material of materials ?? []) {
        await tx.$executeRaw`
          INSERT INTO aquaflow.work_order_materials
            (work_order_id,inventory_item_id,quantity_used,unit_cost,used_by,completion_report_id)
          VALUES (${workOrderId},${material.materialId},${material.quantity},${material.unitCost},${officerId},${reportId})`;
      }
    }
  }
  return reportId;
}

mobileRouter.post("/field/work-orders/:id/completion/draft", fieldWorkOrderRoles, async (req, res, next) => {
  const workOrderId = workOrderIdSchema.safeParse(req.params.id);
  const input = completionDraftInput.safeParse(req.body);
  if (!workOrderId.success || !input.success)
    return res.status(400).json({ error: input.success ? "Invalid work order id" : input.error.issues[0].message });
  try {
    const owned = await ownedCompletionWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status))
      return res.status(409).json({ error: "Completed job completion is read-only" });
    const materials = await validateCompletionMaterials(input.data.materials);
    await prisma.$transaction((tx) => saveCompletionReport(tx, workOrderId.data, owned.fieldOfficerId, input.data, materials));
    res.json({ workOrderId: workOrderId.data, completion: await completionDetail(workOrderId.data, true) });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.post("/field/work-orders/:id/completion/signature", fieldWorkOrderRoles, async (req, res, next) => {
  const workOrderId = workOrderIdSchema.safeParse(req.params.id);
  const input = completionSignatureInput.safeParse(req.body);
  if (!workOrderId.success || !input.success)
    return res.status(400).json({ error: input.success ? "Invalid work order id" : input.error.issues[0].message });
  try {
    const owned = await ownedCompletionWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status))
      return res.status(409).json({ error: "Completed job completion is read-only" });
    const match = input.data.content.match(/^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/);
    const bytes = match ? Buffer.from(match[1], "base64") : Buffer.alloc(0);
    if (!match || bytes.length > 2_000_000 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      return res.status(400).json({ error: "Signature must be a valid PNG image no larger than 2 MB" });
    const metadata = await prisma.$transaction(async (tx) => {
      const reportId = await saveCompletionReport(tx, workOrderId.data, owned.fieldOfficerId, {}, undefined);
      const existing = await tx.$queryRaw<any[]>`
        SELECT signature_evidence_id FROM aquaflow.field_work_order_completion_reports
        WHERE completion_report_id=${reportId}`;
      const rows = await tx.$queryRaw<any[]>`
        INSERT INTO aquaflow.work_order_evidence
          (work_order_id,evidence_type,file_path,description,captured_by)
        VALUES (${workOrderId.data},'SIGNATURE',${input.data.content},'Customer job-completion signature',${owned.fieldOfficerId})
        RETURNING *`;
      await tx.$executeRaw`
        UPDATE aquaflow.field_work_order_completion_reports
        SET signature_evidence_id=${rows[0].evidence_id},updated_at=CURRENT_TIMESTAMP
        WHERE completion_report_id=${reportId}`;
      if (existing[0]?.signature_evidence_id)
        await tx.$executeRaw`DELETE FROM aquaflow.work_order_evidence WHERE evidence_id=${existing[0].signature_evidence_id}`;
      return {
        evidenceId: rows[0].evidence_id,
        mimeType: "image/png",
        capturedAt: rows[0].captured_at,
        contentUrl: `/api/mobile/field/work-orders/${workOrderId.data}/completion/signature/content`,
      };
    });
    res.status(201).json(metadata);
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

mobileRouter.get("/field/work-orders/:id/completion/signature/content", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const workOrderId = workOrderIdSchema.safeParse(req.params.id);
    if (!workOrderId.success) return res.status(400).json({ error: "Invalid work order id" });
    if (!(await ownedCompletionWorkOrder(req, res, workOrderId.data))) return;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT e.file_path FROM aquaflow.field_work_order_completion_reports r
      JOIN aquaflow.work_order_evidence e ON e.evidence_id=r.signature_evidence_id
      WHERE r.work_order_id=${workOrderId.data} AND e.work_order_id=${workOrderId.data}`;
    if (!rows[0]) return res.status(404).json({ error: "Customer signature not found" });
    const match = String(rows[0].file_path).match(/^data:(image\/png);base64,(.+)$/s);
    if (!match) return res.status(422).json({ error: "Customer signature content is unavailable" });
    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  } catch (error) { next(error); }
});

mobileRouter.delete("/field/work-orders/:id/completion/signature", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const workOrderId = workOrderIdSchema.safeParse(req.params.id);
    if (!workOrderId.success) return res.status(400).json({ error: "Invalid work order id" });
    const owned = await ownedCompletionWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status))
      return res.status(409).json({ error: "Completed job completion is read-only" });
    const removed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT completion_report_id,signature_evidence_id
        FROM aquaflow.field_work_order_completion_reports WHERE work_order_id=${workOrderId.data}`;
      if (!rows[0]?.signature_evidence_id) return false;
      await tx.$executeRaw`
        UPDATE aquaflow.field_work_order_completion_reports
        SET signature_evidence_id=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE completion_report_id=${rows[0].completion_report_id}`;
      await tx.$executeRaw`
        DELETE FROM aquaflow.work_order_evidence
        WHERE evidence_id=${rows[0].signature_evidence_id} AND work_order_id=${workOrderId.data}`;
      return true;
    });
    if (!removed) return res.status(404).json({ error: "Customer signature not found" });
    res.json({ message: "Customer signature removed" });
  } catch (error) { next(error); }
});

mobileRouter.post("/field/work-orders/:id/completion/submit", fieldWorkOrderRoles, async (req, res, next) => {
  const workOrderId = workOrderIdSchema.safeParse(req.params.id);
  const input = completionSubmitInput.safeParse(req.body);
  if (!workOrderId.success || !input.success)
    return res.status(400).json({ error: input.success ? "Invalid work order id" : input.error.issues[0].message });
  try {
    const owned = await ownedCompletionWorkOrder(req, res, workOrderId.data);
    if (!owned) return;
    if (owned.status !== "IN_PROGRESS")
      return res.status(409).json({ error: "The work order must be in progress before job completion can be submitted" });
    const materials = await validateCompletionMaterials(input.data.materials);
    const completionNotes = input.data.completionNotes?.trim() || "Completed by field officer";
    const submission = {
      ...input.data,
      customerNameConfirmed: true,
      customerIdentityConfirmed: true,
      noMaterialsUsed: materials?.length === 0,
      completionNotes,
    };
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<any[]>`
        SELECT status FROM aquaflow.work_orders WHERE work_order_id=${workOrderId.data} FOR UPDATE`;
      if (locked[0]?.status !== "IN_PROGRESS")
        throw Object.assign(new Error("The work order is no longer in progress"), { status: 409 });
      const reportId = await saveCompletionReport(tx, workOrderId.data, owned.fieldOfficerId, submission, materials);
      await tx.$executeRaw`
        UPDATE aquaflow.field_work_order_completion_reports
        SET status='SUBMITTED',submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE completion_report_id=${reportId}`;
      await tx.$executeRaw`
        UPDATE aquaflow.work_orders SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,
          completion_notes=${completionNotes},updated_at=CURRENT_TIMESTAMP
        WHERE work_order_id=${workOrderId.data}`;
      await tx.$executeRaw`
        UPDATE aquaflow.work_order_assignments SET status='COMPLETED'
        WHERE assignment_id=${owned.assignment_id} AND field_officer_id=${owned.fieldOfficerId}`;
      await tx.$executeRaw`
        INSERT INTO aquaflow.work_order_updates
          (work_order_id,field_officer_id,previous_status,new_status,notes)
        VALUES (${workOrderId.data},${owned.fieldOfficerId},'IN_PROGRESS','COMPLETED',
          ${`Job completion submitted: ${completionNotes}`})`;
    });
    res.json({ workOrderId: workOrderId.data, status: "COMPLETED",
      assignmentStatus: "COMPLETED", completion: await completionDetail(workOrderId.data, true) });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

const disconnectionAcknowledgement = z.enum(["ACKNOWLEDGED", "UNAVAILABLE", "REFUSED_TO_SIGN"]);
const disconnectionDraftBody = z.object({
  disconnectionDateTime: z.coerce.date().optional().nullable(),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  gpsCapturedAt: z.coerce.date().optional().nullable(),
  customerAcknowledgement: disconnectionAcknowledgement.optional().nullable(),
  currentReading: z.coerce.number().finite().min(0).max(999_999_999).optional().nullable(),
  remarks: z.string().trim().max(5000).optional().nullable(),
  officerConfirmed: z.boolean().optional(),
});
const disconnectionSubmitBody = z.object({
  disconnectionDateTime: z.coerce.date(),
  gpsLatitude: z.coerce.number().min(-90).max(90),
  gpsLongitude: z.coerce.number().min(-180).max(180),
  gpsCapturedAt: z.coerce.date(),
  customerAcknowledgement: disconnectionAcknowledgement,
  currentReading: z.coerce.number().finite().min(0).max(999_999_999),
  remarks: z.string().trim().min(2).max(5000),
  officerConfirmed: z.literal(true),
});
const disconnectionPhotoBody = z.object({ content: z.string().trim().min(20).max(6_000_000) });

function mobileDisconnectionReadingAmount(context: any, consumption: number) {
  let consumptionCharge = 0;
  if (context.billingMethod === "FLAT") {
    consumptionCharge = Number(context.flatAmount);
  } else if (context.billingMethod === "TIERED") {
    for (const band of context.bands ?? []) {
      const lower = Number(band.lowerLimit);
      const upper = band.upperLimit == null ? consumption : Number(band.upperLimit);
      consumptionCharge += Math.max(0, Math.min(consumption, upper) - lower) * Number(band.ratePerUnit);
    }
  } else {
    consumptionCharge = consumption * Number(context.ratePerUnit);
  }
  consumptionCharge = roundMoney(consumptionCharge);
  return roundMoney(
    consumptionCharge + Math.max(0, Number(context.minimumCharge) - consumptionCharge) +
      Number(context.standingCharge) + Number(context.meterRent),
  );
}

async function mobileDisconnectionReadingContext(workOrderId: bigint) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT wo.account_id AS "accountId", ma.assignment_id AS "meterAssignmentId",
      ma.meter_id AS "meterId", m.meter_number AS "meterNumber",
      COALESCE(latest.current_reading,m.opening_reading) AS "previousReading",
      tariff.tariff_id AS "tariffId", tariff.tariff_name AS "tariffName",
      tariff.billing_method AS "billingMethod", tariff.minimum_charge AS "minimumCharge",
      tariff.standing_charge AS "standingCharge", tariff.meter_rent AS "meterRent",
      tariff.flat_amount AS "flatAmount", tariff.rate_per_unit AS "ratePerUnit", tariff.bands
    FROM aquaflow.work_orders wo
    JOIN aquaflow.customer_accounts ca ON ca.account_id=wo.account_id
    JOIN aquaflow.meter_assignments ma ON ma.account_id=wo.account_id
      AND ma.assignment_status='ACTIVE' AND ma.removal_date IS NULL
    JOIN aquaflow.meters m ON m.meter_id=ma.meter_id
    LEFT JOIN LATERAL (
      SELECT mr.current_reading FROM aquaflow.meter_readings mr
      WHERE mr.meter_id=m.meter_id AND mr.approval_status='APPROVED'
      ORDER BY mr.reading_date DESC,mr.reading_id DESC LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT t.*,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'lowerLimit',tb.lower_limit,'upperLimit',tb.upper_limit,
          'ratePerUnit',tb.rate_per_unit,'bandSequence',tb.band_sequence
        ) ORDER BY tb.band_sequence)
        FROM aquaflow.tariff_bands tb WHERE tb.tariff_id=t.tariff_id AND tb.status='ACTIVE'),'[]'::jsonb) AS bands
      FROM aquaflow.tariffs t
      WHERE t.category_id=ca.category_id AND t.status='ACTIVE'
        AND t.effective_from<=CURRENT_DATE
        AND (t.effective_to IS NULL OR t.effective_to>=CURRENT_DATE)
      ORDER BY t.effective_from DESC,t.tariff_id DESC LIMIT 1
    ) tariff ON TRUE
    WHERE wo.work_order_id=${workOrderId}
    ORDER BY ma.assignment_date DESC,ma.assignment_id DESC LIMIT 1`;
  return rows[0] ?? null;
}

async function ownedDisconnection(req: Request, res: Response, workOrderId: bigint) {
  const officer = await activeFieldOfficer(req, res);
  if (!officer) return null;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT wo.work_order_id, wo.account_id, wo.status, wt.type_code, a.assignment_id,
           a.field_officer_id, a.status AS assignment_status
    FROM aquaflow.work_orders wo
    JOIN aquaflow.work_order_types wt ON wt.work_order_type_id=wo.work_order_type_id
    JOIN LATERAL (SELECT assignment_id, field_officer_id, status FROM aquaflow.work_order_assignments
      WHERE work_order_id=wo.work_order_id ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1) a ON TRUE
    WHERE wo.work_order_id=${workOrderId}`;
  if (!rows[0] || rows[0].type_code !== "DISCONNECTION") {
    res.status(404).json({ error: "Disconnection not found" });
    return null;
  }
  if (rows[0].field_officer_id !== officer.fieldOfficerId || !["ASSIGNED", "ACCEPTED", "COMPLETED"].includes(rows[0].assignment_status)) {
    res.status(403).json({ error: "This disconnection is not assigned to you" });
    return null;
  }
  return { ...rows[0], fieldOfficerId: officer.fieldOfficerId };
}

function disconnectionPhotoMetadata(row: any, workOrderId: bigint) {
  const metadata = evidenceMetadata(row, workOrderId);
  const contentUrl = `/api/mobile/field/disconnections/${workOrderId}/photos/${row.evidence_id}/content`;
  return { ...metadata, thumbnailUrl: contentUrl, contentUrl };
}

async function disconnectionDetail(workOrderId: bigint) {
  const [rows, reports, photos, readingContext] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT wo.work_order_id AS "workOrderId", wo.work_order_number AS "workOrderNumber",
             COALESCE(wo.source_reference, dn.notice_reference, wo.work_order_number) AS "noticeReference",
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS "customerName",
             ca.account_number AS "accountNumber", wo.description AS "disconnectionReason",
             ca.current_balance AS "outstandingBalance",
             CONCAT_WS(', ', p.plot_number, p.building_name, p.physical_address) AS location,
             wo.scheduled_date AS "scheduledDate", wo.status,
             a.assignment_id AS "assignmentId", a.status AS "assignmentStatus"
      FROM aquaflow.work_orders wo
      JOIN aquaflow.customer_accounts ca ON ca.account_id=wo.account_id
      JOIN aquaflow.customers c ON c.customer_id=ca.customer_id
      LEFT JOIN aquaflow.properties p ON p.property_id=wo.property_id
      LEFT JOIN LATERAL (
        SELECT notice_number AS notice_reference FROM aquaflow.debt_notices
        WHERE account_id=wo.account_id AND notice_type IN ('DISCONNECTION_NOTICE','FINAL_DEMAND')
          AND notice_status IN ('APPROVED','SENT','EXPIRED')
        ORDER BY created_at DESC LIMIT 1
      ) dn ON TRUE
      JOIN LATERAL (
        SELECT assignment_id, status FROM aquaflow.work_order_assignments
        WHERE work_order_id=wo.work_order_id ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1
      ) a ON TRUE
      WHERE wo.work_order_id=${workOrderId}`,
    prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.field_disconnection_reports WHERE work_order_id=${workOrderId}`,
    prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.work_order_evidence WHERE work_order_id=${workOrderId} AND evidence_type='AFTER_PHOTO' ORDER BY captured_at DESC`,
    mobileDisconnectionReadingContext(workOrderId),
  ]);
  const report = reports[0];
  return { ...rows[0],
    meterNumber: readingContext?.meterNumber ?? null,
    previousReading: readingContext == null ? null : Number(readingContext.previousReading),
    tariffName: readingContext?.tariffName ?? null,
    hasActiveTariff: Boolean(readingContext?.tariffId),
    evidenceStatus: report?.status ?? null, draft: report ? {
    disconnectionDateTime: report.disconnection_datetime,
    gpsLatitude: report.gps_latitude, gpsLongitude: report.gps_longitude,
    gpsCapturedAt: report.gps_captured_at,
    customerAcknowledgement: report.customer_acknowledgement,
    currentReading: report.current_reading == null ? null : Number(report.current_reading),
    remarks: report.remarks, officerConfirmed: report.officer_confirmed,
    submittedAt: report.submitted_at,
  } : null, photos: photos.map((row) => disconnectionPhotoMetadata(row, workOrderId)) };
}

mobileRouter.get("/field/disconnections", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const officer = await activeFieldOfficer(req, res);
    if (!officer) return;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT wo.work_order_id AS "workOrderId", wo.work_order_number AS "workOrderNumber",
             COALESCE(wo.source_reference, dn.notice_reference, wo.work_order_number) AS "noticeReference",
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)), ''), c.organization_name, c.customer_number) AS "customerName",
             ca.account_number AS "accountNumber", ca.current_balance AS "outstandingBalance",
             wo.description AS "disconnectionReason", wo.scheduled_date AS "scheduledDate", wo.status,
             r.status AS "evidenceStatus", a.assignment_id AS "assignmentId", a.status AS "assignmentStatus"
      FROM aquaflow.work_orders wo
      JOIN aquaflow.work_order_types wt ON wt.work_order_type_id=wo.work_order_type_id AND wt.type_code='DISCONNECTION'
      JOIN aquaflow.customer_accounts ca ON ca.account_id=wo.account_id
      JOIN aquaflow.customers c ON c.customer_id=ca.customer_id
      LEFT JOIN aquaflow.field_disconnection_reports r ON r.work_order_id=wo.work_order_id
      LEFT JOIN LATERAL (
        SELECT notice_number AS notice_reference FROM aquaflow.debt_notices
        WHERE account_id=wo.account_id AND notice_type IN ('DISCONNECTION_NOTICE','FINAL_DEMAND')
          AND notice_status IN ('APPROVED','SENT','EXPIRED') ORDER BY created_at DESC LIMIT 1
      ) dn ON TRUE
      JOIN LATERAL (
        SELECT assignment_id, field_officer_id, status, assigned_at FROM aquaflow.work_order_assignments
        WHERE work_order_id=wo.work_order_id ORDER BY assigned_at DESC, assignment_id DESC LIMIT 1
      ) a ON a.field_officer_id=${officer.fieldOfficerId} AND a.status IN ('ASSIGNED','ACCEPTED','COMPLETED')
      ORDER BY wo.scheduled_date NULLS LAST, wo.created_at DESC`;
    res.json({ items: rows });
  } catch (error) { next(error); }
});

mobileRouter.get("/field/disconnections/:id", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid disconnection id" });
    if (!(await ownedDisconnection(req, res, id.data))) return;
    res.json(await disconnectionDetail(id.data));
  } catch (error) { next(error); }
});

async function upsertDisconnectionReport(tx: typeof prisma, workOrderId: bigint, officerId: bigint, data: z.infer<typeof disconnectionDraftBody>, submitted: boolean) {
  await tx.$executeRaw`INSERT INTO aquaflow.field_disconnection_reports
    (work_order_id, field_officer_id, disconnection_datetime, gps_latitude, gps_longitude, gps_captured_at,
     customer_acknowledgement, current_reading, remarks, officer_confirmed, status, submitted_at)
    VALUES (${workOrderId}, ${officerId}, ${data.disconnectionDateTime ?? null}, ${data.gpsLatitude ?? null},
      ${data.gpsLongitude ?? null}, ${data.gpsCapturedAt ?? null}, ${data.customerAcknowledgement ?? null},
      ${data.currentReading ?? null}, ${data.remarks ?? null}, ${data.officerConfirmed ?? false}, ${submitted ? "SUBMITTED" : "DRAFT"},
      ${submitted ? new Date() : null})
    ON CONFLICT (work_order_id) DO UPDATE SET
      field_officer_id=EXCLUDED.field_officer_id,
      disconnection_datetime=COALESCE(EXCLUDED.disconnection_datetime, field_disconnection_reports.disconnection_datetime),
      gps_latitude=COALESCE(EXCLUDED.gps_latitude, field_disconnection_reports.gps_latitude),
      gps_longitude=COALESCE(EXCLUDED.gps_longitude, field_disconnection_reports.gps_longitude),
      gps_captured_at=COALESCE(EXCLUDED.gps_captured_at, field_disconnection_reports.gps_captured_at),
      customer_acknowledgement=COALESCE(EXCLUDED.customer_acknowledgement, field_disconnection_reports.customer_acknowledgement),
      current_reading=COALESCE(EXCLUDED.current_reading, field_disconnection_reports.current_reading),
      remarks=COALESCE(EXCLUDED.remarks, field_disconnection_reports.remarks),
      officer_confirmed=CASE WHEN ${data.officerConfirmed === undefined} THEN field_disconnection_reports.officer_confirmed ELSE EXCLUDED.officer_confirmed END,
      status=EXCLUDED.status, submitted_at=EXCLUDED.submitted_at, updated_at=CURRENT_TIMESTAMP`;
}

mobileRouter.post("/field/disconnections/:id/draft", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.id);
    const data = disconnectionDraftBody.safeParse(req.body);
    if (!id.success || !data.success) return res.status(400).json({ error: data.success ? "Invalid disconnection id" : data.error.issues[0].message });
    const owned = await ownedDisconnection(req, res, id.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status)) return res.status(409).json({ error: "This disconnection is no longer open for drafting" });
    await upsertDisconnectionReport(prisma, id.data, owned.fieldOfficerId, data.data, false);
    res.json(await disconnectionDetail(id.data));
  } catch (error) { next(error); }
});

mobileRouter.post("/field/disconnections/:id/submit", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.id);
    const data = disconnectionSubmitBody.safeParse(req.body);
    if (!id.success || !data.success) return res.status(400).json({ error: data.success ? "Invalid disconnection id" : data.error.issues[0].message });
    const owned = await ownedDisconnection(req, res, id.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status)) return res.status(409).json({ error: "This disconnection has already been completed or reassigned" });
    const readingContext = await mobileDisconnectionReadingContext(id.data);
    if (!readingContext) return res.status(409).json({ error: "This account has no active meter to read" });
    if (!readingContext.tariffId) return res.status(409).json({ error: "This account has no active tariff for the final reading" });
    const previousReading = Number(readingContext.previousReading);
    const currentReading = data.data.currentReading;
    if (currentReading < previousReading) {
      return res.status(400).json({ error: `Current reading cannot be lower than the previous reading of ${previousReading}` });
    }
    const consumption = currentReading - previousReading;
    const finalReadingAmount = mobileDisconnectionReadingAmount(readingContext, consumption);
    const photos = await prisma.$queryRaw<any[]>`SELECT evidence_id FROM aquaflow.work_order_evidence WHERE work_order_id=${id.data} AND evidence_type='AFTER_PHOTO' LIMIT 1`;
    if (!photos[0]) return res.status(400).json({ error: "At least one evidence photo is required" });
    await prisma.$transaction(async (tx) => {
      await upsertDisconnectionReport(tx as typeof prisma, id.data, owned.fieldOfficerId, data.data, true);
      const reading = await tx.meterReading.create({ data: {
        meterId: readingContext.meterId,
        accountId: readingContext.accountId,
        fieldOfficerId: owned.fieldOfficerId,
        previousReading,
        currentReading,
        readingType: "ACTUAL",
        readingDate: data.data.disconnectionDateTime,
        gpsLatitude: data.data.gpsLatitude,
        gpsLongitude: data.data.gpsLongitude,
        abnormalFlag: consumption === 0,
        exceptionType: consumption === 0 ? "ZERO" : "NONE",
        approvalStatus: "APPROVED",
        approvedBy: credentialUserId(req),
        approvalComments: `Final reading captured in the field app for disconnection ${id.data}`,
        approvedAt: new Date(),
        syncId: `DISCONNECTION-${id.data}`,
        events: { create: { eventType: "DISCONNECTION_READING_POSTED", remarks: data.data.remarks, performedBy: credentialUserId(req) } },
      } });
      await tx.$executeRaw`
        INSERT INTO aquaflow.disconnection_postings
          (work_order_id,account_id,meter_id,reading_id,previous_reading,current_reading,
           default_disconnection_fee,disconnection_fee,fee_overridden,fee_override_reason,
           fine_amount,fine_reason,posted_by)
        VALUES (${id.data},${readingContext.accountId},${readingContext.meterId},${reading.readingId},
          ${previousReading},${currentReading},${finalReadingAmount},${finalReadingAmount},
          FALSE,NULL,0,NULL,${credentialUserId(req)})`;
      await tx.customerAccount.update({
        where: { accountId: readingContext.accountId },
        data: { currentBalance: { increment: finalReadingAmount }, accountStatus: "DISCONNECTED", updatedAt: new Date() },
      });
      await tx.meter.update({ where: { meterId: readingContext.meterId }, data: { status: "DISCONNECTED", updatedAt: new Date() } });
      await tx.meterEvent.create({ data: {
        meterId: readingContext.meterId,
        assignmentId: readingContext.meterAssignmentId,
        eventType: "READING_CAPTURED",
        reading: currentReading,
        remarks: data.data.remarks,
        performedBy: credentialUserId(req),
        metadata: { workOrderId: id.data.toString(), readingId: reading.readingId.toString(), source: "FIELD_APP_DISCONNECTION" },
      } });
      await tx.$executeRaw`UPDATE aquaflow.work_orders SET status='COMPLETED', completed_at=CURRENT_TIMESTAMP,
        completion_notes=${data.data.remarks}, updated_at=CURRENT_TIMESTAMP WHERE work_order_id=${id.data}`;
      await tx.$executeRaw`UPDATE aquaflow.work_order_assignments SET status='COMPLETED'
        WHERE assignment_id=${owned.assignment_id} AND field_officer_id=${owned.fieldOfficerId}`;
      await tx.$executeRaw`INSERT INTO aquaflow.work_order_updates
        (work_order_id, field_officer_id, previous_status, new_status, notes)
        VALUES (${id.data}, ${owned.fieldOfficerId}, ${owned.status}, 'COMPLETED', ${data.data.remarks})`;
    });
    res.json(await disconnectionDetail(id.data));
  } catch (error) { next(error); }
});

mobileRouter.post("/field/disconnections/:id/photos", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.id);
    const data = disconnectionPhotoBody.safeParse(req.body);
    if (!id.success || !data.success) return res.status(400).json({ error: data.success ? "Invalid disconnection id" : data.error.issues[0].message });
    const owned = await ownedDisconnection(req, res, id.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status)) return res.status(409).json({ error: "Completed disconnection evidence is read-only" });
    const match = data.data.content.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match) return res.status(400).json({ error: "Photo must be a JPEG, PNG, or WebP data URI" });
    const rows = await prisma.$queryRaw<any[]>`INSERT INTO aquaflow.work_order_evidence
      (work_order_id, evidence_type, file_path, description, captured_by)
      VALUES (${id.data}, 'AFTER_PHOTO', ${data.data.content}, 'Disconnection evidence', ${owned.fieldOfficerId}) RETURNING *`;
    res.status(201).json(disconnectionPhotoMetadata(rows[0], id.data));
  } catch (error) { next(error); }
});

mobileRouter.get("/field/disconnections/:id/photos/:photoId/content", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.id);
    const photoId = workOrderIdSchema.safeParse(req.params.photoId);
    if (!id.success || !photoId.success) return res.status(400).json({ error: "Invalid disconnection photo reference" });
    if (!(await ownedDisconnection(req, res, id.data))) return;
    const rows = await prisma.$queryRaw<any[]>`SELECT file_path FROM aquaflow.work_order_evidence
      WHERE evidence_id=${photoId.data} AND work_order_id=${id.data} AND evidence_type='AFTER_PHOTO'`;
    if (!rows[0]) return res.status(404).json({ error: "Disconnection photo not found" });
    const match = String(rows[0].file_path).match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return res.status(422).json({ error: "Photo content is unavailable" });
    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  } catch (error) { next(error); }
});

mobileRouter.delete("/field/disconnections/:id/photos/:photoId", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.id);
    const photoId = workOrderIdSchema.safeParse(req.params.photoId);
    if (!id.success || !photoId.success) return res.status(400).json({ error: "Invalid disconnection photo reference" });
    const owned = await ownedDisconnection(req, res, id.data);
    if (!owned) return;
    if (!["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(owned.status)) return res.status(409).json({ error: "Completed disconnection evidence is read-only" });
    const removed = await prisma.$executeRaw`DELETE FROM aquaflow.work_order_evidence WHERE evidence_id=${photoId.data}
      AND work_order_id=${id.data} AND evidence_type='AFTER_PHOTO' AND captured_by=${owned.fieldOfficerId}`;
    if (!removed) return res.status(404).json({ error: "Disconnection photo not found or was not captured by you" });
    res.json({ message: "Disconnection photo removed" });
  } catch (error) { next(error); }
});

const reconnectionDraftBody = z.object({
  reconnectionDateTime: z.coerce.date().optional().nullable(),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  gpsCapturedAt: z.coerce.date().optional().nullable(),
  remarks: z.string().trim().max(5000).optional().nullable(),
});
const reconnectionSubmitBody = z.object({
  reconnectionDateTime: z.coerce.date(),
  gpsLatitude: z.coerce.number().min(-90).max(90),
  gpsLongitude: z.coerce.number().min(-180).max(180),
  gpsCapturedAt: z.coerce.date(),
  remarks: z.string().trim().min(2).max(5000),
});

async function ownedReconnection(req: Request, res: Response, workOrderId: bigint) {
  const officer = await activeFieldOfficer(req, res);
  if (!officer) return null;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT wo.work_order_id, wo.account_id, wo.status, wt.type_code, a.assignment_id,
      a.field_officer_id, a.status AS assignment_status, rr.reconnection_request_id,
      rr.status AS request_status, rr.fee_payment_status, rr.fee_payment_id,
      rr.reconnection_fee, pay.payment_status, pay.payment_type, pay.amount AS paid_amount
    FROM aquaflow.work_orders wo
    JOIN aquaflow.work_order_types wt ON wt.work_order_type_id=wo.work_order_type_id
    LEFT JOIN aquaflow.reconnection_requests rr ON rr.work_order_id=wo.work_order_id
    LEFT JOIN aquaflow.payments pay ON pay.payment_id=rr.fee_payment_id
    JOIN LATERAL (SELECT assignment_id,field_officer_id,status FROM aquaflow.work_order_assignments
      WHERE work_order_id=wo.work_order_id ORDER BY assigned_at DESC,assignment_id DESC LIMIT 1) a ON TRUE
    WHERE wo.work_order_id=${workOrderId}`;
  if (!rows[0] || rows[0].type_code !== "RECONNECTION") { res.status(404).json({ error: "Reconnection not found" }); return null; }
  if (rows[0].field_officer_id !== officer.fieldOfficerId || !["ASSIGNED","ACCEPTED","COMPLETED"].includes(rows[0].assignment_status)) {
    res.status(403).json({ error: "This reconnection is not assigned to you" }); return null;
  }
  return { ...rows[0], fieldOfficerId: officer.fieldOfficerId };
}

function reconnectionPaid(row: any) {
  return row.fee_payment_status === "PAID" && row.payment_status === "POSTED" &&
    row.payment_type === "RECONNECTION_FEE" && Number(row.paid_amount) >= Number(row.reconnection_fee);
}
function reconnectionPhotoMetadata(row: any, workOrderId: bigint) {
  const contentUrl = `/api/mobile/field/reconnections/${workOrderId}/photos/${row.evidence_id}/content`;
  return { evidenceId: row.evidence_id, mimeType: String(row.file_path).match(/^data:([^;,]+)/)?.[1] ?? "image/jpeg",
    capturedAt: row.captured_at, thumbnailUrl: contentUrl, contentUrl };
}
async function reconnectionDetail(workOrderId: bigint) {
  const [rows,reports,photos] = await Promise.all([
    prisma.$queryRaw<any[]>`SELECT wo.work_order_id AS "workOrderId",wo.work_order_number AS "workOrderNumber",
      rr.reconnection_request_id AS "reconnectionRequestId",COALESCE(rr.request_number,'') AS "reconnectionReference",
      COALESCE(dwo.source_reference,dwo.work_order_number) AS "disconnectionReference",
      ca.account_number AS "accountNumber",ca.account_status AS "accountStatus",
      (SELECT m.status FROM aquaflow.meter_assignments ma JOIN aquaflow.meters m ON m.meter_id=ma.meter_id
       WHERE ma.account_id=ca.account_id AND ma.assignment_status='ACTIVE' AND ma.removal_date IS NULL
       ORDER BY ma.assignment_date DESC,ma.assignment_id DESC LIMIT 1) AS "meterStatus",
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.middle_name,c.last_name)),''),c.organization_name,c.customer_number) AS "customerName",
      CONCAT_WS(', ',p.plot_number,p.building_name,p.physical_address) AS location,wo.scheduled_date AS "scheduledDate",
      wo.status,COALESCE(rr.status,'NOT_CREATED') AS "requestStatus",
      COALESCE(rr.fee_payment_status,'NOT_STARTED') AS "feePaymentStatus",
      COALESCE(rr.reconnection_fee,0) AS "amountRequired",
      COALESCE(pay.amount,0) AS "amountPaid",COALESCE(pay.payment_status,'NOT_STARTED') AS "paymentStatus",
      pay.transaction_reference AS "paymentReference",
      COALESCE(rr.fee_payment_status='PAID' AND pay.payment_status='POSTED' AND pay.payment_type='RECONNECTION_FEE' AND pay.amount>=rr.reconnection_fee,FALSE) AS "paymentConfirmed"
      FROM aquaflow.work_orders wo LEFT JOIN aquaflow.reconnection_requests rr ON rr.work_order_id=wo.work_order_id
      JOIN aquaflow.customer_accounts ca ON ca.account_id=wo.account_id JOIN aquaflow.customers c ON c.customer_id=ca.customer_id
      LEFT JOIN aquaflow.properties p ON p.property_id=wo.property_id LEFT JOIN aquaflow.payments pay ON pay.payment_id=rr.fee_payment_id
      LEFT JOIN aquaflow.work_orders dwo ON dwo.work_order_id=rr.disconnection_work_order_id WHERE wo.work_order_id=${workOrderId}`,
    prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.field_reconnection_reports WHERE work_order_id=${workOrderId}`,
    prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.work_order_evidence WHERE work_order_id=${workOrderId} AND evidence_type='AFTER_PHOTO' ORDER BY captured_at DESC`,
  ]);
  const report=reports[0]; return { ...rows[0], evidenceStatus: report?.status ?? null, draft: report ? {
    reconnectionDateTime:report.reconnection_datetime,gpsLatitude:report.gps_latitude,gpsLongitude:report.gps_longitude,
    gpsCapturedAt:report.gps_captured_at,remarks:report.remarks,submittedAt:report.submitted_at } : null,
    photos:photos.map(row=>reconnectionPhotoMetadata(row,workOrderId)) };
}

mobileRouter.get("/field/reconnections",fieldWorkOrderRoles,async(req,res,next)=>{try{
  const officer=await activeFieldOfficer(req,res);if(!officer)return;
  const rows=await prisma.$queryRaw<any[]>`SELECT wo.work_order_id AS "workOrderId",wo.work_order_number AS "workOrderNumber",
    COALESCE(rr.request_number,'') AS "reconnectionReference",COALESCE(dwo.source_reference,dwo.work_order_number) AS "disconnectionReference",
    ca.account_number AS "accountNumber",COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.middle_name,c.last_name)),''),c.organization_name,c.customer_number) AS "customerName",
    CONCAT_WS(', ',p.plot_number,p.building_name,p.physical_address) AS location,wo.scheduled_date AS "scheduledDate",wo.status,
    COALESCE(rr.fee_payment_status,'NOT_STARTED') AS "feePaymentStatus",
    COALESCE(pay.payment_status,'NOT_STARTED') AS "paymentStatus",
    COALESCE(rr.fee_payment_status='PAID' AND pay.payment_status='POSTED' AND pay.payment_type='RECONNECTION_FEE' AND pay.amount>=rr.reconnection_fee,FALSE) AS "paymentConfirmed",
    fr.status AS "evidenceStatus",a.assignment_id AS "assignmentId",a.status AS "assignmentStatus"
    FROM aquaflow.work_orders wo JOIN aquaflow.work_order_types wt ON wt.work_order_type_id=wo.work_order_type_id AND wt.type_code='RECONNECTION'
    LEFT JOIN aquaflow.reconnection_requests rr ON rr.work_order_id=wo.work_order_id JOIN aquaflow.customer_accounts ca ON ca.account_id=wo.account_id
    JOIN aquaflow.customers c ON c.customer_id=ca.customer_id LEFT JOIN aquaflow.properties p ON p.property_id=wo.property_id
    LEFT JOIN aquaflow.payments pay ON pay.payment_id=rr.fee_payment_id LEFT JOIN aquaflow.work_orders dwo ON dwo.work_order_id=rr.disconnection_work_order_id
    LEFT JOIN aquaflow.field_reconnection_reports fr ON fr.work_order_id=wo.work_order_id
    JOIN LATERAL(SELECT assignment_id,field_officer_id,status,assigned_at FROM aquaflow.work_order_assignments WHERE work_order_id=wo.work_order_id ORDER BY assigned_at DESC,assignment_id DESC LIMIT 1)a
      ON a.field_officer_id=${officer.fieldOfficerId} AND a.status IN('ASSIGNED','ACCEPTED','COMPLETED') ORDER BY wo.scheduled_date NULLS LAST,wo.created_at DESC`;
  res.json({items:rows});}catch(error){next(error)}});
mobileRouter.get("/field/reconnections/:id",fieldWorkOrderRoles,async(req,res,next)=>{try{const id=workOrderIdSchema.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid reconnection id"});if(!(await ownedReconnection(req,res,id.data)))return;res.json(await reconnectionDetail(id.data));}catch(error){next(error)}});

async function upsertReconnectionReport(tx:typeof prisma,workOrderId:bigint,requestId:bigint,officerId:bigint,data:z.infer<typeof reconnectionDraftBody>,submitted:boolean){
  await tx.$executeRaw`INSERT INTO aquaflow.field_reconnection_reports(work_order_id,reconnection_request_id,field_officer_id,reconnection_datetime,gps_latitude,gps_longitude,gps_captured_at,remarks,status,submitted_at)
    VALUES(${workOrderId},${requestId},${officerId},${data.reconnectionDateTime??null},${data.gpsLatitude??null},${data.gpsLongitude??null},${data.gpsCapturedAt??null},${data.remarks??null},${submitted?"SUBMITTED":"DRAFT"},${submitted?new Date():null})
    ON CONFLICT(work_order_id)DO UPDATE SET field_officer_id=EXCLUDED.field_officer_id,reconnection_datetime=COALESCE(EXCLUDED.reconnection_datetime,field_reconnection_reports.reconnection_datetime),
    gps_latitude=COALESCE(EXCLUDED.gps_latitude,field_reconnection_reports.gps_latitude),gps_longitude=COALESCE(EXCLUDED.gps_longitude,field_reconnection_reports.gps_longitude),
    gps_captured_at=COALESCE(EXCLUDED.gps_captured_at,field_reconnection_reports.gps_captured_at),remarks=COALESCE(EXCLUDED.remarks,field_reconnection_reports.remarks),status=EXCLUDED.status,
    submitted_at=EXCLUDED.submitted_at,updated_at=CURRENT_TIMESTAMP`;
}
mobileRouter.post("/field/reconnections/:id/draft",fieldWorkOrderRoles,async(req,res,next)=>{try{const id=workOrderIdSchema.safeParse(req.params.id),data=reconnectionDraftBody.safeParse(req.body);if(!id.success||!data.success)return res.status(400).json({error:data.success?"Invalid reconnection id":data.error.issues[0].message});const owned=await ownedReconnection(req,res,id.data);if(!owned)return;if(!["ASSIGNED","ACCEPTED","IN_PROGRESS"].includes(owned.status))return res.status(409).json({error:"Completed reconnection evidence is read-only"});await upsertReconnectionReport(prisma,id.data,owned.reconnection_request_id,owned.fieldOfficerId,data.data,false);res.json(await reconnectionDetail(id.data));}catch(error){next(error)}});
mobileRouter.post("/field/reconnections/:id/submit",fieldWorkOrderRoles,async(req,res,next)=>{try{const id=workOrderIdSchema.safeParse(req.params.id),data=reconnectionSubmitBody.safeParse(req.body);if(!id.success||!data.success)return res.status(400).json({error:data.success?"Invalid reconnection id":data.error.issues[0].message});const owned=await ownedReconnection(req,res,id.data);if(!owned)return;if(!["ASSIGNED","ACCEPTED","IN_PROGRESS"].includes(owned.status))return res.status(409).json({error:"This reconnection has already been completed or reassigned"});if(!reconnectionPaid(owned))return res.status(409).json({error:"A posted reconnection-fee payment is required before completion"});await prisma.$transaction(async tx=>{await upsertReconnectionReport(tx as typeof prisma,id.data,owned.reconnection_request_id,owned.fieldOfficerId,data.data,true);await tx.$executeRaw`UPDATE aquaflow.work_orders SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,completion_notes=${data.data.remarks},updated_at=CURRENT_TIMESTAMP WHERE work_order_id=${id.data}`;await tx.$executeRaw`UPDATE aquaflow.work_order_assignments SET status='COMPLETED' WHERE assignment_id=${owned.assignment_id} AND field_officer_id=${owned.fieldOfficerId}`;await tx.$executeRaw`UPDATE aquaflow.reconnection_requests SET status='COMPLETED',updated_at=CURRENT_TIMESTAMP WHERE reconnection_request_id=${owned.reconnection_request_id}`;await tx.$executeRaw`UPDATE aquaflow.customer_accounts SET account_status='ACTIVE',updated_at=CURRENT_TIMESTAMP WHERE account_id=${owned.account_id} AND account_status='DISCONNECTED'`;await tx.$executeRaw`UPDATE aquaflow.meters m SET status='ACTIVE',updated_at=CURRENT_TIMESTAMP FROM aquaflow.meter_assignments ma WHERE ma.meter_id=m.meter_id AND ma.account_id=${owned.account_id} AND ma.assignment_status='ACTIVE' AND ma.removal_date IS NULL AND m.status='DISCONNECTED'`;await tx.$executeRaw`INSERT INTO aquaflow.work_order_updates(work_order_id,field_officer_id,previous_status,new_status,notes)VALUES(${id.data},${owned.fieldOfficerId},${owned.status},'COMPLETED',${data.data.remarks})`;});res.json(await reconnectionDetail(id.data));}catch(error){next(error)}});
mobileRouter.post("/field/reconnections/:id/photos",fieldWorkOrderRoles,async(req,res,next)=>{try{const id=workOrderIdSchema.safeParse(req.params.id),data=disconnectionPhotoBody.safeParse(req.body);if(!id.success||!data.success)return res.status(400).json({error:data.success?"Invalid reconnection id":data.error.issues[0].message});const owned=await ownedReconnection(req,res,id.data);if(!owned)return;if(!["ASSIGNED","ACCEPTED","IN_PROGRESS"].includes(owned.status))return res.status(409).json({error:"Completed reconnection evidence is read-only"});const match=data.data.content.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);if(!match)return res.status(400).json({error:"Photo must be a JPEG, PNG, or WebP data URI"});const rows=await prisma.$queryRaw<any[]>`INSERT INTO aquaflow.work_order_evidence(work_order_id,evidence_type,file_path,description,captured_by)VALUES(${id.data},'AFTER_PHOTO',${data.data.content},'Reconnection evidence',${owned.fieldOfficerId})RETURNING *`;res.status(201).json(reconnectionPhotoMetadata(rows[0],id.data));}catch(error){next(error)}});
mobileRouter.get("/field/reconnections/:id/photos/:photoId/content",fieldWorkOrderRoles,async(req,res,next)=>{try{const id=workOrderIdSchema.safeParse(req.params.id),photoId=workOrderIdSchema.safeParse(req.params.photoId);if(!id.success||!photoId.success)return res.status(400).json({error:"Invalid reconnection photo reference"});if(!(await ownedReconnection(req,res,id.data)))return;const rows=await prisma.$queryRaw<any[]>`SELECT file_path FROM aquaflow.work_order_evidence WHERE evidence_id=${photoId.data} AND work_order_id=${id.data} AND evidence_type='AFTER_PHOTO'`;if(!rows[0])return res.status(404).json({error:"Reconnection photo not found"});const match=String(rows[0].file_path).match(/^data:([^;,]+);base64,(.+)$/s);if(!match)return res.status(422).json({error:"Photo content is unavailable"});res.type(match[1]).send(Buffer.from(match[2],"base64"));}catch(error){next(error)}});
mobileRouter.delete("/field/reconnections/:id/photos/:photoId",fieldWorkOrderRoles,async(req,res,next)=>{try{const id=workOrderIdSchema.safeParse(req.params.id),photoId=workOrderIdSchema.safeParse(req.params.photoId);if(!id.success||!photoId.success)return res.status(400).json({error:"Invalid reconnection photo reference"});const owned=await ownedReconnection(req,res,id.data);if(!owned)return;if(!["ASSIGNED","ACCEPTED","IN_PROGRESS"].includes(owned.status))return res.status(409).json({error:"Completed reconnection evidence is read-only"});const removed=await prisma.$executeRaw`DELETE FROM aquaflow.work_order_evidence WHERE evidence_id=${photoId.data} AND work_order_id=${id.data} AND evidence_type='AFTER_PHOTO' AND captured_by=${owned.fieldOfficerId}`;if(!removed)return res.status(404).json({error:"Reconnection photo not found or was not captured by you"});res.json({message:"Reconnection photo removed"});}catch(error){next(error)}});

const inspectionAnswer = z.enum(["YES", "NO", "NA"]);
const inspectionBody = z.object({
  checklist: z.object({
    waterAvailability: inspectionAnswer,
    accessRoad: inspectionAnswer,
    siteSuitability: inspectionAnswer,
    connectionPoint: inspectionAnswer,
    safetyRisks: inspectionAnswer,
  }),
  findings: z.string().trim().min(2).max(5000),
  recommendations: z.string().trim().min(2).max(5000),
  estimatedMaterialCost: z.coerce.number().min(0).max(100_000_000),
  estimatedLabourCost: z.coerce.number().min(0).max(100_000_000),
  gpsLatitude: z.coerce.number().min(-90).max(90),
  gpsLongitude: z.coerce.number().min(-180).max(180),
  gpsCapturedAt: z.coerce.date(),
});
const inspectionDraftBody = z.object({
  checklist: z.object({
    waterAvailability: inspectionAnswer.optional(),
    accessRoad: inspectionAnswer.optional(),
    siteSuitability: inspectionAnswer.optional(),
    connectionPoint: inspectionAnswer.optional(),
    safetyRisks: inspectionAnswer.optional(),
  }).optional(),
  findings: z.string().trim().min(2).max(5000).optional(),
  recommendations: z.string().trim().min(2).max(5000).optional(),
  estimatedMaterialCost: z.coerce.number().min(0).max(100_000_000).optional(),
  estimatedLabourCost: z.coerce.number().min(0).max(100_000_000).optional(),
  gpsLatitude: z.coerce.number().min(-90).max(90).optional(),
  gpsLongitude: z.coerce.number().min(-180).max(180).optional(),
  gpsCapturedAt: z.coerce.date().optional(),
  recommendation: z.enum(["RECOMMENDED", "NOT_RECOMMENDED"]).optional(),
});
const inspectionPhotoBody = z.object({
  content: z.string().trim().min(20).max(6_000_000),
});

async function ownedInspection(req: Request, res: Response, applicationId: bigint) {
  const officer = await activeFieldOfficer(req, res);
  if (!officer) return null;
  const rows = await prisma.$queryRaw<any[]>`
    SELECT connection_application_id, application_number, status, inspection_officer_id
    FROM aquaflow.new_connection_applications
    WHERE connection_application_id = ${applicationId}`;
  if (!rows[0]) {
    res.status(404).json({ error: "Connection application not found" });
    return null;
  }
  if (rows[0].inspection_officer_id !== BigInt(req.user!.userId)) {
    res.status(403).json({ error: "This inspection is not assigned to you" });
    return null;
  }
  return { application: rows[0], fieldOfficerId: officer.fieldOfficerId };
}

function inspectionPhotoMetadata(row: any, applicationId: bigint) {
  return {
    photoId: row.inspection_photo_id,
    mimeType: row.mime_type,
    capturedAt: row.captured_at,
    thumbnailUrl: `/api/mobile/field/inspections/${applicationId}/photos/${row.inspection_photo_id}/content`,
  };
}

async function inspectionDetail(applicationId: bigint) {
  const [applicationRows, reportRows, photoRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT a.connection_application_id AS "applicationId", a.application_number AS "applicationReference",
             a.applicant_name AS "applicantName", a.physical_address AS "siteLocation",
             a.plot_number AS "plotNumber", a.inspection_scheduled_at AS "scheduledInspectionDate",
             a.status AS "applicationStatus", z.zone_name AS "zoneName"
      FROM aquaflow.new_connection_applications a
      LEFT JOIN aquaflow.zones z ON z.zone_id = a.zone_id
      WHERE a.connection_application_id=${applicationId}`,
    prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.field_inspection_reports WHERE connection_application_id=${applicationId}`,
    prisma.$queryRaw<any[]>`SELECT * FROM aquaflow.field_inspection_photos WHERE connection_application_id=${applicationId} ORDER BY captured_at DESC`,
  ]);
  const report = reportRows[0];
  return {
    ...applicationRows[0],
    inspectionStatus: report?.status ?? null,
    inspectionRecommendation: report?.recommendation ?? null,
    draft: report ? {
      checklist: report.checklist,
      findings: report.findings,
      recommendations: report.recommendations,
      estimatedMaterialCost: report.estimated_material_cost,
      estimatedLabourCost: report.estimated_labour_cost,
      gpsLatitude: report.gps_latitude,
      gpsLongitude: report.gps_longitude,
      gpsCapturedAt: report.gps_captured_at,
      recommendation: report.recommendation,
      status: report.status,
      submittedAt: report.submitted_at,
      updatedAt: report.updated_at,
    } : null,
    photos: photoRows.map((row) => inspectionPhotoMetadata(row, applicationId)),
  };
}

mobileRouter.get("/field/inspections", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const officer = await activeFieldOfficer(req, res);
    if (!officer) return;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT a.connection_application_id AS "applicationId", a.application_number AS "applicationReference",
             a.applicant_name AS "applicantName", a.physical_address AS "siteLocation",
             a.inspection_scheduled_at AS "scheduledInspectionDate", a.status AS "applicationStatus",
             z.zone_name AS "zoneName", r.status AS "inspectionStatus",
             r.recommendation AS "inspectionRecommendation"
      FROM aquaflow.new_connection_applications a
      LEFT JOIN aquaflow.zones z ON z.zone_id = a.zone_id
      LEFT JOIN aquaflow.field_inspection_reports r ON r.connection_application_id=a.connection_application_id
      WHERE a.inspection_officer_id=${BigInt(req.user!.userId)}
        AND a.status='INSPECTION_SCHEDULED'
      ORDER BY a.inspection_scheduled_at NULLS LAST, a.created_at DESC`;
    res.json({ items: rows });
  } catch (error) { next(error); }
});

mobileRouter.get("/field/inspections/:applicationId", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.applicationId);
    if (!id.success) return res.status(400).json({ error: "Invalid connection application" });
    if (!(await ownedInspection(req, res, id.data))) return;
    res.json(await inspectionDetail(id.data));
  } catch (error) { next(error); }
});

async function upsertInspectionDraft(
  client: typeof prisma,
  applicationId: bigint,
  officerId: bigint,
  data: z.infer<typeof inspectionDraftBody>,
  submitted: boolean,
  recommendation?: "RECOMMENDED" | "NOT_RECOMMENDED",
) {
  const submittedRecommendation = recommendation ?? data.recommendation ?? null;
  const rows = await client.$queryRaw<any[]>`
    INSERT INTO aquaflow.field_inspection_reports
      (connection_application_id, field_officer_id, checklist, findings, recommendations,
       estimated_material_cost, estimated_labour_cost, gps_latitude, gps_longitude, gps_captured_at,
       recommendation, status, submitted_at, updated_at)
    VALUES (${applicationId}, ${officerId}, ${JSON.stringify(data.checklist ?? {})}::jsonb, ${data.findings ?? null}, ${data.recommendations ?? null},
      COALESCE(${data.estimatedMaterialCost}, 0), COALESCE(${data.estimatedLabourCost}, 0), ${data.gpsLatitude}, ${data.gpsLongitude}, ${data.gpsCapturedAt},
      ${submittedRecommendation}, ${submitted ? "SUBMITTED" : "DRAFT"}, ${submitted ? new Date() : null}, CURRENT_TIMESTAMP)
    ON CONFLICT (connection_application_id) DO UPDATE SET
      field_officer_id=EXCLUDED.field_officer_id, checklist=field_inspection_reports.checklist || EXCLUDED.checklist,
      findings=COALESCE(EXCLUDED.findings, field_inspection_reports.findings),
      recommendations=COALESCE(EXCLUDED.recommendations, field_inspection_reports.recommendations),
      estimated_material_cost=COALESCE(EXCLUDED.estimated_material_cost, field_inspection_reports.estimated_material_cost),
      estimated_labour_cost=COALESCE(EXCLUDED.estimated_labour_cost, field_inspection_reports.estimated_labour_cost),
      gps_latitude=COALESCE(EXCLUDED.gps_latitude, field_inspection_reports.gps_latitude),
      gps_longitude=COALESCE(EXCLUDED.gps_longitude, field_inspection_reports.gps_longitude),
      gps_captured_at=COALESCE(EXCLUDED.gps_captured_at, field_inspection_reports.gps_captured_at),
      recommendation=COALESCE(EXCLUDED.recommendation, field_inspection_reports.recommendation), status=EXCLUDED.status,
      submitted_at=EXCLUDED.submitted_at, updated_at=CURRENT_TIMESTAMP
    RETURNING inspection_report_id`;
  return rows[0];
}

mobileRouter.post("/field/inspections/:applicationId/draft", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.applicationId);
    const data = inspectionDraftBody.safeParse(req.body);
    if (!id.success || !data.success) return res.status(400).json({ error: data.success ? "Invalid connection application" : data.error.issues[0].message });
    const owned = await ownedInspection(req, res, id.data);
    if (!owned) return;
    if (owned.application.status !== "INSPECTION_SCHEDULED") return res.status(409).json({ error: "This inspection is no longer open for drafting" });
    await upsertInspectionDraft(prisma, id.data, owned.fieldOfficerId, data.data, false);
    res.json(await inspectionDetail(id.data));
  } catch (error) { next(error); }
});

mobileRouter.post("/field/inspections/:applicationId/submit", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.applicationId);
    const data = inspectionBody.extend({ recommendation: z.enum(["RECOMMENDED", "NOT_RECOMMENDED"]) }).safeParse(req.body);
    if (!id.success || !data.success) return res.status(400).json({ error: data.success ? "Invalid connection application" : data.error.issues[0].message });
    const owned = await ownedInspection(req, res, id.data);
    if (!owned) return;
    if (owned.application.status !== "INSPECTION_SCHEDULED") return res.status(409).json({ error: "This inspection has already been submitted or reassigned" });
    const outcome = data.data.recommendation === "RECOMMENDED" ? "FEASIBLE" : "NOT_FEASIBLE";
    await prisma.$transaction(async (tx) => {
      await upsertInspectionDraft(tx as typeof prisma, id.data, owned.fieldOfficerId, data.data, true, data.data.recommendation);
      await tx.$executeRaw`UPDATE aquaflow.new_connection_applications SET status=${outcome === "FEASIBLE" ? "INSPECTED" : "REJECTED"},
        inspection_outcome=${outcome}, inspection_notes=${data.data.findings}, materials_cost=${data.data.estimatedMaterialCost},
        labour_cost=${data.data.estimatedLabourCost}, updated_at=CURRENT_TIMESTAMP WHERE connection_application_id=${id.data}`;
      await tx.$executeRaw`INSERT INTO aquaflow.new_connection_activities
        (connection_application_id, activity_type, notes, performed_by)
        VALUES (${id.data}, 'RECORD_INSPECTION', ${`Inspection ${outcome}: ${data.data.findings}`}, ${BigInt(req.user!.userId)})`;
    });
    res.json(await inspectionDetail(id.data));
  } catch (error) { next(error); }
});

mobileRouter.post("/field/inspections/:applicationId/photos", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.applicationId);
    const data = inspectionPhotoBody.safeParse(req.body);
    if (!id.success || !data.success) return res.status(400).json({ error: data.success ? "Invalid connection application" : data.error.issues[0].message });
    const owned = await ownedInspection(req, res, id.data);
    if (!owned) return;
    const match = data.data.content.match(/^data:([^;,]+);base64,[A-Za-z0-9+/=\r\n]+$/);
    if (!match) return res.status(400).json({ error: "Photo must be a base64 data URI" });
    const rows = await prisma.$queryRaw<any[]>`INSERT INTO aquaflow.field_inspection_photos
      (connection_application_id, captured_by, content, mime_type)
      VALUES (${id.data}, ${owned.fieldOfficerId}, ${data.data.content}, ${match[1]}) RETURNING *`;
    res.status(201).json(inspectionPhotoMetadata(rows[0], id.data));
  } catch (error) { next(error); }
});

mobileRouter.get("/field/inspections/:applicationId/photos/:photoId/content", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.applicationId);
    const photoId = workOrderIdSchema.safeParse(req.params.photoId);
    if (!id.success || !photoId.success) return res.status(400).json({ error: "Invalid inspection photo reference" });
    if (!(await ownedInspection(req, res, id.data))) return;
    const rows = await prisma.$queryRaw<any[]>`SELECT content, mime_type FROM aquaflow.field_inspection_photos WHERE inspection_photo_id=${photoId.data} AND connection_application_id=${id.data}`;
    if (!rows[0]) return res.status(404).json({ error: "Inspection photo not found" });
    const content = String(rows[0].content).replace(/^data:[^;,]+;base64,/, "");
    res.type(rows[0].mime_type).send(Buffer.from(content, "base64"));
  } catch (error) { next(error); }
});

mobileRouter.delete("/field/inspections/:applicationId/photos/:photoId", fieldWorkOrderRoles, async (req, res, next) => {
  try {
    const id = workOrderIdSchema.safeParse(req.params.applicationId);
    const photoId = workOrderIdSchema.safeParse(req.params.photoId);
    if (!id.success || !photoId.success) return res.status(400).json({ error: "Invalid inspection photo reference" });
    const owned = await ownedInspection(req, res, id.data);
    if (!owned) return;
    const removed = await prisma.$executeRaw`DELETE FROM aquaflow.field_inspection_photos
      WHERE inspection_photo_id=${photoId.data} AND connection_application_id=${id.data} AND captured_by=${owned.fieldOfficerId}`;
    if (!removed) return res.status(404).json({ error: "Inspection photo not found or was not captured by you" });
    res.json({ message: "Inspection photo removed" });
  } catch (error) { next(error); }
});
