import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [
    cycle,
    readingCount,
    abnormalNegativeCount,
    channelCount,
    paymentCount,
    paymentTotals,
    paymentsByChannel,
  ] = await Promise.all([
    prisma.readingCycle.findUnique({
      where: { cycleCode: "LEGACY-SNAPSHOT" },
      select: { cycleCode: true, status: true, startDate: true, endDate: true },
    }),
    prisma.meterReading.count({
      where: { cycle: { cycleCode: "LEGACY-SNAPSHOT" } },
    }),
    prisma.meterReading.count({
      where: {
        cycle: { cycleCode: "LEGACY-SNAPSHOT" },
        abnormalFlag: true,
        exceptionType: "NEGATIVE",
      },
    }),
    prisma.paymentChannel.count({
      where: { channelCode: { in: ["001", "002", "003", "004", "005"] } },
    }),
    prisma.payment.count(),
    prisma.payment.aggregate({
      _sum: { amount: true, unallocatedAmount: true },
    }),
    prisma.payment.groupBy({
      by: ["channelId", "paymentStatus", "matchingStatus"],
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const channels = await prisma.paymentChannel.findMany({
    select: { channelId: true, channelCode: true, channelName: true },
  });
  const channelById = new Map(channels.map((row) => [row.channelId, row]));

  console.dir(
    {
      readingCycle: cycle
        ? {
            ...cycle,
            startDate: cycle.startDate.toISOString().slice(0, 10),
            endDate: cycle.endDate.toISOString().slice(0, 10),
          }
        : null,
      readingCount,
      abnormalNegativeCount,
      channelCount,
      paymentCount,
      paymentTotal: paymentTotals._sum.amount?.toFixed(2) ?? "0.00",
      unallocatedTotal:
        paymentTotals._sum.unallocatedAmount?.toFixed(2) ?? "0.00",
      paymentsByChannel: paymentsByChannel.map((row) => ({
        channelCode: channelById.get(row.channelId)?.channelCode,
        channelName: channelById.get(row.channelId)?.channelName,
        paymentStatus: row.paymentStatus,
        matchingStatus: row.matchingStatus,
        count: row._count._all,
        amount: row._sum.amount?.toFixed(2) ?? "0.00",
      })),
    },
    { depth: null },
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
