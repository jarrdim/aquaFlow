import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const customerNumber = process.env.CUSTOMER_PORTAL_CUSTOMER_NUMBER?.trim();
  const phoneNumber = process.env.CUSTOMER_PORTAL_PHONE?.trim();
  const password = process.env.CUSTOMER_PORTAL_PASSWORD ?? "ChangeMe123!";
  if (!customerNumber || !phoneNumber) {
    throw new Error("CUSTOMER_PORTAL_CUSTOMER_NUMBER and CUSTOMER_PORTAL_PHONE are required");
  }
  if (password.length < 8) throw new Error("CUSTOMER_PORTAL_PASSWORD must contain at least 8 characters");

  const customer = await prisma.customer.findUnique({
    where: { customerNumber },
    include: { accounts: { orderBy: { accountNumber: "asc" } } },
  });
  if (!customer || customer.status !== "ACTIVE") throw new Error(`Active customer ${customerNumber} was not found`);
  if (!customer.accounts.length) throw new Error(`${customerNumber} has no water accounts to link`);

  const displayName = customer.organizationName ||
    [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ") || customerNumber;
  const nameParts = displayName.trim().split(/\s+/);
  const emailAddress = customer.emailAddress?.trim() || `${customerNumber.toLowerCase()}@customer.samdamte.local`;
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: customerNumber }, { customerId: customer.customerId }] },
  });
  const data = {
    username: customerNumber,
    firstName: nameParts[0] || "Customer",
    lastName: nameParts.slice(1).join(" ") || "Account",
    emailAddress,
    phoneNumber,
    passwordHash,
    userType: "CUSTOMER",
    customerId: customer.customerId,
    status: "ACTIVE",
  };
  const user = existing
    ? await prisma.user.update({ where: { userId: existing.userId }, data })
    : await prisma.user.create({ data });

  await prisma.$transaction(
    customer.accounts.map((account, index) => prisma.customerAccountAccess.upsert({
      where: { userId_accountId: { userId: user.userId, accountId: account.accountId } },
      update: { status: "ACTIVE", accessRole: "OWNER", verifiedAt: new Date(), isDefault: index === 0 },
      create: {
        userId: user.userId,
        accountId: account.accountId,
        status: "ACTIVE",
        accessRole: "OWNER",
        verifiedAt: new Date(),
        isDefault: index === 0,
      },
    })),
  );

  console.log(JSON.stringify({
    username: user.username,
    phoneNumber: user.phoneNumber,
    customerNumber,
    accounts: customer.accounts.map((account) => account.accountNumber),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
