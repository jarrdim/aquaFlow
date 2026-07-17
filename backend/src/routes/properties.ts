import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const propertiesRouter = Router();
propertiesRouter.use(requireAuth);

const createPropertySchema = z.object({
  ownerCustomerId: z.string().min(1),
  zoneId: z.string().min(1),
  serviceAreaId: z.string().optional(),
  routeId: z.string().optional(),
  plotNumber: z.string().optional(),
  buildingName: z.string().optional(),
  physicalAddress: z.string().min(1),
  occupancyStatus: z.enum(["OWNER_OCCUPIED", "TENANTED", "VACANT"]).default("OWNER_OCCUPIED"),
});

async function nextPropertyCode() {
  const count = await prisma.property.count();
  return `PROP-${String(count + 1).padStart(6, "0")}`;
}

propertiesRouter.get("/", async (req, res) => {
  const customerId = req.query.customerId as string | undefined;
  const properties = await prisma.property.findMany({
    where: customerId ? { ownerCustomerId: BigInt(customerId) } : {},
    include: { zone: true, serviceArea: true, route: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(properties);
});

propertiesRouter.post("/", async (req, res) => {
  const parsed = createPropertySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const property = await prisma.property.create({
    data: {
      propertyCode: await nextPropertyCode(),
      ownerCustomerId: BigInt(data.ownerCustomerId),
      zoneId: BigInt(data.zoneId),
      serviceAreaId: data.serviceAreaId ? BigInt(data.serviceAreaId) : undefined,
      routeId: data.routeId ? BigInt(data.routeId) : undefined,
      plotNumber: data.plotNumber,
      buildingName: data.buildingName,
      physicalAddress: data.physicalAddress,
      occupancyStatus: data.occupancyStatus,
    },
  });

  res.status(201).json(property);
});
