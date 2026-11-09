// Manual database benchmark: all fixture users/wishlist writes are rolled back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../src/prisma/client";
import { insertWishlist } from "../src/modules/wishlist/wishlist.insert";
import { productViewSelect } from "../src/modules/products/products.select";
const rollback = new Error("ROLLBACK_ONLY");
async function main() {
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'wishlist'`;
  console.info(JSON.stringify({ wishlistIndexes: indexes.map(index => index.indexname) }));
  const product = await prisma.product.findFirst({ where: { material: { isActive: true }, variant: { isActive: true } }, select: { productIdentifier: true } });
  if (!product) throw new Error("An active product is needed.");
  const samples: Record<string, number[]> = { beforeEndpoint: [], beforeClickWithLookup: [], afterEndpointWithCount: [], duplicateWithCount: [] };
  try {
    await prisma.$transaction(async tx => {
      const fixture = await tx.user.create({ data: { name: "Rollback benchmark", email: randomUUID() + "@example.invalid", role: UserRole.CUSTOMER }, select: { id: true } });
      const userId = fixture.id, productIdentifier = product.productIdentifier;
      const select = { id: true, userId: true, productIdentifier: true, createdAt: true, product: { select: productViewSelect } } as const;
      for (let attempt = 0; attempt < 3; attempt++) {
        await tx.wishlist.deleteMany({ where: { userId } });
        const clickStart = performance.now();
        await tx.wishlist.findMany({ where: { userId, productIdentifier }, select: { id: true, productIdentifier: true } });
        let start = performance.now();
        await tx.product.findFirst({ where: { productIdentifier, material: { isActive: true }, variant: { isActive: true } }, select: { productIdentifier: true } });
        await tx.wishlist.findUnique({ where: { userId_productIdentifier: { userId, productIdentifier } }, select: { id: true } });
        const legacy = await tx.wishlist.create({ data: { userId, productIdentifier }, select });
        samples.beforeEndpoint!.push(performance.now() - start); samples.beforeClickWithLookup!.push(performance.now() - clickStart);
        await tx.wishlist.deleteMany({ where: { userId } });
        start = performance.now();
        const created = await insertWishlist(tx, userId, productIdentifier);
        if (created.alreadySaved || created.wishlistCount !== 1) throw new Error("Creation check failed.");
        const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value), (key: string, entry: unknown) => ["mrp", "price"].includes(key) ? Number(entry) : entry) as unknown;
        assert.deepStrictEqual(normalize(created.wishlistItem.product), normalize(legacy.product), "The product response must preserve existing fields.");
        samples.afterEndpointWithCount!.push(performance.now() - start);
        start = performance.now();
        const duplicate = await insertWishlist(tx, userId, productIdentifier);
        if (!duplicate.alreadySaved || duplicate.wishlistCount !== 1) throw new Error("Duplicate safety check failed.");
        samples.duplicateWithCount!.push(performance.now() - start);
      }
      throw rollback;
    }, { timeout: 55_000, maxWait: 10_000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.info(JSON.stringify({ rollback: true, note: "Database work only; excludes HTTP/auth and queued client reads. Transactions serialize parallel queries.", milliseconds: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, values.map(value => Math.round(value * 100) / 100)])) }));
}
main().catch((error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(JSON.stringify({ code: error.code, databaseCode: error.meta?.code }));
  } else console.error(error instanceof Error && ["Creation check failed.", "Duplicate safety check failed."].includes(error.message) ? error.message : "Benchmark could not complete.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
