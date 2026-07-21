import { PrismaClient } from "@prisma/client";
import {
  csvTable,
  optional,
  requiredDate,
  resolveStagingSource,
  sameDate,
} from "./import_legacy_common";

const prisma = new PrismaClient();
const source = resolveStagingSource("09_reading_cycles.csv", process.argv[2]);

async function main() {
  const table = csvTable(source);
  const supportedStatuses = new Set(["PLANNED", "OPEN", "CLOSED", "CANCELLED"]);
  const seen = new Set<string>();

  const data = table.records.map((record, position) => {
    const cycleCode = table.cell(record, "cycle_code");
    const sourceStatus = table.cell(record, "status").toUpperCase();
    const status = sourceStatus === "COMPLETED" ? "CLOSED" : sourceStatus;
    const startDate = requiredDate(
      table.cell(record, "start_date"),
      `start date on row ${position + 2}`,
      true,
    );
    const endDate = requiredDate(
      table.cell(record, "end_date"),
      `end date on row ${position + 2}`,
      true,
    );

    if (!cycleCode) throw new Error(`Blank cycle code on row ${position + 2}`);
    if (seen.has(cycleCode)) throw new Error(`Duplicate cycle code: ${cycleCode}`);
    if (!supportedStatuses.has(status)) {
      throw new Error(`Unsupported reading-cycle status "${sourceStatus}"`);
    }
    if (endDate < startDate) {
      throw new Error(`Cycle ${cycleCode} ends before it starts`);
    }
    seen.add(cycleCode);

    return {
      cycleCode,
      cycleName: table.cell(record, "cycle_name"),
      startDate,
      endDate,
      status,
      remarks: optional(table.cell(record, "remarks")),
    };
  });

  const existing = await prisma.readingCycle.findMany({
    where: { cycleCode: { in: data.map((row) => row.cycleCode) } },
  });
  const existingByCode = new Map(existing.map((row) => [row.cycleCode, row]));
  let created = 0;
  let updated = 0;

  for (const row of data) {
    const current = existingByCode.get(row.cycleCode);
    if (!current) {
      await prisma.readingCycle.create({ data: row });
      created += 1;
      continue;
    }
    const changed =
      current.cycleName !== row.cycleName ||
      !sameDate(current.startDate, row.startDate) ||
      !sameDate(current.endDate, row.endDate) ||
      current.status !== row.status ||
      current.remarks !== row.remarks;
    if (changed) {
      await prisma.readingCycle.update({
        where: { readingCycleId: current.readingCycleId },
        data: row,
      });
      updated += 1;
    }
  }

  console.log({
    source,
    sourceRows: data.length,
    created,
    updated,
    unchanged: data.length - created - updated,
    statusMapping: "COMPLETED -> CLOSED",
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
