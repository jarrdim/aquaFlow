import { Router } from "express";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { rateLimit } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const fieldLoginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

const customerRegistrationSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phoneNumber: z.string().trim().min(9).max(30),
  emailAddress: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
  idNumber: z.string().trim().min(3).max(80),
  accountNumber: z.string().trim().max(80).optional(),
  password: z.string().min(8).max(128),
});

const FIELD_OFFICER_ROLES = new Set([
  "METER_READER",
  "METER_SUPERVISOR",
  "SUPERVISOR",
]);

type SessionUser = {
  userId: bigint;
  username: string;
  firstName: string;
  lastName: string;
  userType: string;
  userRoles: Array<{ role: { roleCode: string } }>;
};

function issueTokens(user: SessionUser) {
  const roles = user.userRoles.map((ur) => ur.role.roleCode);
  const identity = {
    userId: user.userId.toString(),
    username: user.username,
    userType: user.userType,
    roles,
  };
  const secret = process.env.JWT_SECRET as string;
  return {
    token: jwt.sign({ ...identity, tokenType: "access" }, secret, { expiresIn: "8h" }),
    refreshToken: jwt.sign({ ...identity, tokenType: "refresh" }, secret, { expiresIn: "30d" }),
    expiresIn: 8 * 60 * 60,
    user: {
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      roles,
    },
  };
}

function issueCustomerTokens(user: SessionUser, customerId: bigint) {
  const identity = {
    // Keep userId as the billing-customer subject for existing customer APIs.
    // authUserId is the actual credential owner and may access accounts that
    // were imported under more than one customer record.
    userId: customerId.toString(),
    authUserId: user.userId.toString(),
    customerId: customerId.toString(),
    username: user.username,
    userType: "CUSTOMER",
    roles: ["CUSTOMER"],
  };
  const secret = process.env.JWT_SECRET as string;
  return {
    token: jwt.sign({ ...identity, tokenType: "access" }, secret, { expiresIn: "8h" }),
    refreshToken: jwt.sign({ ...identity, tokenType: "refresh" }, secret, { expiresIn: "30d" }),
    expiresIn: 8 * 60 * 60,
    user: {
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: "CUSTOMER",
      roles: ["CUSTOMER"],
    },
  };
}

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

const loginLimiter = rateLimit({
  namespace: "login",
  maximum: 10,
  windowMs: 15 * 60 * 1000,
});

const customerRegistrationLimiter = rateLimit({
  namespace: "customer-registration",
  maximum: 5,
  windowMs: 15 * 60 * 1000,
});

function normalizedIdentity(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

authRouter.post("/customer/register", customerRegistrationLimiter, async (req, res, next) => {
  const parsed = customerRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Enter valid customer details and a password containing at least 8 characters.",
    });
  }

  const data = parsed.data;
  const customer = await prisma.customer.findFirst({
    where: {
      status: "ACTIVE",
      OR: [
        { nationalId: { equals: data.idNumber, mode: "insensitive" } },
        { registrationNumber: { equals: data.idNumber, mode: "insensitive" } },
      ],
    },
    include: { accounts: { orderBy: { accountNumber: "asc" } } },
  });

  const suppliedPhone = normalizedPhone(data.phoneNumber);
  const expectedNames = customer ? [
    customer.organizationName,
    [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" "),
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
  ].map(normalizedIdentity).filter(Boolean) : [];
  const nameMatches = expectedNames.includes(normalizedIdentity(data.fullName));
  const phoneMatches = customer != null && normalizedPhone(customer.phoneNumber) === suppliedPhone;
  const requestedAccount = normalizedIdentity(data.accountNumber);
  const accountMatches = customer != null && (
    !requestedAccount || customer.accounts.some((account) => normalizedIdentity(account.accountNumber) === requestedAccount)
  );

  if (!customer || !nameMatches || !phoneMatches || !accountMatches || customer.accounts.length === 0) {
    return res.status(400).json({
      error: "We could not verify those details against an active Samdamte water account.",
    });
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { customerId: customer.customerId },
        { username: customer.customerNumber },
      ],
    },
  });
  if (existingUser) {
    return res.status(409).json({
      error: "Online access is already registered for this customer. Use the Login screen or contact Samdamte support.",
    });
  }

  const displayName = customer.organizationName ||
    [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ") ||
    customer.customerNumber;
  const nameParts = displayName.trim().split(/\s+/);
  const emailAddress = data.emailAddress?.trim() || customer.emailAddress?.trim() ||
    `${customer.customerNumber.toLowerCase()}@customer.samdamte.local`;

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: customer.customerNumber,
          firstName: nameParts[0] || "Customer",
          lastName: nameParts.slice(1).join(" ") || "Account",
          emailAddress,
          phoneNumber: `+254${suppliedPhone}`,
          passwordHash: await bcrypt.hash(data.password, 12),
          userType: "CUSTOMER",
          customerId: customer.customerId,
          status: "ACTIVE",
        },
      });
      await Promise.all(customer.accounts.map((account, index) =>
        tx.customerAccountAccess.create({
          data: {
            userId: created.userId,
            accountId: account.accountId,
            status: "ACTIVE",
            accessRole: "OWNER",
            verifiedAt: new Date(),
            isDefault: index === 0,
          },
        }),
      ));
      return created;
    });

    return res.status(201).json(issueCustomerTokens({ ...user, userRoles: [] }, customer.customerId));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({
        error: "That phone number or email address is already assigned to another online account.",
      });
    }
    return next(error);
  }
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "username and password are required" });
  }
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { username },
    include: { userRoles: { include: { role: true }, where: { status: "ACTIVE" } } },
  });

  if (!user || user.status !== "ACTIVE") {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await prisma.user.update({
    where: { userId: user.userId },
    data: { lastLoginAt: new Date() },
  });

  res.json(issueTokens(user));
});

authRouter.post("/shared/login", loginLimiter, async (req, res) => {
  const parsed = fieldLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "identifier and password are required" });
  }

  const { identifier, password } = parsed.data;
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: identifier, mode: "insensitive" } },
        { emailAddress: { equals: identifier, mode: "insensitive" } },
        { phoneNumber: identifier },
        { fieldOfficer: { is: { employeeNumber: { equals: identifier, mode: "insensitive" } } } },
        { customer: { is: { customerNumber: { equals: identifier, mode: "insensitive" } } } },
        {
          customerAccountAccess: {
            some: {
              status: "ACTIVE",
              account: { customer: { customerNumber: { equals: identifier, mode: "insensitive" } } },
            },
          },
        },
      ],
    },
    include: {
      customer: true,
      customerAccountAccess: {
        where: { status: "ACTIVE" },
        orderBy: [{ isDefault: "desc" }, { account: { accountNumber: "asc" } }],
        include: { account: { include: { customer: true } } },
      },
      fieldOfficer: true,
      userRoles: { include: { role: true }, where: { status: "ACTIVE" } },
    },
  });

  if (!user && normalizedPhone(identifier).length >= 9) {
    const candidates = await prisma.user.findMany({
      where: { userType: "CUSTOMER", status: "ACTIVE" },
      include: {
        customer: true,
        customerAccountAccess: {
          where: { status: "ACTIVE" },
          orderBy: [{ isDefault: "desc" }, { account: { accountNumber: "asc" } }],
          include: { account: { include: { customer: true } } },
        },
        fieldOfficer: true,
        userRoles: { include: { role: true }, where: { status: "ACTIVE" } },
      },
    });
    const requestedPhone = normalizedPhone(identifier);
    user = candidates.find((candidate) => {
      const phones = [
        candidate.phoneNumber,
        candidate.customer?.phoneNumber,
        ...candidate.customerAccountAccess.map((access) => access.account.customer.phoneNumber),
      ].filter((value): value is string => Boolean(value));
      return phones.some((phone) => normalizedPhone(phone) === requestedPhone);
    }) ?? null;
  }

  if (!user || user.status !== "ACTIVE" || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.userType === "CUSTOMER") {
    const primaryCustomer = user.customer?.status === "ACTIVE"
      ? user.customer
      : user.customerAccountAccess.map((access) => access.account.customer).find((customer) => customer.status === "ACTIVE");
    if (!primaryCustomer || user.customerAccountAccess.length === 0) {
      return res.status(403).json({ error: "This customer account is not active" });
    }
    await prisma.user.update({
      where: { userId: user.userId },
      data: { lastLoginAt: new Date() },
    });
    return res.json(issueCustomerTokens(user, primaryCustomer.customerId));
  }

  const hasFieldRole = user.userRoles.some(({ role }) =>
    role.status === "ACTIVE" && FIELD_OFFICER_ROLES.has(role.roleCode),
  );
  if (
    user.userType !== "STAFF" ||
    !user.fieldOfficer ||
    user.fieldOfficer.status !== "ACTIVE" ||
    !hasFieldRole
  ) {
    return res.status(403).json({
      error: "This account is not authorized for the Samdamte mobile app",
    });
  }

  await prisma.user.update({
    where: { userId: user.userId },
    data: { lastLoginAt: new Date() },
  });
  return res.json(issueTokens(user));
});

authRouter.post("/field/login", loginLimiter, async (req, res) => {
  const parsed = fieldLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "identifier and password are required" });
  }

  const { identifier, password } = parsed.data;
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: identifier, mode: "insensitive" } },
        { fieldOfficer: { is: { employeeNumber: { equals: identifier, mode: "insensitive" } } } },
      ],
    },
    include: {
      fieldOfficer: true,
      userRoles: { include: { role: true }, where: { status: "ACTIVE" } },
    },
  });

  if (!user || user.status !== "ACTIVE" || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const hasFieldRole = user.userRoles.some(({ role }) =>
    role.status === "ACTIVE" && FIELD_OFFICER_ROLES.has(role.roleCode),
  );
  if (
    user.userType !== "STAFF" ||
    !user.fieldOfficer ||
    user.fieldOfficer.status !== "ACTIVE" ||
    !hasFieldRole
  ) {
    return res.status(403).json({
      error: "This account is not authorized for the Field Officer App",
    });
  }

  await prisma.user.update({
    where: { userId: user.userId },
    data: { lastLoginAt: new Date() },
  });

  res.json(issueTokens(user));
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  try {
    const payload = jwt.verify(
      parsed.data.refreshToken,
      process.env.JWT_SECRET as string,
    ) as { userId?: string; authUserId?: string; customerId?: string; tokenType?: string; userType?: string; roles?: string[] };
    if (payload.tokenType !== "refresh" || !payload.userId) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    if (payload.userType === "CUSTOMER" && payload.roles?.includes("CUSTOMER")) {
      const user = await prisma.user.findUnique({
        where: { userId: BigInt(payload.authUserId ?? payload.userId) },
        include: {
          customer: true,
          customerAccountAccess: {
            where: { status: "ACTIVE" },
            orderBy: [{ isDefault: "desc" }, { account: { accountNumber: "asc" } }],
            include: { account: { include: { customer: true } } },
          },
          userRoles: { include: { role: true }, where: { status: "ACTIVE" } },
        },
      });
      const customer = user?.customer?.status === "ACTIVE"
        ? user.customer
        : user?.customerAccountAccess.map((access) => access.account.customer).find((item) => item.status === "ACTIVE");
      if (!user || user.status !== "ACTIVE" || !customer || user.customerAccountAccess.length === 0) {
        return res.status(401).json({ error: "Customer account is not active" });
      }
      return res.json(issueCustomerTokens(user, customer.customerId));
    }

    const user = await prisma.user.findUnique({
      where: { userId: BigInt(payload.userId) },
      include: {
        userRoles: { include: { role: true }, where: { status: "ACTIVE" } },
      },
    });
    if (!user || user.status !== "ACTIVE") {
      return res.status(401).json({ error: "Account is not active" });
    }
    res.json(issueTokens(user));
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Current password and a new password of at least 8 characters are required" });
  }
  const user = await prisma.user.findUnique({
    where: { userId: BigInt(req.user!.authUserId ?? req.user!.userId) },
  });
  if (!user || user.status !== "ACTIVE") {
    return res.status(404).json({ error: "Active user not found" });
  }
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
    return res.status(400).json({ error: "New password must be different from the current password" });
  }
  await prisma.user.update({
    where: { userId: user.userId },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.newPassword, 12),
      updatedAt: new Date(),
    },
  });
  return res.json({ message: "Password changed successfully" });
});
