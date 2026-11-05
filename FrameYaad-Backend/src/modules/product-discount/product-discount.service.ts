import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { logger } from "../../config/logger";
import { listProductDiscountSchema, type CreateProductDiscountInput, type UpdateProductDiscountInput } from "./product-discount.schemas";

const select = {
  id: true, productVariantId: true, couponId: true, expiresAt: true, createdAt: true, updatedAt: true,
  variant: { select: { id: true, color: true, frameSize: true, mountType: true, glassType: true, product: { select: { id: true, productName: true, productIdentifier: true } } } },
  coupon: { select: { id: true, code: true, couponType: true, discountType: true, discountValue: true, isActive: true, startDate: true, endDate: true } },
} satisfies Prisma.ProductDiscountSelect;

const assertReferences = async (input: CreateProductDiscountInput) => {
  const [variant, coupon] = await Promise.all([
    prisma.variant.findUnique({ where: { id: input.productVariantId }, select: { id: true } }),
    prisma.coupon.findUnique({ where: { id: input.couponId }, select: { id: true } }),
  ]);
  if (!variant) throw new ApiError(400, "Product variant does not exist", "VARIANT_NOT_FOUND");
  if (!coupon) throw new ApiError(400, "Coupon does not exist", "COUPON_NOT_FOUND");
  if (input.expiresAt && input.expiresAt < new Date()) throw new ApiError(400, "Discount expiry must be in the future", "INVALID_DISCOUNT_EXPIRY");
};

export const list = async (rawQuery: unknown) => {
  const query = listProductDiscountSchema.parse(rawQuery);
  const where: Prisma.ProductDiscountWhereInput = {
    ...(query.productVariantId ? { productVariantId: query.productVariantId } : {}),
    ...(query.couponId ? { couponId: query.couponId } : {}),
  };
  const [assignments, total] = await prisma.$transaction([
    prisma.productDiscount.findMany({ where, select, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.productDiscount.count({ where }),
  ]);
  return { assignments, pagination: paginationMeta(query.page, query.limit, total) };
};

export const get = async (id: string) => {
  const item = await prisma.productDiscount.findUnique({ where: { id }, select });
  if (!item) throw new ApiError(404, "Product discount assignment was not found", "PRODUCT_DISCOUNT_NOT_FOUND");
  return item;
};

export const create = async (input: CreateProductDiscountInput) => {
  await assertReferences(input);
  const item = await prisma.productDiscount.create({ data: input, select });
  logger.info({ assignmentId: item.id }, "Product Variant Coupon Assignment Created");
  return item;
};

export const update = async (id: string, input: UpdateProductDiscountInput) => {
  await get(id);
  const item = await prisma.productDiscount.update({ where: { id }, data: input, select });
  logger.info({ assignmentId: id }, "Product Variant Coupon Assignment Updated");
  return item;
};

export const remove = async (id: string) => {
  await get(id);
  await prisma.productDiscount.delete({ where: { id } });
  logger.info({ assignmentId: id }, "Product Variant Coupon Assignment Deleted");
};
