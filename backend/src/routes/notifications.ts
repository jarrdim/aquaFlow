import { Router } from "express";
import { z } from "zod";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "../lib/notificationSecrets";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const id = z.coerce.bigint().positive();
const channels = z.array(z.enum(["SMS", "EMAIL", "PUSH"])).min(1);
const managers = requireRole(
  "SYSTEM_ADMIN",
  "BILLING_OFFICER",
  "BILLING_SUPERVISOR",
  "FINANCE_MANAGER",
  "CASHIER",
  "ACCOUNTANT",
);
const administrators = requireRole("SYSTEM_ADMIN");
const uid = (req: any) => (req.user?.userId ? BigInt(req.user.userId) : null);
const customerName = (customer: any) =>
  customer?.organizationName ||
  [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ");
const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const day = (value: unknown) =>
  value ? new Date(value as string).toLocaleDateString("en-KE") : "N/A";
const render = (
  text: string | null | undefined,
  values: Record<string, string>,
) =>
  String(text ?? "").replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (_all, key) => values[key] ?? `{{${key}}}`,
  );

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailHtml(subject: string, message: string) {
  const paragraphs = message
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 18px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#075985;padding:24px 30px;color:#ffffff;">
          <div style="font-size:25px;font-weight:700;letter-spacing:.2px;">AquaFlow</div>
          <div style="margin-top:4px;font-size:13px;color:#bae6fd;">Water Utility Management</div>
        </td></tr>
        <tr><td style="padding:30px;">
          <h1 style="margin:0 0 24px;color:#0f172a;font-size:22px;line-height:1.35;">${escapeHtml(subject)}</h1>
          ${paragraphs}
          <div style="margin-top:26px;padding-top:20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.6;">
            This is an automated AquaFlow notification. Please contact the water utility office if you need assistance.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const smtpConfigurationSchema = z.object({
  host: z.string().trim().min(3),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  user: z.string().trim().min(3),
  fromEmail: z.string().email(),
  fromName: z.string().trim().min(2).max(100).default("AquaFlow"),
  replyTo: z.string().email().optional().nullable(),
});

const providerPublicSelect = {
  providerId: true,
  providerCode: true,
  providerName: true,
  channel: true,
  providerType: true,
  endpointUrl: true,
  environmentPrefix: true,
  configuration: true,
  secretConfiguredAt: true,
  isDefault: true,
  status: true,
  remarks: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

const include = {
  template: true,
  provider: { select: providerPublicSelect },
  customer: true,
  account: true,
  bill: { include: { billingCycle: true } },
  requester: true,
  attempts: { orderBy: { attemptNumber: "desc" as const } },
} as const;

async function activeTemplate(notificationType: string, channel: string) {
  return prisma.notificationTemplate.findFirst({
    where: { notificationType, channel, status: "ACTIVE" },
    orderBy: { templateId: "desc" },
  });
}

async function smtpTransport(provider: any) {
  const configuration = smtpConfigurationSchema.parse(provider.configuration);
  if (!provider.encryptedSecret) {
    throw new Error("The SMTP password has not been configured.");
  }
  return {
    configuration,
    transport: nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      requireTLS: !configuration.secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: {
        user: configuration.user,
        pass: decryptProviderSecret(provider.encryptedSecret),
      },
    }),
  };
}

async function failAttempt(
  notification: any,
  provider: any,
  attemptNumber: number,
  reason: string,
) {
  const now = new Date();
  await prisma.notificationDeliveryAttempt.create({
    data: {
      notificationId: notification.notificationId,
      providerId: provider?.providerId,
      attemptNumber,
      status: "FAILED",
      errorMessage: reason.slice(0, 2000),
    },
  });
  return prisma.notification.update({
    where: { notificationId: notification.notificationId },
    data: {
      providerId: provider?.providerId,
      deliveryStatus: "FAILED",
      failureReason: reason.slice(0, 2000),
      retryCount: attemptNumber,
      lastAttemptAt: now,
      updatedAt: now,
    },
    include,
  });
}

async function processOne(notificationId: bigint) {
  const notification = await prisma.notification.findUnique({
    where: { notificationId },
    include: { provider: true },
  });
  if (
    !notification ||
    !["QUEUED", "FAILED"].includes(notification.deliveryStatus)
  )
    return notification;
  if (notification.retryCount >= notification.maxRetries) return notification;
  if (notification.scheduledAt && notification.scheduledAt > new Date())
    return notification;

  const provider =
    notification.provider ??
    (await prisma.notificationProvider.findFirst({
      where: {
        channel: notification.channel,
        status: "ACTIVE",
        isDefault: true,
      },
      orderBy: { providerId: "asc" },
    }));
  const attemptNumber = notification.retryCount + 1;
  const now = new Date();
  if (!provider) {
    await prisma.notificationDeliveryAttempt.create({
      data: {
        notificationId,
        attemptNumber,
        status: "FAILED",
        errorMessage: `No active ${notification.channel} provider is configured.`,
      },
    });
    return prisma.notification.update({
      where: { notificationId },
      data: {
        deliveryStatus: "FAILED",
        failureReason: `No active ${notification.channel} provider is configured.`,
        retryCount: attemptNumber,
        lastAttemptAt: now,
        updatedAt: now,
      },
      include,
    });
  }

  if (provider.providerType === "SMTP") {
    if (notification.channel !== "EMAIL") {
      return failAttempt(
        notification,
        provider,
        attemptNumber,
        "SMTP providers can only process email notifications.",
      );
    }
    try {
      const { configuration, transport } = await smtpTransport(provider);
      const emailSubject = notification.subject || "AquaFlow notification";
      const information = await transport.sendMail({
        from: {
          name: configuration.fromName,
          address: configuration.fromEmail,
        },
        to: notification.recipient,
        replyTo: configuration.replyTo || undefined,
        subject: emailSubject,
        text: notification.messageBody,
        html: emailHtml(emailSubject, notification.messageBody),
      });
      const reference = String(information.messageId || `SMTP-${Date.now()}`);
      await prisma.notificationDeliveryAttempt.create({
        data: {
          notificationId,
          providerId: provider.providerId,
          attemptNumber,
          status: "SENT",
          providerReference: reference,
          requestPayload: {
            recipient: notification.recipient,
            subject: notification.subject,
          },
          responsePayload: {
            accepted: information.accepted.map(String),
            rejected: information.rejected.map(String),
            messageId: reference,
          },
        },
      });
      return prisma.notification.update({
        where: { notificationId },
        data: {
          providerId: provider.providerId,
          deliveryStatus: "SENT",
          externalReference: reference,
          sentAt: now,
          lastAttemptAt: now,
          failureReason: null,
          retryCount: attemptNumber,
          updatedAt: now,
        },
        include,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "SMTP delivery failed.";
      return failAttempt(notification, provider, attemptNumber, reason);
    }
  }

  if (provider.providerType !== "SIMULATED") {
    const reason = `${provider.providerName} is configured but its live connector is not enabled. Use a simulated provider until credentials are available.`;
    await prisma.notificationDeliveryAttempt.create({
      data: {
        notificationId,
        providerId: provider.providerId,
        attemptNumber,
        status: "FAILED",
        errorMessage: reason,
      },
    });
    return prisma.notification.update({
      where: { notificationId },
      data: {
        providerId: provider.providerId,
        deliveryStatus: "FAILED",
        failureReason: reason,
        retryCount: attemptNumber,
        lastAttemptAt: now,
        updatedAt: now,
      },
      include,
    });
  }

  const reference = `SIM-${notification.channel}-${Date.now()}-${notificationId}`;
  await prisma.notificationDeliveryAttempt.create({
    data: {
      notificationId,
      providerId: provider.providerId,
      attemptNumber,
      status: "DELIVERED",
      providerReference: reference,
      requestPayload: {
        recipient: notification.recipient,
        subject: notification.subject,
        message: notification.messageBody,
      },
      responsePayload: { accepted: true, simulated: true },
    },
  });
  return prisma.notification.update({
    where: { notificationId },
    data: {
      providerId: provider.providerId,
      deliveryStatus: "DELIVERED",
      externalReference: reference,
      sentAt: now,
      deliveredAt: now,
      lastAttemptAt: now,
      failureReason: null,
      retryCount: attemptNumber,
      updatedAt: now,
    },
    include,
  });
}

notificationsRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const [total, queued, sent, delivered, failed, recent, groups] =
      await Promise.all([
        prisma.notification.count(),
        prisma.notification.count({ where: { deliveryStatus: "QUEUED" } }),
        prisma.notification.count({ where: { deliveryStatus: "SENT" } }),
        prisma.notification.count({ where: { deliveryStatus: "DELIVERED" } }),
        prisma.notification.count({ where: { deliveryStatus: "FAILED" } }),
        prisma.notification.findMany({
          include,
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
        prisma.notification.groupBy({
          by: ["channel"],
          _count: { _all: true },
        }),
      ]);
    res.json({
      total,
      queued,
      sent,
      delivered,
      failed,
      recent,
      byChannel: groups.map((row) => ({
        channel: row.channel,
        count: row._count._all,
      })),
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get("/targets", async (_req, res, next) => {
  try {
    const [accounts, bills, payments] = await Promise.all([
      prisma.customerAccount.findMany({
        where: { accountStatus: "ACTIVE" },
        include: { customer: true },
        orderBy: { accountNumber: "asc" },
      }),
      prisma.bill.findMany({
        where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } },
        include: {
          account: { include: { customer: true } },
          billingCycle: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.payment.findMany({
        where: { accountId: { not: null } },
        include: { account: { include: { customer: true } }, receipt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);
    res.json({
      accounts: accounts.map((a) => ({
        ...a,
        customerName: customerName(a.customer),
      })),
      bills: bills.map((b) => ({
        ...b,
        customerName: customerName(b.account.customer),
      })),
      payments: payments.map((p) => ({
        ...p,
        customerName: customerName(p.account?.customer),
      })),
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get("/templates", async (_req, res, next) => {
  try {
    res.json(
      await prisma.notificationTemplate.findMany({
        include: { creator: true },
        orderBy: [{ notificationType: "asc" }, { channel: "asc" }],
      }),
    );
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post(
  "/templates",
  administrators,
  async (req, res, next) => {
    const parsed = z
      .object({
        templateCode: z.string().min(2),
        templateName: z.string().min(2),
        notificationType: z.string().min(2),
        channel: z.enum(["SMS", "EMAIL", "PUSH"]),
        subject: z.string().optional().nullable(),
        messageBody: z.string().min(2),
        description: z.string().optional().nullable(),
        variables: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.status(201).json(
        await prisma.notificationTemplate.create({
          data: {
            ...parsed.data,
            templateCode: parsed.data.templateCode.toUpperCase(),
            createdBy: uid(req),
          },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.patch(
  "/templates/:id",
  administrators,
  async (req, res, next) => {
    const templateId = id.safeParse(req.params.id);
    const parsed = z
      .object({
        templateName: z.string().min(2).optional(),
        subject: z.string().nullable().optional(),
        messageBody: z.string().min(2).optional(),
        description: z.string().nullable().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
      })
      .safeParse(req.body);
    if (!templateId.success || !parsed.success)
      return res.status(400).json({ error: "Invalid template update" });
    try {
      res.json(
        await prisma.notificationTemplate.update({
          where: { templateId: templateId.data },
          data: { ...parsed.data, updatedAt: new Date() },
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.get("/providers", async (_req, res, next) => {
  try {
    res.json(
      await prisma.notificationProvider.findMany({
        select: {
          ...providerPublicSelect,
          creator: {
            select: { userId: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ channel: "asc" }, { providerName: "asc" }],
      }),
    );
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post(
  "/providers",
  administrators,
  async (req, res, next) => {
    const parsed = z
      .object({
        providerCode: z.string().min(2),
        providerName: z.string().min(2),
        channel: z.enum(["SMS", "EMAIL", "PUSH"]),
        providerType: z
          .enum(["SIMULATED", "HTTP_API", "SMTP"])
          .default("SIMULATED"),
        endpointUrl: z.string().url().optional().nullable(),
        isDefault: z.boolean().default(false),
        remarks: z.string().optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    if (parsed.data.providerType === "SMTP" && parsed.data.channel !== "EMAIL")
      return res
        .status(400)
        .json({ error: "SMTP providers must use the EMAIL channel." });
    if (parsed.data.providerType === "SMTP" && parsed.data.isDefault)
      return res.status(409).json({
        error:
          "Create and configure the SMTP provider before making it default.",
      });
    try {
      const result = await prisma.$transaction(async (tx) => {
        if (parsed.data.isDefault)
          await tx.notificationProvider.updateMany({
            where: { channel: parsed.data.channel },
            data: { isDefault: false },
          });
        return tx.notificationProvider.create({
          data: {
            ...parsed.data,
            providerCode: parsed.data.providerCode.toUpperCase(),
            createdBy: uid(req),
          },
        });
      });
      const { encryptedSecret: _secret, ...safeResult } = result;
      res.status(201).json({
        ...safeResult,
        secretConfigured: Boolean(result.encryptedSecret),
      });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.patch(
  "/providers/:id",
  administrators,
  async (req, res, next) => {
    const providerId = id.safeParse(req.params.id);
    const parsed = z
      .object({
        providerName: z.string().min(2).optional(),
        endpointUrl: z.string().url().nullable().optional(),
        isDefault: z.boolean().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        remarks: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!providerId.success || !parsed.success)
      return res.status(400).json({ error: "Invalid provider update" });
    try {
      const current = await prisma.notificationProvider.findUniqueOrThrow({
        where: { providerId: providerId.data },
      });
      if (
        current.providerType === "SMTP" &&
        (parsed.data.isDefault || parsed.data.status === "ACTIVE") &&
        (!current.encryptedSecret || !current.configuration)
      )
        return res.status(409).json({
          error:
            "Configure and test the SMTP credentials before activating this provider.",
        });
      const result = await prisma.$transaction(async (tx) => {
        if (parsed.data.isDefault)
          await tx.notificationProvider.updateMany({
            where: { channel: current.channel },
            data: { isDefault: false },
          });
        return tx.notificationProvider.update({
          where: { providerId: providerId.data },
          data: { ...parsed.data, updatedAt: new Date() },
        });
      });
      const { encryptedSecret: _secret, ...safeResult } = result;
      res.json({
        ...safeResult,
        secretConfigured: Boolean(result.encryptedSecret),
      });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.put(
  "/providers/:id/smtp",
  administrators,
  async (req, res, next) => {
    const providerId = id.safeParse(req.params.id);
    const parsed = smtpConfigurationSchema
      .extend({ password: z.string().min(8).max(500).optional() })
      .safeParse(req.body);
    if (!providerId.success || !parsed.success)
      return res.status(400).json({ error: "Invalid SMTP configuration" });
    try {
      const current = await prisma.notificationProvider.findUniqueOrThrow({
        where: { providerId: providerId.data },
      });
      if (current.channel !== "EMAIL" || current.providerType !== "SMTP")
        return res.status(409).json({
          error: "The selected provider is not an SMTP email provider.",
        });
      if (!parsed.data.password && !current.encryptedSecret)
        return res.status(400).json({ error: "SMTP password is required." });
      const { password, ...configuration } = parsed.data;
      const updated = await prisma.notificationProvider.update({
        where: { providerId: providerId.data },
        data: {
          configuration,
          ...(password
            ? {
                encryptedSecret: encryptProviderSecret(password),
                secretConfiguredAt: new Date(),
              }
            : {}),
          updatedAt: new Date(),
        },
        select: providerPublicSelect,
      });
      res.json({ ...updated, secretConfigured: true });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.post(
  "/providers/:id/test",
  administrators,
  async (req, res, next) => {
    const providerId = id.safeParse(req.params.id);
    const parsed = z
      .object({ recipient: z.string().email() })
      .safeParse(req.body);
    if (!providerId.success || !parsed.success)
      return res.status(400).json({ error: "A valid test email is required." });
    try {
      const provider = await prisma.notificationProvider.findUniqueOrThrow({
        where: { providerId: providerId.data },
      });
      if (provider.channel !== "EMAIL" || provider.providerType !== "SMTP")
        return res.status(409).json({
          error: "The selected provider is not an SMTP email provider.",
        });
      const { configuration, transport } = await smtpTransport(provider);
      await transport.verify();
      const information = await transport.sendMail({
        from: {
          name: configuration.fromName,
          address: configuration.fromEmail,
        },
        to: parsed.data.recipient,
        replyTo: configuration.replyTo || undefined,
        subject: "AquaFlow SMTP configuration test",
        text: "Your AquaFlow SMTP email provider is configured correctly.",
        html: emailHtml(
          "SMTP configuration successful",
          "Your AquaFlow SMTP email provider is configured correctly.\n\nYou can now activate this provider and use it for customer notifications.",
        ),
      });
      res.json({
        message: "SMTP connection verified and test email accepted.",
        reference: String(information.messageId ?? ""),
      });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "SMTP verification failed.";
      const message = /ETIMEDOUT|timeout/i.test(rawMessage)
        ? "SMTP connection timed out. This computer or network is blocking the configured SMTP port. Allow outbound SMTP in the firewall/router, or try port 465 with Direct TLS enabled."
        : rawMessage;
      res.status(502).json({ error: message });
    }
  },
);

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "");
    const channel = String(req.query.channel ?? "");
    const search = String(req.query.search ?? "").trim();
    const where: any = {};
    if (status) where.deliveryStatus = status;
    if (channel) where.channel = channel;
    if (search)
      where.OR = [
        { recipient: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } },
        {
          account: { accountNumber: { contains: search, mode: "insensitive" } },
        },
      ];
    res.json(
      await prisma.notification.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    );
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get("/audience", managers, async (req, res, next) => {
  const parsed = z
    .object({
      search: z.string().trim().max(100).default(""),
      minimumBalance: z.coerce.number().min(0).default(0.01),
      accountStatuses: z.string().trim().default("").transform((value) => value ? value.split(",").filter(Boolean) : []),
      zoneIds: z.string().trim().default("").transform((value, context) => {
        const values = value ? value.split(",").filter(Boolean) : [];
        if (values.some((item) => !/^\d+$/.test(item))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Zone IDs must be numeric" });
        return values;
      }),
      categoryIds: z.string().trim().default("").transform((value, context) => {
        const values = value ? value.split(",").filter(Boolean) : [];
        if (values.some((item) => !/^\d+$/.test(item))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Category IDs must be numeric" });
        return values;
      }),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(25),
    })
    .safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const { search, minimumBalance, accountStatuses, zoneIds, categoryIds, page, pageSize } =
      parsed.data;
    const where: any = {
      currentBalance: { gte: minimumBalance },
      ...(accountStatuses.length ? { accountStatus: { in: accountStatuses } } : {}),
      ...(zoneIds.length ? { property: { zoneId: { in: zoneIds.map(BigInt) } } } : {}),
      ...(categoryIds.length ? { categoryId: { in: categoryIds.map(BigInt) } } : {}),
      ...(search
        ? {
            OR: [
              {
                accountNumber: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  firstName: { contains: search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  middleName: { contains: search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  lastName: { contains: search, mode: "insensitive" },
                },
              },
              {
                customer: {
                  organizationName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
              { customer: { phoneNumber: { contains: search } } },
              {
                customer: {
                  emailAddress: { contains: search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total, balance] = await Promise.all([
      prisma.customerAccount.findMany({
        where,
        include: { customer: true, category: true, property: { include: { zone: true } } },
        orderBy: [{ currentBalance: "desc" }, { accountNumber: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.customerAccount.count({ where }),
      prisma.customerAccount.aggregate({
        where,
        _sum: { currentBalance: true },
      }),
    ]);
    res.json({
      items: items.map((account) => ({
        ...account,
        customerName: customerName(account.customer),
        hasSms: Boolean(account.customer.phoneNumber),
        hasEmail: Boolean(account.customer.emailAddress),
      })),
      total,
      page,
      pageSize,
      totalBalance: balance._sum.currentBalance ?? 0,
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/send-bulk", managers, async (req, res, next) => {
  const audienceFilters = z.object({
    search: z.string().trim().max(100).default(""),
    minimumBalance: z.coerce.number().min(0).default(0.01),
    accountStatuses: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
    zoneIds: z.array(id).max(100).default([]),
    categoryIds: z.array(id).max(100).default([]),
  });
  const parsed = z
    .object({
      selectionMode: z.enum(["SELECTED", "FILTER"]),
      accountIds: z.array(id).max(1000).default([]),
      filters: audienceFilters,
      notificationType: z.enum(["GENERAL", "BALANCE_REMINDER"]),
      channels,
      subject: z.string().optional(),
      message: z.string().optional(),
      scheduledAt: z.coerce.date().optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.flatten() });
  if (
    parsed.data.notificationType === "GENERAL" &&
    !parsed.data.message?.trim()
  )
    return res.status(400).json({
      error: "A custom message is required for a general notification.",
    });
  if (
    parsed.data.selectionMode === "SELECTED" &&
    !parsed.data.accountIds.length
  )
    return res.status(400).json({ error: "Select at least one account." });
  try {
    const { filters } = parsed.data;
    const filteredWhere: any = {
      currentBalance: { gte: filters.minimumBalance },
      ...(filters.accountStatuses.length ? { accountStatus: { in: filters.accountStatuses } } : {}),
      ...(filters.zoneIds.length ? { property: { zoneId: { in: filters.zoneIds } } } : {}),
      ...(filters.categoryIds.length ? { categoryId: { in: filters.categoryIds } } : {}),
      ...(filters.search
        ? {
            OR: [
              {
                accountNumber: {
                  contains: filters.search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  firstName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                customer: {
                  middleName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                customer: {
                  lastName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                customer: {
                  organizationName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              },
              { customer: { phoneNumber: { contains: filters.search } } },
              {
                customer: {
                  emailAddress: { contains: filters.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const accounts = await prisma.customerAccount.findMany({
      where:
        parsed.data.selectionMode === "SELECTED"
          ? { accountId: { in: parsed.data.accountIds }, ...filteredWhere }
          : filteredWhere,
      include: { customer: true },
      orderBy: { accountNumber: "asc" },
      take: 1001,
    });
    if (accounts.length > 1000)
      return res.status(400).json({
        error:
          "This audience contains more than 1,000 accounts. Narrow the filters and create another batch.",
      });
    const templateEntries = await Promise.all(
      parsed.data.channels.map(async (channel) => ({
        channel,
        template: await activeTemplate(
          parsed.data.notificationType,
          channel,
        ),
      })),
    );
    const unavailableChannels = templateEntries
      .filter(({ template }) => !template && !parsed.data.message)
      .map(({ channel }) => channel);
    const data: any[] = [];
    const skipped = { missingSms: 0, missingEmail: 0, unavailableTemplate: 0 };
    for (const account of accounts) {
      const values: Record<string, string> = {
        customer_name: customerName(account.customer),
        account_number: account.accountNumber,
        balance: money(account.currentBalance),
      };
      for (const { channel, template } of templateEntries) {
        if (!template && !parsed.data.message) {
          skipped.unavailableTemplate += 1;
          continue;
        }
        const recipient =
          channel === "EMAIL"
            ? account.customer.emailAddress
            : channel === "SMS"
              ? account.customer.phoneNumber
              : account.accountNumber;
        if (!recipient) {
          if (channel === "EMAIL") skipped.missingEmail += 1;
          if (channel === "SMS") skipped.missingSms += 1;
          continue;
        }
        data.push({
          templateId: template?.templateId,
          customerId: account.customerId,
          accountId: account.accountId,
          notificationType: parsed.data.notificationType,
          channel,
          recipient,
          subject: render(parsed.data.subject ?? template?.subject, values),
          messageBody: render(
            parsed.data.message ?? template?.messageBody ?? "",
            values,
          ),
          scheduledAt: parsed.data.scheduledAt,
          requestedBy: uid(req),
          metadata: {
            targetType: "BULK_ACCOUNT",
            selectionMode: parsed.data.selectionMode,
          },
        });
      }
    }
    const created = data.length
      ? await prisma.notification.createMany({ data })
      : { count: 0 };
    res.status(201).json({
      accounts: accounts.length,
      created: created.count,
      skipped,
      unavailableChannels,
      queued: true,
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/send", managers, async (req, res, next) => {
  const parsed = z
    .object({
      targetType: z.enum(["ACCOUNT", "BILL", "PAYMENT"]),
      targetId: id,
      notificationType: z.enum([
        "GENERAL",
        "BILL_ISSUED",
        "DUE_DATE_REMINDER",
        "BALANCE_REMINDER",
        "PAYMENT_RECEIPT",
        "PAYMENT_REVERSAL",
      ]),
      channels,
      subject: z.string().optional(),
      message: z.string().optional(),
      scheduledAt: z.coerce.date().optional().nullable(),
      processNow: z.boolean().default(true),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.flatten() });
  if (
    parsed.data.notificationType === "GENERAL" &&
    !parsed.data.message?.trim()
  )
    return res.status(400).json({
      error: "A custom message is required for a general notification.",
    });
  try {
    let account: any = null;
    let bill: any = null;
    let payment: any = null;
    if (parsed.data.targetType === "ACCOUNT")
      account = await prisma.customerAccount.findUnique({
        where: { accountId: parsed.data.targetId },
        include: { customer: true },
      });
    if (parsed.data.targetType === "BILL") {
      bill = await prisma.bill.findUnique({
        where: { billId: parsed.data.targetId },
        include: {
          account: { include: { customer: true } },
          billingCycle: true,
        },
      });
      account = bill?.account;
    }
    if (parsed.data.targetType === "PAYMENT") {
      payment = await prisma.payment.findUnique({
        where: { paymentId: parsed.data.targetId },
        include: { account: { include: { customer: true } }, receipt: true },
      });
      account = payment?.account;
    }
    if (!account)
      return res.status(404).json({
        error: "The selected target does not have a customer account.",
      });
    const values: Record<string, string> = {
      customer_name: customerName(account.customer),
      account_number: account.accountNumber,
      balance: money(account.currentBalance),
      bill_number: bill?.billNumber ?? "",
      period: bill?.billingCycle?.cycleName ?? "",
      amount_due: money(bill?.totalAmountDue),
      due_date: day(bill?.dueDate),
      payment_reference: payment?.transactionReference ?? "",
      amount: money(payment?.amount),
      receipt_number:
        payment?.receipt?.receiptNumber ?? payment?.transactionReference ?? "",
    };
    const created: any[] = [];
    const skipped: { channel: string; reason: string }[] = [];
    for (const channel of parsed.data.channels) {
      const recipient =
        channel === "EMAIL"
          ? account.customer.emailAddress
          : channel === "SMS"
            ? account.customer.phoneNumber
            : account.accountNumber;
      if (!recipient) {
        skipped.push({
          channel,
          reason: `Customer has no ${channel === "EMAIL" ? "email address" : "phone number"}.`,
        });
        continue;
      }
      const template = await activeTemplate(
        parsed.data.notificationType,
        channel,
      );
      if (!template && !parsed.data.message) {
        skipped.push({
          channel,
          reason: `No active ${parsed.data.notificationType} ${channel} template exists.`,
        });
        continue;
      }
      const notification = await prisma.notification.create({
        data: {
          templateId: template?.templateId,
          customerId: account.customerId,
          accountId: account.accountId,
          billId: bill?.billId,
          notificationType: parsed.data.notificationType,
          channel,
          recipient,
          subject: render(parsed.data.subject ?? template?.subject, values),
          messageBody: render(
            parsed.data.message ?? template?.messageBody ?? "",
            values,
          ),
          scheduledAt: parsed.data.scheduledAt,
          requestedBy: uid(req),
          metadata: {
            targetType: parsed.data.targetType,
            targetId: parsed.data.targetId.toString(),
          },
        },
        include,
      });
      created.push(
        parsed.data.processNow && !parsed.data.scheduledAt
          ? await processOne(notification.notificationId)
          : notification,
      );
    }
    if (
      bill &&
      created.some((n) => ["SENT", "DELIVERED"].includes(n?.deliveryStatus))
    )
      await prisma.bill.update({
        where: { billId: bill.billId },
        data: { notificationStatus: "SENT", updatedAt: new Date() },
      });
    res.status(201).json({ created, skipped });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/process", managers, async (req, res, next) => {
  const parsed = z
    .object({ notificationIds: z.array(id).optional() })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const queued = await prisma.notification.findMany({
      where: {
        notificationId: parsed.data.notificationIds
          ? { in: parsed.data.notificationIds }
          : undefined,
        deliveryStatus: { in: ["QUEUED", "FAILED"] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      select: { notificationId: true },
      take: 200,
    });
    const processed = [];
    for (const row of queued)
      processed.push(await processOne(row.notificationId));
    res.json({ processed });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/:id/retry", managers, async (req, res, next) => {
  const notificationId = id.safeParse(req.params.id);
  if (!notificationId.success)
    return res.status(400).json({ error: "Invalid notification" });
  try {
    res.json(await processOne(notificationId.data));
  } catch (error) {
    next(error);
  }
});
