import type { Prisma } from "@prisma/client";

export const cartViewSelect = {
  id: true,
  userId: true,
  totalPrice: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productIdentifier: true,
      quantity: true,
      price: true,
      subtotal: true,
      product: {
        select: {
          id: true,
          productName: true,
          material: { select: { id: true, name: true, brandName: true, isActive: true } },
          variant: {
            select: {
              id: true,
              color: true,
              frameSize: true,
              mountType: true,
              price: true,
              isActive: true,
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
} satisfies Prisma.CartSelect;
