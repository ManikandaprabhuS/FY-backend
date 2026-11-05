import type { RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { addWishlistItemSchema } from "./wishlist.schemas";
import { wishlistIdSchema } from "./wishlist.schemas";
import * as service from "./wishlist.service";

type AddWishlistItemBody = z.infer<typeof addWishlistItemSchema>;

const userIdFrom = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth.user.id;
};

export const list: RequestHandler = async (request, response) => {
  const wishlist = await service.listWishlist(userIdFrom(request));
  response.status(200).json({ success: true, data: { wishlist } });
};

export const analytics: RequestHandler = async (_request, response) => {
  const products = await service.getWishlistAnalytics();
  response.status(200).json({ success: true, data: { products } });
};

export const add: RequestHandler = async (request, response) => {
  const wishlistItem = await service.addWishlistItem(
    userIdFrom(request),
    request.body as AddWishlistItemBody,
  );
  response.status(201).json({ success: true, data: { wishlistItem } });
};

export const remove: RequestHandler = async (request, response) => {
  await service.removeWishlistItem(wishlistIdSchema.parse(request.params.id), userIdFrom(request));
  response.status(204).send();
};
