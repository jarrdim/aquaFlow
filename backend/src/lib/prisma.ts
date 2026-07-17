import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient instance across the app (and across
// ts-node-dev hot reloads) to avoid exhausting Postgres connections.
export const prisma = new PrismaClient();
