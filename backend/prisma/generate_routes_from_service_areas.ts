import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const applyChanges = process.argv.includes("--apply");
const requestedSize = Number(
  process.argv.find((argument) => argument.startsWith("--max-accounts="))?.split("=")[1] ??
    "250",
);

if (!Number.isInteger(requestedSize) || requestedSize < 1) {
  throw new Error("--max-accounts must be a positive whole number");
}

function codePart(value: string) {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "UNSPECIFIED"
  );
}

function routeCode(zoneCode: string, areaCode: string | null, sequence: number) {
  return `RT-${codePart(zoneCode)}-${codePart(areaCode ?? "NO-AREA")}-${String(sequence).padStart(2, "0")}`;
}

function routeName(
  zoneName: string,
  areaName: string | null,
  sequence: number,
  routeCount: number,
) {
  const groupName = areaName ?? "Unassigned service area";
  const baseName =
    codePart(zoneName) === codePart(groupName)
      ? groupName
      : `${zoneName} · ${groupName}`;
  const suffix = routeCount > 1 ? ` · Route ${String(sequence).padStart(2, "0")}` : "";
  return `${baseName}${suffix}`;
}

async function main() {
  const properties = await prisma.property.findMany({
    where: { status: "ACTIVE" },
    select: {
      propertyId: true,
      propertyCode: true,
      zoneId: true,
      serviceAreaId: true,
      zone: { select: { zoneCode: true, zoneName: true } },
      serviceArea: { select: { areaCode: true, areaName: true } },
      accounts: {
        where: { accountStatus: { in: ["ACTIVE", "PENDING", "SUSPENDED"] } },
        select: { accountId: true },
      },
    },
    orderBy: [{ zoneId: "asc" }, { serviceAreaId: "asc" }, { propertyCode: "asc" }],
  });

  const groups = new Map<string, typeof properties>();
  for (const property of properties) {
    const key = `${property.zoneId}:${property.serviceAreaId ?? "NO_AREA"}`;
    const group = groups.get(key) ?? [];
    group.push(property);
    groups.set(key, group);
  }

  const plan: Array<{
    code: string;
    name: string;
    zoneId: bigint;
    sequence: number;
    propertyIds: bigint[];
    accountIds: bigint[];
    areaCode: string | null;
  }> = [];

  for (const group of groups.values()) {
    const first = group[0];
    const chunks: Array<typeof properties> = [];
    let currentChunk: typeof properties = [];
    let currentAccounts = 0;

    for (const property of group) {
      const accountCount = Math.max(property.accounts.length, 1);
      if (currentChunk.length > 0 && currentAccounts + accountCount > requestedSize) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentAccounts = 0;
      }
      currentChunk.push(property);
      currentAccounts += accountCount;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    chunks.forEach((chunk, index) => {
      const sequence = index + 1;
      plan.push({
        code: routeCode(first.zone.zoneCode, first.serviceArea?.areaCode ?? null, sequence),
        name: routeName(
          first.zone.zoneName,
          first.serviceArea?.areaName ?? null,
          sequence,
          chunks.length,
        ),
        zoneId: first.zoneId,
        sequence,
        propertyIds: chunk.map((property) => property.propertyId),
        accountIds: chunk.flatMap((property) =>
          property.accounts.map((account) => account.accountId),
        ),
        areaCode: first.serviceArea?.areaCode ?? null,
      });
    });
  }

  if (applyChanges) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(`
        SELECT setval(
          pg_get_serial_sequence('"aquaflow"."routes"', 'route_id'),
          COALESCE((SELECT MAX(route_id) FROM aquaflow.routes), 0) + 1,
          false
        )
      `);

      for (const route of plan) {
        const saved = await transaction.route.upsert({
          where: { routeCode: route.code },
          create: {
            zoneId: route.zoneId,
            routeCode: route.code,
            routeName: route.name,
            sequenceNumber: route.sequence,
            estimatedCustomers: route.accountIds.length,
            status: "ACTIVE",
          },
          update: {
            zoneId: route.zoneId,
            routeName: route.name,
            sequenceNumber: route.sequence,
            estimatedCustomers: route.accountIds.length,
            status: "ACTIVE",
            updatedAt: new Date(),
          },
        });

        await transaction.property.updateMany({
          where: { propertyId: { in: route.propertyIds } },
          data: { routeId: saved.routeId, updatedAt: new Date() },
        });
        if (route.accountIds.length > 0) {
          await transaction.customerAccount.updateMany({
            where: { accountId: { in: route.accountIds } },
            data: { routeId: saved.routeId, updatedAt: new Date() },
          });
        }
      }
    });
  }

  const byZone = new Map<
    string,
    { zone: string; routes: number; properties: number; accounts: number }
  >();
  for (const route of plan) {
    const zone = properties.find((property) => property.zoneId === route.zoneId)!.zone;
    const key = route.zoneId.toString();
    const summary = byZone.get(key) ?? {
      zone: `${zone.zoneCode} · ${zone.zoneName}`,
      routes: 0,
      properties: 0,
      accounts: 0,
    };
    summary.routes += 1;
    summary.properties += route.propertyIds.length;
    summary.accounts += route.accountIds.length;
    byZone.set(key, summary);
  }

  const noServiceArea = plan.filter((route) => route.areaCode === null);
  const [generatedRoutes, activePropertiesWithoutRoute, eligibleAccountsWithoutRoute] =
    await Promise.all([
      prisma.route.count({ where: { routeCode: { startsWith: "RT-" } } }),
      prisma.property.count({ where: { status: "ACTIVE", routeId: null } }),
      prisma.customerAccount.count({
        where: {
          accountStatus: { in: ["ACTIVE", "PENDING", "SUSPENDED"] },
          routeId: null,
        },
      }),
    ]);
  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? "APPLIED" : "DRY RUN",
        maximumAccountsPerRoute: requestedSize,
        activeProperties: properties.length,
        serviceAreaGroups: groups.size,
        routesPlanned: plan.length,
        propertiesWithoutServiceArea: noServiceArea.reduce(
          (total, route) => total + route.propertyIds.length,
          0,
        ),
        destination: {
          generatedRoutes,
          activePropertiesWithoutRoute,
          eligibleAccountsWithoutRoute,
        },
        byZone: [...byZone.values()],
        sampleRoutes: plan.slice(0, 10).map((route) => ({
          code: route.code,
          name: route.name,
          properties: route.propertyIds.length,
          accounts: route.accountIds.length,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
