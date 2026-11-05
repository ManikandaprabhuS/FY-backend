import { OrderStatus, Prisma, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { z } from "zod";

import { supabaseAdmin } from "../../config/supabase";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import { productViewSelect } from "./products.select";
import { productListQuerySchema } from "./products.schemas";
import type { createAdminProductPreviewSchema, createAdminVariantSchema, createProductSchema, updateAdminProductPreviewSchema, updateAdminVariantSchema, updateProductSchema } from "./products.schemas";

type CreateProductInput = z.infer<typeof createProductSchema>;
type CreateAdminProductPreviewInput = z.infer<typeof createAdminProductPreviewSchema>;
type UpdateAdminProductPreviewInput = z.infer<typeof updateAdminProductPreviewSchema>;
type UpdateAdminVariantInput = z.infer<typeof updateAdminVariantSchema>;
type CreateAdminVariantInput = z.infer<typeof createAdminVariantSchema>;
type UpdateProductInput = z.infer<typeof updateProductSchema>;

const productImagesBucket = "product-images";

const assertActiveReferences = async (materialId: string, variantId: string): Promise<void> => {
  const [material, variant] = await Promise.all([
    prisma.material.findUnique({ where: { id: materialId }, select: { id: true, isActive: true } }),
    prisma.variant.findUnique({ where: { id: variantId }, select: { id: true, isActive: true } }),
  ]);

  if (!material) throw new ApiError(400, "Material does not exist", "MATERIAL_NOT_FOUND");
  if (!material.isActive) throw new ApiError(409, "Material is inactive", "MATERIAL_INACTIVE");
  if (!variant) throw new ApiError(400, "Variant does not exist", "VARIANT_NOT_FOUND");
  if (!variant.isActive) throw new ApiError(409, "Variant is inactive", "VARIANT_INACTIVE");
};

export const listProducts = async (rawQuery: unknown, role: UserRole) => {
  const { page, limit, search, materialId, variantId, isActive } = productListQuerySchema.parse(rawQuery);
  const customerVisibility: Prisma.ProductWhereInput = role === UserRole.CUSTOMER
    ? { material: { isActive: true }, variant: { isActive: true } }
    : {};
  const where: Prisma.ProductWhereInput = {
    ...customerVisibility,
    ...(materialId ? { materialId } : {}),
    ...(variantId ? { variantId } : {}),
    ...(isActive === undefined ? {} : { material: { isActive } }),
    ...(search ? { OR: [
      { productName: { contains: search, mode: "insensitive" } },
      { productIdentifier: { contains: search, mode: "insensitive" } },
    ] } : {}),
  };

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({ where, select: productViewSelect, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.product.count({ where }),
  ]);

  return { products, pagination: paginationMeta(page, limit, total) };
};

export const listPublicProducts = async (rawQuery: unknown) => {
  const query = rawQuery && typeof rawQuery === "object"
    ? rawQuery as Record<string, unknown>
    : {};

  const result = await listProducts({ ...query, isActive: "true" }, UserRole.CUSTOMER);
  return {
    ...result,
    products: result.products.map((product) => ({
      ...product,
      variants: product.variants.filter((variant) => variant.isActive),
    })),
  };
};

export const getProduct = async (id: string, role: UserRole) => {
  const product = await prisma.product.findUnique({ where: { id }, select: productViewSelect });
  if (!product) throw new ApiError(404, "Product was not found", "PRODUCT_NOT_FOUND");
  if (role === UserRole.CUSTOMER && (!product.material.isActive || !product.variant?.isActive)) {
    throw new ApiError(404, "Product was not found", "PRODUCT_NOT_FOUND");
  }
  return product;
};

export const getPublicProduct = async (id: string) => {
  const product = await getProduct(id, UserRole.CUSTOMER);
  return {
    ...product,
    variants: product.variants.filter((variant) => variant.isActive),
  };
};

export const createProduct = async (input: CreateProductInput, actorId: string) => {
  await assertActiveReferences(input.materialId, input.variantId);
  return prisma.product.create({ data: { ...input, createdById: actorId }, select: productViewSelect });
};

export const updateProduct = async (id: string, input: UpdateProductInput, role: UserRole) => {
  const existing = await getProduct(id, role);
  const materialId = input.materialId ?? existing.materialId;
  const variantId = input.variantId ?? existing.variantId;
  if ((input.materialId || input.variantId) && variantId) await assertActiveReferences(materialId, variantId);
  return prisma.product.update({ where: { id }, data: input, select: productViewSelect });
};

export const deleteProduct = async (id: string, role: UserRole): Promise<void> => {
  const product = await getProduct(id, role);
  const orderItems = await prisma.orderItem.findMany({
    where: { productIdentifier: product.productIdentifier },
    select: {
      order: {
        select: {
          orderNumber: true,
          status: true,
        },
      },
    },
    orderBy: { order: { createdAt: "desc" } },
  });

  const activeOrderItems = orderItems.filter(({ order }) => (
    order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.CANCELLED
  ));

  if (activeOrderItems.length > 0) {
    const activeOrders = activeOrderItems.map(({ order }) => ({
      orderNumber: order.orderNumber,
      status: order.status,
    }));
    const latestOrder = activeOrders[0]!;
    const additionalOrders = activeOrders.length - 1;
    const additionalMessage = additionalOrders > 0
      ? ` It is also included in ${additionalOrders} other active order${additionalOrders === 1 ? "" : "s"}.`
      : "";

    throw new ApiError(
      409,
      `Product cannot be deleted because a customer ordered it in ${latestOrder.orderNumber}. The order status is ${latestOrder.status} and it has not been delivered.${additionalMessage}`,
      "PRODUCT_HAS_ACTIVE_ORDERS",
      { productId: product.id, productIdentifier: product.productIdentifier, activeOrders },
    );
  }

  // Delivered and cancelled orders must retain their item references for order
  // history, invoices, customer support, and reporting. A hard delete would
  // corrupt that historical record, so return a precise conflict instead.
  if (orderItems.length > 0) {
    const orderHistory = orderItems.map(({ order }) => ({
      orderNumber: order.orderNumber,
      status: order.status,
    }));
    throw new ApiError(
      409,
      "Product cannot be deleted because it is referenced by delivered or cancelled order history.",
      "PRODUCT_HAS_ORDER_HISTORY",
      { productId: product.id, productIdentifier: product.productIdentifier, orders: orderHistory },
    );
  }

  const cartReferenceCount = await prisma.cartItem.count({
    where: { productIdentifier: product.productIdentifier },
  });
  if (cartReferenceCount > 0) {
    throw new ApiError(
      409,
      `Product cannot be deleted because it is currently present in ${cartReferenceCount} customer cart${cartReferenceCount === 1 ? "" : "s"}.`,
      "PRODUCT_IN_CUSTOMER_CARTS",
      { productId: product.id, productIdentifier: product.productIdentifier, cartCount: cartReferenceCount },
    );
  }

  await prisma.product.delete({ where: { id } });
};

export const createAdminProductPreview = async (
  input: CreateAdminProductPreviewInput,
  actorId: string,
) => {
  const productIdentifier = `FY-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  return prisma.$transaction(async (transaction) => {
    const material = await transaction.material.create({
      data: {
        // Material.name is not used by the admin list preview. The identifier
        // keeps its existing unique constraint satisfied for duplicate product names.
        name: `${input.name} ${productIdentifier}`,
        description: input.description,
        brandName: input.brandName,
        material: input.material,
        availableColors: input.availableColors,
        isActive: input.isActive,
        createdById: actorId,
      },
    });
    const product = await transaction.product.create({
      data: {
        productIdentifier,
        productName: input.name,
        materialId: material.id,
        createdById: actorId,
        images: input.images.length > 0 ? { create: input.images.map((image, index) => ({ imageUrl: image.imageUrl, isPrimary: index === 0 })) } : undefined,
      },
    });
    const variants = [];
    for (const item of input.variants) {
      variants.push(await transaction.variant.create({ data: {
        productId: product.id, color: item.color ?? input.availableColors[0] ?? "Standard", frameSize: item.frameSize,
        mountType: item.mountType, glassType: item.glassType, stockQuantity: item.stockQuantity,
        mrp: item.price, price: item.offerPrice ?? item.price, isActive: input.isActive, createdById: actorId,
      }}));
    }
    return transaction.product.update({ where: { id: product.id }, data: { variantId: variants[0]!.id }, select: productViewSelect });
  }, { maxWait: 10000, timeout: 30000 });
};

export const updateAdminProductPreview = async (
  id: string,
  input: UpdateAdminProductPreviewInput,
  role: UserRole,
) => {
  const existing = await getProduct(id, role);
  const primaryVariant = input.variants?.[0];

  return prisma.$transaction(async (transaction) => {
    await transaction.material.update({
      where: { id: existing.materialId },
      data: {
        description: input.description,
        brandName: input.brandName,
        material: input.material,
        availableColors: input.availableColors,
        isActive: input.isActive,
      },
    });

    if (primaryVariant && existing.variantId) {
      await transaction.variant.update({
        where: { id: existing.variantId },
        data: {
          color: primaryVariant.color ?? undefined,
          frameSize: primaryVariant.frameSize,
          mountType: primaryVariant.mountType,
          glassType: primaryVariant.glassType,
          stockQuantity: primaryVariant.stockQuantity,
          mrp: primaryVariant.price,
          price: primaryVariant.price,
          isActive: input.isActive,
        },
      });
    } else if (input.isActive !== undefined && existing.variantId) {
      await transaction.variant.update({ where: { id: existing.variantId }, data: { isActive: input.isActive } });
    }

    return transaction.product.update({
      where: { id },
      data: {
        productName: input.name,
        images: input.images === undefined
          ? undefined
          : {
              deleteMany: {},
              create: input.images.map((image, index) => ({ imageUrl: image.imageUrl, isPrimary: index === 0 })),
            },
      },
      select: productViewSelect,
    });
  }, { maxWait: 10000, timeout: 30000 });
};

export const updateAdminVariant = async (id: string, input: UpdateAdminVariantInput) =>
  prisma.variant.update({
    where: { id },
    data: {
      color: input.color ?? undefined,
      frameSize: input.frameSize,
      mountType: input.mountType,
      glassType: input.glassType,
      stockQuantity: input.stockQuantity,
      mrp: input.price,
      price: input.offerPrice ?? input.price,
    },
  });

export const createAdminVariant = async (productId: string, input: CreateAdminVariantInput, actorId: string, role: UserRole) => {
  const product = await getProduct(productId, role);
  const variant = await prisma.variant.create({ data: {
    productId, color: input.color ?? product.material.availableColors[0] ?? "Standard", frameSize: input.frameSize,
    mountType: input.mountType, glassType: input.glassType, stockQuantity: input.stockQuantity,
    mrp: input.price, price: input.offerPrice ?? input.price, createdById: actorId, isActive: product.material.isActive,
  }});
  if (!product.variantId) await prisma.product.update({ where: { id: productId }, data: { variantId: variant.id } });
  return variant;
};

export const deleteAdminVariant = async (id: string): Promise<void> => {
  const variant = await prisma.variant.findUnique({ where: { id }, select: { productId: true } });
  if (!variant) throw new ApiError(404, "Variant was not found", "VARIANT_NOT_FOUND");
  await prisma.$transaction(async (transaction) => {
    const replacement = await transaction.variant.findFirst({ where: { productId: variant.productId, id: { not: id } }, select: { id: true } });
    await transaction.product.updateMany({ where: { variantId: id }, data: { variantId: replacement?.id ?? null } });
    await transaction.variant.delete({ where: { id } });
  });
};

export const uploadProductImages = async (files: Express.Multer.File[]): Promise<string[]> => {
  if (files.length === 0) {
    throw new ApiError(400, "At least one image file is required", "PRODUCT_IMAGES_REQUIRED");
  }

  const uploadedPaths: string[] = [];

  try {
    for (const file of files) {
      const extension = path.extname(file.originalname).toLowerCase() ||
        (file.mimetype === "video/mp4" ? ".mp4" : ".jpg");
      const objectPath = `products/${randomUUID()}${extension}`;
      const { error } = await supabaseAdmin.storage
        .from(productImagesBucket)
        .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

      if (error) {
        throw new ApiError(502, "Unable to store product image", "PRODUCT_IMAGE_UPLOAD_FAILED");
      }

      uploadedPaths.push(objectPath);
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabaseAdmin.storage.from(productImagesBucket).remove(uploadedPaths);
    }
    throw error;
  }

  return uploadedPaths.map((objectPath) =>
    supabaseAdmin.storage.from(productImagesBucket).getPublicUrl(objectPath).data.publicUrl,
  );
};
