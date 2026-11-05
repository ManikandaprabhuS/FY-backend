import { z } from "zod";

export const cartItemIdSchema = z.string().uuid();
export const addCartItemSchema = z.object({
  productIdentifier: z.string().trim().min(2).max(100),
  quantity: z.number().int().min(1).max(99),
}).strict();
export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(99),
}).strict();

export const moveCartItemToWishlistSchema = z.object({
  productIdentifier: z.string().trim().min(2).max(100),
}).strict();
