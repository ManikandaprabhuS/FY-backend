import type { Prisma } from "@prisma/client";

export const userViewSelect = {
  id: true,
  name: true,
  email: true,
  isEmailVerified: true,
  phoneNumber: true,
  isPhoneNumberVerified: true,
  addressLine: true,
  postalCode: true,
  city: true,
  state: true,
  country: true,
  gender: true,
  role: true,
  isActive: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserView = Prisma.UserGetPayload<{ select: typeof userViewSelect }>;
