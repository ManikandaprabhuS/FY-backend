import type { Prisma } from "@prisma/client";

export const couponViewSelect = {
  id: true, code: true, description: true, couponType: true, discountType: true,
  discountValue: true, minimumOrderValue: true, usageLimit: true, usagePerUser: true,
  usageCount: true, newUserOnly: true, festivalCoupon: true, buyOneGetOne: true,
  buyTwoGetOne: true, isActive: true, startDate: true, endDate: true, expiresAt: true,
  createdById: true, createdAt: true, updatedAt: true,
  createdBy: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.CouponSelect;
