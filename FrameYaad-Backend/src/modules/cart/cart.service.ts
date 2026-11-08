import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { cartViewSelect } from "./cart.select";
import { productViewSelect } from "../products/products.select";
import { resolveFrameColor } from "../colors/color-resolver";
import type { addCartItemSchema, moveCartItemToWishlistSchema, updateCartItemSchema } from "./cart.schemas";

type AddCartItemInput = z.infer<typeof addCartItemSchema>;
type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
type MoveCartItemToWishlistInput = z.infer<typeof moveCartItemToWishlistSchema>;

const wishlistSelect = {
  id: true,
  userId: true,
  productIdentifier: true,
  createdAt: true,
  product: { select: productViewSelect },
} as const;

const getOrCreateCart = (transaction: Prisma.TransactionClient, userId: string) =>
  transaction.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });

const refreshCartTotal = async (transaction: Prisma.TransactionClient, cartId: string): Promise<void> => {
  const totals = await transaction.cartItem.aggregate({
    where: { cartId },
    _sum: { subtotal: true },
  });
  await transaction.cart.update({
    where: { id: cartId },
    data: { totalPrice: totals._sum.subtotal ?? new Prisma.Decimal(0) },
  });
};

const getAvailableProduct = async (transaction: Prisma.TransactionClient, productIdentifier: string, variantId?: string | null) => {
  const variantSelect = { id: true, color: true, frameSize: true, isActive: true, price: true } as const;
  const product = await transaction.product.findUnique({
    where: { productIdentifier },
    select: {
      id: true, productName: true, productIdentifier: true,
      material: { select: { isActive: true, name: true, availableColors: true } },
      variant: { select: variantSelect }, variants: { select: variantSelect },
    },
  });
  const variant = variantId ? product?.variants.find(item => item.id === variantId) ?? (product?.variant?.id === variantId ? product.variant : undefined) : product?.variant;
  if (!product || !product.material.isActive || !variant?.isActive) throw new ApiError(404, "Product variant is not available", "PRODUCT_NOT_AVAILABLE");
  return { ...product, variant };
};


const returnCart = (transaction: Prisma.TransactionClient, cartId: string) =>
  transaction.cart.findUniqueOrThrow({ where: { id: cartId }, select: cartViewSelect });

export const getCart = async (userId: string) => {
  const cart = await prisma.cart.findUnique({ where: { userId }, select: cartViewSelect });
  if (cart) return cart;
  return prisma.cart.create({ data: { userId }, select: cartViewSelect });
};

export const addItem = (userId: string, input: AddCartItemInput) =>
  prisma.$transaction(async (transaction) => {
    const cart = await getOrCreateCart(transaction, userId);
    const product = await getAvailableProduct(transaction, input.productIdentifier, input.variantId);
    const color = await resolveFrameColor(input.color || product.variant.color);
    if (input.color && !product.material.availableColors.some(value => [input.color, color.name, color.hex].some(candidate => candidate?.toLowerCase() === value.toLowerCase())) && product.variant.color?.toLowerCase() !== input.color.toLowerCase()) {
      throw new ApiError(400, "Select an available product colour", "INVALID_PRODUCT_COLOR");
    }
    const selectionKey = input.variantId || input.color ? [product.variant.id, color.hex || color.name || ""].join(":") : "";
    const selection = { selectedVariantId: product.variant.id, selectedColorName: color.name, selectedColorHex: color.hex, selectionKey };
    const existing = await transaction.cartItem.findUnique({
      where: {
        cartId_productIdentifier_selectionKey: {
          cartId: cart.id,
          productIdentifier: input.productIdentifier,
          selectionKey,
        },
      },
      select: { id: true, quantity: true },
    });
    const quantity = (existing?.quantity ?? 0) + input.quantity;
    if (quantity > 99) throw new ApiError(400, "Cart item quantity cannot exceed 99", "QUANTITY_LIMIT_EXCEEDED");
    const price = product.variant.price;
    const subtotal = price.mul(quantity);

    if (existing) {
      await transaction.cartItem.update({
        where: { id: existing.id },
        data: { quantity, price, subtotal, ...selection },
      });
    } else {
      await transaction.cartItem.create({
        data: {
          cartId: cart.id,
          productIdentifier: input.productIdentifier,
          ...selection,
          quantity,
          price,
          subtotal,
        },
      });
    }
    await refreshCartTotal(transaction, cart.id);
    return returnCart(transaction, cart.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const updateItem = (userId: string, itemId: string, input: UpdateCartItemInput) =>
  prisma.$transaction(async (transaction) => {
    const item = await transaction.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      select: { id: true, cartId: true, productIdentifier: true, selectedVariantId: true },
    });
    if (!item) throw new ApiError(404, "Cart item was not found", "CART_ITEM_NOT_FOUND");
    const product = await getAvailableProduct(transaction, item.productIdentifier, item.selectedVariantId);
    const price = product.variant.price;
    await transaction.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity, price, subtotal: price.mul(input.quantity) },
    });
    await refreshCartTotal(transaction, item.cartId);
    return returnCart(transaction, item.cartId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const removeItem = (userId: string, itemId: string) =>
  prisma.$transaction(async (transaction) => {
    const item = await transaction.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      select: { id: true, cartId: true },
    });
    if (!item) throw new ApiError(404, "Cart item was not found", "CART_ITEM_NOT_FOUND");
    await transaction.cartItem.delete({ where: { id: item.id } });
    await refreshCartTotal(transaction, item.cartId);
    return returnCart(transaction, item.cartId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const moveItemToWishlist = (userId: string, input: MoveCartItemToWishlistInput) =>
  prisma.$transaction(async (transaction) => {
    const product = await getAvailableProduct(transaction, input.productIdentifier);
    const cart = await transaction.cart.findUnique({
      where: { userId },
      select: { id: true },
    });

    const wishlistItem = await transaction.wishlist.upsert({
      where: {
        userId_productIdentifier: {
          userId,
          productIdentifier: product.productIdentifier,
        },
      },
      create: { userId, productIdentifier: product.productIdentifier },
      update: {},
      select: wishlistSelect,
    });

    if (cart) {
      await transaction.cartItem.deleteMany({
        where: { cartId: cart.id, productIdentifier: product.productIdentifier },
      });
      await refreshCartTotal(transaction, cart.id);
    }

    return {
      wishlistItem,
      cart: cart ? await returnCart(transaction, cart.id) : null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const clearCart = async (userId: string): Promise<void> => {
  const cart = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });
  if (!cart) return;
  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { cartId: cart.id } }),
    prisma.cart.update({ where: { id: cart.id }, data: { totalPrice: 0 } }),
  ]);
};
