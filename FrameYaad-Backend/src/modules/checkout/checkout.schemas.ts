import { z } from "zod";
export const checkoutItemsSchema = z.array(z.object({
  productIdentifier: z.string().trim().min(1).max(100),
  variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10000),
  colorName: z.string().trim().max(50).optional(), colorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).strict()).min(1).max(100);
export const offerCodeSchema = z.enum(["FIRST_ORDER", "BIG_ORDER"]);
