import { z } from "zod";

export const wishlistIdSchema = z.string().uuid();

export const addWishlistItemSchema = z.object({
  productIdentifier: z.string().trim().min(2).max(100),
}).strict();
