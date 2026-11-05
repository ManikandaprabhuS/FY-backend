import type { Prisma } from "@prisma/client";

export const productViewSelect = {
  id: true,
  productIdentifier: true,
  productName: true,
  materialId: true,
  variantId: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  material: {
    select: {
      id: true,
      name: true,
      description: true,
      brandName: true,
      material: true,
      availableColors: true,
      isActive: true,
    },
  },
  variants: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      color: true,
      frameSize: true,
      mountType: true,
      glassType: true,
      stockQuantity: true,
      mrp: true,
      price: true,
      isActive: true,
    },
  },
  variant: {
    select: { id: true, isActive: true },
  },
  images: {
    select: {
      id: true,
      imageUrl: true,
      isPrimary: true,
      createdAt: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.ProductSelect;

export type ProductView = Prisma.ProductGetPayload<{ select: typeof productViewSelect }>;
