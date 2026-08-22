import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const startOfDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nextDay = (value: string) => {
  const date = startOfDay(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
};

reportsRouter.get("/daily-income", async (req, res, next) => {
  const parsed = z.object({ from: dateSchema, to: dateSchema }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Valid from and to dates are required" });
  if (parsed.data.from > parsed.data.to) return res.status(400).json({ error: "From date cannot be after to date" });

  try {
    const payments = await prisma.payment.findMany({
      where: {
        paymentStatus: "POSTED",
        valueDate: { gte: startOfDay(parsed.data.from), lt: nextDay(parsed.data.to) },
      },
      include: { channel: true },
      orderBy: [{ valueDate: "asc" }, { paymentDate: "asc" }],
    });
    const grouped = new Map<string, { date: string; channel: string; transactions: number; amount: number }>();
    for (const payment of payments) {
      const date = payment.valueDate.toISOString().slice(0, 10);
      const channel = payment.channel.channelName;
      const key = `${date}|${payment.channelId}`;
      const row = grouped.get(key) ?? { date, channel, transactions: 0, amount: 0 };
      row.transactions += 1;
      row.amount += Number(payment.amount);
      grouped.set(key, row);
    }
    const rows = [...grouped.values()].map((row) => ({ ...row, amount: Math.round(row.amount * 100) / 100 }));
    res.json({
      from: parsed.data.from,
      to: parsed.data.to,
      transactions: payments.length,
      totalIncome: Math.round(payments.reduce((sum, payment) => sum + Number(payment.amount), 0) * 100) / 100,
      rows,
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/meter-reading-coverage", async (req, res, next) => {
  const parsed = z.object({ cycleId: z.coerce.bigint().positive() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "A valid reading cycle is required" });

  try {
    const cycle = await prisma.readingCycle.findUnique({ where: { readingCycleId: parsed.data.cycleId } });
    if (!cycle) return res.status(404).json({ error: "Reading cycle was not found" });

    const assignments = await prisma.meterAssignment.findMany({
      where: { assignmentStatus: "ACTIVE", removalDate: null, meter: { status: "ACTIVE" } },
      include: {
        meter: true,
        zone: true,
        borehole: { include: { zone: true } },
        account: { include: { customer: true, property: { include: { zone: true } } } },
      },
      orderBy: { meter: { meterNumber: "asc" } },
    });
    const meterIds = [...new Set(assignments.map((assignment) => assignment.meterId))];
    const readings = meterIds.length
      ? await prisma.meterReading.findMany({
          where: { readingCycleId: cycle.readingCycleId, meterId: { in: meterIds } },
          select: { meterId: true, readingDate: true, currentReading: true, approvalStatus: true },
        })
      : [];
    const readingByMeter = new Map(readings.map((reading) => [reading.meterId.toString(), reading]));
    const seenMeters = new Set<string>();
    const meters = assignments.flatMap((assignment) => {
      const meterId = assignment.meterId.toString();
      if (seenMeters.has(meterId)) return [];
      seenMeters.add(meterId);
      const reading = readingByMeter.get(meterId);
      const customer = assignment.account?.customer;
      const customerName = customer
        ? customer.customerType === "ORGANIZATION"
          ? customer.organizationName || customer.customerNumber
          : [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ")
        : "Network meter";
      const zone = assignment.zone ?? assignment.account?.property.zone ?? assignment.borehole?.zone;
      const groupType = assignment.meter.meterType === "BULK" ? "BULK" : "ZONE";
      return [{
        meterId,
        meterNumber: assignment.meter.meterNumber,
        meterType: assignment.meter.meterType,
        groupType,
        groupName: groupType === "BULK" ? "Bulk meters" : zone?.zoneName || "Unassigned zone",
        zoneName: zone?.zoneName || null,
        accountNumber: assignment.account?.accountNumber || null,
        customerName,
        status: reading ? "READ" : "UNREAD",
        readingDate: reading?.readingDate ?? null,
        currentReading: reading?.currentReading ?? null,
        approvalStatus: reading?.approvalStatus ?? null,
      }];
    });
    const groups = new Map<string, { groupType: string; groupName: string; total: number; read: number; unread: number }>();
    for (const meter of meters) {
      const key = `${meter.groupType}|${meter.groupName}`;
      const group = groups.get(key) ?? { groupType: meter.groupType, groupName: meter.groupName, total: 0, read: 0, unread: 0 };
      group.total += 1;
      if (meter.status === "READ") group.read += 1;
      else group.unread += 1;
      groups.set(key, group);
    }
    res.json({
      cycle,
      total: meters.length,
      read: meters.filter((meter) => meter.status === "READ").length,
      unread: meters.filter((meter) => meter.status === "UNREAD").length,
      groups: [...groups.values()].sort((a, b) => a.groupType.localeCompare(b.groupType) || a.groupName.localeCompare(b.groupName)),
      meters,
    });
  } catch (error) {
    next(error);
  }
});
