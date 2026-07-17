import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const lookupsRouter = Router();
lookupsRouter.use(requireAuth);

lookupsRouter.get("/zones", async (_req, res) => {
  res.json(await prisma.zone.findMany({ where: { status: "ACTIVE" }, orderBy: { zoneName: "asc" } }));
});

lookupsRouter.get("/service-areas", async (req, res) => {
  const zoneId = req.query.zoneId ? BigInt(req.query.zoneId as string) : undefined;
  res.json(
    await prisma.serviceArea.findMany({
      where: { status: "ACTIVE", ...(zoneId ? { zoneId } : {}) },
      orderBy: { areaName: "asc" },
    })
  );
});

lookupsRouter.get("/routes", async (req, res) => {
  const zoneId = req.query.zoneId ? BigInt(req.query.zoneId as string) : undefined;
  res.json(
    await prisma.route.findMany({
      where: { status: "ACTIVE", ...(zoneId ? { zoneId } : {}) },
      orderBy: { routeName: "asc" },
    })
  );
});

lookupsRouter.get("/customer-categories", async (_req, res) => {
  res.json(await prisma.customerCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { categoryName: "asc" } }));
});
