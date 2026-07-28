import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

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
        notifications: { orderBy: { createdAt: "desc" }, take: 30 },
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
      payments: account.payments.map((payment) => ({
        paymentId: payment.paymentId,
        transactionReference: payment.transactionReference,
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        status: payment.paymentStatus,
        channelName: payment.channel.channelName,
        receiptNumber: payment.receipt?.receiptNumber,
      })),
    }));
    res.json({
      customer: {
        customerId: customer.customerId,
        customerNumber: customer.customerNumber,
        name,
        phoneNumber: customer.phoneNumber,
        emailAddress: customer.emailAddress,
      },
      summary: {
        accounts: accounts.length,
        balance: accounts.reduce((sum, account) => sum + Number(account.currentBalance), 0),
        openRequests: customer.serviceRequests.filter((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status)).length,
        unreadNotifications: customer.notifications.filter((item) => item.deliveryStatus !== "DELIVERED").length,
      },
      accounts,
      serviceRequests: customer.serviceRequests,
      connections,
      notifications: customer.notifications,
    });
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
