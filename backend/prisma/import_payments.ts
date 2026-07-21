import { PrismaClient } from "@prisma/client";
import {
  batches,
  csvTable,
  optional,
  requiredDate,
  requiredDecimal,
  resolveStagingSource,
  sameDate,
} from "./import_legacy_common";

const prisma = new PrismaClient();
const source = resolveStagingSource("12_payments.csv", process.argv[2]);

async function main() {
  const table = csvTable(source);
  const [accounts, channels, existing] = await Promise.all([
    prisma.customerAccount.findMany({
      select: { accountId: true, accountNumber: true },
    }),
    prisma.paymentChannel.findMany({
      select: { channelId: true, channelCode: true },
    }),
    prisma.payment.findMany({
      select: {
        paymentId: true,
        transactionReference: true,
        accountId: true,
        channelId: true,
        payerName: true,
        payerPhone: true,
        amount: true,
        paymentDate: true,
        valueDate: true,
        customerReference: true,
        matchingStatus: true,
        paymentStatus: true,
        paymentType: true,
        remarks: true,
        unallocatedAmount: true,
      },
    }),
  ]);

  const accountByNumber = new Map(accounts.map((row) => [row.accountNumber, row]));
  const channelByCode = new Map(channels.map((row) => [row.channelCode, row]));
  const existingByReference = new Map(
    existing.map((row) => [row.transactionReference, row]),
  );
  const seen = new Set<string>();
  const errors: string[] = [];
  const matchingStatuses = new Set([
    "MATCHED",
    "UNMATCHED",
    "PARTIALLY_MATCHED",
    "SUSPENSE",
  ]);
  const paymentStatuses = new Set(["RECEIVED", "POSTED", "REVERSED"]);

  const data = table.records.map((record, position) => {
    const rowNumber = position + 2;
    const transactionReference = table.cell(record, "transaction_reference");
    const accountNumber = table.cell(record, "account_number");
    const channelCode = table.cell(record, "channel_code");
    const account = accountByNumber.get(accountNumber);
    const channel = channelByCode.get(channelCode);
    const amount = requiredDecimal(
      table.cell(record, "amount"),
      `amount on row ${rowNumber}`,
    );
    const unallocatedAmount = requiredDecimal(
      table.cell(record, "unallocated_amount"),
      `unallocated amount on row ${rowNumber}`,
    );
    const matchingStatus = table.cell(record, "matching_status").toUpperCase();
    const paymentStatus = table.cell(record, "payment_status").toUpperCase();
    const paymentType =
      table.cell(record, "payment_type").toUpperCase() || "BILL_PAYMENT";
    const issues: string[] = [];

    if (!transactionReference) issues.push("blank transaction reference");
    if (seen.has(transactionReference)) issues.push("duplicate transaction reference");
    if (!account) issues.push(`account ${accountNumber || "blank"} was not imported`);
    if (!channel) issues.push(`channel ${channelCode || "blank"} was not imported`);
    if (amount <= 0) issues.push("amount must be greater than zero");
    if (unallocatedAmount < 0 || unallocatedAmount > amount) {
      issues.push("unallocated amount must be between zero and the payment amount");
    }
    if (!matchingStatuses.has(matchingStatus)) {
      issues.push(`unsupported matching status ${matchingStatus}`);
    }
    if (!paymentStatuses.has(paymentStatus)) {
      issues.push(`unsupported payment status ${paymentStatus}`);
    }
    seen.add(transactionReference);
    if (issues.length) errors.push(`row ${rowNumber}: ${issues.join(", ")}`);

    return {
      transactionReference,
      accountId: account!.accountId,
      channelId: channel!.channelId,
      payerName: optional(table.cell(record, "payer_name")),
      payerPhone: optional(table.cell(record, "payer_phone")),
      amount,
      paymentDate: requiredDate(
        table.cell(record, "payment_date"),
        `payment date on row ${rowNumber}`,
      ),
      valueDate: requiredDate(
        table.cell(record, "value_date"),
        `value date on row ${rowNumber}`,
        true,
      ),
      customerReference: optional(table.cell(record, "customer_reference")),
      matchingStatus,
      paymentStatus,
      paymentType,
      remarks: optional(table.cell(record, "remarks")),
      unallocatedAmount,
    };
  });

  if (errors.length) {
    throw new Error(
      `Import stopped: ${errors.length} invalid payment row(s).\n${errors
        .slice(0, 30)
        .join("\n")}`,
    );
  }

  const inserts = data.filter(
    (row) => !existingByReference.has(row.transactionReference),
  );
  let created = 0;
  for (const batch of batches(inserts)) {
    const result = await prisma.payment.createMany({
      data: batch,
      skipDuplicates: true,
    });
    created += result.count;
  }

  const updates = data.filter((row) => {
    const current = existingByReference.get(row.transactionReference);
    return (
      current &&
      (current.accountId !== row.accountId ||
        current.channelId !== row.channelId ||
        current.payerName !== row.payerName ||
        current.payerPhone !== row.payerPhone ||
        Number(current.amount) !== row.amount ||
        !sameDate(current.paymentDate, row.paymentDate) ||
        !sameDate(current.valueDate, row.valueDate) ||
        current.customerReference !== row.customerReference ||
        current.matchingStatus !== row.matchingStatus ||
        current.paymentStatus !== row.paymentStatus ||
        current.paymentType !== row.paymentType ||
        current.remarks !== row.remarks ||
        Number(current.unallocatedAmount) !== row.unallocatedAmount)
    );
  });

  for (const batch of batches(updates, 100)) {
    await prisma.$transaction(
      batch.map((row) =>
        prisma.payment.update({
          where: { transactionReference: row.transactionReference },
          data: row,
        }),
      ),
    );
  }

  await prisma.$queryRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"aquaflow"."payments"', 'payment_id'),
      COALESCE((SELECT MAX(payment_id) FROM aquaflow.payments), 0) + 1,
      false
    )
  `);

  const importedTotal = data.reduce((sum, row) => sum + row.amount, 0);
  console.log({
    source,
    sourceRows: data.length,
    created,
    updated: updates.length,
    unchanged: data.length - created - updates.length,
    importedTotal: importedTotal.toFixed(2),
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
