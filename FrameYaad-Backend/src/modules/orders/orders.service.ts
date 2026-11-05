import { OrderStatus, Prisma, UserRole } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { createOrderPlacedNotifications } from "../notifications/notification-events.service";
import { orderViewSelect } from "./orders.select";
import { orderListQuerySchema } from "./orders.schemas";
import type { checkoutSchema, updateOrderStatusSchema } from "./orders.schemas";

type CheckoutInput = z.infer<typeof checkoutSchema>;
type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PLACED: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  PROCESSING: [OrderStatus.READY_TO_SHIP, OrderStatus.CANCELLED],
  READY_TO_SHIP: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.DELIVERED],
  DELIVERED: [],
  CANCELLED: [],
};

const orderNumber = async (): Promise<string> => {
  while (true) {
    const candidate = `FY-${Math.floor(1000 + Math.random() * 9000)}`;
    const existing = await prisma.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
};

export const checkout = (userId: string, input: CheckoutInput) =>
  prisma.$transaction(async (transaction) => {
    const address = await transaction.userAddress.findFirst({
      where: { id: input.userAddressId, userId },
      select: { id: true },
    });
    if (!address) throw new ApiError(400, "A valid owned address is required", "INVALID_ORDER_ADDRESS");

    const cart = await transaction.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        items: {
          select: {
            productIdentifier: true,
            quantity: true,
            product: {
              select: {
                material: { select: { isActive: true } },
                variant: { select: { isActive: true, price: true } },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      throw new ApiError(400, "Cart is empty", "CART_EMPTY");
    }
    if (cart.items.some((item) => !item.product.material.isActive || !item.product.variant?.isActive)) {
      throw new ApiError(409, "Cart contains an unavailable product", "CART_PRODUCT_UNAVAILABLE");
    }

    const orderItems = cart.items.map((item) => {
      const price = item.product.variant!.price;
      return {
        productIdentifier: item.productIdentifier,
        quantity: item.quantity,
        price,
        subtotal: price.mul(item.quantity),
      };
    });
    const totalPrice = orderItems.reduce(
      (total, item) => total.add(item.subtotal),
      new Prisma.Decimal(0),
    );

    const order = await transaction.order.create({
      data: {
        userId,
        userAddressId: address.id,
        orderNumber: await orderNumber(),
        totalPrice,
        remark: input.remark,
        items: { create: orderItems },
      },
      select: orderViewSelect,
    });
    await createOrderPlacedNotifications(transaction, order);
    await transaction.cartItem.deleteMany({ where: { cartId: cart.id } });
    await transaction.cart.update({ where: { id: cart.id }, data: { totalPrice: 0 } });
    return order;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const listOrders = async (rawQuery: unknown, actorId: string, role: UserRole) => {
  const { page, limit, status, userId, search } = orderListQuerySchema.parse(rawQuery);
  const where: Prisma.OrderWhereInput = {
    ...(role === UserRole.CUSTOMER ? { userId: actorId } : userId ? { userId } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? /^FY-\d{4}$/i.test(search)
        ? { orderNumber: { equals: search.toUpperCase() } }
        : { orderNumber: { contains: search, mode: "insensitive" } }
      : {}),
  };
  const [orders, total, pendingCount, processingCount, shippedCount, deliveredCount, cancelledCount] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: orderViewSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...where, status: OrderStatus.PLACED } }),
    prisma.order.count({ where: { ...where, status: { in: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.READY_TO_SHIP] } } }),
    prisma.order.count({ where: { ...where, status: OrderStatus.SHIPPED } }),
    prisma.order.count({ where: { ...where, status: OrderStatus.DELIVERED } }),
    prisma.order.count({ where: { ...where, status: OrderStatus.CANCELLED } }),
  ]);
  return {
    orders,
    pagination: paginationMeta(page, limit, total),
    summary: {
      totalCount: total,
      pendingCount,
      processingCount,
      shippedCount,
      deliveredCount,
      cancelledCount,
    },
  };
};

export const getOrder = async (id: string, actorId: string, role: UserRole) => {
  const order = await prisma.order.findFirst({
    where: { id, ...(role === UserRole.CUSTOMER ? { userId: actorId } : {}) },
    select: orderViewSelect,
  });
  if (!order) throw new ApiError(404, "Order was not found", "ORDER_NOT_FOUND");
  return order;
};

export const updateOrderStatus = async (id: string, input: UpdateOrderStatusInput) => {
  const existing = await prisma.order.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new ApiError(404, "Order was not found", "ORDER_NOT_FOUND");
  if (!allowedTransitions[existing.status].includes(input.status)) {
    throw new ApiError(
      409,
      `Order cannot move from ${existing.status} to ${input.status}`,
      "INVALID_ORDER_STATUS_TRANSITION",
    );
  }
  return prisma.order.update({
    where: { id },
    data: { status: input.status, ...(input.remark === undefined ? {} : { remark: input.remark }) },
    select: orderViewSelect,
  });
};
