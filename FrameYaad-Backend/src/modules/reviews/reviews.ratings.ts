import { prisma } from "../../prisma/client";
export type RatingSummary = { average: number; count: number; breakdown: Record<string, number> };
const cache = new Map<string, { expires: number; value: RatingSummary }>();
export const invalidateRatings = (productId: string) => cache.delete(productId);
export const emptyRating = (): RatingSummary => ({ average: 0, count: 0, breakdown: { "1":0,"2":0,"3":0,"4":0,"5":0 } });
export async function ratingSummaries(ids: string[]) {
  const now = Date.now(), missing = ids.filter(id => !cache.has(id) || cache.get(id)!.expires <= now);
  if (missing.length) {
    const groups = await prisma.review.groupBy({ by: ["productId","rating"], where: { productId: { in: missing }, status: "APPROVED", product: { material: { isActive: true }, variant: { isActive: true } } }, _count: { _all: true } });
    const values = new Map(missing.map(id => [id, emptyRating()]));
    for (const group of groups) { const value = values.get(group.productId)!; value.count += group._count._all; value.average += group.rating * group._count._all; value.breakdown[String(group.rating)] = group._count._all; }
    for (const [id, value] of values) { value.average = value.count ? Math.round(value.average / value.count * 10) / 10 : 0; cache.set(id, { expires: now + 5000, value }); }
    if (cache.size > 5000) for (const key of cache.keys()) { cache.delete(key); if (cache.size <= 4000) break; }
  }
  return Object.fromEntries(ids.map(id => [id, cache.get(id)?.value ?? emptyRating()]));
}
