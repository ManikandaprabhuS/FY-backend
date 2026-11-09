import { UserRole, type Prisma } from "@prisma/client";
import type { z } from "zod";
import type { productListQuerySchema } from "./products.schemas";

export const buildProductWhere = ({ search, materialId, variantId, isActive }: z.infer<typeof productListQuerySchema>, role: UserRole): Prisma.ProductWhereInput => ({
  ...(role === UserRole.CUSTOMER ? { material: { isActive: true }, variant: { isActive: true } } : {}),
  ...(materialId ? { materialId } : {}),
  ...(variantId ? { variantId } : {}),
  ...(isActive === undefined ? {} : { material: { isActive } }),
  ...(search ? { OR: [{ productName: { contains: search, mode: "insensitive" } }, { productIdentifier: { contains: search, mode: "insensitive" } }] } : {}),
});
