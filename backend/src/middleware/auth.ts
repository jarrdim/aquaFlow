import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export const WEB_SESSION_COOKIE = "aquaflow_session";

function cookieValue(req: Request, name: string) {
  const header = req.headers.cookie ?? "";
  for (const entry of header.split(";")) {
    const [key, ...value] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export interface AuthPayload {
  userId: string;
  authUserId?: string;
  customerId?: string;
  username: string;
  userType: string;
  roles: string[];
  tokenType?: "access" | "refresh";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : null;
  const token = bearerToken ?? cookieValue(req, WEB_SESSION_COOKIE);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    if (payload.tokenType === "refresh") {
      return res.status(401).json({ error: "A refresh token cannot access this resource" });
    }
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const credentialOwnerId = BigInt(payload.authUserId ?? payload.userId);
    const activeUser = await prisma.user.findUnique({
      where: { userId: credentialOwnerId },
      select: { status: true },
    });
    if (!activeUser || activeUser.status !== "ACTIVE") {
      return res.status(401).json({ error: "Account is not active" });
    }
    req.user = payload;
    next();
  } catch (error) {
    next(error);
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
