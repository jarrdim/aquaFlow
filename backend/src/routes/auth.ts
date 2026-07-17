import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
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

  const roles = user.userRoles.map((ur) => ur.role.roleCode);

  const token = jwt.sign(
    { userId: user.userId.toString(), username: user.username, userType: user.userType, roles },
    process.env.JWT_SECRET as string,
    { expiresIn: "8h" }
  );

  await prisma.user.update({
    where: { userId: user.userId },
    data: { lastLoginAt: new Date() },
  });

  res.json({
    token,
    user: {
      userId: user.userId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      roles,
    },
  });
});
