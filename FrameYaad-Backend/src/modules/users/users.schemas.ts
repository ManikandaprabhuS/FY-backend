import { z } from "zod";

import { profileFieldsSchema } from "../auth/auth.schemas";

export const userIdSchema = z.string().uuid();
export const customerPhoneLookupSchema = z.object({
  phone: z.string().trim().min(7).max(24).regex(/^[+\d\s()-]+$/)
    .transform(value => value.replace(/\D/g, ""))
    .refine(value => value.length >= 7 && value.length <= 15, "Enter a valid phone number"),
});

export const adminUpdateUserSchema = profileFieldsSchema.extend({
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});
