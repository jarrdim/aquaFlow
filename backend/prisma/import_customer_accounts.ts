import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const defaultSource = path.resolve(
  process.cwd(),
  "..",
  "..",
  "aquaflow_migration_package",
  "aquaflow_staging",
  "06_customer_accounts.csv",
);
const source = path.resolve(process.argv[2] ?? defaultSource);

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function optionalDate(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isLegacyEmptyDate(value: string) {
  return /^\(empty dat/i.test(value.trim());
}

function dateKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function normalizeStatus(sourceStatus: string) {
  const status = sourceStatus.trim().toUpperCase();
  if (status === "CONNECTED") return "ACTIVE";
  if (status === "VACATED") return "CLOSED";
  return status || "PENDING";
}

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`Customer-account CSV was not found: ${source}`);
  }

  const [headers, ...records] = parseCsv(fs.readFileSync(source, "utf8"));
  const index = new Map(headers.map((header, position) => [header.trim(), position]));
  const cell = (record: string[], column: string) =>
    record[index.get(column) ?? -1]?.trim() ?? "";

  const [properties, categories, routes, existingAccounts] = await Promise.all([
    prisma.property.findMany({
      select: {
        propertyId: true,
        propertyCode: true,
        ownerCustomerId: true,
      },
    }),
    prisma.customerCategory.findMany({
      select: { categoryId: true, categoryCode: true },
    }),
    prisma.route.findMany({
      select: { routeId: true, routeCode: true },
    }),
    prisma.customerAccount.findMany({
      select: {
        accountId: true,
        accountNumber: true,
        customerId: true,
        propertyId: true,
        categoryId: true,
        routeId: true,
        openingBalance: true,
        currentBalance: true,
        connectionDate: true,
        accountStatus: true,
        closureDate: true,
      },
    }),
  ]);

  const propertiesByCode = new Map(
    properties.map((property) => [property.propertyCode, property]),
  );
  const categoriesByCode = new Map(
    categories.map((category) => [category.categoryCode, category.categoryId]),
  );
  const routesByCode = new Map(routes.map((route) => [route.routeCode, route.routeId]));
  const existingByNumber = new Map(
    existingAccounts.map((account) => [account.accountNumber, account]),
  );

  const unresolved: string[] = [];
  const malformedConnectionDates: string[] = [];
  const malformedClosureDates: string[] = [];
  let legacyEmptyConnectionDates = 0;
  let legacyEmptyClosureDates = 0;
  const preConnectionClosureDates: string[] = [];
  const sourceStatuses = new Map<string, number>();

  const data = records.map((record, position) => {
    const accountNumber = cell(record, "account_number");
    const propertyCode = cell(record, "property_code");
    const categoryCode = cell(record, "category_code");
    const routeCode = cell(record, "route_code");
    const property = propertiesByCode.get(propertyCode);
    const categoryId = categoriesByCode.get(categoryCode);
    const routeId = routeCode ? routesByCode.get(routeCode) : null;
    const connectionValue = cell(record, "connection_date");
    const closureValue = cell(record, "closure_date");
    const connectionDate = optionalDate(connectionValue);
    const parsedClosureDate = optionalDate(closureValue);
    const closureDate =
      connectionDate &&
      parsedClosureDate &&
      parsedClosureDate < connectionDate
        ? null
        : parsedClosureDate;
    const rawStatus = cell(record, "account_status").toUpperCase() || "PENDING";
    const accountStatus = normalizeStatus(rawStatus);

    sourceStatuses.set(rawStatus, (sourceStatuses.get(rawStatus) ?? 0) + 1);
    if (connectionValue && isLegacyEmptyDate(connectionValue)) {
      legacyEmptyConnectionDates += 1;
    } else if (connectionValue && !connectionDate) {
      malformedConnectionDates.push(`${accountNumber}: ${connectionValue}`);
    }
    if (closureValue && isLegacyEmptyDate(closureValue)) {
      legacyEmptyClosureDates += 1;
    } else if (closureValue && !parsedClosureDate) {
      malformedClosureDates.push(`${accountNumber}: ${closureValue}`);
    }
    if (connectionDate && parsedClosureDate && parsedClosureDate < connectionDate) {
      preConnectionClosureDates.push(
        `${accountNumber}: connection ${connectionValue}, closure ${closureValue}`,
      );
    }
    if (
      !accountNumber ||
      !property ||
      !property.ownerCustomerId ||
      !categoryId ||
      (routeCode && !routeId)
    ) {
      unresolved.push(
        `row ${position + 2}: account=${accountNumber || "missing"}, property=${propertyCode}, category=${categoryCode}, route=${routeCode || "blank"}`,
      );
    }

    return {
      accountNumber,
      customerId: property!.ownerCustomerId!,
      propertyId: property!.propertyId,
      categoryId: categoryId!,
      routeId: routeId ?? null,
      openingBalance: cell(record, "opening_balance") || "0",
      currentBalance: cell(record, "current_balance") || "0",
      connectionDate,
      accountStatus,
      closureDate,
    };
  });

  if (unresolved.length > 0) {
    throw new Error(
      `Import stopped: ${unresolved.length} unresolved reference(s).\n${unresolved
        .slice(0, 25)
        .join("\n")}`,
    );
  }
  if (malformedConnectionDates.length > 0 || malformedClosureDates.length > 0) {
    throw new Error(
      `Import stopped: ${malformedConnectionDates.length} malformed connection date(s) and ${malformedClosureDates.length} malformed closure date(s).\n${[
        ...malformedConnectionDates,
        ...malformedClosureDates,
      ]
        .slice(0, 25)
        .join("\n")}`,
    );
  }

  // DBeaver imports with explicit IDs do not automatically advance this sequence.
  await prisma.$queryRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"aquaflow"."customer_accounts"', 'account_id'),
      COALESCE((SELECT MAX(account_id) FROM aquaflow.customer_accounts), 0) + 1,
      false
    )
  `);

  const missing = data.filter((account) => !existingByNumber.has(account.accountNumber));
  let inserted = 0;
  for (let offset = 0; offset < missing.length; offset += 500) {
    const result = await prisma.customerAccount.createMany({
      data: missing.slice(offset, offset + 500),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  const changed = data.filter((account) => {
    const existing = existingByNumber.get(account.accountNumber);
    if (!existing) return false;
    return (
      existing.customerId !== account.customerId ||
      existing.propertyId !== account.propertyId ||
      existing.categoryId !== account.categoryId ||
      existing.routeId !== account.routeId ||
      Number(existing.openingBalance) !== Number(account.openingBalance) ||
      Number(existing.currentBalance) !== Number(account.currentBalance) ||
      dateKey(existing.connectionDate) !== dateKey(account.connectionDate) ||
      existing.accountStatus !== account.accountStatus ||
      dateKey(existing.closureDate) !== dateKey(account.closureDate)
    );
  });

  let updated = 0;
  for (let offset = 0; offset < changed.length; offset += 100) {
    const batch = changed.slice(offset, offset + 100);
    await prisma.$transaction(
      batch.map((account) =>
        prisma.customerAccount.update({
          where: { accountNumber: account.accountNumber },
          data: {
            customerId: account.customerId,
            propertyId: account.propertyId,
            categoryId: account.categoryId,
            routeId: account.routeId,
            openingBalance: account.openingBalance,
            currentBalance: account.currentBalance,
            connectionDate: account.connectionDate,
            accountStatus: account.accountStatus,
            closureDate: account.closureDate,
            updatedAt: new Date(),
          },
        }),
      ),
    );
    updated += batch.length;
  }

  const statusSummary = await prisma.customerAccount.groupBy({
    by: ["accountStatus"],
    _count: { _all: true },
    orderBy: { accountStatus: "asc" },
  });

  console.log(
    JSON.stringify(
      {
        source: path.basename(source),
        sourceRows: records.length,
        inserted,
        updated,
        unchangedExisting: existingAccounts.length - updated,
        destinationTotal: await prisma.customerAccount.count(),
        sourceStatuses: Object.fromEntries(sourceStatuses),
        destinationStatuses: Object.fromEntries(
          statusSummary.map((row) => [row.accountStatus, row._count._all]),
        ),
        normalizedStatuses: {
          CONNECTED: "ACTIVE",
          VACATED: "CLOSED",
        },
        legacyEmptyDatesStoredAsNull: {
          connectionDate: legacyEmptyConnectionDates,
          closureDate: legacyEmptyClosureDates,
        },
        preConnectionClosureDatesStoredAsNull: {
          count: preConnectionClosureDates.length,
          sample: preConnectionClosureDates.slice(0, 10),
        },
        routesLeftBlank: data.filter((account) => account.routeId === null).length,
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
