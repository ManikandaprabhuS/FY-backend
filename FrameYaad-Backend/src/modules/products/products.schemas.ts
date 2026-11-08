import { z } from "zod";
import { plainText } from "../../utils/input-schemas";
const priceSchema = z.number().positive("Price must be greater than zero").max(9_999_999_999.99);
const stockSchema = z.number().int().nonnegative().max(2_147_483_647);
const colorsSchema = z.array(plainText(1, 80)).min(1).max(20).refine(
  colors => new Set(colors.map(color => color.toLowerCase())).size === colors.length,
  "Frame colors must not contain duplicates",
);

export const productIdSchema = z.string().uuid();
const imageUrl = z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS image URL");
const productImageSchema = z.object({
  imageUrl,
  displayOrder: z.number().int().positive(),
  color: plainText(1, 80).nullable().optional(),
}).strict();

const gallerySchema = z.array(productImageSchema).min(1, "At least one product image is required").max(30)
  .refine(images => images.some(image => !image.color), "At least one default product image is required");

const productFields = {
  materialId: z.string().uuid(),
  variantId: z.string().uuid(),
  productIdentifier: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9_-]+$/),
  productName: plainText(2, 160),
};

export const createProductSchema = z.object({ ...productFields, images: gallerySchema }).strict();

// Compatibility input for the existing admin Add Product screen. It is mapped
// only to fields already present in the current schema.
export const createAdminProductPreviewSchema = z.object({
  name: plainText(2, 160),
  description: z.string().trim().min(1, 'Description is required').max(2_000),
  brandName: plainText(2, 120),
  material: plainText(2, 120),
  availableColors: colorsSchema,
  isActive: z.boolean().default(true),
  images: gallerySchema,
  variants: z.array(z.object({
    imageUrl: imageUrl.nullable().optional(),
    color: plainText(1, 80).optional().nullable(),
    frameSize: plainText(1, 80),
    mountType: plainText(1, 80),
    glassType: z.enum(["NONE", "OPTION_1", "OPTION_2"]),
    price: priceSchema,
    offerPrice: priceSchema.optional().nullable(),
    stockQuantity: stockSchema,
  })).min(1).max(50),
}).strict();

const adminVariantFields = {
  imageUrl: imageUrl.nullable().optional(),
  color: plainText(1, 80).optional().nullable(),
  frameSize: plainText(1, 80).optional(),
  mountType: plainText(1, 80).optional(),
  glassType: z.enum(["NONE", "OPTION_1", "OPTION_2"]).optional(),
  price: priceSchema.optional(),
  offerPrice: priceSchema.optional().nullable(),
  stockQuantity: stockSchema.optional(),
};

export const updateAdminProductPreviewSchema = z.object({
  name: plainText(2, 160).optional(),
  description: z.string().trim().min(1, 'Description is required').max(2_000).optional(),
  brandName: plainText(2, 120).optional(),
  material: plainText(2, 120).optional(),
  availableColors: colorsSchema.optional(),
  isActive: z.boolean().optional(),
  images: gallerySchema.optional(),
  variants: z.array(z.object(adminVariantFields)).max(50).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one product field is required",
});

export const updateAdminVariantSchema = z.object(adminVariantFields).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one variant field is required" },
);

export const createAdminVariantSchema = z.object({
  imageUrl: imageUrl.nullable().optional(),
  color: plainText(1, 80).optional().nullable(),
  frameSize: plainText(1, 80),
  mountType: plainText(1, 80),
  glassType: z.enum(["NONE", "OPTION_1", "OPTION_2"]),
  price: priceSchema,
  offerPrice: priceSchema.optional().nullable(),
  stockQuantity: stockSchema,
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
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  materialId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
