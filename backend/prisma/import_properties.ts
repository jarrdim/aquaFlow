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
  "05_properties.csv",
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

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function identityKey(record: {
  customerNumber?: string | null;
  migrationYear?: string | null;
  customerType?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  phoneNumber?: string | null;
}) {
  const year =
    record.migrationYear ??
    record.customerNumber?.match(/^CUST-(\d{4})-/)?.[1] ??
    "";
  const completeName = normalize(
    [
      record.organizationName,
      record.firstName,
      record.middleName,
      record.lastName,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return [
    normalize(record.customerType),
    completeName,
    normalize(record.phoneNumber),
    normalize(year),
  ].join("|");
}

function uniqueLookup<T>(entries: Array<[string, T]>) {
  const result = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const [key, value] of entries) {
    if (!key) continue;
    if (result.has(key)) ambiguous.add(key);
    else result.set(key, value);
  }
  for (const key of ambiguous) result.delete(key);
  return result;
}

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`Properties CSV was not found: ${source}`);
  }

  const parsed = parseCsv(fs.readFileSync(source, "utf8"));
  const [headers, ...records] = parsed;
  const index = new Map(headers.map((header, position) => [header.trim(), position]));
  const cell = (record: string[], column: string) =>
    record[index.get(column) ?? -1]?.trim() ?? "";

  const stagingDirectory = path.dirname(source);
  const customerSource = path.join(stagingDirectory, "04_customers.csv");
  const zoneSource = path.join(stagingDirectory, "01_zones.csv");
  const serviceAreaSource = path.join(stagingDirectory, "02_service_areas.csv");
  for (const requiredSource of [customerSource, zoneSource, serviceAreaSource]) {
    if (!fs.existsSync(requiredSource)) {
      throw new Error(`Required mapping CSV was not found: ${requiredSource}`);
    }
  }

  const [customerHeaders, ...customerRecords] = parseCsv(
    fs.readFileSync(customerSource, "utf8"),
  );
  const customerIndex = new Map(
    customerHeaders.map((header, position) => [header.trim(), position]),
  );
  const customerCell = (record: string[], column: string) =>
    record[customerIndex.get(column) ?? -1]?.trim() ?? "";
  const legacyCustomerIdentities = new Map(
    customerRecords.map((record) => [
      customerCell(record, "customer_number"),
      identityKey({
        customerType: customerCell(record, "customer_type"),
        firstName: customerCell(record, "first_name"),
        middleName: customerCell(record, "middle_name"),
        lastName: customerCell(record, "last_name"),
        organizationName: customerCell(record, "organization_name"),
        phoneNumber: customerCell(record, "phone_number"),
        migrationYear: customerCell(record, "registration_date").slice(0, 4),
      }),
    ]),
  );

  const [zoneHeaders, ...zoneRecords] = parseCsv(
    fs.readFileSync(zoneSource, "utf8"),
  );
  const zoneIndex = new Map(
    zoneHeaders.map((header, position) => [header.trim(), position]),
  );
  const zoneCell = (record: string[], column: string) =>
    record[zoneIndex.get(column) ?? -1]?.trim() ?? "";
  const legacyZoneNames = new Map(
    zoneRecords.map((record) => [
      zoneCell(record, "zone_code"),
      normalize(zoneCell(record, "zone_name")),
    ]),
  );

  const [areaHeaders, ...areaRecords] = parseCsv(
    fs.readFileSync(serviceAreaSource, "utf8"),
  );
  const areaIndex = new Map(
    areaHeaders.map((header, position) => [header.trim(), position]),
  );
  const areaCell = (record: string[], column: string) =>
    record[areaIndex.get(column) ?? -1]?.trim() ?? "";
  const legacyAreaNames = new Map(
    areaRecords.map((record) => [
      areaCell(record, "area_code"),
      normalize(areaCell(record, "area_name")),
    ]),
  );

  const [customers, zones, serviceAreas, routes] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { customerId: "asc" },
      select: {
        customerId: true,
        customerNumber: true,
        customerType: true,
        firstName: true,
        middleName: true,
        lastName: true,
        organizationName: true,
        phoneNumber: true,
      },
    }),
    prisma.zone.findMany({ select: { zoneId: true, zoneCode: true, zoneName: true } }),
    prisma.serviceArea.findMany({
      select: { serviceAreaId: true, areaCode: true, areaName: true },
    }),
    prisma.route.findMany({ select: { routeId: true, routeCode: true } }),
  ]);

  const customerIds = new Map(customers.map((item) => [item.customerNumber, item.customerId]));
  const customerIdsByIdentity = uniqueLookup(
    customers.map((item) => [identityKey(item), item.customerId]),
  );
  const customerIdsByPhone = uniqueLookup(
    customers.map((item) => [normalize(item.phoneNumber), item.customerId]),
  );
  const legacyCustomerPhones = new Map(
    customerRecords.map((record) => [
      customerCell(record, "customer_number"),
      normalize(customerCell(record, "phone_number")),
    ]),
  );
  const sourceIdentityGroups = new Map<string, string[]>();
  for (const [customerNumber, key] of legacyCustomerIdentities) {
    sourceIdentityGroups.set(key, [
      ...(sourceIdentityGroups.get(key) ?? []),
      customerNumber,
    ]);
  }
  const destinationIdentityGroups = new Map<
    string,
    Array<{ customerId: bigint; order: number }>
  >();
  for (const customer of customers) {
    const key = identityKey(customer);
    const suffix = Number(customer.customerNumber.match(/(\d+)$/)?.[1] ?? 0);
    destinationIdentityGroups.set(key, [
      ...(destinationIdentityGroups.get(key) ?? []),
      { customerId: customer.customerId, order: suffix },
    ]);
  }
  const customerIdsByDuplicateGroup = new Map<string, bigint>();
  for (const [key, sourceNumbers] of sourceIdentityGroups) {
    const destinations = destinationIdentityGroups
      .get(key)
      ?.sort((left, right) => left.order - right.order);
    if (!destinations || destinations.length !== sourceNumbers.length) continue;
    sourceNumbers.forEach((customerNumber, position) => {
      customerIdsByDuplicateGroup.set(
        customerNumber,
        destinations[position].customerId,
      );
    });
  }
  const destinationsByGeneratedSequence = new Map<
    number,
    { customerId: bigint; year: string }
  >();
  for (const customer of customers) {
    const match = customer.customerNumber.match(/^CUST-(\d{4})-(\d+)$/);
    if (!match) continue;
    destinationsByGeneratedSequence.set(Number(match[2]), {
      customerId: customer.customerId,
      year: match[1],
    });
  }
  const customerIdsByGeneratedSequence = new Map<string, bigint>();
  customerRecords.forEach((record, position) => {
    const destination = destinationsByGeneratedSequence.get(position + 1);
    const sourceYear = customerCell(record, "registration_date").slice(0, 4);
    if (destination && destination.year === sourceYear) {
      customerIdsByGeneratedSequence.set(
        customerCell(record, "customer_number"),
        destination.customerId,
      );
    }
  });
  const customerIdsByImportOrder = new Map<string, bigint>();
  if (customerRecords.length === customers.length) {
    customerRecords.forEach((record, position) => {
      const sourceIdentity = identityKey({
        customerType: customerCell(record, "customer_type"),
        firstName: customerCell(record, "first_name"),
        middleName: customerCell(record, "middle_name"),
        lastName: customerCell(record, "last_name"),
        organizationName: customerCell(record, "organization_name"),
        phoneNumber: customerCell(record, "phone_number"),
        migrationYear: customerCell(record, "registration_date").slice(0, 4),
      });
      const destination = customers[position];
      if (destination && sourceIdentity === identityKey(destination)) {
        customerIdsByImportOrder.set(
          customerCell(record, "customer_number"),
          destination.customerId,
        );
      }
    });
  }
  const zoneIds = new Map(zones.map((item) => [item.zoneCode, item.zoneId]));
  const zoneIdsByName = uniqueLookup(
    zones.map((item) => [normalize(item.zoneName), item.zoneId]),
  );
  const serviceAreaIds = new Map(serviceAreas.map((item) => [item.areaCode, item.serviceAreaId]));
  const routeIds = new Map(routes.map((item) => [item.routeCode, item.routeId]));
  console.log({
    availableParents: {
      customers: customers.length,
      zones: zones.length,
      serviceAreas: serviceAreas.length,
      routes: routes.length,
    },
    samples: {
      customer: customers[0]?.customerNumber ?? null,
      zone: zones[0]?.zoneCode ?? null,
      serviceArea: serviceAreas[0]?.areaCode ?? null,
    },
  });
  const unresolved: string[] = [];
  let customersMappedByIdentity = 0;
  let customersMappedByValidatedOrder = 0;
  let customersMappedByDuplicateGroup = 0;
  let customersMappedByGeneratedSequence = 0;
  let customersMappedByPhone = 0;
  let zonesMappedByName = 0;
  let serviceAreasLeftBlank = 0;
  let routesLeftBlank = 0;

  const data = records.map((record, position) => {
    const propertyCode = cell(record, "property_code");
    const customerNumber = cell(record, "owner_customer_number");
    const zoneCode = cell(record, "zone_code");
    const serviceAreaCode = cell(record, "service_area_code");
    const routeCode = cell(record, "route_code");
    const directCustomerId = customerIds.get(customerNumber);
    const identityCustomerId = customerIdsByIdentity.get(
      legacyCustomerIdentities.get(customerNumber) ?? "",
    );
    const phoneCustomerId = customerIdsByPhone.get(
      legacyCustomerPhones.get(customerNumber) ?? "",
    );
    const ownerCustomerId =
      directCustomerId ??
      identityCustomerId ??
      phoneCustomerId ??
      customerIdsByDuplicateGroup.get(customerNumber) ??
      customerIdsByGeneratedSequence.get(customerNumber) ??
      customerIdsByImportOrder.get(customerNumber);
    if (!directCustomerId && identityCustomerId) customersMappedByIdentity += 1;
    if (!directCustomerId && !identityCustomerId && ownerCustomerId) {
      if (phoneCustomerId) {
        customersMappedByPhone += 1;
      } else
      if (customerIdsByDuplicateGroup.has(customerNumber)) {
        customersMappedByDuplicateGroup += 1;
      } else if (customerIdsByGeneratedSequence.has(customerNumber)) {
        customersMappedByGeneratedSequence += 1;
      } else {
        customersMappedByValidatedOrder += 1;
      }
    }

    const directZoneId = zoneIds.get(zoneCode);
    const zoneId =
      directZoneId ??
      zoneIdsByName.get(legacyAreaNames.get(serviceAreaCode) ?? "") ??
      zoneIdsByName.get(legacyZoneNames.get(zoneCode) ?? "");
    if (!directZoneId && zoneId) zonesMappedByName += 1;

    const serviceAreaId = serviceAreaCode
      ? serviceAreaIds.get(serviceAreaCode)
      : null;
    const routeId = routeCode ? routeIds.get(routeCode) : null;

    if (!propertyCode || !ownerCustomerId || !zoneId) {
      unresolved.push(
        `row ${position + 2}: property=${propertyCode || "missing"}, customer=${customerNumber}, zone=${zoneCode}`,
      );
    }
    if (serviceAreaCode && !serviceAreaId) serviceAreasLeftBlank += 1;
    if (routeCode && !routeId) routesLeftBlank += 1;

    return {
      propertyCode,
      ownerCustomerId: ownerCustomerId!,
      zoneId: zoneId!,
      serviceAreaId: serviceAreaId ?? null,
      routeId: routeId ?? null,
      plotNumber: optional(cell(record, "plot_number")),
      buildingName: optional(cell(record, "building_name")),
      physicalAddress: cell(record, "physical_address"),
      gpsLatitude: optional(cell(record, "gps_latitude")),
      gpsLongitude: optional(cell(record, "gps_longitude")),
      occupancyStatus: cell(record, "occupancy_status") || "OWNER_OCCUPIED",
      status: cell(record, "status") || "ACTIVE",
    };
  });

  if (unresolved.length > 0) {
    throw new Error(
      `Import stopped: ${unresolved.length} unresolved reference(s).\n${unresolved
        .slice(0, 20)
        .join("\n")}`,
    );
  }

  console.log({
    resolvedMappings: {
      customersMappedByIdentity,
      customersMappedByValidatedOrder,
      customersMappedByDuplicateGroup,
      customersMappedByGeneratedSequence,
      customersMappedByPhone,
      zonesMappedByName,
      serviceAreasLeftBlank,
      routesLeftBlank,
    },
  });

  let inserted = 0;
  for (let offset = 0; offset < data.length; offset += 500) {
    const result = await prisma.property.createMany({
      data: data.slice(offset, offset + 500),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  console.log({
    source,
    staged: data.length,
    inserted,
    skippedExisting: data.length - inserted,
    destinationTotal: await prisma.property.count(),
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
