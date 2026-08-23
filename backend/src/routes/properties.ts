import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { resolveCustomerReferences } from "../lib/customerReferences";
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

const bulkPropertySchema = z.object({
  properties: z.array(z.object({
    propertyCode: z.string().trim().min(1).max(50),
    customerNumber: z.string().trim().min(1).max(50),
    serviceAreaCode: z.string().trim().min(1).max(50),
    plotNumber: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().optional()),
    buildingName: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().optional()),
    physicalAddress: z.string().trim().min(1),
    occupancyStatus: z.enum(["OWNER_OCCUPIED", "TENANTED", "VACANT"]).default("OWNER_OCCUPIED"),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  })).min(1).max(1000),
});

propertiesRouter.post("/bulk-import", async (req, res) => {
  const parsed = bulkPropertySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const rows = parsed.data.properties;
  const [customerResolution, areas, existing] = await Promise.all([
    resolveCustomerReferences(rows.map((row) => row.customerNumber)),
    prisma.serviceArea.findMany({
      where: { areaCode: { in: rows.map((row) => row.serviceAreaCode) } },
      select: { serviceAreaId: true, areaCode: true, zoneId: true },
    }),
    prisma.property.findMany({
      where: { propertyCode: { in: rows.map((row) => row.propertyCode) } },
      select: { propertyCode: true },
    }),
  ]);
  const { customerIds, ambiguousReferences } = customerResolution;
  const areaByCode = new Map(areas.map((row) => [row.areaCode, row]));
  const existingCodes = new Set(existing.map((row) => row.propertyCode));
  const seenCodes = new Set<string>();
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    if (ambiguousReferences.has(row.customerNumber)) errors.push(`Row ${line}: customer ${row.customerNumber} matches more than one customer sequence.`);
    else if (!customerIds.has(row.customerNumber)) errors.push(`Row ${line}: customer ${row.customerNumber} was not found.`);
    if (!areaByCode.has(row.serviceAreaCode)) errors.push(`Row ${line}: service area ${row.serviceAreaCode} was not found.`);
    if (seenCodes.has(row.propertyCode)) errors.push(`Row ${line}: property ${row.propertyCode} is duplicated in this file.`);
    seenCodes.add(row.propertyCode);
  });
  if (errors.length) return res.status(409).json({ error: errors.slice(0, 100).join("\n") });

  const newRows = rows.filter((row) => !existingCodes.has(row.propertyCode));
  const result = await prisma.property.createMany({
    data: newRows.map((row) => {
      const area = areaByCode.get(row.serviceAreaCode)!;
      return {
        propertyCode: row.propertyCode,
        ownerCustomerId: customerIds.get(row.customerNumber)!,
        zoneId: area.zoneId,
        serviceAreaId: area.serviceAreaId,
        plotNumber: row.plotNumber || null,
        buildingName: row.buildingName || null,
        physicalAddress: row.physicalAddress,
        occupancyStatus: row.occupancyStatus,
        status: row.status,
      };
    }),
  });
  res.status(201).json({ imported: result.count, skipped: rows.length - newRows.length });
});

async function nextPropertyCode() {
  const prefix = "PROP-";
  const properties = await prisma.property.findMany({
    where: { propertyCode: { startsWith: prefix } },
    select: { propertyCode: true },
  });
  const highest = properties.reduce((max, property) => {
    const sequence = Number(property.propertyCode.slice(prefix.length));
    return Number.isInteger(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(6, "0")}`;
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

  try {
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
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "The generated property code already exists. Please try again." });
    }
    throw error;
  }
});
