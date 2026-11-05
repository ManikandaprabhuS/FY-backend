import { OrderStatus } from "@prisma/client";
import { z } from "zod";

export const orderIdSchema = z.string().uuid();
export const checkoutSchema = z.object({
  userAddressId: z.string().uuid(),
  remark: z.string().trim().max(500).optional(),
}).strict();
export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  remark: z.string().trim().max(500).nullable().optional(),
}).strict();
export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(OrderStatus).optional(),
  userId: z.string().uuid().optional(),
  search: z.string().trim().max(40).optional(),
});
