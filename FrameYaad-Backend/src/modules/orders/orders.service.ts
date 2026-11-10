import { OrderStatus, Prisma, UserRole } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../prisma/client";
import { lockOfferSettings } from "../offers/offers.service";
import { lockOfferIdentity, offerIdentity, priceCheckoutItems, validateOffer } from "../checkout/checkout.service";
import { assertAvailableStock } from "../../utils/stock";
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

const resolveLegacyOrderCoupons = async <T extends {couponId:string|null;couponTitle:string|null}>(orders:T[]):Promise<T[]> => {
  const ids=[...new Set(orders.flatMap(o=>o.couponId&&!o.couponTitle?[o.couponId]:[]))];
  if(!ids.length)return orders;
  const archive=await prisma.legacyCoupon.findMany({where:{id:{in:ids}},select:{id:true,code:true}});
  const codes=new Map(archive.map(c=>[c.id,c.code]));
  return orders.map(o=>({...o,couponTitle:o.couponTitle??(o.couponId?codes.get(o.couponId)??o.couponId:null)}));
};

export const getOrdersBatch = (ids: string[]) => prisma.order.findMany({
  where: { id: { in: [...new Set(ids)] } }, select: orderViewSelect,
}).then(resolveLegacyOrderCoupons);

const orderNumber = async (database: Pick<Prisma.TransactionClient,"order">): Promise<string> => {
  while (true) {
    const candidate = `FY-${Math.floor(1000 + Math.random() * 9000)}`;
    const existing = await database.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
};

export const checkout = async (userId: string, input: CheckoutInput) => {
  for (let attempt=0; ; attempt++) {
    try { return await checkoutAttempt(userId,input); }
    catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
};
const checkoutAttempt = (userId: string, input: CheckoutInput) =>
  prisma.$transaction(async (transaction) => {
    if(input.couponCode)await lockOfferSettings(transaction,input.couponCode);
    const identity = await offerIdentity(transaction,userId);
    await lockOfferIdentity(transaction,identity.email,identity.phone);
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
                variant: { select: { id: true, color: true, frameSize: true, isActive: true, price: true, stockQuantity: true } },
                variants: { select: { id: true, color: true, frameSize: true, isActive: true, price: true, stockQuantity: true } },
              },
            },
          },
        },
      },
    });
    if (!input.items && (!cart || cart.items.length === 0)) {
      throw new ApiError(400, "Cart is empty", "CART_EMPTY");
    }
    if (!input.items && cart?.items.some((item) => !item.product.material.isActive || (!item.selectedVariantId && !item.product.variant?.isActive))) {
      throw new ApiError(409, "Cart contains an unavailable product", "CART_PRODUCT_UNAVAILABLE");
    }

    const requestedByVariant = new Map<string, number>();
    const orderItems = input.items ? await priceCheckoutItems(transaction,input.items) : (cart?.items ?? []).map((item) => {
      const variant = item.selectedVariantId ? item.product.variants.find(value => value.id === item.selectedVariantId) ?? (item.product.variant?.id === item.selectedVariantId ? item.product.variant : undefined) : item.product.variant;
      if (!variant?.isActive) throw new ApiError(409, "Cart contains an unavailable variant", "CART_PRODUCT_UNAVAILABLE");
      const requested = (requestedByVariant.get(variant.id) ?? 0) + item.quantity;
      assertAvailableStock(requested, variant.stockQuantity);
      requestedByVariant.set(variant.id, requested);
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

    const offer = await validateOffer(transaction,userId,totalPrice,input.couponCode,input.couponVersion);
    const order = await transaction.order.create({
      data: {
        userId,
        userAddressId: address.id,
        orderNumber: await orderNumber(transaction),
        totalPrice: offer.total,
        subtotal: offer.subtotal, discountAmount: offer.discountAmount, discountPercent: offer.discountPercent,
        couponCode: offer.couponCode, couponTitle: offer.couponTitle,
        offerEmail: offer.offerEmail, offerPhone: offer.offerPhone,
        remark: input.remark,
        items: { create: orderItems },
      },
      select: orderViewSelect,
    });
    await createOrderPlacedNotifications(transaction, order);
    if (cart) {
      await transaction.cartItem.deleteMany({ where: { cartId: cart.id } });
      await transaction.cart.update({ where: { id: cart.id }, data: { totalPrice: 0 } });
    }
    return order;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });

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
    orders: await resolveLegacyOrderCoupons(orders),
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
  user: { select: { name: true, email: true, phoneNumber: true } },
  userAddress: orderViewSelect.userAddress,
  couponId: true,
  couponCode: true, couponTitle: true, discountPercent: true, discountAmount: true, subtotal: true,
  items: orderViewSelect.items,
} satisfies Prisma.OrderSelect;

export const exportOrders = async (rawQuery: unknown, actorId: string, role: UserRole) => {
  const query = orderListQuerySchema.parse(rawQuery);
  const where = await buildOrderWhere(query, actorId, role);
  const orders: Prisma.OrderGetPayload<{ select: typeof orderExportSelect }>[] = [];
  const couponCodes = new Map<string, string>();
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.order.findMany({
      where, select: orderExportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    orders.push(...batch);
    const couponIds = [...new Set(batch.flatMap(order => order.couponId && !couponCodes.has(order.couponId) ? [order.couponId] : []))];
    if (couponIds.length) {
      const coupons = await prisma.legacyCoupon.findMany({ where: { id: { in: couponIds } }, select: { id: true, code: true } });
      for (const coupon of coupons) couponCodes.set(coupon.id, coupon.code);
    }
    if (batch.length < 500) break;
    cursor = batch[batch.length - 1]!.id;
  }
  const total = orders.reduce((sum, order) => sum.add(order.totalPrice), new Prisma.Decimal(0));
  return {
    range: [orderRangeLabels[query.dateFilter], query.status ? "Status: " + query.status.replaceAll("_", " ") : "", query.search ? "Search: " + query.search : ""].filter(Boolean).join(" | "),
    generatedAt: new Date().toISOString(),
    summary: { totalRevenue: total.toNumber(), orderCount: orders.length, averageOrderValue: orders.length ? total.div(orders.length).toNumber() : 0 },
    orders: orders.map(order => {
      const subtotal = order.items.reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0));
      return {
        createdAt: order.createdAt, orderNumber: order.orderNumber, orderStatus: order.status,
        totalAmount: Number(order.totalPrice), user: order.user,
        address: [order.userAddress?.addressLine, order.userAddress?.city, order.userAddress?.state, order.userAddress?.country, order.userAddress?.postalCode].filter(Boolean).join(", "),
        paymentStatus: "-", paymentMethod: "-", exportCoupon: order.couponTitle ? order.couponTitle + " (" + Number(order.discountPercent ?? 0) + "%)" : order.couponId ? couponCodes.get(order.couponId) ?? order.couponId : "-",
        subtotal: Number(order.subtotal ?? subtotal), discount: Number(order.discountAmount ?? Prisma.Decimal.max(0, subtotal.sub(order.totalPrice))),
        orderItems: order.items.map(serializeOrderItem),
      };
    }),
  };
};

export const getOrder = async (id: string, actorId: string, role: UserRole) => {
  const order = await prisma.order.findFirst({
    where: { id, ...(role === UserRole.CUSTOMER ? { userId: actorId } : {}) },
    select: orderViewSelect,
  });
  if (!order) throw new ApiError(404, "Order was not found", "ORDER_NOT_FOUND");
  return (await resolveLegacyOrderCoupons([order]))[0]!;
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
