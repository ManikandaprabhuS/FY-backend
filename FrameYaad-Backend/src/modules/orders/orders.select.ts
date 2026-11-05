import type { Prisma } from "@prisma/client";

export const orderViewSelect = {
  id: true,
  orderNumber: true,
  userId: true,
  userAddressId: true,
  totalPrice: true,
  status: true,
  remark: true,
  couponId: true,
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
      quantity: true,
      price: true,
      subtotal: true,
      product: {
        select: {
          id: true,
          productName: true,
          variant: {
            select: {
              frameSize: true,
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

// Historical orders retain their snapshot when the catalog product no longer exists.
// Keep the same public item shape expected by the dashboard.
export const serializeOrderView = (order: OrderView) => ({
  ...order,
  items: order.items.map(({ snapshotProductId, snapshotProductName, snapshotFrameSize, ...item }) => ({
    ...item,
    productIdentifier: item.productIdentifier ?? snapshotProductId ?? item.id,
    product: item.product ?? {
      id: snapshotProductId ?? item.id,
      productName: snapshotProductName ?? "Unavailable product",
      variant: { frameSize: snapshotFrameSize ?? "Not specified", mountType: "Not specified" },
      images: [],
    },
  })),
});
