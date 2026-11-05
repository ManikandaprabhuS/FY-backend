import type { UserRole } from "@prisma/client";
import type { RequestHandler } from "express";
import type { Request } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { createAdminProductPreviewSchema, createAdminVariantSchema, createProductSchema, updateAdminProductPreviewSchema, updateAdminVariantSchema, updateProductSchema } from "./products.schemas";
import { productIdSchema } from "./products.schemas";
import * as productsService from "./products.service";

type CreateProductBody = z.infer<typeof createProductSchema>;
type CreateAdminProductPreviewBody = z.infer<typeof createAdminProductPreviewSchema>;
type UpdateAdminProductPreviewBody = z.infer<typeof updateAdminProductPreviewSchema>;
type UpdateAdminVariantBody = z.infer<typeof updateAdminVariantSchema>;
type CreateAdminVariantBody = z.infer<typeof createAdminVariantSchema>;
type UpdateProductBody = z.infer<typeof updateProductSchema>;

const authFrom = (request: Parameters<RequestHandler>[0]): { id: string; role: UserRole } => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return { id: request.auth.user.id, role: request.auth.user.role };
};

const idFrom = (value: unknown): string => productIdSchema.parse(value);

export const listProducts: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const data = await productsService.listProducts(request.query, auth.role);
  response.status(200).json({ success: true, data });
};

export const listPublicProducts: RequestHandler = async (request, response) => {
  const data = await productsService.listPublicProducts(request.query);
  response.status(200).json({ success: true, data });
};

export const getProduct: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const product = await productsService.getProduct(idFrom(request.params.id), auth.role);
  response.status(200).json({ success: true, data: { product } });
};

export const getPublicProduct: RequestHandler = async (request, response) => {
  const product = await productsService.getPublicProduct(idFrom(request.params.id));
  response.status(200).json({ success: true, data: { product } });
};

export const createProduct: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const product = await productsService.createProduct(request.body as CreateProductBody, auth.id);
  response.status(201).json({ success: true, data: { product } });
};

export const createAdminProductPreview: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const product = await productsService.createAdminProductPreview(
    request.body as CreateAdminProductPreviewBody,
    auth.id,
  );
  response.status(201).json({ success: true, product });
};

export const uploadProductImages: RequestHandler = async (request, response) => {
  authFrom(request);
  const files = (request as Request & { files?: Express.Multer.File[] }).files ?? [];
  const images = await productsService.uploadProductImages(files);

  // The existing admin client reads `response.data.images`; retain that contract.
  response.status(201).json({ success: true, images });
};

export const updateAdminProductPreview: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const product = await productsService.updateAdminProductPreview(
    idFrom(request.params.id),
    request.body as UpdateAdminProductPreviewBody,
    auth.role,
  );
  response.status(200).json({ success: true, product });
};

export const updateAdminVariant: RequestHandler = async (request, response) => {
  authFrom(request);
  const variant = await productsService.updateAdminVariant(
    idFrom(request.params.id),
    request.body as UpdateAdminVariantBody,
  );
  response.status(200).json({ success: true, variant });
};

export const createAdminVariant: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const variant = await productsService.createAdminVariant(idFrom(request.params.id), request.body as CreateAdminVariantBody, auth.id, auth.role);
  response.status(201).json({ success: true, variant });
};

export const deleteAdminVariant: RequestHandler = async (request, response) => {
  authFrom(request);
  await productsService.deleteAdminVariant(idFrom(request.params.id));
  response.status(204).send();
};

export const updateProduct: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const product = await productsService.updateProduct(
    idFrom(request.params.id),
    request.body as UpdateProductBody,
    auth.role,
  );
  response.status(200).json({ success: true, data: { product } });
};

export const deleteProduct: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  await productsService.deleteProduct(idFrom(request.params.id), auth.role);
  response.status(204).send();
};
