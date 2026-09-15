import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

const password = process.env.PLAY_TEST_PASSWORD;
if (!password || password.length < 12) {
  throw new Error("Set PLAY_TEST_PASSWORD to a test-only password containing at least 12 characters.");
}

const TEST_EMAIL_SUFFIX = "@example.invalid";

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);

  const zone = await prisma.zone.upsert({
    where: { zoneCode: "PLAYTEST" },
    update: { zoneName: "Play Store Test Zone", status: "ACTIVE" },
    create: {
      zoneCode: "PLAYTEST",
      zoneName: "Play Store Test Zone",
      description: "Reserved for Google Play closed-test accounts",
      status: "ACTIVE",
    },
  });
  const serviceArea = await prisma.serviceArea.upsert({
    where: { areaCode: "PLAYTEST" },
    update: { zoneId: zone.zoneId, areaName: "Play Store Test Area", status: "ACTIVE" },
    create: {
      zoneId: zone.zoneId,
      areaCode: "PLAYTEST",
      areaName: "Play Store Test Area",
      areaType: "OTHER",
      description: "Reserved for Google Play closed-test accounts",
      status: "ACTIVE",
    },
  });
  const route = await prisma.route.upsert({
    where: { routeCode: "PLAYTEST" },
    update: { zoneId: zone.zoneId, routeName: "Play Store Test Route", status: "ACTIVE" },
    create: {
      zoneId: zone.zoneId,
      routeCode: "PLAYTEST",
      routeName: "Play Store Test Route",
      sequenceNumber: 9999,
      estimatedCustomers: 15,
      status: "ACTIVE",
    },
  });
  const category = await prisma.customerCategory.upsert({
    where: { categoryCode: "PLAYTEST" },
    update: { categoryName: "Play Store Test Customers", status: "ACTIVE" },
    create: {
      categoryCode: "PLAYTEST",
      categoryName: "Play Store Test Customers",
      description: "Non-production customer category for Google Play testing",
      status: "ACTIVE",
    },
  });

  for (let index = 1; index <= 15; index += 1) {
    const suffix = index.toString().padStart(2, "0");
    const username = `playtest${suffix}`;
    const emailAddress = `${username}${TEST_EMAIL_SUFFIX}`;
    const phoneNumber = `+25470099${index.toString().padStart(4, "0")}`;
    const customerNumber = `PLAYTEST${suffix}`;
    const accountNumber = `PLAYTEST-ACC-${suffix}`;

    const collidingUser = await prisma.user.findUnique({ where: { username } });
    if (collidingUser && !collidingUser.emailAddress.endsWith(TEST_EMAIL_SUFFIX)) {
      throw new Error(`Refusing to modify non-test user ${username}.`);
    }
    const collidingCustomer = await prisma.customer.findUnique({ where: { customerNumber } });
    if (collidingCustomer?.emailAddress && !collidingCustomer.emailAddress.endsWith(TEST_EMAIL_SUFFIX)) {
      throw new Error(`Refusing to modify non-test customer ${customerNumber}.`);
    }

    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { customerNumber },
        update: {
          firstName: "Playtest",
          lastName: `Customer ${suffix}`,
          phoneNumber,
          emailAddress,
          status: "ACTIVE",
        },
        create: {
          customerNumber,
          customerType: "INDIVIDUAL",
          firstName: "Playtest",
          lastName: `Customer ${suffix}`,
          nationalId: `PLAY-TEST-ID-${suffix}`,
          phoneNumber,
          emailAddress,
          preferredLanguage: "EN",
          status: "ACTIVE",
        },
      });
      const property = await tx.property.upsert({
        where: { propertyCode: `PLAYTEST-PROP-${suffix}` },
        update: {
          ownerCustomerId: customer.customerId,
          zoneId: zone.zoneId,
          serviceAreaId: serviceArea.serviceAreaId,
          routeId: route.routeId,
          status: "ACTIVE",
        },
        create: {
          propertyCode: `PLAYTEST-PROP-${suffix}`,
          ownerCustomerId: customer.customerId,
          zoneId: zone.zoneId,
          serviceAreaId: serviceArea.serviceAreaId,
          routeId: route.routeId,
          plotNumber: `TEST-${suffix}`,
          physicalAddress: `Play Store Test Address ${suffix}`,
          occupancyStatus: "OWNER_OCCUPIED",
          status: "ACTIVE",
        },
      });
      const account = await tx.customerAccount.upsert({
        where: { accountNumber },
        update: {
          customerId: customer.customerId,
          propertyId: property.propertyId,
          categoryId: category.categoryId,
          routeId: route.routeId,
          accountStatus: "ACTIVE",
        },
        create: {
          accountNumber,
          customerId: customer.customerId,
          propertyId: property.propertyId,
          categoryId: category.categoryId,
          routeId: route.routeId,
          openingBalance: 0,
          currentBalance: 0,
          connectionDate: new Date(),
          accountStatus: "ACTIVE",
        },
      });
      const user = await tx.user.upsert({
        where: { username },
        update: {
          firstName: "Playtest",
          lastName: `Customer ${suffix}`,
          emailAddress,
          phoneNumber,
          passwordHash,
          userType: "CUSTOMER",
          customerId: customer.customerId,
          status: "ACTIVE",
        },
        create: {
          username,
          firstName: "Playtest",
          lastName: `Customer ${suffix}`,
          emailAddress,
          phoneNumber,
          passwordHash,
          userType: "CUSTOMER",
          customerId: customer.customerId,
          status: "ACTIVE",
        },
      });
      await tx.customerAccountAccess.upsert({
        where: { userId_accountId: { userId: user.userId, accountId: account.accountId } },
        update: { accessRole: "OWNER", status: "ACTIVE", verifiedAt: new Date(), isDefault: true },
        create: {
          userId: user.userId,
          accountId: account.accountId,
          accessRole: "OWNER",
          status: "ACTIVE",
          verifiedAt: new Date(),
          isDefault: true,
        },
      });
    });
  }

  console.log("Prepared 15 active Play test customers: playtest01 through playtest15.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
