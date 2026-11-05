import { z } from "zod";

export const assignmentIdSchema = z.string().uuid();
export const createProductDiscountSchema = z.object({
  productVariantId: z.string().uuid(),
  couponId: z.string().uuid(),
  expiresAt: z.coerce.date().nullable().optional(),
});
export const updateProductDiscountSchema = z.object({ expiresAt: z.coerce.date().nullable().optional() });
export const listProductDiscountSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  productVariantId: z.string().uuid().optional(),
  couponId: z.string().uuid().optional(),
});
export type CreateProductDiscountInput = z.infer<typeof createProductDiscountSchema>;
export type UpdateProductDiscountInput = z.infer<typeof updateProductDiscountSchema>;
