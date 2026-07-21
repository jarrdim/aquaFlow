import { PrismaClient } from "@prisma/client";
import {
  batches,
  csvTable,
  requiredDate,
  requiredDecimal,
  resolveStagingSource,
  sameDate,
} from "./import_legacy_common";

const prisma = new PrismaClient();
const source = resolveStagingSource(
  "10_meter_readings_snapshot.csv",
  process.argv[2],
);
const legacySnapshotCycleCode =
  process.env.LEGACY_READING_CYCLE_CODE?.trim() || "RC-2026-06";

async function main() {
  const table = csvTable(source);
  const [meters, accounts, cycles, existing] = await Promise.all([
    prisma.meter.findMany({ select: { meterId: true, meterNumber: true } }),
    prisma.customerAccount.findMany({
      select: { accountId: true, accountNumber: true },
    }),
    prisma.readingCycle.findMany({
      select: { readingCycleId: true, cycleCode: true },
    }),
    prisma.meterReading.findMany({
      select: {
        readingId: true,
        meterId: true,
        accountId: true,
        readingCycleId: true,
        previousReading: true,
        currentReading: true,
        readingType: true,
        readingDate: true,
        abnormalFlag: true,
        exceptionType: true,
        approvalStatus: true,
      },
    }),
  ]);

  const meterByNumber = new Map(meters.map((row) => [row.meterNumber, row]));
  const accountByNumber = new Map(accounts.map((row) => [row.accountNumber, row]));
  const cycleByCode = new Map(cycles.map((row) => [row.cycleCode, row]));
  const existingByKey = new Map(
    existing.map((row) => [`${row.meterId}:${row.readingCycleId}`, row]),
  );
  const supportedTypes = new Set(["ACTUAL", "ESTIMATED", "SMART"]);
  const supportedApprovals = new Set(["PENDING", "APPROVED", "REJECTED"]);
  const seen = new Set<string>();
  const errors: string[] = [];
  let abnormalNegative = 0;

  const data = table.records.map((record, position) => {
    const rowNumber = position + 2;
    const meterNumber = table.cell(record, "meter_number");
    const accountNumber = table.cell(record, "account_number");
    const sourceCycleCode = table.cell(record, "cycle_code");
    const cycleCode =
      sourceCycleCode === "LEGACY-SNAPSHOT"
        ? legacySnapshotCycleCode
        : sourceCycleCode;
    const meter = meterByNumber.get(meterNumber);
    const account = accountByNumber.get(accountNumber);
    const cycle = cycleByCode.get(cycleCode);
    const previousReading = requiredDecimal(
      table.cell(record, "previous_reading"),
      `previous reading on row ${rowNumber}`,
    );
    const currentReading = requiredDecimal(
      table.cell(record, "current_reading"),
      `current reading on row ${rowNumber}`,
    );
    const readingType = table.cell(record, "reading_type").toUpperCase();
    const approvalStatus = table.cell(record, "approval_status").toUpperCase();
    const issues: string[] = [];

    if (!meter) issues.push(`meter ${meterNumber || "blank"} was not imported`);
    if (!account) issues.push(`account ${accountNumber || "blank"} was not imported`);
    if (!cycle) issues.push(`cycle ${cycleCode || "blank"} was not imported`);
    if (previousReading < 0 || currentReading < 0) {
      issues.push("reading values must not be negative");
    }
    if (!supportedTypes.has(readingType)) {
      issues.push(`unsupported reading type ${readingType}`);
    }
    if (!supportedApprovals.has(approvalStatus)) {
      issues.push(`unsupported approval status ${approvalStatus}`);
    }

    const key = meter && cycle ? `${meter.meterId}:${cycle.readingCycleId}` : "";
    if (key && seen.has(key)) issues.push("duplicate meter/cycle reading");
    if (key) seen.add(key);
    if (issues.length) errors.push(`row ${rowNumber}: ${issues.join(", ")}`);

    const isNegative = currentReading < previousReading;
    if (isNegative) abnormalNegative += 1;
    return {
      meterId: meter!.meterId,
      accountId: account!.accountId,
      readingCycleId: cycle!.readingCycleId,
      previousReading,
      currentReading,
      readingType,
      readingDate: requiredDate(
        table.cell(record, "reading_date"),
        `reading date on row ${rowNumber}`,
      ),
      abnormalFlag: isNegative,
      exceptionType: isNegative ? "NEGATIVE" : "NONE",
      approvalStatus,
    };
  });

  if (errors.length) {
    throw new Error(
      `Import stopped: ${errors.length} invalid reading row(s).\n${errors
        .slice(0, 30)
        .join("\n")}`,
    );
  }

  const inserts = data.filter(
    (row) => !existingByKey.has(`${row.meterId}:${row.readingCycleId}`),
  );
  let created = 0;
  for (const batch of batches(inserts)) {
    const result = await prisma.meterReading.createMany({
      data: batch,
      skipDuplicates: true,
    });
    created += result.count;
  }

  const updates = data.filter((row) => {
    const current = existingByKey.get(`${row.meterId}:${row.readingCycleId}`);
    return (
      current &&
      (current.accountId !== row.accountId ||
        Number(current.previousReading) !== row.previousReading ||
        Number(current.currentReading) !== row.currentReading ||
        current.readingType !== row.readingType ||
        !sameDate(current.readingDate, row.readingDate) ||
        current.abnormalFlag !== row.abnormalFlag ||
        current.exceptionType !== row.exceptionType ||
        current.approvalStatus !== row.approvalStatus)
    );
  });

  for (const batch of batches(updates, 100)) {
    await prisma.$transaction(
      batch.map((row) =>
        prisma.meterReading.update({
          where: {
            readingId: existingByKey.get(
              `${row.meterId}:${row.readingCycleId}`,
            )!.readingId,
          },
          data: row,
        }),
      ),
    );
  }

  await prisma.$queryRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"aquaflow"."meter_readings"', 'reading_id'),
      COALESCE((SELECT MAX(reading_id) FROM aquaflow.meter_readings), 0) + 1,
      false
    )
  `);

  console.log({
    source,
    sourceRows: data.length,
    created,
    updated: updates.length,
    unchanged: data.length - created - updates.length,
    abnormalNegative,
    legacySnapshotCycleCode,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
