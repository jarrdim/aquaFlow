import { PrismaClient } from "@prisma/client";
import {
  csvTable,
  requiredBoolean,
  resolveStagingSource,
} from "./import_legacy_common";

const prisma = new PrismaClient();
const source = resolveStagingSource("11_payment_channels.csv", process.argv[2]);

async function main() {
  const table = csvTable(source);
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();

  const data = table.records.map((record, position) => {
    const channelCode = table.cell(record, "channel_code");
    const channelName = table.cell(record, "channel_name");
    const status = table.cell(record, "status").toUpperCase();
    if (!channelCode || !channelName) {
      throw new Error(`Blank channel code or name on row ${position + 2}`);
    }
    if (seenCodes.has(channelCode)) {
      throw new Error(`Duplicate payment channel code: ${channelCode}`);
    }
    if (seenNames.has(channelName)) {
      throw new Error(`Duplicate payment channel name: ${channelName}`);
    }
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw new Error(`Unsupported channel status: ${status}`);
    }
    seenCodes.add(channelCode);
    seenNames.add(channelName);
    return {
      channelCode,
      channelName,
      requiresReference: requiredBoolean(
        table.cell(record, "requires_reference"),
        `requires_reference on row ${position + 2}`,
      ),
      autoAllocation: requiredBoolean(
        table.cell(record, "auto_allocation"),
        `auto_allocation on row ${position + 2}`,
      ),
      receiptRequired: requiredBoolean(
        table.cell(record, "receipt_required"),
        `receipt_required on row ${position + 2}`,
      ),
      status,
    };
  });

  const existing = await prisma.paymentChannel.findMany();
  const byCode = new Map(existing.map((row) => [row.channelCode, row]));
  const nameOwner = new Map(existing.map((row) => [row.channelName, row.channelCode]));
  let created = 0;
  let updated = 0;

  for (const row of data) {
    const conflictingCode = nameOwner.get(row.channelName);
    if (conflictingCode && conflictingCode !== row.channelCode) {
      throw new Error(
        `Channel name "${row.channelName}" already belongs to code ${conflictingCode}`,
      );
    }
    const current = byCode.get(row.channelCode);
    if (!current) {
      await prisma.paymentChannel.create({ data: row });
      created += 1;
      continue;
    }
    const changed =
      current.channelName !== row.channelName ||
      current.requiresReference !== row.requiresReference ||
      current.autoAllocation !== row.autoAllocation ||
      current.receiptRequired !== row.receiptRequired ||
      current.status !== row.status;
    if (changed) {
      await prisma.paymentChannel.update({
        where: { channelId: current.channelId },
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
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
