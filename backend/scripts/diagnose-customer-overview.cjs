require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      userType: "CUSTOMER",
      status: "ACTIVE",
      customerAccountAccess: { some: { status: "ACTIVE" } },
    },
    include: {
      customer: true,
      customerAccountAccess: {
        where: { status: "ACTIVE" },
        include: { account: { include: { customer: true } } },
      },
    },
  });
  if (!user) throw new Error("No active customer login found");

  const customer = user.customer?.status === "ACTIVE"
    ? user.customer
    : user.customerAccountAccess.map((access) => access.account.customer)
      .find((candidate) => candidate.status === "ACTIVE");
  if (!customer) throw new Error("No active customer profile found");

  const token = jwt.sign({
    userId: customer.customerId.toString(),
    authUserId: user.userId.toString(),
    customerId: customer.customerId.toString(),
    username: user.username,
    userType: "CUSTOMER",
    roles: ["CUSTOMER"],
    tokenType: "access",
  }, process.env.JWT_SECRET, { expiresIn: "5m" });

  const response = await fetch("http://127.0.0.1:4000/api/mobile/customer/overview", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  console.log(JSON.stringify({
    username: user.username,
    userId: user.userId.toString(),
    status: response.status,
    body: body.slice(0, 4000),
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
