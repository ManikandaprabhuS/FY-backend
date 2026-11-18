import type { Prisma } from '@prisma/client';
import { ApiError } from '../../utils/api-error';

type StockItem = { snapshotVariantId: string | null; quantity: number };
/** Run inside the order transaction; deterministic ordering prevents cross-cart deadlocks. */
export async function changeOrderStock(tx: Prisma.TransactionClient, items: readonly StockItem[], restore = false) {
  const quantities = new Map<string, number>();
  for (const item of items) if (item.snapshotVariantId) quantities.set(item.snapshotVariantId, (quantities.get(item.snapshotVariantId) ?? 0) + item.quantity);
  for (const [id, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
    const result = await tx.variant.updateMany({
      where: { id, ...(restore ? {} : { isActive: true, stockQuantity: { gte: quantity } }) },
      data: { stockQuantity: restore ? { increment: quantity } : { decrement: quantity } },
    });
    if (!restore && result.count !== 1) throw new ApiError(409, 'This variant is out of stock or no longer has the requested quantity. Please review your cart.', 'INSUFFICIENT_STOCK');
  }
}
