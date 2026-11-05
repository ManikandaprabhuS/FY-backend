import { z } from "zod";

export const couponIdSchema = z.string().uuid();
const couponType = z.enum(["PERCENTAGE", "FLAT", "LIMITED_COUNT", "ORDER_PRICE_ABOVE", "ONCE_PER_USER", "NEW_USER", "FESTIVAL", "BUY_ONE_GET_ONE", "BUY_TWO_GET_ONE"]);
const discountType = z.enum(["PERCENTAGE", "FLAT", "NONE"]);
const date = z.coerce.date();

const couponBaseSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().trim().max(2000).optional().nullable(),
  couponType,
  discountType,
  discountValue: z.number().nonnegative(),
  minimumOrderValue: z.number().nonnegative().default(0),
  usageLimit: z.number().int().positive().optional().nullable(),
  usagePerUser: z.number().int().positive().optional().nullable(),
  newUserOnly: z.boolean().default(false),
  festivalCoupon: z.boolean().default(false),
  buyOneGetOne: z.boolean().default(false),
  buyTwoGetOne: z.boolean().default(false),
  isActive: z.boolean().default(true),
  startDate: date,
  endDate: date,
  expiresAt: date,
});

const applyCouponRefinements = <T extends typeof couponBaseSchema>(schema: T) => schema.superRefine((value, ctx) => {
  if (value.endDate < value.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date cannot be before start date" });
  if (value.expiresAt < value.startDate) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Expiry cannot be before start date" });
  if (value.discountType === "PERCENTAGE" && value.discountValue > 100) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount cannot exceed 100" });
  if (value.usagePerUser && value.usageLimit && value.usagePerUser > value.usageLimit) ctx.addIssue({ code: "custom", path: ["usagePerUser"], message: "Usage per user cannot exceed usage limit" });
});

export const createCouponSchema = applyCouponRefinements(couponBaseSchema);

// Derive from the unrefined base object, then apply update-only conditional
// checks. Zod v4 intentionally rejects partial() on refined objects.
export const updateCouponSchema = couponBaseSchema.partial().superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date cannot be before start date" });
  if (value.startDate && value.expiresAt && value.expiresAt < value.startDate) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Expiry cannot be before start date" });
  if (value.discountType === "PERCENTAGE" && value.discountValue !== undefined && value.discountValue > 100) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount cannot exceed 100" });
  if (value.usagePerUser !== undefined && value.usageLimit !== undefined && value.usagePerUser !== null && value.usageLimit !== null && value.usagePerUser > value.usageLimit) ctx.addIssue({ code: "custom", path: ["usagePerUser"], message: "Usage per user cannot exceed usage limit" });
});

export const couponListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  sortBy: z.enum(["code", "createdAt", "startDate", "endDate", "usageCount"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export const couponStatusSchema = z.object({ isActive: z.boolean() });

export const validateCouponSchema = z.object({
  code: z.string().trim().min(1, "Promo code is required").max(40),
  items: z.array(z.object({
    productVariantId: z.string().uuid(),
    unitPrice: z.number().nonnegative(),
    quantity: z.number().int().positive(),
  })).min(1, "Cart must contain at least one item"),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
