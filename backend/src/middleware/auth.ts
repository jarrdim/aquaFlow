import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export interface AuthPayload {
  userId: string;
  username: string;
  userType: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function isSystemAdmin(req: Request) {
  return Boolean(req.user?.roles.includes("SYSTEM_ADMIN"));
}

// Business rule from the FRS: sensitive actions are gated by role, not just login.
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    // System administrators are superusers. Centralizing this rule ensures
    // future role-gated endpoints cannot accidentally exclude the admin role.
    const hasRole =
      isSystemAdmin(req) ||
      req.user.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}

/**
 * Checks live role grants instead of relying only on the roles embedded in the
 * login token. Permission changes therefore take effect on the next request,
 * while SYSTEM_ADMIN remains the deliberate superuser escape hatch.
 */
export function requirePermission(...permissionCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (isSystemAdmin(req)) return next();

    try {
      const matchingGrant = await prisma.rolePermission.count({
        where: {
          permission: { permissionCode: { in: permissionCodes } },
          role: {
            status: "ACTIVE",
            userRoles: {
              some: {
                userId: BigInt(req.user.userId),
                status: "ACTIVE",
              },
            },
          },
        },
      });
      if (!matchingGrant) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
