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

authRouter.post("/refresh", async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  try {
    const payload = jwt.verify(
      parsed.data.refreshToken,
      process.env.JWT_SECRET as string,
    ) as { userId?: string; tokenType?: string; userType?: string; roles?: string[] };
    if (payload.tokenType !== "refresh" || !payload.userId) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    if (payload.userType === "CUSTOMER" && payload.roles?.includes("CUSTOMER")) {
      const customer = await prisma.customer.findUnique({
        where: { customerId: BigInt(payload.userId) },
      });
      if (!customer || customer.status !== "ACTIVE") {
        return res.status(401).json({ error: "Customer account is not active" });
      }
      const identity = {
        userId: customer.customerId.toString(),
        username: customer.phoneNumber,
        userType: "CUSTOMER",
        roles: ["CUSTOMER"],
      };
      const secret = process.env.JWT_SECRET as string;
      const customerName = customer.organizationName ||
        [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ");
      return res.json({
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
    where: { userId: BigInt(req.user!.userId) },
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
