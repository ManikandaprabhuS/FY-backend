import { readFile } from "node:fs/promises";
import { prisma } from "../src/prisma/client";
import { env } from "../src/config/env";
async function main() {
  if (!process.argv.includes("--apply") || env.NODE_ENV === "production") throw new Error("Use --apply against the configured non-production database.");
  const sql = await readFile("prisma/compatibility/reviews.sql","utf8");
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews'`;
  if (columns.length && !columns.some(column => column.column_name === "effectsProcessedAt")) throw new Error("A different reviews table already exists; stop for manual review.");
  await prisma.$transaction(async tx => {
    for (const statement of sql.split(";").map(value=>value.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
  }, { timeout: 30000 });
  console.info("Review table/indexes installed; direct anon/authenticated access disabled. No existing product/user/order tables altered.");
}
main().catch(()=>{console.error("Review deployment did not complete. No private database details printed.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
