import type { RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { addWishlistItemSchema } from "./wishlist.schemas";
import { wishlistIdSchema, wishlistLookupSchema } from "./wishlist.schemas";
import * as service from "./wishlist.service";

type AddWishlistItemBody = z.infer<typeof addWishlistItemSchema>;

const userIdFrom = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth.user.id;
};

export const list: RequestHandler = async (request, response) => {
  const data = await service.listWishlist(userIdFrom(request), request.query);
  response.status(200).json({ success: true, data });
};

export const analytics: RequestHandler = async (request, response) => {
  const data = await service.getWishlistAnalytics(request.query);
  response.status(200).json({ success: true, data });
};

export const lookup: RequestHandler = async (request, response) => {
  const { productIdentifiers } = wishlistLookupSchema.parse(request.body);
  const items = await service.lookupWishlist(userIdFrom(request), productIdentifiers);
  response.status(200).json({ success: true, data: { items } });
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
