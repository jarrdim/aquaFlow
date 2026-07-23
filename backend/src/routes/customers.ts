import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const customersRouter = Router();
customersRouter.use(requireAuth);

// Mirrors ck_customer_identity in the DDL: individuals need a name,
// organizations need an org name. Enforced here too so we fail fast
// with a clean error instead of a raw Postgres constraint violation.
const createCustomerSchema = z
  .object({
    customerType: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
    firstName: z.string().min(1).optional(),
    middleName: z.string().optional(),
    lastName: z.string().min(1).optional(),
    organizationName: z.string().min(1).optional(),
    nationalId: z.string().optional(),
    registrationNumber: z.string().optional(),
    phoneNumber: z.string().min(1),
    alternativePhone: z.string().optional(),
    emailAddress: z.string().email().optional(),
    preferredLanguage: z.enum(["EN", "SW"]).default("EN"),
  })
  .refine(
    (data) =>
      data.customerType === "INDIVIDUAL"
        ? !!data.firstName && !!data.lastName
        : !!data.organizationName,
    { message: "INDIVIDUAL customers need first/last name; ORGANIZATION customers need organizationName" }
  );

async function nextCustomerNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.customer.count();
  return `CUST-${year}-${String(count + 1).padStart(5, "0")}`;
}

customersRouter.get("/", async (req, res) => {
  const search = (req.query.search as string) ?? "";
  const status = (req.query.status as string) ?? "";
  const meterAssignment = (req.query.meterAssignment as string) ?? "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 20);

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" as const } },
      { middleName: { contains: search, mode: "insensitive" as const } },
      { lastName: { contains: search, mode: "insensitive" as const } },
      { organizationName: { contains: search, mode: "insensitive" as const } },
      { customerNumber: { contains: search, mode: "insensitive" as const } },
      { phoneNumber: { contains: search } },
    ];
  }

  if (status) {
    where.status = status;
  }

  const activeMeterAssignment = {
    meterAssignments: { some: { assignmentStatus: "ACTIVE" } },
  };
  if (meterAssignment === "ASSIGNED") {
    where.accounts = { some: activeMeterAssignment };
  } else if (meterAssignment === "UNASSIGNED") {
    where.accounts = { none: activeMeterAssignment };
  }

  const [items, total, withoutActiveMeter] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        accounts: {
          select: {
            accountId: true,
            meterAssignments: {
              where: { assignmentStatus: "ACTIVE" },
              select: {
                meterId: true,
                meter: { select: { meterNumber: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
    prisma.customer.count({
      where: {
        accounts: {
          none: {
            meterAssignments: { some: { assignmentStatus: "ACTIVE" } },
          },
        },
      },
    }),
  ]);

  res.json({
    items: items.map(({ accounts, ...customer }) => ({
      ...customer,
      accountCount: accounts.length,
      activeMeters: accounts.flatMap((account) =>
        account.meterAssignments.map((assignment) => ({
          meterId: assignment.meterId,
          meterNumber: assignment.meter.meterNumber,
        })),
      ),
    })),
    total,
    page,
    pageSize,
    summary: { withoutActiveMeter },
  });
});

customersRouter.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { customerId: BigInt(req.params.id) },
    include: { accounts: { include: { property: true, category: true } } },
  });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

// Editable subset — customerType and customerNumber are intentionally not
// editable here: changing type would violate ck_customer_identity retroactively,
// and the number is the durable reference used across bills/accounts (FRS rule #1).
//
// All optional text fields use the `optText` transform so that an empty string
// sent from the frontend is treated as "no change" rather than a validation
// failure — this prevents the common bug where the edit form serialises unused
// type-conditional fields (e.g. organizationName="") for an Individual customer.
const optText = z.string().optional().transform((v) => (v === "" ? undefined : v));

const updateCustomerSchema = z.object({
  firstName:          optText,
  middleName:         optText,
  lastName:           optText,
  organizationName:   optText,
  nationalId:         optText,
  registrationNumber: optText,
  phoneNumber:        z.string().min(1).optional(),
  alternativePhone:   optText,
  emailAddress:       z
    .string()
    .email()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  preferredLanguage:  z.enum(["EN", "SW"]).optional(),
  status:             z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]).optional(),
});

const bulkCustomerStatusSchema = z.object({
  customerIds: z.array(z.string().regex(/^\d+$/)).min(1).max(1000),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]),
});

customersRouter.patch("/bulk-status", async (req, res) => {
  const parsed = bulkCustomerStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const result = await prisma.customer.updateMany({
    where: {
      customerId: {
        in: parsed.data.customerIds.map((id) => BigInt(id)),
      },
    },
    data: { status: parsed.data.status },
  });

  res.json({ updated: result.count, status: parsed.data.status });
});

customersRouter.patch("/:id", async (req, res) => {
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  // Drop undefined values so Prisma leaves those columns untouched
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );

  try {
    const customer = await prisma.customer.update({
      where: { customerId: BigInt(req.params.id) },
      data,
    });
    res.json(customer);
  } catch {
    res.status(404).json({ error: "Customer not found" });
  }
});

customersRouter.post("/", async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = parsed.data;

  const customer = await prisma.customer.create({
    data: {
      customerNumber: await nextCustomerNumber(),
      customerType: data.customerType,
      firstName: data.firstName,
      middleName: data.middleName,
      lastName: data.lastName,
      organizationName: data.organizationName,
      nationalId: data.nationalId,
      registrationNumber: data.registrationNumber,
      phoneNumber: data.phoneNumber,
      alternativePhone: data.alternativePhone,
      emailAddress: data.emailAddress,
      preferredLanguage: data.preferredLanguage,
      createdBy: req.user ? BigInt(req.user.userId) : null,
    },
  });

  res.status(201).json(customer);
});
