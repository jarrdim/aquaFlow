import { Router } from "express";
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
