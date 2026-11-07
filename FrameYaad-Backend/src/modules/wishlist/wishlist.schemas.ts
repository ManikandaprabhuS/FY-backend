import { z } from "zod";

export const wishlistIdSchema = z.string().uuid();
export const wishlistLookupSchema = z.object({ productIdentifiers: z.array(z.string().trim().min(2).max(100)).max(100) }).strict();

export const addWishlistItemSchema = z.object({
  productIdentifier: z.string().trim().min(2).max(100),
}).strict();
