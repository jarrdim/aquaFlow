import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const defaultPassword = process.env.SEED_DEFAULT_PASSWORD ?? "ChangeMe123!";
const seedDemoGeography = process.env.SEED_DEMO_GEOGRAPHY === "true";
const fieldOfficerZoneCode =
  process.env.SEED_FIELD_OFFICER_ZONE_CODE?.trim() || null;

const roleDefinitions = [
  ["SYSTEM_ADMIN", "System Administrator", "Full system administration"],
  [
    "BILLING_OFFICER",
    "Billing Officer",
    "Create tariffs and run billing operations",
  ],
  [
    "BILLING_SUPERVISOR",
    "Billing Supervisor",
    "Approve tariffs, readings and billing transactions",
  ],
  [
    "FINANCE_MANAGER",
    "Finance Manager",
    "Approve tariff activation and financial controls",
  ],
  ["METER_READER", "Meter Reader", "Capture assigned route meter readings"],
  [
    "METER_SUPERVISOR",
    "Meter Supervisor",
    "Approve readings and manage meter operations",
  ],
  ["CASHIER", "Cashier", "Record customer payments and issue receipts"],
  ["ACCOUNTANT", "Accountant", "Reconcile collections and approve financial controls"],
  ["AUDITOR", "Auditor", "Read-only financial and operational audit access"],
  [
    "CREDIT_CONTROL_OFFICER",
    "Credit Control Officer",
    "Manage arrears follow-up, reminders, notices and payment arrangements",
  ],
  [
    "CREDIT_CONTROL_SUPERVISOR",
    "Credit Control Supervisor",
    "Approve debt notices and payment arrangements",
  ],
  [
    "CUSTOMER_CARE_OFFICER",
    "Customer Care Officer",
    "View debt profiles and record promises to pay",
  ],
] as const;

const staffDefinitions = [
  {
    username: "admin",
    firstName: "System",
    lastName: "Administrator",
    emailAddress: "admin@aquaflow.local",
    phoneNumber: "+254700000001",
    roleCode: "SYSTEM_ADMIN",
  },
  {
    username: "billing.officer",
    firstName: "Brenda",
    lastName: "Billing",
    emailAddress: "billing.officer@aquaflow.local",
    phoneNumber: "+254700000002",
    roleCode: "BILLING_OFFICER",
  },
  {
    username: "billing.supervisor",
    firstName: "Samuel",
    lastName: "Billing",
    emailAddress: "billing.supervisor@aquaflow.local",
    phoneNumber: "+254700000003",
    roleCode: "BILLING_SUPERVISOR",
  },
  {
    username: "finance.manager",
    firstName: "Faith",
    lastName: "Manager",
    emailAddress: "finance.manager@aquaflow.local",
    phoneNumber: "+254700000004",
    roleCode: "FINANCE_MANAGER",
  },
  {
    username: "meter.reader",
    firstName: "Ryan",
    lastName: "Reader",
    emailAddress: "meter.reader@aquaflow.local",
    phoneNumber: "+254700000005",
    roleCode: "METER_READER",
  },
  {
    username: "meter.supervisor",
    firstName: "Mary",
    lastName: "Supervisor",
    emailAddress: "meter.supervisor@aquaflow.local",
    phoneNumber: "+254700000006",
    roleCode: "METER_SUPERVISOR",
  },
  {
    username: "cashier",
    firstName: "Carol",
    lastName: "Cashier",
    emailAddress: "cashier@aquaflow.local",
    phoneNumber: "+254700000007",
    roleCode: "CASHIER",
  },
  {
    username: "accountant",
    firstName: "Andrew",
    lastName: "Accountant",
    emailAddress: "accountant@aquaflow.local",
    phoneNumber: "+254700000008",
    roleCode: "ACCOUNTANT",
  },
  {
    username: "auditor",
    firstName: "Alice",
    lastName: "Auditor",
    emailAddress: "auditor@aquaflow.local",
    phoneNumber: "+254700000009",
    roleCode: "AUDITOR",
  },
  {
    username: "credit.officer",
    firstName: "Christine",
    lastName: "Credit",
    emailAddress: "credit.officer@aquaflow.local",
    phoneNumber: "+254700000010",
    roleCode: "CREDIT_CONTROL_OFFICER",
  },
  {
    username: "credit.supervisor",
    firstName: "Charles",
    lastName: "Credit",
    emailAddress: "credit.supervisor@aquaflow.local",
    phoneNumber: "+254700000011",
    roleCode: "CREDIT_CONTROL_SUPERVISOR",
  },
  {
    username: "customer.care",
    firstName: "Catherine",
    lastName: "Care",
    emailAddress: "customer.care@aquaflow.local",
    phoneNumber: "+254700000012",
    roleCode: "CUSTOMER_CARE_OFFICER",
  },
] as const;

async function ensureRole(
  roleCode: string,
  roleName: string,
  description: string,
) {
  return prisma.role.upsert({
    where: { roleCode },
    update: { roleName, description, status: "ACTIVE" },
    create: { roleCode, roleName, description, status: "ACTIVE" },
  });
}

async function ensureUser(
  definition: (typeof staffDefinitions)[number],
  passwordHash: string,
) {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username: definition.username },
        { emailAddress: definition.emailAddress },
      ],
    },
  });
  const data = {
    username: definition.username,
    firstName: definition.firstName,
    lastName: definition.lastName,
    emailAddress: definition.emailAddress,
    phoneNumber: definition.phoneNumber,
    passwordHash,
    userType: "STAFF",
    status: "ACTIVE",
  };
  return existing
    ? prisma.user.update({ where: { userId: existing.userId }, data })
    : prisma.user.create({ data });
}

async function ensureUserRole(userId: bigint, roleId: bigint) {
  const existing = await prisma.userRole.findFirst({
    where: { userId, roleId },
  });
  if (existing) {
    return prisma.userRole.update({
      where: { userRoleId: existing.userRoleId },
      data: { status: "ACTIVE", effectiveTo: null },
    });
  }
  return prisma.userRole.create({ data: { userId, roleId } });
}

async function ensureCategory(categoryCode: string, categoryName: string) {
  const existing = await prisma.customerCategory.findFirst({
    where: { OR: [{ categoryCode }, { categoryName }] },
  });
  return (
    existing ??
    prisma.customerCategory.create({ data: { categoryCode, categoryName } })
  );
}

async function ensureZone(zoneCode: string, zoneName: string) {
  const existing = await prisma.zone.findFirst({
    where: { OR: [{ zoneCode }, { zoneName }] },
  });
  return existing ?? prisma.zone.create({ data: { zoneCode, zoneName } });
}

async function ensureServiceArea(
  areaCode: string,
  areaName: string,
  areaType: string,
  zoneId: bigint,
) {
  const existing = await prisma.serviceArea.findFirst({
    where: { OR: [{ areaCode }, { areaName }] },
  });
  return (
    existing ??
    prisma.serviceArea.create({
      data: { areaCode, areaName, areaType, zoneId },
    })
  );
}

async function ensureRoute(
  routeCode: string,
  routeName: string,
  zoneId: bigint,
) {
  const existing = await prisma.route.findFirst({
    where: { OR: [{ routeCode }, { routeName }] },
  });
  return (
    existing ?? prisma.route.create({ data: { routeCode, routeName, zoneId } })
  );
}

async function ensureFieldOfficer(
  userId: bigint,
  employeeNumber: string,
  officerType: "METER_READER" | "SUPERVISOR",
  phoneNumber: string,
  homeZoneId: bigint | null,
) {
  const existing = await prisma.fieldOfficer.findFirst({
    where: { OR: [{ userId }, { employeeNumber }] },
  });
  const data = {
    userId,
    employeeNumber,
    officerType,
    phoneNumber,
    homeZoneId,
    availabilityStatus: "AVAILABLE",
    status: "ACTIVE",
  };
  return existing
    ? prisma.fieldOfficer.update({
        where: { fieldOfficerId: existing.fieldOfficerId },
        data,
      })
    : prisma.fieldOfficer.create({ data });
}

async function main() { 
  const roles = new Map<string, { roleId: bigint }>();
  for (const [code, name, description] of roleDefinitions) {
    roles.set(code, await ensureRole(code, name, description));
  }

  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  const users = new Map<string, Awaited<ReturnType<typeof ensureUser>>>();
  for (const definition of staffDefinitions) {
    const user = await ensureUser(definition, passwordHash);
    users.set(definition.username, user);
    await ensureUserRole(user.userId, roles.get(definition.roleCode)!.roleId);
  }

  const category = await ensureCategory("RESIDENTIAL", "Residential");
  await ensureCategory("COMMERCIAL", "Commercial");
  await ensureCategory("INSTITUTIONAL", "Institutional");
  await ensureCategory("BULK", "Bulk Supply");
  await ensureCategory("KIOSK", "Water Kiosk");
  await ensureCategory("CONSTRUCTION", "Construction");

  let zone: Awaited<ReturnType<typeof ensureZone>> | null = null;
  let serviceArea: Awaited<ReturnType<typeof ensureServiceArea>> | null = null;
  let route: Awaited<ReturnType<typeof ensureRoute>> | null = null;

  if (seedDemoGeography) {
    zone = await ensureZone("ZONE-01", "Zone 1");
    serviceArea = await ensureServiceArea(
      "AREA-01",
      "Central Estate",
      "ESTATE",
      zone.zoneId,
    );
    route = await ensureRoute("ROUTE-01", "Route 1", zone.zoneId);
  } else if (fieldOfficerZoneCode) {
    zone = await prisma.zone.findUnique({
      where: { zoneCode: fieldOfficerZoneCode },
    });
    if (!zone) {
      throw new Error(
        `SEED_FIELD_OFFICER_ZONE_CODE=${fieldOfficerZoneCode} does not match an imported zone. Import that zone first or remove this setting.`,
      );
    }
  }

  await ensureFieldOfficer(
    users.get("meter.reader")!.userId,
    "MR-001",
    "METER_READER",
    "+254700000005",
    zone?.zoneId ?? null,
  );
  await ensureFieldOfficer(
    users.get("meter.supervisor")!.userId,
    "MS-001",
    "SUPERVISOR",
    "+254700000006",
    zone?.zoneId ?? null,
  );

  console.log("Seeded AquaFlow users and reference data:", {
    users: staffDefinitions.map(({ username, roleCode }) => ({
      username,
      role: roleCode,
    })),
    category: category.categoryCode,
    geography: seedDemoGeography
      ? {
          zone: zone?.zoneCode,
          serviceArea: serviceArea?.areaCode,
          route: route?.routeCode,
        }
      : {
          demoRecordsCreated: false,
          fieldOfficerZone: zone?.zoneCode ?? null,
        },
  });
  console.log(`Development password for all seeded users: ${defaultPassword}`);
  console.log(
    "Change every seeded password before using this outside local testing.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
