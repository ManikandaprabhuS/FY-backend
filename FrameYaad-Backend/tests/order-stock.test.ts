import type { Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { changeOrderStock } from '../src/modules/orders/order-stock';

it('groups quantities per variant and guards each atomic decrement in stable lock order', async () => {
 const updateMany = vi.fn().mockResolvedValue({ count: 1 });
 const tx = { variant: { updateMany } } as unknown as Prisma.TransactionClient;
 await changeOrderStock(tx, [{snapshotVariantId:'b',quantity:1},{snapshotVariantId:'a',quantity:3},{snapshotVariantId:'b',quantity:2}]);
 expect(updateMany.mock.calls.map(([args])=>args)).toEqual([
  {where:{id:'a',isActive:true,stockQuantity:{gte:3}},data:{stockQuantity:{decrement:3}}},
  {where:{id:'b',isActive:true,stockQuantity:{gte:3}},data:{stockQuantity:{decrement:3}}},
 ]);
});
it('rejects an exhausted variant so the surrounding order transaction rolls back', async () => {
 const tx = { variant: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as unknown as Prisma.TransactionClient;
 await expect(changeOrderStock(tx,[{snapshotVariantId:'v',quantity:1}])).rejects.toMatchObject({statusCode:409,code:'INSUFFICIENT_STOCK',message:expect.stringContaining('out of stock')});
});
it('restores the snapshot variant quantity, not the current primary product variant', async () => {
 const updateMany = vi.fn().mockResolvedValue({ count: 1 });
 await changeOrderStock({variant:{updateMany}} as unknown as Prisma.TransactionClient,[{snapshotVariantId:'selected',quantity:3}],true);
 expect(updateMany).toHaveBeenCalledWith({where:{id:'selected'},data:{stockQuantity:{increment:3}}});
});
it('does not fabricate a variant for historical items with no variant snapshot', async () => {
 const updateMany = vi.fn();
 await changeOrderStock({variant:{updateMany}} as unknown as Prisma.TransactionClient,[{snapshotVariantId:null,quantity:3}],true);
 expect(updateMany).not.toHaveBeenCalled();
});
