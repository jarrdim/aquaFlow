import { Router } from "express";
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

mobileRouter.use(requireAuth);

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
