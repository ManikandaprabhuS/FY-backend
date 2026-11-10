import type { Prisma } from "@prisma/client";
import { resolveLegacyColor } from "../colors/colors.values";

export const orderViewSelect = {
  id: true,
  orderNumber: true,
  userId: true,
  userAddressId: true,
  totalPrice: true,
  status: true,
  remark: true,
  couponId: true,
  couponCode: true, couponTitle: true, discountPercent: true, discountAmount: true, subtotal: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, phoneNumber: true } },
  userAddress: {
    select: {
      id: true,
      addressLine: true,
      postalCode: true,
      city: true,
      state: true,
      country: true,
      contactPerson: true,
      contactNumber: true,
    },
  },
  items: {
    select: {
      id: true,
      productIdentifier: true,
      snapshotProductId: true,
      snapshotProductName: true,
      snapshotFrameSize: true,
      snapshotVariantId: true, snapshotColorName: true, snapshotColorHex: true, snapshotMaterial: true,
      quantity: true,
      price: true,
      subtotal: true,
      product: {
        select: {
          id: true,
          productName: true,
          material: { select: { name: true } },
          variant: {
            select: {
              id: true, color: true, frameSize: true,
              mountType: true,
            },
          },
          images: {
            where: { isPrimary: true },
            select: { id: true, imageUrl: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.OrderSelect;

type OrderView = Prisma.OrderGetPayload<{ select: typeof orderViewSelect }>;

export const serializeOrderItem = (item: OrderView["items"][number]) => {
  const legacy = resolveLegacyColor(item.product?.variant?.color);
  const rawSize = item.snapshotFrameSize ?? item.product?.variant?.frameSize;
  const frameSize = !rawSize || rawSize === "Not specified" ? "-" : rawSize;
  const productId = item.snapshotProductId ?? item.product?.id ?? "-";
  const productName = item.snapshotProductName ?? item.product?.productName ?? "-";
  return {
    ...item,
    productIdentifier: item.productIdentifier ?? item.snapshotProductId ?? item.id,
    productId, productName, frameSize,
    variantId: item.snapshotVariantId ?? item.product?.variant?.id ?? null,
    colorName: item.snapshotColorName ?? legacy.name, colorHex: item.snapshotColorHex ?? legacy.hex,
    material: item.snapshotMaterial ?? item.product?.material?.name ?? "-",
    product: {
      ...item.product, id: productId, productName,
      variant: { ...item.product?.variant, id: item.snapshotVariantId ?? item.product?.variant?.id, color: item.snapshotColorHex ?? item.snapshotColorName ?? item.product?.variant?.color, frameSize, mountType: item.product?.variant?.mountType ?? "-" },
      material: { name: item.snapshotMaterial ?? item.product?.material?.name ?? "-" },
      images: item.product?.images ?? [],
    },
  };
};
export const serializeOrderView = (order: OrderView) => {
  const subtotal=order.subtotal ?? order.items.reduce((sum,item)=>sum+Number(item.subtotal),0);
  return { ...order, subtotal:Number(subtotal), discountAmount:order.discountAmount==null?Math.max(0,Number(subtotal)-Number(order.totalPrice)):Number(order.discountAmount),
    items:order.items.map(serializeOrderItem) };
};
