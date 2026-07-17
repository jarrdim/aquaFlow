import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

const createAccountSchema = z.object({
  customerId: z.string().min(1),
  propertyId: z.string().min(1),
  categoryId: z.string().min(1),
  routeId: z.string().optional(),
  openingBalance: z.number().optional(),
});

async function nextAccountNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.customerAccount.count();
  return `ACC-${year}-${String(count + 1).padStart(5, "0")}`;
}

accountsRouter.post("/", async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  // FRS business rule: an account shall not be activated without a valid
  // customer, property and customer category — enforced by the required FKs below.
  const account = await prisma.customerAccount.create({
    data: {
      accountNumber: await nextAccountNumber(),
      customerId: BigInt(data.customerId),
      propertyId: BigInt(data.propertyId),
      categoryId: BigInt(data.categoryId),
      routeId: data.routeId ? BigInt(data.routeId) : undefined,
      openingBalance: data.openingBalance ?? 0,
      currentBalance: data.openingBalance ?? 0,
      accountStatus: "PENDING",
    },
  });

  res.status(201).json(account);
});
