import { OrderStatus, Prisma, UserRole } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { createOrderPlacedNotifications } from "../notifications/notification-events.service";
import { orderViewSelect, serializeOrderItem } from "./orders.select";
import { resolveLegacyColor } from "../colors/colors.values";
import { orderListQuerySchema } from "./orders.schemas";
import { buildOrderWhere, orderRangeLabels } from "./orders.filters";
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

export const getOrdersBatch = (ids: string[]) => prisma.order.findMany({
  where: { id: { in: [...new Set(ids)] } }, select: orderViewSelect,
});

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
            selectedVariantId: true, selectedColorName: true, selectedColorHex: true,
            quantity: true,
            product: {
              select: {
                id: true, productName: true,
                material: { select: { isActive: true, name: true } },
                variant: { select: { id: true, color: true, frameSize: true, isActive: true, price: true } },
                variants: { select: { id: true, color: true, frameSize: true, isActive: true, price: true } },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      throw new ApiError(400, "Cart is empty", "CART_EMPTY");
    }
    if (cart.items.some((item) => !item.product.material.isActive || (!item.selectedVariantId && !item.product.variant?.isActive))) {
      throw new ApiError(409, "Cart contains an unavailable product", "CART_PRODUCT_UNAVAILABLE");
    }

    const orderItems = cart.items.map((item) => {
      const variant = item.selectedVariantId ? item.product.variants.find(value => value.id === item.selectedVariantId) ?? (item.product.variant?.id === item.selectedVariantId ? item.product.variant : undefined) : item.product.variant;
      if (!variant?.isActive) throw new ApiError(409, "Cart contains an unavailable variant", "CART_PRODUCT_UNAVAILABLE");
      const price = variant.price;
      const color = resolveLegacyColor(variant.color);
      return {
        productIdentifier: item.productIdentifier,
        snapshotProductId: item.product.id, snapshotProductName: item.product.productName,
        snapshotVariantId: variant.id, snapshotFrameSize: variant.frameSize,
        snapshotColorName: item.selectedColorName ?? color.name, snapshotColorHex: item.selectedColorHex ?? color.hex,
        snapshotMaterial: item.product.material.name,
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
  const query = orderListQuerySchema.parse(rawQuery);
  const { page, limit, status } = query;
  const where = await buildOrderWhere(query, actorId, role);
  // One grouped count replaces six separate aggregate queries. Keep status
  // summaries independent of the selected status, as in the original API.
  const { status: _status, ...summaryWhere } = where;
  void _status;
  const [orders, statusCounts] = await Promise.all([
    prisma.order.findMany({
      where,
      select: orderViewSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.groupBy({ by: ["status"], orderBy: { status: "asc" }, where: summaryWhere, _count: { _all: true } }),
  ]);
  const counts = new Map(statusCounts.map(group => [group.status, typeof group._count === "object" ? group._count._all ?? 0 : 0]));
  const total = status ? counts.get(status) ?? 0 : [...counts.values()].reduce((sum, count) => sum + count, 0);
  return {
    orders,
    pagination: paginationMeta(page, limit, total),
    summary: {
      totalCount: total,
      pendingCount: counts.get(OrderStatus.PLACED) ?? 0,
      processingCount: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.READY_TO_SHIP].reduce((sum, value) => sum + (counts.get(value) ?? 0), 0),
      shippedCount: counts.get(OrderStatus.SHIPPED) ?? 0,
      deliveredCount: counts.get(OrderStatus.DELIVERED) ?? 0,
      cancelledCount: counts.get(OrderStatus.CANCELLED) ?? 0,
    },
  };
};

const orderExportSelect = {
  id: true, createdAt: true, orderNumber: true, status: true, totalPrice: true,
  user: { select: { name: true } },
  items: orderViewSelect.items,
} satisfies Prisma.OrderSelect;

export const exportOrders = async (rawQuery: unknown, actorId: string, role: UserRole) => {
  const query = orderListQuerySchema.parse(rawQuery);
  const where = await buildOrderWhere(query, actorId, role);
  const orders: Prisma.OrderGetPayload<{ select: typeof orderExportSelect }>[] = [];
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.order.findMany({
      where, select: orderExportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    orders.push(...batch);
    if (batch.length < 500) break;
    cursor = batch[batch.length - 1]!.id;
  }
  const total = orders.reduce((sum, order) => sum.add(order.totalPrice), new Prisma.Decimal(0));
  return {
    range: [orderRangeLabels[query.dateFilter], query.status ? "Status: " + query.status.replaceAll("_", " ") : "", query.search ? "Search: " + query.search : ""].filter(Boolean).join(" | "),
    generatedAt: new Date().toISOString(),
    summary: { totalRevenue: total.toNumber(), orderCount: orders.length, averageOrderValue: orders.length ? total.div(orders.length).toNumber() : 0 },
    orders: orders.map(order => ({ createdAt: order.createdAt, orderNumber: order.orderNumber, orderStatus: order.status, totalAmount: Number(order.totalPrice), user: order.user, orderItems: order.items.map(serializeOrderItem) })),
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
