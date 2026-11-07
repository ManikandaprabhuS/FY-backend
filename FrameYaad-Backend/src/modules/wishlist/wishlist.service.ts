import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { parsePagination, paginationMeta } from "../../utils/pagination";
import { productViewSelect } from "../products/products.select";
import type { addWishlistItemSchema } from "./wishlist.schemas";

type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>;

const wishlistSelect = {
  id: true,
  userId: true,
  productIdentifier: true,
  createdAt: true,
  product: { select: productViewSelect },
} as const;

export const listWishlist = async (userId: string, rawQuery: unknown = {}) => {
  const { page, limit } = parsePagination(rawQuery);
  const [wishlist, total] = await Promise.all([prisma.wishlist.findMany({
    where: { userId },
    select: wishlistSelect,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit,
  }), prisma.wishlist.count({ where: { userId } })]);
  return { wishlist, pagination: paginationMeta(page, limit, total) };
};

export const lookupWishlist = (userId: string, identifiers: string[]) => prisma.wishlist.findMany({
  where: { userId, productIdentifier: { in: identifiers } }, select: { id: true, productIdentifier: true },
});

export const getWishlistAnalytics = async (rawQuery: unknown = {}) => {
  const { page, limit } = parsePagination(rawQuery);
  const counts = await prisma.wishlist.groupBy({
    by: ["productIdentifier"],
    _count: { userId: true },
    orderBy: [{ _count: { userId: "desc" } }, { productIdentifier: "asc" }], skip: (page - 1) * limit, take: limit,
  });

  const products = await prisma.product.findMany({
    where: { productIdentifier: { in: counts.map((item) => item.productIdentifier) } },
    select: { productIdentifier: true, productName: true },
  });
  const names = new Map(products.map((product) => [product.productIdentifier, product.productName]));

  const total = await prisma.product.count({ where: { wishlistItems: { some: {} } } });
  return { products: counts.map((item) => ({
    productIdentifier: item.productIdentifier,
    productName: names.get(item.productIdentifier) ?? item.productIdentifier,
    wishlistUserCount: item._count.userId,
  })), pagination: paginationMeta(page, limit, total) };
};

export const addWishlistItem = async (userId: string, input: AddWishlistItemInput) => {
  const product = await prisma.product.findFirst({
    where: {
      productIdentifier: input.productIdentifier,
      material: { isActive: true },
      variant: { isActive: true },
    },
    select: { productIdentifier: true },
  });
  if (!product) {
    throw new ApiError(404, "An active product was not found", "PRODUCT_NOT_FOUND");
  }

  const existing = await prisma.wishlist.findUnique({
    where: {
      userId_productIdentifier: { userId, productIdentifier: product.productIdentifier },
    },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(409, "Product is already in the wishlist", "WISHLIST_ITEM_EXISTS");
  }

  return prisma.wishlist.create({
    data: { userId, productIdentifier: product.productIdentifier },
    select: wishlistSelect,
  });
};

export const removeWishlistItem = async (id: string, userId: string): Promise<void> => {
  const result = await prisma.wishlist.deleteMany({ where: { id, userId } });
  if (result.count === 0) {
    throw new ApiError(404, "Wishlist item was not found", "WISHLIST_ITEM_NOT_FOUND");
  }
};
