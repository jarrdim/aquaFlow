import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const setupsRouter = Router();
setupsRouter.use(requireAuth, requireRole("SYSTEM_ADMIN"));

const asyncRoute = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const id = z.coerce.bigint().positive();
const status = z.enum(["ACTIVE", "INACTIVE"]);
const optionalText = z.string().trim().max(1000).optional().nullable().transform((value) => value || null);
const code = z.string().trim().min(2).max(80).transform((value) =>
  value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
);

const zoneInput = z.object({
  zoneCode: code,
  zoneName: z.string().trim().min(2).max(120),
  description: optionalText,
  status: status.default("ACTIVE"),
});
const serviceAreaInput = z.object({
  zoneId: id,
  areaCode: code,
  areaName: z.string().trim().min(2).max(120),
  areaType: z.enum(["ESTATE", "VILLAGE", "MARKET", "INDUSTRIAL", "OTHER"]),
  description: optionalText,
  status: status.default("ACTIVE"),
});
const routeInput = z.object({
  zoneId: id,
  routeCode: code,
  routeName: z.string().trim().min(2).max(120),
  sequenceNumber: z.coerce.number().int().positive().optional().nullable(),
  estimatedCustomers: z.coerce.number().int().min(0).optional().nullable(),
  status: status.default("ACTIVE"),
});
const categoryInput = z.object({
  categoryCode: code,
  categoryName: z.string().trim().min(2).max(120),
  description: optionalText,
  status: status.default("ACTIVE"),
});
const officerInput = z.object({
  userId: id,
  employeeNumber: z.string().trim().min(2).max(40),
  officerType: z.enum(["METER_READER", "FIELD_OFFICER", "SUPERVISOR"]),
  phoneNumber: z.string().trim().min(7).max(30),
  homeZoneId: id.optional().nullable(),
  availabilityStatus: z.enum(["AVAILABLE", "BUSY", "ON_LEAVE", "UNAVAILABLE"]),
  status: status.default("ACTIVE"),
});
const meterCatalogueInput = z.object({
  catalogueCode: code,
  catalogueName: z.string().trim().min(2).max(140),
  meterType: z.enum(["CUSTOMER", "BULK", "ZONE", "BOREHOLE"]),
  technology: z.enum(["MANUAL", "PREPAID", "SMART"]),
  brand: z.string().trim().max(100).optional().nullable().transform((value) => value || null),
  model: z.string().trim().max(100).optional().nullable().transform((value) => value || null),
  meterSizeMm: z.coerce.number().positive(),
  defaultInstallationStatus: z.enum(["IN_STORE", "INSTALLED", "REMOVED"]),
  description: optionalText,
  status: status.default("ACTIVE"),
});
const serviceRequestTypeInput = z.object({
  typeCode: code,
  typeName: z.string().trim().min(2).max(120),
  requestClass: z.enum(["SERVICE_REQUEST", "COMPLAINT"]),
  defaultPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  targetResolutionHours: z.coerce.number().int().positive().optional().nullable(),
  description: optionalText,
  status: status.default("ACTIVE"),
});
const workOrderTypeInput = z.object({
  typeCode: code,
  typeName: z.string().trim().min(2).max(120),
  description: optionalText,
  defaultPriority: z.enum(["LOW", "NORMAL", "HIGH", "EMERGENCY"]),
  standardMaterials: optionalText,
  completionInstructions: optionalText,
  estimatedDurationMinutes: z.coerce.number().int().positive().optional().nullable(),
  requiresPhoto: z.boolean().default(false),
  requiresGps: z.boolean().default(false),
  requiresSignature: z.boolean().default(false),
  status: status.default("ACTIVE"),
});

const schemas = {
  zones: zoneInput,
  "service-areas": serviceAreaInput,
  routes: routeInput,
  "customer-categories": categoryInput,
  "field-officers": officerInput,
  "meter-catalogue": meterCatalogueInput,
  "service-request-types": serviceRequestTypeInput,
  "work-order-types": workOrderTypeInput,
} as const;
type Resource = keyof typeof schemas;

function resourceOf(value: string): Resource | null {
  return value in schemas ? value as Resource : null;
}

function parseBody(resource: Resource, body: unknown, res: Response) {
  const parsed = schemas[resource].safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return null;
  }
  return parsed.data as any;
}

function databaseConflict(error: unknown, res: Response) {
  if (
    (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003"].includes(error.code)) ||
    (typeof error === "object" && error !== null && "code" in error && ["23503", "23505"].includes(String((error as any).code)))
  ) {
    res.status(409).json({ error: "This setup record conflicts with an existing or referenced record." });
    return true;
  }
  return false;
}

setupsRouter.get("/lookups", asyncRoute(async (_req, res) => {
  const [zones, users] = await Promise.all([
    prisma.zone.findMany({ where: { status: "ACTIVE" }, orderBy: { zoneName: "asc" }, select: { zoneId: true, zoneCode: true, zoneName: true } }),
    prisma.user.findMany({
      where: { userType: { in: ["STAFF", "SYSTEM"] }, status: "ACTIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { userId: true, username: true, firstName: true, lastName: true, phoneNumber: true, fieldOfficer: { select: { fieldOfficerId: true } } },
    }),
  ]);
  res.json({ zones, users });
}));

setupsRouter.get("/:resource", asyncRoute(async (req, res) => {
  const resource = resourceOf(req.params.resource);
  if (!resource) return res.status(404).json({ error: "Unknown setup resource" });
  switch (resource) {
    case "zones": return res.json(await prisma.zone.findMany({ include: { _count: { select: { serviceAreas: true, routes: true, properties: true } } }, orderBy: { zoneName: "asc" } }));
    case "service-areas": return res.json(await prisma.serviceArea.findMany({ include: { zone: { select: { zoneId: true, zoneName: true } }, _count: { select: { properties: true } } }, orderBy: { areaName: "asc" } }));
    case "routes": return res.json(await prisma.route.findMany({ include: { zone: { select: { zoneId: true, zoneName: true } }, _count: { select: { accounts: true, properties: true } } }, orderBy: [{ sequenceNumber: "asc" }, { routeName: "asc" }] }));
    case "customer-categories": return res.json(await prisma.customerCategory.findMany({ include: { _count: { select: { accounts: true, tariffs: true } } }, orderBy: { categoryName: "asc" } }));
    case "field-officers": return res.json(await prisma.fieldOfficer.findMany({ include: { user: { select: { userId: true, firstName: true, lastName: true, username: true, status: true } }, homeZone: { select: { zoneId: true, zoneName: true } }, _count: { select: { routeAssignments: true } } }, orderBy: { employeeNumber: "asc" } }));
    case "meter-catalogue": return res.json(await prisma.meterCatalogueItem.findMany({ orderBy: { catalogueName: "asc" } }));
    case "service-request-types": return res.json(await prisma.serviceRequestType.findMany({ orderBy: { typeName: "asc" } }));
    case "work-order-types": return res.json(await prisma.$queryRaw<any[]>`
      SELECT work_order_type_id AS "workOrderTypeId", type_code AS "typeCode", type_name AS "typeName",
             description, requires_photo AS "requiresPhoto", requires_gps AS "requiresGps",
             requires_signature AS "requiresSignature", default_priority AS "defaultPriority",
             standard_materials AS "standardMaterials", completion_instructions AS "completionInstructions",
             estimated_duration_minutes AS "estimatedDurationMinutes", status, created_at AS "createdAt", updated_at AS "updatedAt",
             (SELECT COUNT(*)::int FROM aquaflow.work_orders wo WHERE wo.work_order_type_id = wt.work_order_type_id) AS "usageCount"
      FROM aquaflow.work_order_types wt ORDER BY type_name`);
  }
}));

setupsRouter.post("/:resource", asyncRoute(async (req, res) => {
  const resource = resourceOf(req.params.resource);
  if (!resource) return res.status(404).json({ error: "Unknown setup resource" });
  const data = parseBody(resource, req.body, res);
  if (!data) return;
  try {
    let created: unknown;
    switch (resource) {
      case "zones": created = await prisma.zone.create({ data }); break;
      case "service-areas": created = await prisma.serviceArea.create({ data }); break;
      case "routes": created = await prisma.route.create({ data }); break;
      case "customer-categories": created = await prisma.customerCategory.create({ data }); break;
      case "field-officers": created = await prisma.fieldOfficer.create({ data }); break;
      case "meter-catalogue": created = await prisma.meterCatalogueItem.create({ data }); break;
      case "service-request-types": created = await prisma.serviceRequestType.create({ data }); break;
      case "work-order-types": {
        const rows = await prisma.$queryRaw<any[]>`
          INSERT INTO aquaflow.work_order_types
            (type_code, type_name, description, default_priority, standard_materials, completion_instructions,
             estimated_duration_minutes, requires_photo, requires_gps, requires_signature, status)
          VALUES (${data.typeCode}, ${data.typeName}, ${data.description}, ${data.defaultPriority}, ${data.standardMaterials},
                  ${data.completionInstructions}, ${data.estimatedDurationMinutes}, ${data.requiresPhoto}, ${data.requiresGps}, ${data.requiresSignature}, ${data.status})
          RETURNING work_order_type_id AS "workOrderTypeId", type_code AS "typeCode", type_name AS "typeName",
                    description, requires_photo AS "requiresPhoto", requires_gps AS "requiresGps",
                    requires_signature AS "requiresSignature", default_priority AS "defaultPriority",
                    standard_materials AS "standardMaterials", completion_instructions AS "completionInstructions",
                    estimated_duration_minutes AS "estimatedDurationMinutes", status, created_at AS "createdAt", updated_at AS "updatedAt"`;
        created = rows[0];
        break;
      }
    }
    res.status(201).json(created);
  } catch (error) {
    if (!databaseConflict(error, res)) throw error;
  }
}));

setupsRouter.patch("/:resource/:id", asyncRoute(async (req, res) => {
  const resource = resourceOf(req.params.resource);
  const recordId = id.safeParse(req.params.id);
  if (!resource) return res.status(404).json({ error: "Unknown setup resource" });
  if (!recordId.success) return res.status(400).json({ error: "Invalid record ID" });
  const data = parseBody(resource, req.body, res);
  if (!data) return;
  try {
    let updated: unknown;
    switch (resource) {
      case "zones": updated = await prisma.zone.update({ where: { zoneId: recordId.data }, data: { ...data, updatedAt: new Date() } }); break;
      case "service-areas": updated = await prisma.serviceArea.update({ where: { serviceAreaId: recordId.data }, data: { ...data, updatedAt: new Date() } }); break;
      case "routes": updated = await prisma.route.update({ where: { routeId: recordId.data }, data: { ...data, updatedAt: new Date() } }); break;
      case "customer-categories": updated = await prisma.customerCategory.update({ where: { categoryId: recordId.data }, data: { ...data, updatedAt: new Date() } }); break;
      case "field-officers": updated = await prisma.fieldOfficer.update({ where: { fieldOfficerId: recordId.data }, data: { ...data, updatedAt: new Date() } }); break;
      case "meter-catalogue": updated = await prisma.meterCatalogueItem.update({ where: { meterCatalogueItemId: recordId.data }, data }); break;
      case "service-request-types": updated = await prisma.serviceRequestType.update({ where: { serviceRequestTypeId: recordId.data }, data }); break;
      case "work-order-types": {
        const rows = await prisma.$queryRaw<any[]>`
          UPDATE aquaflow.work_order_types SET type_code = ${data.typeCode}, type_name = ${data.typeName},
            description = ${data.description}, requires_photo = ${data.requiresPhoto}, requires_gps = ${data.requiresGps},
            requires_signature = ${data.requiresSignature}, default_priority = ${data.defaultPriority},
            standard_materials = ${data.standardMaterials}, completion_instructions = ${data.completionInstructions},
            estimated_duration_minutes = ${data.estimatedDurationMinutes}, status = ${data.status}, updated_at = CURRENT_TIMESTAMP
          WHERE work_order_type_id = ${recordId.data}
          RETURNING work_order_type_id AS "workOrderTypeId", type_code AS "typeCode", type_name AS "typeName",
                    description, requires_photo AS "requiresPhoto", requires_gps AS "requiresGps",
                    requires_signature AS "requiresSignature", default_priority AS "defaultPriority",
                    standard_materials AS "standardMaterials", completion_instructions AS "completionInstructions",
                    estimated_duration_minutes AS "estimatedDurationMinutes", status, created_at AS "createdAt", updated_at AS "updatedAt"`;
        if (!rows[0]) return res.status(404).json({ error: "Setup record not found" });
        updated = rows[0];
        break;
      }
    }
    res.json(updated);
  } catch (error) {
    if (!databaseConflict(error, res)) throw error;
  }
}));

setupsRouter.delete("/:resource/:id", asyncRoute(async (req, res) => {
  const resource = resourceOf(req.params.resource);
  const recordId = id.safeParse(req.params.id);
  if (!resource) return res.status(404).json({ error: "Unknown setup resource" });
  if (!recordId.success) return res.status(400).json({ error: "Invalid record ID" });
  switch (resource) {
    case "zones": await prisma.zone.update({ where: { zoneId: recordId.data }, data: { status: "INACTIVE", updatedAt: new Date() } }); break;
    case "service-areas": await prisma.serviceArea.update({ where: { serviceAreaId: recordId.data }, data: { status: "INACTIVE", updatedAt: new Date() } }); break;
    case "routes": await prisma.route.update({ where: { routeId: recordId.data }, data: { status: "INACTIVE", updatedAt: new Date() } }); break;
    case "customer-categories": await prisma.customerCategory.update({ where: { categoryId: recordId.data }, data: { status: "INACTIVE", updatedAt: new Date() } }); break;
    case "field-officers": await prisma.fieldOfficer.update({ where: { fieldOfficerId: recordId.data }, data: { status: "INACTIVE", updatedAt: new Date() } }); break;
    case "meter-catalogue": await prisma.meterCatalogueItem.update({ where: { meterCatalogueItemId: recordId.data }, data: { status: "INACTIVE" } }); break;
    case "service-request-types": await prisma.serviceRequestType.update({ where: { serviceRequestTypeId: recordId.data }, data: { status: "INACTIVE" } }); break;
    case "work-order-types": await prisma.$executeRaw`UPDATE aquaflow.work_order_types SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE work_order_type_id = ${recordId.data}`; break;
  }
  res.status(204).send();
}));
