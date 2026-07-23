import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("SYSTEM_ADMIN"));

const id = z.coerce.bigint().positive();
const status = z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"]);
const roleInput = z.object({
  roleCode: z.string().trim().min(2).max(80).transform((value) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
  roleName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
const permissionInput = z.object({
  permissionCode: z.string().trim().min(2).max(100).transform((value) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
  moduleName: z.string().trim().min(2).max(100),
  permissionName: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).optional().nullable(),
});

const handlePrismaError = (error: unknown, res: any) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    res.status(409).json({ error: "A record with the same unique value already exists" });
    return true;
  }
  return false;
};

adminRouter.get("/dashboard", async (_req, res) => {
  const [users, activeUsers, roles, permissions] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.role.count(),
    prisma.permission.count(),
  ]);
  res.json({ users, activeUsers, roles, permissions });
});

adminRouter.get("/users", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const take = Math.min(100, Math.max(10, Number(req.query.take) || 25));
  const q = String(req.query.q ?? "").trim();
  const roleId = String(req.query.roleId ?? "").trim();
  const userStatus = String(req.query.status ?? "").trim();
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [
      { username: { contains: q, mode: "insensitive" } },
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { emailAddress: { contains: q, mode: "insensitive" } },
    ] } : {}),
    ...(userStatus ? { status: userStatus } : {}),
    ...(roleId ? { userRoles: { some: { roleId: BigInt(roleId), status: "ACTIVE" } } } : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * take,
      take,
      select: {
        userId: true, username: true, firstName: true, lastName: true,
        emailAddress: true, phoneNumber: true, userType: true, status: true,
        twoFactorEnabled: true, lastLoginAt: true, createdAt: true,
        userRoles: { where: { status: "ACTIVE" }, select: { role: true } },
      },
    }),
  ]);
  res.json({ data: users, total, page, take, pages: Math.max(1, Math.ceil(total / take)) });
});

const userCreate = z.object({
  username: z.string().trim().min(3).max(80),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  emailAddress: z.string().trim().email(),
  phoneNumber: z.string().trim().max(30).optional().nullable(),
  password: z.string().min(8).max(200),
  userType: z.enum(["STAFF", "SYSTEM"]).default("STAFF"),
  status: status.default("ACTIVE"),
  twoFactorEnabled: z.boolean().default(false),
  roleIds: z.array(id).min(1),
});

adminRouter.post("/users", async (req, res) => {
  const parsed = userCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { roleIds, password, ...data } = parsed.data;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...data, phoneNumber: data.phoneNumber || null, passwordHash: await bcrypt.hash(password, 10) } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: created.userId, roleId, assignedBy: BigInt(req.user!.userId) })) });
      return created;
    });
    res.status(201).json(user);
  } catch (error) {
    if (!handlePrismaError(error, res)) throw error;
  }
});

const userUpdate = userCreate.omit({ password: true, roleIds: true, username: true }).partial().extend({ password: z.string().min(8).max(200).optional() });
adminRouter.patch("/users/:id", async (req, res) => {
  const userId = id.safeParse(req.params.id);
  const parsed = userUpdate.safeParse(req.body);
  if (!userId.success || !parsed.success) return res.status(400).json({ error: "Invalid user update" });
  if (userId.data === BigInt(req.user!.userId) && parsed.data.status && parsed.data.status !== "ACTIVE") {
    return res.status(400).json({ error: "You cannot deactivate your own account" });
  }
  const { password, ...data } = parsed.data;
  try {
    const user = await prisma.user.update({ where: { userId: userId.data }, data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } });
    res.json(user);
  } catch (error) {
    if (!handlePrismaError(error, res)) throw error;
  }
});

adminRouter.put("/users/:id/roles", async (req, res) => {
  const userId = id.safeParse(req.params.id);
  const parsed = z.object({ roleIds: z.array(id).min(1) }).safeParse(req.body);
  if (!userId.success || !parsed.success) return res.status(400).json({ error: "At least one valid role is required" });
  if (userId.data === BigInt(req.user!.userId)) {
    const adminRole = await prisma.role.findUnique({ where: { roleCode: "SYSTEM_ADMIN" } });
    if (adminRole && !parsed.data.roleIds.includes(adminRole.roleId)) return res.status(400).json({ error: "You cannot remove your own system administrator role" });
  }
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: userId.data } });
    await tx.userRole.createMany({ data: parsed.data.roleIds.map((roleId) => ({ userId: userId.data, roleId, assignedBy: BigInt(req.user!.userId) })) });
  });
  res.json({ message: "User roles updated" });
});

adminRouter.get("/roles", async (_req, res) => {
  const roles = await prisma.role.findMany({
    orderBy: { roleName: "asc" },
    include: {
      rolePermissions: { include: { permission: true } },
      _count: { select: { userRoles: { where: { status: "ACTIVE" } } } },
    },
  });
  res.json(roles);
});

adminRouter.post("/roles", async (req, res) => {
  const parsed = roleInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try { res.status(201).json(await prisma.role.create({ data: parsed.data })); }
  catch (error) { if (!handlePrismaError(error, res)) throw error; }
});

adminRouter.patch("/roles/:id", async (req, res) => {
  const roleId = id.safeParse(req.params.id);
  const parsed = roleInput.partial().safeParse(req.body);
  if (!roleId.success || !parsed.success) return res.status(400).json({ error: "Invalid role update" });
  try { res.json(await prisma.role.update({ where: { roleId: roleId.data }, data: parsed.data })); }
  catch (error) { if (!handlePrismaError(error, res)) throw error; }
});

adminRouter.put("/roles/:id/permissions", async (req, res) => {
  const roleId = id.safeParse(req.params.id);
  const parsed = z.object({ permissionIds: z.array(id) }).safeParse(req.body);
  if (!roleId.success || !parsed.success) return res.status(400).json({ error: "Invalid permission selection" });
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: roleId.data } });
    if (parsed.data.permissionIds.length) await tx.rolePermission.createMany({ data: parsed.data.permissionIds.map((permissionId) => ({ roleId: roleId.data, permissionId, grantedBy: BigInt(req.user!.userId) })) });
  });
  res.json({ message: "Role permissions updated" });
});

adminRouter.get("/permissions", async (_req, res) => res.json(await prisma.permission.findMany({ orderBy: [{ moduleName: "asc" }, { permissionName: "asc" }] })));
adminRouter.post("/permissions", async (req, res) => {
  const parsed = permissionInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try { res.status(201).json(await prisma.permission.create({ data: parsed.data })); }
  catch (error) { if (!handlePrismaError(error, res)) throw error; }
});
adminRouter.patch("/permissions/:id", async (req, res) => {
  const permissionId = id.safeParse(req.params.id);
  const parsed = permissionInput.partial().safeParse(req.body);
  if (!permissionId.success || !parsed.success) return res.status(400).json({ error: "Invalid permission update" });
  try { res.json(await prisma.permission.update({ where: { permissionId: permissionId.data }, data: parsed.data })); }
  catch (error) { if (!handlePrismaError(error, res)) throw error; }
});
