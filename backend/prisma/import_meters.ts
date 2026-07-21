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
  "07_meters.csv",
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

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

function normalizeTechnology(value: string) {
  const technology = value.trim().toUpperCase();
  return technology === "MECHANICAL" ? "MANUAL" : technology;
}

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`Meter CSV was not found: ${source}`);
  }

  const [headers, ...records] = parseCsv(fs.readFileSync(source, "utf8"));
  const index = new Map(headers.map((header, position) => [header.trim(), position]));
  const cell = (record: string[], column: string) =>
    record[index.get(column) ?? -1]?.trim() ?? "";

  const allowedMeterTypes = new Set(["CUSTOMER", "BULK", "ZONE", "BOREHOLE"]);
  const allowedTechnologies = new Set(["MANUAL", "PREPAID", "SMART"]);
  const allowedStatuses = new Set([
    "IN_STOCK",
    "ACTIVE",
    "FAULTY",
    "INACTIVE",
    "REMOVED",
    "REPLACED",
    "DISCONNECTED",
    "TAMPERED",
  ]);
  const allowedInstallationStatuses = new Set(["IN_STORE", "INSTALLED", "REMOVED"]);

  const existingMeters = await prisma.meter.findMany({
    select: {
      meterId: true,
      meterNumber: true,
      meterType: true,
      technology: true,
      brand: true,
      model: true,
      meterSizeMm: true,
      serialNumber: true,
      installationDate: true,
      installationStatus: true,
      openingReading: true,
      status: true,
    },
  });
  const existingByNumber = new Map(
    existingMeters.map((meter) => [meter.meterNumber, meter]),
  );

  const invalid: string[] = [];
  const seenMeterNumbers = new Set<string>();
  const seenSerialNumbers = new Set<string>();
  let legacyEmptyInstallationDates = 0;
  const sourceTechnologies = new Map<string, number>();

  const data = records.map((record, position) => {
    const meterNumber = cell(record, "meter_number");
    const meterType = cell(record, "meter_type").toUpperCase();
    const rawTechnology = cell(record, "technology").toUpperCase();
    const technology = normalizeTechnology(rawTechnology);
    const serialNumber = optional(cell(record, "serial_number"));
    const installationValue = cell(record, "installation_date");
    const installationDate = optionalDate(installationValue);
    const installationStatus =
      cell(record, "installation_status").toUpperCase() || "IN_STORE";
    const status = cell(record, "status").toUpperCase() || "IN_STOCK";
    const meterSizeMm = cell(record, "meter_size_mm");
    const openingReading = cell(record, "opening_reading") || "0";

    sourceTechnologies.set(
      rawTechnology,
      (sourceTechnologies.get(rawTechnology) ?? 0) + 1,
    );

    const issues: string[] = [];
    if (!meterNumber) issues.push("missing meter number");
    if (seenMeterNumbers.has(meterNumber)) issues.push("duplicate meter number");
    if (!allowedMeterTypes.has(meterType)) issues.push(`unsupported type ${meterType}`);
    if (!allowedTechnologies.has(technology)) {
      issues.push(`unsupported technology ${rawTechnology}`);
    }
    if (!allowedStatuses.has(status)) issues.push(`unsupported status ${status}`);
    if (!allowedInstallationStatuses.has(installationStatus)) {
      issues.push(`unsupported installation status ${installationStatus}`);
    }
    if (!meterSizeMm || !Number.isFinite(Number(meterSizeMm)) || Number(meterSizeMm) <= 0) {
      issues.push(`invalid size ${meterSizeMm || "blank"}`);
    }
    if (!Number.isFinite(Number(openingReading)) || Number(openingReading) < 0) {
      issues.push(`invalid opening reading ${openingReading}`);
    }
    if (serialNumber && seenSerialNumbers.has(serialNumber)) {
      issues.push(`duplicate serial number ${serialNumber}`);
    }
    if (installationValue && isLegacyEmptyDate(installationValue)) {
      legacyEmptyInstallationDates += 1;
    } else if (installationValue && !installationDate) {
      issues.push(`invalid installation date ${installationValue}`);
    }

    seenMeterNumbers.add(meterNumber);
    if (serialNumber) seenSerialNumbers.add(serialNumber);
    if (issues.length > 0) {
      invalid.push(`row ${position + 2} (${meterNumber || "unknown"}): ${issues.join(", ")}`);
    }

    return {
      meterNumber,
      meterType,
      technology,
      brand: optional(cell(record, "brand")),
      model: optional(cell(record, "model")),
      meterSizeMm,
      serialNumber,
      installationDate,
      installationStatus,
      openingReading,
      status,
    };
  });

  if (invalid.length > 0) {
    throw new Error(
      `Import stopped: ${invalid.length} invalid meter row(s).\n${invalid
        .slice(0, 25)
        .join("\n")}`,
    );
  }

  // Keep the identity sequence correct after manual DBeaver imports.
  await prisma.$queryRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"aquaflow"."meters"', 'meter_id'),
      COALESCE((SELECT MAX(meter_id) FROM aquaflow.meters), 0) + 1,
      false
    )
  `);

  const missing = data.filter((meter) => !existingByNumber.has(meter.meterNumber));
  let inserted = 0;
  for (let offset = 0; offset < missing.length; offset += 500) {
    const result = await prisma.meter.createMany({
      data: missing.slice(offset, offset + 500),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  const changed = data.filter((meter) => {
    const existing = existingByNumber.get(meter.meterNumber);
    if (!existing) return false;
    return (
      existing.meterType !== meter.meterType ||
      existing.technology !== meter.technology ||
      existing.brand !== meter.brand ||
      existing.model !== meter.model ||
      Number(existing.meterSizeMm) !== Number(meter.meterSizeMm) ||
      existing.serialNumber !== meter.serialNumber ||
      dateKey(existing.installationDate) !== dateKey(meter.installationDate) ||
      existing.installationStatus !== meter.installationStatus ||
      Number(existing.openingReading) !== Number(meter.openingReading) ||
      existing.status !== meter.status
    );
  });

  let updated = 0;
  for (let offset = 0; offset < changed.length; offset += 100) {
    const batch = changed.slice(offset, offset + 100);
    await prisma.$transaction(
      batch.map((meter) =>
        prisma.meter.update({
          where: { meterNumber: meter.meterNumber },
          data: {
            meterType: meter.meterType,
            technology: meter.technology,
            brand: meter.brand,
            model: meter.model,
            meterSizeMm: meter.meterSizeMm,
            serialNumber: meter.serialNumber,
            installationDate: meter.installationDate,
            installationStatus: meter.installationStatus,
            openingReading: meter.openingReading,
            status: meter.status,
            updatedAt: new Date(),
          },
        }),
      ),
    );
    updated += batch.length;
  }

  const [statusSummary, installationSummary, technologySummary] = await Promise.all([
    prisma.meter.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    prisma.meter.groupBy({
      by: ["installationStatus"],
      _count: { _all: true },
      orderBy: { installationStatus: "asc" },
    }),
    prisma.meter.groupBy({
      by: ["technology"],
      _count: { _all: true },
      orderBy: { technology: "asc" },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        source: path.basename(source),
        sourceRows: records.length,
        inserted,
        updated,
        unchangedExisting: existingMeters.length - updated,
        destinationTotal: await prisma.meter.count(),
        status: Object.fromEntries(
          statusSummary.map((row) => [row.status, row._count._all]),
        ),
        installationStatus: Object.fromEntries(
          installationSummary.map((row) => [
            row.installationStatus,
            row._count._all,
          ]),
        ),
        technology: Object.fromEntries(
          technologySummary.map((row) => [row.technology, row._count._all]),
        ),
        sourceTechnologies: Object.fromEntries(sourceTechnologies),
        normalizedTechnologies: { MECHANICAL: "MANUAL" },
        legacyEmptyInstallationDatesStoredAsNull:
          legacyEmptyInstallationDates,
        blankSerialNumbers: data.filter((meter) => meter.serialNumber === null)
          .length,
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
