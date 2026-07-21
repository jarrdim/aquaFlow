import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;

type DetailRow = {
  meterId: string;
  meterNumber: string;
  cycleStart: string;
  cycleEnd: string;
  durationDays: number;
  valid: boolean;
  notes: string;
};

function iso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: Date, end: Date) {
  return Math.round(
    (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate(),
      )) /
      DAY_MS,
  );
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function mode(values: number[]) {
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  )[0];
}

function percent(count: number, total: number) {
  return total ? Math.round((count / total) * 10_000) / 100 : 0;
}

async function main() {
  const [cycles, readings] = await Promise.all([
    prisma.readingCycle.findMany({
      orderBy: [{ startDate: "asc" }, { readingCycleId: "asc" }],
      include: { _count: { select: { readings: true } } },
    }),
    prisma.meterReading.findMany({
      orderBy: [
        { meterId: "asc" },
        { readingDate: "asc" },
        { readingId: "asc" },
      ],
      select: {
        readingId: true,
        meterId: true,
        readingDate: true,
        previousReading: true,
        currentReading: true,
        cycle: {
          select: {
            cycleCode: true,
            cycleName: true,
            startDate: true,
            endDate: true,
          },
        },
        meter: { select: { meterNumber: true } },
      },
    }),
  ]);

  const byMeter = new Map<string, typeof readings>();
  for (const reading of readings) {
    const key = reading.meterId.toString();
    const list = byMeter.get(key) ?? [];
    list.push(reading);
    byMeter.set(key, list);
  }

  const details: DetailRow[] = [];
  const inferredIntervals: DetailRow[] = [];
  for (const [meterId, meterReadings] of byMeter) {
    if (meterReadings.length === 1) {
      const reading = meterReadings[0];
      const artifact =
        /LEGACY|SNAPSHOT/i.test(reading.cycle.cycleCode) ||
        /LEGACY|SNAPSHOT/i.test(reading.cycle.cycleName);
      details.push({
        meterId,
        meterNumber: reading.meter.meterNumber,
        cycleStart: iso(reading.cycle.startDate),
        cycleEnd: iso(reading.cycle.endDate),
        durationDays: daysBetween(
          reading.cycle.startDate,
          reading.cycle.endDate,
        ),
        valid: false,
        notes: artifact
          ? `Legacy snapshot metadata; only one observed reading (${iso(reading.readingDate)}). The range is not an empirical meter cycle.`
          : `Only one observed reading (${iso(reading.readingDate)}); consecutive dates are required to infer a cycle.`,
      });
      continue;
    }

    for (let index = 1; index < meterReadings.length; index += 1) {
      const previous = meterReadings[index - 1];
      const current = meterReadings[index];
      const durationDays = daysBetween(previous.readingDate, current.readingDate);
      const legacy =
        /LEGACY|SNAPSHOT/i.test(previous.cycle.cycleCode) ||
        /LEGACY|SNAPSHOT/i.test(current.cycle.cycleCode);
      const placeholder =
        previous.readingDate.getUTCFullYear() < 2000 ||
        current.readingDate.getUTCFullYear() < 2000;
      const unusual = durationDays < 20 || durationDays > 40;
      const notes: string[] = [];
      if (legacy)
        notes.push(
          "Interval touches LEGACY/SNAPSHOT metadata and is not representative of a normal production cycle",
        );
      if (placeholder)
        notes.push("Implausible pre-2000 reading date; likely placeholder");
      if (durationDays <= 0)
        notes.push("Duplicate or non-increasing reading date");
      else if (durationDays < 20)
        notes.push("Unusually short compared with an approximately 30-day cycle");
      else if (durationDays > 40)
        notes.push("Unusually long compared with an approximately 30-day cycle");
      const valid = !legacy && !placeholder && !unusual;
      const row = {
        meterId,
        meterNumber: current.meter.meterNumber,
        cycleStart: iso(previous.readingDate),
        cycleEnd: iso(current.readingDate),
        durationDays,
        valid,
        notes: notes.join("; ") || "Plausible consecutive-reading interval",
      };
      details.push(row);
      inferredIntervals.push(row);
    }
  }

  const validIntervals = inferredIntervals.filter((row) => row.valid);
  const startDays = validIntervals.map((row) =>
    new Date(`${row.cycleStart}T00:00:00Z`).getUTCDate(),
  );
  const endDays = validIntervals.map((row) =>
    new Date(`${row.cycleEnd}T00:00:00Z`).getUTCDate(),
  );
  const startMode = mode(startDays);
  const endMode = mode(endDays);
  const exactStart26 = startDays.filter((day) => day === 26).length;
  const nearStart26 = startDays.filter((day) => day >= 25 && day <= 27).length;
  const exactEnd25 = endDays.filter((day) => day === 25).length;
  const nearEnd25 = endDays.filter((day) => day >= 24 && day <= 26).length;

  const readingDates = readings.map((reading) => reading.readingDate);
  const readingDayCounts = new Map<number, number>();
  readingDates.forEach((value) =>
    readingDayCounts.set(
      value.getUTCDate(),
      (readingDayCounts.get(value.getUTCDate()) ?? 0) + 1,
    ),
  );
  const readingDateCounts = new Map<string, number>();
  readingDates.forEach((value) => {
    const key = iso(value);
    readingDateCounts.set(key, (readingDateCounts.get(key) ?? 0) + 1);
  });
  const topReadingDates = [...readingDateCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15);
  const readingDayMode = mode(readingDates.map((value) => value.getUTCDate()));

  const cycleAudit = cycles.map((cycle) => {
    const durationDays = daysBetween(cycle.startDate, cycle.endDate);
    const legacy =
      /LEGACY|SNAPSHOT/i.test(cycle.cycleCode) ||
      /LEGACY|SNAPSHOT/i.test(cycle.cycleName);
    const placeholder = cycle.startDate.getUTCFullYear() < 2000;
    const unusual = durationDays < 20 || durationDays > 40;
    const notes: string[] = [];
    if (legacy)
      notes.push(
        "LEGACY/SNAPSHOT label indicates migration metadata, not a recurring operational cycle",
      );
    if (placeholder)
      notes.push(
        "Start year before 2000 (1900-style null/default date artifact)",
      );
    if (durationDays < 20) notes.push("Unusually short");
    if (durationDays > 40) notes.push("Unusually long");
    return {
      id: cycle.readingCycleId.toString(),
      code: cycle.cycleCode,
      name: cycle.cycleName,
      start: iso(cycle.startDate),
      end: iso(cycle.endDate),
      durationDays,
      readings: cycle._count.readings,
      valid: !legacy && !placeholder && !unusual,
      notes: notes.join("; ") || "Plausible operational cycle record",
    };
  });

  const docs = path.resolve(__dirname, "../../docs");
  fs.mkdirSync(docs, { recursive: true });
  const csvPath = path.join(docs, "Reading_Cycle_Detailed_Analysis.csv");
  const headers = [
    "Meter ID",
    "Meter Number",
    "Cycle Start",
    "Cycle End",
    "Duration (days)",
    "Valid?",
    "Notes",
  ];
  fs.writeFileSync(
    csvPath,
    [
      headers.join(","),
      ...details.map((row) =>
        [
          row.meterId,
          row.meterNumber,
          row.cycleStart,
          row.cycleEnd,
          row.durationDays,
          row.valid ? "Yes" : "No",
          row.notes,
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n"),
    "utf8",
  );

  const result = {
    generatedAt: new Date().toISOString(),
    records: {
      readings: readings.length,
      meters: byMeter.size,
      metersWithOneReading: [...byMeter.values()].filter(
        (items) => items.length === 1,
      ).length,
      metersWithMultipleReadings: [...byMeter.values()].filter(
        (items) => items.length > 1,
      ).length,
      inferredConsecutiveIntervals: inferredIntervals.length,
      validApproximatelyMonthlyIntervals: validIntervals.length,
      invalidOrNonRepresentativeRows: details.filter((row) => !row.valid)
        .length,
      earliestReading: readingDates.length
        ? iso(new Date(Math.min(...readingDates.map(Number))))
        : null,
      latestReading: readingDates.length
        ? iso(new Date(Math.max(...readingDates.map(Number))))
        : null,
    },
    empiricalCycle: validIntervals.length
      ? {
          mostCommonStartDay: startMode
            ? { day: startMode[0], count: startMode[1] }
            : null,
          mostCommonEndDay: endMode
            ? { day: endMode[0], count: endMode[1] }
            : null,
          exactStart26Percent: percent(exactStart26, validIntervals.length),
          start26PlusMinus1Percent: percent(
            nearStart26,
            validIntervals.length,
          ),
          exactEnd25Percent: percent(exactEnd25, validIntervals.length),
          end25PlusMinus1Percent: percent(nearEnd25, validIntervals.length),
        }
      : null,
    adminClaim: validIntervals.length
      ? "Comparable against empirically valid intervals; see percentages."
      : "Not verifiable from the current dataset: there are no valid recurring approximately monthly consecutive-reading intervals.",
    crossSectionalReadingDates: {
      warning:
        "These are individual latest-reading dates from a snapshot, not inferred cycle boundaries.",
      mostCommonDayOfMonth: readingDayMode
        ? { day: readingDayMode[0], count: readingDayMode[1] }
        : null,
      day26ExactPercent: percent(
        readingDayCounts.get(26) ?? 0,
        readingDates.length,
      ),
      day26PlusMinus1Percent: percent(
        [25, 26, 27].reduce(
          (sum, day) => sum + (readingDayCounts.get(day) ?? 0),
          0,
        ),
        readingDates.length,
      ),
      day25ExactPercent: percent(
        readingDayCounts.get(25) ?? 0,
        readingDates.length,
      ),
      day25PlusMinus1Percent: percent(
        [24, 25, 26].reduce(
          (sum, day) => sum + (readingDayCounts.get(day) ?? 0),
          0,
        ),
        readingDates.length,
      ),
      topReadingDates: topReadingDates.map(([date, count]) => ({
        date,
        count,
        percent: percent(count, readingDates.length),
      })),
    },
    cycleRecords: cycleAudit,
    detailedCsv: csvPath,
  };

  const jsonPath = path.join(docs, "Reading_Cycle_Empirical_Analysis.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(result, null, 2),
    "utf8",
  );
  console.dir(result, { depth: null });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
