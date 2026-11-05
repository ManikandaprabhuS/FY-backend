import { PrismaClient } from "@prisma/client";

import { env } from "../config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The transaction pooler is appropriate for deployed serverless workloads, but
// it is not consistently reachable from the local Windows development runtime.
// Use Supabase's direct connection locally and retain the pooled URL in production.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasourceUrl: env.NODE_ENV === "development" ? env.DIRECT_URL : env.DATABASE_URL,
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
