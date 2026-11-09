import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { logger } from "../../config/logger";
const pending = new Set<string>();
const waiting: string[] = [];
let active = 0;
export async function processReviewEffects(id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.$transaction(async tx => {
        const review = await tx.review.findUnique({ where: { id }, select: { id: true, name: true, email: true, rating: true, userId: true, effectsProcessedAt: true, product: { select: { id: true, productName: true, productIdentifier: true } } } });
        if (!review || review.effectsProcessedAt) return;
        const purchase = await tx.order.findFirst({ where: {
          OR: [...(review.userId ? [{ userId: review.userId }] : []), { user: { email: { equals: review.email, mode: "insensitive" } } }],
          items: { some: { OR: [{ snapshotProductId: review.product.id }, { productIdentifier: review.product.productIdentifier }] } },
        }, select: { id: true } });
        const notification = await tx.notification.create({ data: { userId: null, type: NotificationType.INFO, title: "New product review", message: "New review from " + review.name + " for " + review.product.productName + " (" + review.rating + " stars)" }, select: { id: true } });
        await tx.review.update({ where: { id }, data: { verifiedPurchase: Boolean(purchase), notificationId: notification.id, effectsProcessedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}
export const queueReviewEffects = (id: string) => {
  if (pending.has(id)) return;
  pending.add(id); waiting.push(id);
  setImmediate(drain);
};
function drain() {
  while (active < 4 && waiting.length) {
    const id = waiting.shift()!; active++;
    void processReviewEffects(id).catch(() => logger.warn({ reviewId: id }, "Review background effects will be retried")).finally(() => { pending.delete(id); active--; drain(); });
  }
}
let started = false;
export const startReviewWorker = () => {
  if (started) return; started = true;
  const recover = () => { void prisma.review.findMany({ where: { effectsProcessedAt: null }, select: { id: true }, take: 20, orderBy: { createdAt: "asc" } }).then(rows => rows.forEach(row => queueReviewEffects(row.id))).catch(() => logger.warn("Review background recovery is temporarily unavailable")); };
  recover(); const timer = setInterval(recover, 30000); timer.unref();
};
