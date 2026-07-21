import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
const output = resolve(
  outputArgument?.slice("--output=".length) ||
    "prisma/audits/meter_reading_cycle_reassignment.csv",
);

type CycleRow = {
  reading_cycle_id: bigint;
  cycle_code: string;
  start_date: Date;
  end_date: Date;
};

type ChangeRow = {
  reading_id: bigint;
  old_reading_cycle_id: bigint | null;
  new_reading_cycle_id: bigint | null;
  reading_date: Date;
  old_exception_type: string;
  new_exception_type: string;
};

const expectedCycles = {
  "RC-2026-06": {
    id: 1n,
    start: "2026-05-26",
    end: "2026-06-25",
  },
  "RC-2026-07": {
    id: 3n,
    start: "2026-06-26",
    end: "2026-07-25",
  },
} as const;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function csv(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function loadAndValidateCycles() {
  const cycles = await prisma.$queryRaw<CycleRow[]>`
    SELECT reading_cycle_id, cycle_code, start_date, end_date
    FROM aquaflow.reading_cycles
    WHERE cycle_code IN ('RC-2026-06', 'RC-2026-07')
    ORDER BY start_date
  `;
  if (cycles.length !== 2) {
    throw new Error(
      "Expected both RC-2026-06 and RC-2026-07 in aquaflow.reading_cycles.",
    );
  }
  const byCode = new Map(cycles.map((cycle) => [cycle.cycle_code, cycle]));
  for (const [code, expected] of Object.entries(expectedCycles)) {
    const actual = byCode.get(code);
    if (!actual) throw new Error(`Reading cycle ${code} does not exist.`);
    if (
      actual.reading_cycle_id !== expected.id ||
      dateOnly(actual.start_date) !== expected.start ||
      dateOnly(actual.end_date) !== expected.end
    ) {
      throw new Error(
        `${code} does not match the approved mapping. Expected ID ${expected.id}, ` +
          `${expected.start} to ${expected.end}; found ID ${actual.reading_cycle_id}, ` +
          `${dateOnly(actual.start_date)} to ${dateOnly(actual.end_date)}.`,
      );
    }
  }
  return {
    june: byCode.get("RC-2026-06")!,
    july: byCode.get("RC-2026-07")!,
  };
}

async function previewChanges(june: CycleRow, july: CycleRow) {
  return prisma.$queryRaw<ChangeRow[]>(Prisma.sql`
    WITH proposed AS (
      SELECT
        reading_id,
        reading_cycle_id AS old_reading_cycle_id,
        reading_date,
        exception_type AS old_exception_type,
        CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date
            THEN ${june.reading_cycle_id}::bigint
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date
            THEN ${july.reading_cycle_id}::bigint
          ELSE NULL
        END AS new_reading_cycle_id,
        CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date THEN exception_type
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date THEN exception_type
          ELSE 'STALE_READING'
        END AS new_exception_type
      FROM aquaflow.meter_readings
    )
    SELECT
      reading_id,
      old_reading_cycle_id,
      new_reading_cycle_id,
      reading_date,
      old_exception_type,
      new_exception_type
    FROM proposed
    WHERE old_reading_cycle_id IS DISTINCT FROM new_reading_cycle_id
       OR old_exception_type IS DISTINCT FROM new_exception_type
    ORDER BY reading_date, reading_id
  `);
}

function writeAudit(rows: ChangeRow[]) {
  mkdirSync(dirname(output), { recursive: true });
  const lines = [
    [
      "reading_id",
      "old_reading_cycle_id",
      "new_reading_cycle_id",
      "reading_date",
      "old_exception_type",
      "new_exception_type",
    ].join(","),
    ...rows.map((row) =>
      [
        row.reading_id,
        row.old_reading_cycle_id,
        row.new_reading_cycle_id,
        row.reading_date.toISOString(),
        row.old_exception_type,
        row.new_exception_type,
      ]
        .map(csv)
        .join(","),
    ),
  ];
  writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const { june, july } = await loadAndValidateCycles();
  const changes = await previewChanges(june, july);
  writeAudit(changes);

  const summary = {
    mode: apply ? "APPLY" : "DRY_RUN",
    auditFile: output,
    changedRows: changes.length,
    assignedToRc202606: changes.filter(
      (row) => row.new_reading_cycle_id === june.reading_cycle_id,
    ).length,
    assignedToRc202607: changes.filter(
      (row) => row.new_reading_cycle_id === july.reading_cycle_id,
    ).length,
    setToNullAndStale: changes.filter(
      (row) =>
        row.new_reading_cycle_id === null &&
        row.new_exception_type === "STALE_READING",
    ).length,
  };
  console.log(summary);

  if (!apply) {
    console.log(
      "No database rows were changed. Review the CSV, apply the Prisma migration, then rerun with --apply.",
    );
    return;
  }

  const nullable = await prisma.$queryRaw<{ nullable: string }[]>`
    SELECT is_nullable AS nullable
    FROM information_schema.columns
    WHERE table_schema = 'aquaflow'
      AND table_name = 'meter_readings'
      AND column_name = 'reading_cycle_id'
  `;
  if (nullable[0]?.nullable !== "YES") {
    throw new Error(
      "reading_cycle_id is still NOT NULL. Run `npx prisma migrate deploy` before using --apply.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    return tx.$executeRaw(Prisma.sql`
      UPDATE aquaflow.meter_readings
      SET
        reading_cycle_id = CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date
            THEN ${june.reading_cycle_id}::bigint
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date
            THEN ${july.reading_cycle_id}::bigint
          ELSE NULL
        END,
        exception_type = CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date THEN exception_type
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date THEN exception_type
          ELSE 'STALE_READING'
        END,
        abnormal_flag = CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date THEN abnormal_flag
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date THEN abnormal_flag
          ELSE TRUE
        END,
        updated_at = NOW()
      WHERE reading_cycle_id IS DISTINCT FROM CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date
            THEN ${june.reading_cycle_id}::bigint
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date
            THEN ${july.reading_cycle_id}::bigint
          ELSE NULL
        END
        OR exception_type IS DISTINCT FROM CASE
          WHEN reading_date::date BETWEEN ${dateOnly(june.start_date)}::date
            AND ${dateOnly(june.end_date)}::date THEN exception_type
          WHEN reading_date::date BETWEEN ${dateOnly(july.start_date)}::date
            AND ${dateOnly(july.end_date)}::date THEN exception_type
          ELSE 'STALE_READING'
        END
    `);
  });
  if (updated !== changes.length) {
    throw new Error(
      `Audit contained ${changes.length} changes, but the transaction updated ${updated}. Review concurrent database activity.`,
    );
  }
  console.log(`Committed ${updated} audited meter-reading reassignment(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
