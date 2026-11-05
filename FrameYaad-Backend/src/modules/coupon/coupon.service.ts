import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { logger } from "../../config/logger";
import { couponListQuerySchema, type CreateCouponInput, type UpdateCouponInput, type ValidateCouponInput } from "./coupon.schemas";
import { couponViewSelect } from "./coupon.select";

const validateRules = (input: CreateCouponInput | UpdateCouponInput) => {
  if (input.endDate && input.startDate && input.endDate < input.startDate) throw new ApiError(400, "End date cannot be before start date", "INVALID_COUPON_DATES");
  if (input.expiresAt && input.startDate && input.expiresAt < input.startDate) throw new ApiError(400, "Expiry cannot be before start date", "INVALID_COUPON_EXPIRY");
};

export const listCoupons = async (rawQuery: unknown) => {
  const query = couponListQuerySchema.parse(rawQuery);
  const where: Prisma.CouponWhereInput = {
    ...(query.search ? { OR: [{ code: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
  };
  const orderBy = { [query.sortBy]: query.sortOrder } as Prisma.CouponOrderByWithRelationInput;
  const [coupons, total] = await prisma.$transaction([
    prisma.coupon.findMany({ where, select: couponViewSelect, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.coupon.count({ where }),
  ]);
  return { coupons, pagination: paginationMeta(query.page, query.limit, total) };
};

export const getCoupon = async (id: string) => {
  const coupon = await prisma.coupon.findUnique({ where: { id }, select: couponViewSelect });
  if (!coupon) throw new ApiError(404, "Coupon was not found", "COUPON_NOT_FOUND");
  return coupon;
};

export const validateCoupon = async (input: ValidateCouponInput) => {
  const now = new Date();
  const coupon = await prisma.coupon.findUnique({
    where: { code: input.code.toUpperCase() },
    select: {
      code: true,
      couponType: true,
      discountType: true,
      discountValue: true,
      minimumOrderValue: true,
      usageLimit: true,
      usageCount: true,
      isActive: true,
      startDate: true,
      endDate: true,
      expiresAt: true,
      discounts: {
        where: {
          productVariantId: { in: input.items.map((item) => item.productVariantId) },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { productVariantId: true },
      },
    },
  });

  if (!coupon) throw new ApiError(400, "Promo code is invalid", "INVALID_PROMO_CODE");
  if (!coupon.isActive) throw new ApiError(400, "This promo code is inactive", "INACTIVE_PROMO_CODE");
  if (now < coupon.startDate) throw new ApiError(400, "This promo code is not active yet", "PROMO_CODE_NOT_STARTED");
  if (now > coupon.endDate || now > coupon.expiresAt) throw new ApiError(400, "This promo code has expired", "EXPIRED_PROMO_CODE");
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) throw new ApiError(400, "This promo code has reached its usage limit", "PROMO_USAGE_LIMIT_REACHED");

  const subtotal = input.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  const minimumOrderValue = Number(coupon.minimumOrderValue);
  if (subtotal < minimumOrderValue) {
    throw new ApiError(400, `A minimum order value of ₹${minimumOrderValue.toLocaleString("en-IN")} is required for this promo code`, "PROMO_MINIMUM_ORDER_NOT_MET");
  }

  const eligibleVariantIds = new Set(coupon.discounts.map((discount) => discount.productVariantId));
  const eligibleItems = input.items.filter((item) => eligibleVariantIds.has(item.productVariantId));
  if (eligibleItems.length === 0) throw new ApiError(400, "This promo code is not valid for the products in your cart", "PROMO_NOT_APPLICABLE");
  const eligibleSubtotal = eligibleItems.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  const discountValue = Number(coupon.discountValue);
  let discountAmount = coupon.discountType === "PERCENTAGE"
    ? eligibleSubtotal * (discountValue / 100)
    : coupon.discountType === "FLAT"
      ? discountValue
      : coupon.couponType === "BUY_ONE_GET_ONE"
        ? eligibleItems.reduce((total, item) => total + Math.floor(item.quantity / 2) * item.unitPrice, 0)
        : coupon.couponType === "BUY_TWO_GET_ONE"
          ? eligibleItems.reduce((total, item) => total + Math.floor(item.quantity / 3) * item.unitPrice, 0)
          : 0;
  if (discountAmount === 0 && coupon.discountType === "NONE") {
    const requiredQuantity = coupon.couponType === "BUY_ONE_GET_ONE" ? 2 : coupon.couponType === "BUY_TWO_GET_ONE" ? 3 : 0;
    throw new ApiError(400, requiredQuantity > 0 ? `Add at least ${requiredQuantity} eligible items to use this promo code` : "This promo code cannot be applied to the cart total", "PROMO_REQUIREMENTS_NOT_MET");
  }
  discountAmount = Math.min(eligibleSubtotal, Math.max(0, discountAmount));
  const roundedDiscount = Math.round(discountAmount * 100) / 100;

  return {
    coupon: {
      code: coupon.code,
      couponType: coupon.couponType,
      discountType: coupon.discountType,
      discountValue,
    },
    subtotal,
    eligibleSubtotal,
    discountAmount: roundedDiscount,
    total: Math.max(0, Math.round((subtotal - roundedDiscount) * 100) / 100),
  };
};

export const createCoupon = async (input: CreateCouponInput, actorId: string) => {
  validateRules(input);
  const coupon = await prisma.coupon.create({ data: { ...input, code: input.code.toUpperCase(), createdById: actorId }, select: couponViewSelect });
  logger.info({ couponId: coupon.id }, "Coupon Created");
  return coupon;
};

export const updateCoupon = async (id: string, input: UpdateCouponInput) => {
  await getCoupon(id); validateRules(input);
  const coupon = await prisma.coupon.update({ where: { id }, data: { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) }, select: couponViewSelect });
  logger.info({ couponId: id }, "Coupon Updated");
  return coupon;
};

export const updateCouponStatus = async (id: string, isActive: boolean) => {
  await getCoupon(id);
  const coupon = await prisma.coupon.update({ where: { id }, data: { isActive }, select: couponViewSelect });
  logger.info({ couponId: id }, isActive ? "Coupon Activated" : "Coupon Deactivated");
  return coupon;
};

export const deleteCoupon = async (id: string) => {
  await getCoupon(id);
  await prisma.coupon.delete({ where: { id } });
  logger.info({ couponId: id }, "Coupon Deleted");
};
