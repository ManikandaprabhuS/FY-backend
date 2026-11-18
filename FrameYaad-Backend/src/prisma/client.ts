import { PrismaClient } from "@prisma/client";

import { env } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Runtime requests use the pooled URL in every environment. DIRECT_URL is
// reserved for Prisma tooling; session-mode connections can exhaust its pool.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
