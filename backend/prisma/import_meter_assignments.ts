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
  "08_meter_assignments.csv",
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

function table(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required migration file was not found: ${filePath}`);
  }
  const [headers, ...records] = parseCsv(fs.readFileSync(filePath, "utf8"));
  const index = new Map(headers.map((header, position) => [header.trim(), position]));
  const cell = (record: string[], column: string) =>
    record[index.get(column) ?? -1]?.trim() ?? "";
  return { records, cell };
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function optionalDate(value: string) {
  const datePart = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isLegacyEmptyDate(value: string) {
  return /^\(empty dat/i.test(value.trim());
}

function dateKey(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

async function main() {
  const assignmentTable = table(source);
  const stagingDirectory = path.dirname(source);
  const accountTable = table(path.join(stagingDirectory, "06_customer_accounts.csv"));
  const propertyTable = table(path.join(stagingDirectory, "05_properties.csv"));
  const readingTable = table(
    path.join(stagingDirectory, "10_meter_readings_snapshot.csv"),
  );

  const propertyCodeByAccount = new Map(
    accountTable.records.map((record) => [
      accountTable.cell(record, "account_number"),
      accountTable.cell(record, "property_code"),
    ]),
  );
  const sourceZoneByProperty = new Map(
    propertyTable.records.map((record) => [
      propertyTable.cell(record, "property_code"),
      propertyTable.cell(record, "zone_code"),
    ]),
  );
  const snapshotDateByMeter = new Map(
    readingTable.records
      .map(
        (record) =>
          [
            readingTable.cell(record, "meter_number"),
            optionalDate(readingTable.cell(record, "reading_date")),
          ] as const,
      )
      .filter((entry): entry is readonly [string, Date] => Boolean(entry[0] && entry[1])),
  );

  const [meters, accounts, existingAssignments] = await Promise.all([
    prisma.meter.findMany({
      select: { meterId: true, meterNumber: true },
    }),
    prisma.customerAccount.findMany({
      select: {
        accountId: true,
        accountNumber: true,
        property: { select: { zoneId: true } },
      },
    }),
    prisma.meterAssignment.findMany({
      select: {
        assignmentId: true,
        meterId: true,
        accountId: true,
        zoneId: true,
        boreholeId: true,
        assetId: true,
        assignmentDate: true,
        assignmentStatus: true,
        installationPoint: true,
        installationStatus: true,
      },
    }),
  ]);

  const metersByNumber = new Map(meters.map((meter) => [meter.meterNumber, meter]));
  const accountsByNumber = new Map(
    accounts.map((account) => [account.accountNumber, account]),
  );
  const activeByMeterId = new Map(
    existingAssignments
      .filter((assignment) => assignment.assignmentStatus === "ACTIVE")
      .map((assignment) => [assignment.meterId, assignment]),
  );
  const activeByAccountId = new Map(
    existingAssignments
      .filter(
        (assignment) =>
          assignment.assignmentStatus === "ACTIVE" && assignment.accountId,
      )
      .map((assignment) => [assignment.accountId!, assignment]),
  );

  const invalid: string[] = [];
  const seenMeterIds = new Set<bigint>();
  const seenAccountIds = new Set<bigint>();
  const fallbackAssignmentDates: string[] = [];

  const data = assignmentTable.records.map((record, position) => {
    const meterNumber = assignmentTable.cell(record, "meter_number");
    const accountNumber = assignmentTable.cell(record, "account_number");
    const sourceZoneCode = assignmentTable.cell(record, "zone_code");
    const boreholeCode = assignmentTable.cell(record, "borehole_code");
    const rawAssignmentDate = assignmentTable.cell(record, "assignment_date");
    const meter = metersByNumber.get(meterNumber);
    const account = accountsByNumber.get(accountNumber);
    const assignmentStatus =
      assignmentTable.cell(record, "assignment_status").toUpperCase() || "ACTIVE";
    const installationStatus =
      assignmentTable.cell(record, "installation_status").toUpperCase() ||
      "COMPLETED";
    const directAssignmentDate = optionalDate(rawAssignmentDate);
    const assignmentDate =
      directAssignmentDate ?? snapshotDateByMeter.get(meterNumber) ?? null;
    const propertyCode = propertyCodeByAccount.get(accountNumber);
    const expectedSourceZone = propertyCode
      ? sourceZoneByProperty.get(propertyCode)
      : undefined;

    const issues: string[] = [];
    if (!meter) issues.push(`meter ${meterNumber || "blank"} was not imported`);
    if (!account) issues.push(`account ${accountNumber || "blank"} was not imported`);
    if (boreholeCode) issues.push(`unexpected borehole target ${boreholeCode}`);
    if (!["ACTIVE", "ENDED"].includes(assignmentStatus)) {
      issues.push(`unsupported assignment status ${assignmentStatus}`);
    }
    if (!assignmentDate) {
      issues.push(`no valid assignment or snapshot date for ${rawAssignmentDate}`);
    }
    if (
      sourceZoneCode &&
      expectedSourceZone &&
      sourceZoneCode !== expectedSourceZone
    ) {
      issues.push(
        `source zone ${sourceZoneCode} differs from property zone ${expectedSourceZone}`,
      );
    }
    if (meter && seenMeterIds.has(meter.meterId) && assignmentStatus === "ACTIVE") {
      issues.push("duplicate active assignment for meter");
    }
    if (
      account &&
      seenAccountIds.has(account.accountId) &&
      assignmentStatus === "ACTIVE"
    ) {
      issues.push("duplicate active assignment for account");
    }

    if (
      !directAssignmentDate &&
      isLegacyEmptyDate(rawAssignmentDate) &&
      assignmentDate
    ) {
      fallbackAssignmentDates.push(
        `${meterNumber}: ${dateKey(assignmentDate)} from legacy snapshot reading`,
      );
    } else if (rawAssignmentDate && !directAssignmentDate) {
      issues.push(`malformed assignment date ${rawAssignmentDate}`);
    }

    if (meter && assignmentStatus === "ACTIVE") seenMeterIds.add(meter.meterId);
    if (account && assignmentStatus === "ACTIVE") seenAccountIds.add(account.accountId);
    if (issues.length > 0) {
      invalid.push(
        `row ${position + 2} (meter ${meterNumber}, account ${accountNumber}): ${issues.join(", ")}`,
      );
    }

    return {
      meterId: meter!.meterId,
      accountId: account!.accountId,
      zoneId: null,
      boreholeId: null,
      assetId: null,
      assignmentDate: assignmentDate!,
      assignmentStatus,
      installationPoint: optional(
        assignmentTable.cell(record, "installation_point"),
      ),
      installationStatus,
    };
  });

  if (invalid.length > 0) {
    throw new Error(
      `Import stopped: ${invalid.length} invalid assignment row(s).\n${invalid
        .slice(0, 30)
        .join("\n")}`,
    );
  }

  const conflicts: string[] = [];
  for (const assignment of data) {
    const meterConflict = activeByMeterId.get(assignment.meterId);
    if (
      meterConflict &&
      meterConflict.accountId !== assignment.accountId
    ) {
      conflicts.push(
        `meter ${assignment.meterId} is already active on another target`,
      );
    }
    const accountConflict = activeByAccountId.get(assignment.accountId);
    if (
      accountConflict &&
      accountConflict.meterId !== assignment.meterId
    ) {
      conflicts.push(
        `account ${assignment.accountId} already has another active meter`,
      );
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Import stopped: ${conflicts.length} existing active-assignment conflict(s).\n${conflicts
        .slice(0, 30)
        .join("\n")}`,
    );
  }

  await prisma.$queryRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"aquaflow"."meter_assignments"', 'assignment_id'),
      COALESCE((SELECT MAX(assignment_id) FROM aquaflow.meter_assignments), 0) + 1,
      false
    )
  `);

  const missing = data.filter(
    (assignment) => !activeByMeterId.has(assignment.meterId),
  );
  let inserted = 0;
  for (let offset = 0; offset < missing.length; offset += 500) {
    const result = await prisma.meterAssignment.createMany({
      data: missing.slice(offset, offset + 500),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  const changed = data.filter((assignment) => {
    const existing = activeByMeterId.get(assignment.meterId);
    if (!existing) return false;
    return (
      existing.accountId !== assignment.accountId ||
      existing.zoneId !== null ||
      existing.boreholeId !== null ||
      existing.assetId !== null ||
      dateKey(existing.assignmentDate) !== dateKey(assignment.assignmentDate) ||
      existing.assignmentStatus !== assignment.assignmentStatus ||
      existing.installationPoint !== assignment.installationPoint ||
      existing.installationStatus !== assignment.installationStatus
    );
  });

  let updated = 0;
  for (let offset = 0; offset < changed.length; offset += 100) {
    const batch = changed.slice(offset, offset + 100);
    await prisma.$transaction(
      batch.map((assignment) =>
        prisma.meterAssignment.update({
          where: {
            assignmentId: activeByMeterId.get(assignment.meterId)!.assignmentId,
          },
          data: {
            accountId: assignment.accountId,
            zoneId: null,
            boreholeId: null,
            assetId: null,
            assignmentDate: assignment.assignmentDate,
            assignmentStatus: assignment.assignmentStatus,
            installationPoint: assignment.installationPoint,
            installationStatus: assignment.installationStatus,
          },
        }),
      ),
    );
    updated += batch.length;
  }

  const [total, activeCount, accountTargetCount] = await Promise.all([
    prisma.meterAssignment.count(),
    prisma.meterAssignment.count({ where: { assignmentStatus: "ACTIVE" } }),
    prisma.meterAssignment.count({ where: { accountId: { not: null } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        source: path.basename(source),
        sourceRows: assignmentTable.records.length,
        inserted,
        updated,
        unchangedExisting: activeByMeterId.size - updated,
        destinationTotal: total,
        activeAssignments: activeCount,
        accountTargets: accountTargetCount,
        sourceZoneValidation: "all assignment zones match source property zones",
        storedTarget: "account_id only; zone is inherited through account.property",
        fallbackAssignmentDates,
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
