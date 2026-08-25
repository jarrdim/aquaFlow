import { Router } from "express";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const customersRouter = Router();
customersRouter.use(requireAuth);

function normalizeKenyanPhone(value: unknown) {
  if (typeof value !== "string") return value;
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (compact.startsWith("0")) return `+254${compact.slice(1)}`;
  if (compact.startsWith("254")) return `+${compact}`;
  return compact;
}

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
    phoneNumber: z.preprocess(
      normalizeKenyanPhone,
      z.string().regex(/^\+254\d{9}$/, "Phone number must use +254 followed by 9 digits"),
    ),
    alternativePhone: z.string().optional(),
    emailAddress: z.string().email().optional(),
    preferredLanguage: z.enum(["EN", "SW"]).default("EN"),
    documents: z.array(z.object({
      documentReference: z.string().trim().min(1).max(100),
      title: z.string().trim().min(1).max(200),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      fileSize: z.number().int().positive().max(5 * 1024 * 1024),
      data: z.string().startsWith("data:").max(7_000_000),
    })).max(6).default([]),
  })
  .refine(
    (data) =>
      data.customerType === "INDIVIDUAL"
        ? !!data.firstName && !!data.lastName
        : !!data.organizationName,
    { message: "INDIVIDUAL customers need first/last name; ORGANIZATION customers need organizationName" }
  );

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
      { nationalId: { contains: search, mode: "insensitive" as const } },
      { registrationNumber: { contains: search, mode: "insensitive" as const } },
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
    include: {
      accounts: { include: { property: true, category: true } },
      documents: {
        select: {
          customerDocumentId: true, documentReference: true, title: true,
          fileName: true, mimeType: true, fileSize: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      users: {
        where: { userType: "CUSTOMER" },
        select: { username: true, phoneNumber: true, status: true, updatedAt: true },
        take: 1,
      },
    },
  });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const { users, ...details } = customer;
  res.json({
    ...details,
    portalAccess: users[0] ? {
      username: users[0].username,
      phoneNumber: users[0].phoneNumber,
      status: users[0].status,
      updatedAt: users[0].updatedAt,
    } : null,
  });
});

const customerPortalAccessSchema = z.object({
  password: z.string().min(8, "Password must contain at least 8 characters").max(200),
  phoneNumber: z.preprocess(
    normalizeKenyanPhone,
    z.string().regex(/^\+254\d{9}$/, "Phone number must use +254 followed by 9 digits"),
  ),
});

customersRouter.post(
  "/:id/portal-access",
  requireRole("CUSTOMER_CARE_OFFICER"),
  async (req, res, next) => {
    const customerId = z.string().regex(/^\d+$/).safeParse(req.params.id);
    const parsed = customerPortalAccessSchema.safeParse(req.body);
    if (!customerId.success || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? "Invalid customer ID" : parsed.error.flatten(),
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { customerId: BigInt(customerId.data) },
      include: { accounts: { orderBy: { accountNumber: "asc" } } },
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    if (customer.status !== "ACTIVE") {
      return res.status(409).json({ error: "Portal access can only be created for an active customer" });
    }
    if (!customer.accounts.length) {
      return res.status(409).json({ error: "Add a water account before creating portal access" });
    }

    const displayName = customer.organizationName ||
      [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ") ||
      customer.customerNumber;
    const nameParts = displayName.trim().split(/\s+/);
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({
          where: {
            OR: [
              { username: customer.customerNumber },
              { customerId: customer.customerId },
            ],
          },
        });
        const common = {
          username: customer.customerNumber,
          firstName: nameParts[0] || "Customer",
          lastName: nameParts.slice(1).join(" ") || "Account",
          phoneNumber: parsed.data.phoneNumber,
          passwordHash,
          userType: "CUSTOMER" as const,
          customerId: customer.customerId,
          status: "ACTIVE" as const,
        };
        const user = existing
          ? await tx.user.update({ where: { userId: existing.userId }, data: common })
          : await tx.user.create({
              data: {
                ...common,
                emailAddress: `${customer.customerNumber.toLowerCase()}@customer.samdamte.local`,
              },
            });

        await Promise.all(customer.accounts.map((account, index) =>
          tx.customerAccountAccess.upsert({
            where: { userId_accountId: { userId: user.userId, accountId: account.accountId } },
            update: { status: "ACTIVE", accessRole: "OWNER", verifiedAt: new Date(), isDefault: index === 0 },
            create: {
              userId: user.userId,
              accountId: account.accountId,
              status: "ACTIVE",
              accessRole: "OWNER",
              verifiedAt: new Date(),
              isDefault: index === 0,
            },
          }),
        ));
        return { user, created: !existing };
      });

      res.json({
        username: result.user.username,
        phoneNumber: result.user.phoneNumber,
        status: result.user.status,
        created: result.created,
        linkedAccounts: customer.accounts.map((account) => account.accountNumber),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "That phone number or portal identity is already assigned to another user" });
      }
      next(error);
    }
  },
);

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
  phoneNumber:        z.preprocess(
    (value) => value === undefined ? undefined : normalizeKenyanPhone(value),
    z.string().regex(/^\+254\d{9}$/, "Phone number must use +254 followed by 9 digits").optional(),
  ),
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

const bulkCustomerRowSchema = z
  .object({
    customerNumber: z.string().trim().min(1).max(50),
    customerType: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
    firstName: z.string().trim().optional(),
    middleName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    organizationName: z.string().trim().optional(),
    nationalId: z.string().trim().optional(),
    registrationNumber: z.string().trim().optional(),
    phoneNumber: z.string().trim().min(1).max(30),
    alternativePhone: z.string().trim().optional(),
    emailAddress: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === ""
          ? undefined
          : value,
      z.string().trim().email().optional(),
    ),
    preferredLanguage: z.enum(["EN", "SW"]).default("EN"),
    status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]).default("ACTIVE"),
    registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (row) =>
      row.customerType === "INDIVIDUAL"
        ? Boolean(row.firstName)
        : Boolean(row.organizationName),
    { message: "Individual customers require a first name; organizations require an organization name" },
  );

const bulkCustomerImportSchema = z.object({
  customers: z.array(bulkCustomerRowSchema).min(1).max(1000),
});

customersRouter.post("/bulk-import", async (req, res, next) => {
  try {
  const parsed = bulkCustomerImportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const rows = parsed.data.customers;
  const duplicateErrors: string[] = [];
  const duplicateFields: Array<[keyof (typeof rows)[number], string]> = [
    ["customerNumber", "customer number"],
    ["nationalId", "national ID"],
    ["registrationNumber", "registration number"],
  ];

  for (const [field, label] of duplicateFields) {
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      const value = row[field];
      if (typeof value !== "string" || !value) return;
      const key = value.toLocaleUpperCase();
      const first = seen.get(key);
      if (first !== undefined) {
        duplicateErrors.push(`Rows ${first + 2} and ${index + 2} use the same ${label} (${value}).`);
      } else {
        seen.set(key, index);
      }
    });
  }

  const existing = await prisma.customer.findMany({
    where: {
      OR: [
        { customerNumber: { in: rows.map((row) => row.customerNumber) } },
        { nationalId: { in: rows.map((row) => row.nationalId).filter((value): value is string => Boolean(value)) } },
        { registrationNumber: { in: rows.map((row) => row.registrationNumber).filter((value): value is string => Boolean(value)) } },
      ],
    },
    select: { customerNumber: true, nationalId: true, registrationNumber: true },
  });

  const existingNumbers = new Set(existing.map((row) => row.customerNumber));
  const existingNationalIds = new Set(existing.map((row) => row.nationalId).filter(Boolean));
  const existingRegistrationNumbers = new Set(existing.map((row) => row.registrationNumber).filter(Boolean));
  rows.forEach((row, index) => {
    if (existingNumbers.has(row.customerNumber)) duplicateErrors.push(`Row ${index + 2}: customer number ${row.customerNumber} already exists.`);
    if (row.nationalId && existingNationalIds.has(row.nationalId)) duplicateErrors.push(`Row ${index + 2}: national ID ${row.nationalId} already exists.`);
    if (row.registrationNumber && existingRegistrationNumbers.has(row.registrationNumber)) duplicateErrors.push(`Row ${index + 2}: registration number ${row.registrationNumber} already exists.`);
  });

  if (duplicateErrors.length) {
    return res.status(409).json({ error: duplicateErrors.slice(0, 100).join("\n") });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Fail before the reverse proxy timeout if another session is holding a
    // lock (for example, an uncommitted operational reset transaction).
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '45s'");
    return tx.customer.createMany({
      data: rows.map((row) => ({
      customerNumber: row.customerNumber,
      customerType: row.customerType,
      firstName: row.firstName || null,
      middleName: row.middleName || null,
      lastName: row.lastName || null,
      organizationName: row.organizationName || null,
      nationalId: row.nationalId || null,
      registrationNumber: row.registrationNumber || null,
      phoneNumber: row.phoneNumber,
      alternativePhone: row.alternativePhone || null,
      emailAddress: row.emailAddress || null,
      preferredLanguage: row.preferredLanguage,
      status: row.status,
      registrationDate: row.registrationDate
        ? new Date(`${row.registrationDate}T00:00:00.000Z`)
        : new Date(),
      createdBy: req.user ? BigInt(req.user.userId) : null,
      })),
    });
  });

  res.status(201).json({ imported: result.count });
  } catch (error) {
    console.error("Customer bulk import failed", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(", ")
        : String(error.meta?.target ?? "customer data");
      if (error.code === "P2002") {
        return res.status(409).json({
          error: `Customer import conflicts with an existing unique value (${target}).`,
        });
      }
      if (error.code === "P2003") {
        return res.status(409).json({
          error: "Customer import references a related record that does not exist.",
        });
      }
      if (error.code === "P2024") {
        return res.status(503).json({
          error: "The database connection pool timed out while importing customers.",
        });
      }
      return res.status(500).json({
        error: `Customer import database error (${error.code}). Check the backend log for details.`,
      });
    }
    next(error);
  }
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

  try {
    const customer = await prisma.$transaction(async (tx) => {
      // Serialize number allocation and derive the next value from the highest
      // number for this year. A row count is unsafe after imports/deletions and
      // allows concurrent requests to select the same customer number.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('aquaflow-customer-number'))::text AS lock`;
      const year = new Date().getFullYear();
      const pattern = `CUST-${year}-%`;
      const [sequence] = await tx.$queryRaw<Array<{ maxSequence: number }>>`
        SELECT COALESCE(
          MAX(CAST(substring(customer_number FROM '[0-9]+$') AS INTEGER)),
          0
        )::INTEGER AS "maxSequence"
        FROM aquaflow.customers
        WHERE customer_number LIKE ${pattern}`;
      const customerNumber = `CUST-${year}-${String(sequence.maxSequence + 1).padStart(5, "0")}`;

      return tx.customer.create({
        data: {
          customerNumber,
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
          documents: data.documents.length ? {
            create: data.documents.map((document) => ({
              documentReference: document.documentReference,
              title: document.title,
              fileName: document.fileName,
              mimeType: document.mimeType,
              fileSize: document.fileSize,
              fileData: document.data,
              uploadedBy: req.user ? BigInt(req.user.userId) : null,
            })),
          } : undefined,
        },
      });
    });

    res.status(201).json(customer);
  } catch (error: any) {
    if (error?.code === "P2002") {
      const fields = Array.isArray(error?.meta?.target)
        ? error.meta.target.join(", ")
        : "customer identity";
      return res.status(409).json({
        error: `A customer with the same ${fields.replace(/_/g, " ")} already exists. Search for and link that customer instead.`,
      });
    }
    console.error("Customer creation failed", error);
    return res.status(500).json({ error: "Customer creation failed. No customer was saved." });
  }
});
