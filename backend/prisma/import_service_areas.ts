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
  "02_service_areas.csv",
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

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function optional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`Service-area CSV was not found: ${source}`);
  }

  const [headers, ...records] = parseCsv(fs.readFileSync(source, "utf8"));
  const index = new Map(headers.map((header, position) => [header.trim(), position]));
  const cell = (record: string[], column: string) =>
    record[index.get(column) ?? -1]?.trim() ?? "";

  const zones = await prisma.zone.findMany({
    select: { zoneId: true, zoneCode: true, zoneName: true },
  });
  const zonesByCode = new Map(zones.map((zone) => [normalize(zone.zoneCode), zone]));
  const zonesByName = new Map<string, (typeof zones)[number]>();
  const duplicateZoneNames = new Set<string>();

  for (const zone of zones) {
    const key = normalize(zone.zoneName);
    if (zonesByName.has(key)) duplicateZoneNames.add(key);
    else zonesByName.set(key, zone);
  }
  for (const key of duplicateZoneNames) zonesByName.delete(key);

  const prepared = records.map((record) => {
    const areaCode = cell(record, "area_code");
    const areaName = cell(record, "area_name");
    const sourceZoneCode = cell(record, "zone_code");
    const zone =
      zonesByCode.get(normalize(sourceZoneCode)) ??
      zonesByName.get(normalize(areaName));

    return {
      areaCode,
      areaName,
      sourceZoneCode,
      areaType: cell(record, "area_type") || "OTHER",
      description: optional(cell(record, "description")),
      status: cell(record, "status") || "ACTIVE",
      zone,
    };
  });

  const unresolved = prepared.filter((item) => !item.zone);
  if (unresolved.length > 0) {
    throw new Error(
      `Could not map ${unresolved.length} service area(s) to a destination zone:\n${unresolved
        .map(
          (item) =>
            `- ${item.areaCode} / ${item.areaName} (source zone ${item.sourceZoneCode})`,
        )
        .join("\n")}`,
    );
  }

  // Manual DBeaver imports may provide explicit primary keys without advancing
  // PostgreSQL's identity sequence. Synchronize it before creating missing rows.
  await prisma.$queryRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"aquaflow"."service_areas"', 'service_area_id'),
      COALESCE((SELECT MAX(service_area_id) FROM aquaflow.service_areas), 0) + 1,
      false
    )
  `);

  for (const item of prepared) {
    const data = {
      zoneId: item.zone!.zoneId,
      areaName: item.areaName,
      areaType: item.areaType,
      description: item.description,
      status: item.status,
      updatedAt: new Date(),
    };
    await prisma.serviceArea.upsert({
      where: { areaCode: item.areaCode },
      create: { areaCode: item.areaCode, ...data },
      update: data,
    });
  }

  const stagingDirectory = path.dirname(source);
  const propertiesSource = path.join(stagingDirectory, "05_properties.csv");
  let linkedProperties = 0;

  if (fs.existsSync(propertiesSource)) {
    const [propertyHeaders, ...propertyRecords] = parseCsv(
      fs.readFileSync(propertiesSource, "utf8"),
    );
    const propertyIndex = new Map(
      propertyHeaders.map((header, position) => [header.trim(), position]),
    );
    const propertyCell = (record: string[], column: string) =>
      record[propertyIndex.get(column) ?? -1]?.trim() ?? "";
    const propertyCodesByArea = new Map<string, string[]>();

    for (const record of propertyRecords) {
      const areaCode = propertyCell(record, "service_area_code");
      const propertyCode = propertyCell(record, "property_code");
      if (!areaCode || !propertyCode) continue;
      const codes = propertyCodesByArea.get(areaCode) ?? [];
      codes.push(propertyCode);
      propertyCodesByArea.set(areaCode, codes);
    }

    const importedAreas = await prisma.serviceArea.findMany({
      where: { areaCode: { in: prepared.map((item) => item.areaCode) } },
      select: { serviceAreaId: true, areaCode: true },
    });

    for (const area of importedAreas) {
      const propertyCodes = propertyCodesByArea.get(area.areaCode) ?? [];
      if (propertyCodes.length === 0) continue;
      const result = await prisma.property.updateMany({
        where: { propertyCode: { in: propertyCodes } },
        data: { serviceAreaId: area.serviceAreaId, updatedAt: new Date() },
      });
      linkedProperties += result.count;
    }
  }

  const destinationTotal = await prisma.serviceArea.count();
  console.log(
    JSON.stringify(
      {
        source: path.basename(source),
        sourceRows: records.length,
        importedOrUpdated: prepared.length,
        destinationTotal,
        linkedProperties,
        mapping: "zone_code first, then normalized area_name -> zone_name",
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
