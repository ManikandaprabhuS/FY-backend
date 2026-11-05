import { z } from "zod";

import { profileFieldsSchema } from "../auth/auth.schemas";

export const userIdSchema = z.string().uuid();

export const adminUpdateUserSchema = profileFieldsSchema.extend({
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});
