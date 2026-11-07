import { z } from "zod";
import { inputDateSchema } from "../../utils/input-schemas";

export const assignmentIdSchema = z.string().uuid();
export const createProductDiscountSchema = z.object({
  productVariantId: z.string().uuid(),
  couponId: z.string().uuid(),
  expiresAt: inputDateSchema.nullable().optional(),
}).strict();
export const updateProductDiscountSchema = z.object({ expiresAt: inputDateSchema.nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, "At least one discount field is required");
export const listProductDiscountSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  productVariantId: z.string().uuid().optional(),
  couponId: z.string().uuid().optional(),
});
export type CreateProductDiscountInput = z.infer<typeof createProductDiscountSchema>;
export type UpdateProductDiscountInput = z.infer<typeof updateProductDiscountSchema>;
