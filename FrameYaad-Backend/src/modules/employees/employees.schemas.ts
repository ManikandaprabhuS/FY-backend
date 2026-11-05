import { z } from "zod";

import { profileFieldsSchema, registrationSchema } from "../auth/auth.schemas";

export const employeeIdSchema = z.string().uuid();
export const createEmployeeSchema = registrationSchema;
export const adminUpdateEmployeeSchema = profileFieldsSchema.extend({
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});
