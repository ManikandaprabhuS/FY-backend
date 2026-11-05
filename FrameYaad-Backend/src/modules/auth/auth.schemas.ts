import { z } from "zod";

import { MINIMUM_PASSWORD_LENGTH } from "../../constants/auth";

export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const passwordSchema = z.string().min(MINIMUM_PASSWORD_LENGTH).max(72);

const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable().optional();

export const profileFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phoneNumber: z.string().trim().min(7).max(20).nullable().optional(),
  addressLine: optionalText(255),
  postalCode: optionalText(20),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  gender: optionalText(30),
}).strict();

export const registrationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  phoneNumber: z.string().trim().min(7).max(20).optional(),
}).strict();

export const customerRegistrationSchema = registrationSchema.extend({
  gender: z.enum(["MALE", "FEMALE"]),
}).strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
}).strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20).optional(),
  newPassword: passwordSchema,
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
}).strict().refine((value) => value.currentPassword !== value.newPassword, {
  message: "New password must be different from the current password",
  path: ["newPassword"],
});

export const updateOwnProfileSchema = profileFieldsSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one profile field is required" },
);
