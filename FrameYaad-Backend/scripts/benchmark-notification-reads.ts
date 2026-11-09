// Manual integration benchmark. Every fixture/write is rolled back; no existing notification is changed.
import { NotificationType, UserRole } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { prisma } from "../src/prisma/client";
const rollback = new Error("BENCHMARK_ROLLBACK");
async function main() {
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications'`;
  console.info(JSON.stringify({ notificationIndexes: indexes.map(index => index.indexname) }));
  const actor = await prisma.user.findFirst({ where: { role: { in: [UserRole.ADMIN, UserRole.EMPLOYEE] } }, select: { id: true } });
  if (!actor) throw new Error("A staff account is required for the rollback-only benchmark.");
  const samples: Record<string, number[]> = { beforeRead: [], afterReadWithCount: [], beforeClickWithRefetches: [], markAllWithCount: [] };
  try {
    await prisma.$transaction(async tx => {
      const fixture = await tx.notification.create({ data: { title: "Rollback-only benchmark", message: "Never committed", type: NotificationType.ACCOUNT_CREATED } });
      const where = { id: fixture.id, userId: null, read: false };
      for (let attempt = 0; attempt < 3; attempt++) {
        await tx.notification.update({ where: { id: fixture.id }, data: { read: false, readById: null } });
        let start = performance.now();
        await tx.notification.findFirst({ where: { id: fixture.id, userId: null } });
        await tx.notification.updateMany({ where, data: { read: true, readById: actor.id } });
        await tx.notification.findUnique({ where: { id: fixture.id } });
        samples.beforeRead!.push(performance.now() - start);
        await tx.notification.findMany({ where: { userId: null }, take: 20, orderBy: { createdAt: "desc" } });
        await tx.notification.groupBy({ by: ["read"], where: { userId: null }, _count: { _all: true } });
        await tx.notification.findMany({ where: { userId: null }, take: 100, orderBy: { createdAt: "desc" } });
        await tx.notification.groupBy({ by: ["read"], where: { userId: null }, _count: { _all: true } });
        samples.beforeClickWithRefetches!.push(performance.now() - start);
        await tx.notification.update({ where: { id: fixture.id }, data: { read: false, readById: null } });
        start = performance.now();
        await tx.notification.updateMany({ where, data: { read: true, readById: actor.id } });
        await Promise.all([tx.notification.findFirst({ where: { id: fixture.id, userId: null } }), tx.notification.count({ where: { userId: null, read: false } })]);
        samples.afterReadWithCount!.push(performance.now() - start);
        await tx.notification.update({ where: { id: fixture.id }, data: { read: false, readById: null } });
        start = performance.now();
        // Fixture-only predicate: never marks real staff notifications as read.
        await tx.notification.updateMany({ where, data: { read: true, readById: actor.id } });
        await tx.notification.count({ where: { userId: null, read: false } });
        samples.markAllWithCount!.push(performance.now() - start);
      }
      throw rollback;
    }, { timeout: 55_000, maxWait: 10_000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.info(JSON.stringify({ rollback: true, note: "Database operation samples; excludes HTTP/auth. Interactive transactions serialize parallel queries.", milliseconds: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, values.map(value => Math.round(value * 100) / 100)])) }));
}
main().catch(() => { console.error("Benchmark could not complete; no credentials or database errors printed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
