import { z } from "zod";

export const productIdSchema = z.string().uuid();

const productFields = {
  materialId: z.string().uuid(),
  variantId: z.string().uuid(),
  productIdentifier: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9_-]+$/),
  productName: z.string().trim().min(2).max(160),
};

export const createProductSchema = z.object(productFields).strict();

// Compatibility input for the existing admin Add Product screen. It is mapped
// only to fields already present in the current schema.
export const createAdminProductPreviewSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2_000).optional(),
  brandName: z.string().trim().min(2).max(120),
  material: z.string().trim().min(2).max(120),
  availableColors: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  isActive: z.boolean().default(true),
  images: z.array(z.object({ imageUrl: z.string().url(), displayOrder: z.number().int().positive() })).max(10).default([]),
  variants: z.array(z.object({
    color: z.string().trim().min(1).max(80).optional().nullable(),
    frameSize: z.string().trim().min(1).max(80),
    mountType: z.string().trim().min(1).max(80),
    glassType: z.enum(["NONE", "OPTION_1", "OPTION_2"]),
    price: z.number().nonnegative(),
    offerPrice: z.number().nonnegative().optional().nullable(),
    stockQuantity: z.number().int().nonnegative(),
  })).min(1).max(50),
}).strict();

const adminVariantFields = {
  color: z.string().trim().min(1).max(80).optional().nullable(),
  frameSize: z.string().trim().min(1).max(80).optional(),
  mountType: z.string().trim().min(1).max(80).optional(),
  glassType: z.enum(["NONE", "OPTION_1", "OPTION_2"]).optional(),
  price: z.number().nonnegative().optional(),
  offerPrice: z.number().nonnegative().optional().nullable(),
  stockQuantity: z.number().int().nonnegative().optional(),
};

export const updateAdminProductPreviewSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2_000).optional(),
  brandName: z.string().trim().min(2).max(120).optional(),
  material: z.string().trim().min(2).max(120).optional(),
  availableColors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  isActive: z.boolean().optional(),
  images: z.array(z.object({ imageUrl: z.string().url(), displayOrder: z.number().int().positive() })).max(10).optional(),
  variants: z.array(z.object(adminVariantFields)).max(50).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one product field is required",
});

export const updateAdminVariantSchema = z.object(adminVariantFields).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one variant field is required" },
);

export const createAdminVariantSchema = z.object({
  color: z.string().trim().min(1).max(80).optional().nullable(),
  frameSize: z.string().trim().min(1).max(80),
  mountType: z.string().trim().min(1).max(80),
  glassType: z.enum(["NONE", "OPTION_1", "OPTION_2"]),
  price: z.number().nonnegative(),
  offerPrice: z.number().nonnegative().optional().nullable(),
  stockQuantity: z.number().int().nonnegative(),
}).strict();

export const updateProductSchema = z.object({
  materialId: productFields.materialId.optional(),
  variantId: productFields.variantId.optional(),
  productIdentifier: productFields.productIdentifier.optional(),
  productName: productFields.productName.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one product field is required",
});

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  materialId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
