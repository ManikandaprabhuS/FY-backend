import { NotificationType } from "@prisma/client";
import { z } from "zod";

export const notificationIdSchema = z.string().uuid();

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  read: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  type: z.nativeEnum(NotificationType).optional(),
});
