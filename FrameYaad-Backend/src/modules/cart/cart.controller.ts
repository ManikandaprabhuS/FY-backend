import type { RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { addCartItemSchema, moveCartItemToWishlistSchema, updateCartItemSchema } from "./cart.schemas";
import { cartItemIdSchema } from "./cart.schemas";
import * as service from "./cart.service";

type AddItemBody = z.infer<typeof addCartItemSchema>;
type UpdateItemBody = z.infer<typeof updateCartItemSchema>;
type MoveToWishlistBody = z.infer<typeof moveCartItemToWishlistSchema>;

const userIdFrom = (request: Parameters<RequestHandler>[0]): string => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth.user.id;
};
const itemIdFrom = (value: unknown): string => cartItemIdSchema.parse(value);

export const get: RequestHandler = async (request, response) => {
  const cart = await service.getCart(userIdFrom(request));
  response.status(200).json({ success: true, data: { cart } });
};

export const add: RequestHandler = async (request, response) => {
  const cart = await service.addItem(userIdFrom(request), request.body as AddItemBody);
  response.status(201).json({ success: true, data: { cart } });
};

export const update: RequestHandler = async (request, response) => {
  const cart = await service.updateItem(
    userIdFrom(request),
    itemIdFrom(request.params.itemId),
    request.body as UpdateItemBody,
  );
  response.status(200).json({ success: true, data: { cart } });
};

export const remove: RequestHandler = async (request, response) => {
  const cart = await service.removeItem(userIdFrom(request), itemIdFrom(request.params.itemId));
  response.status(200).json({ success: true, data: { cart } });
};

export const moveToWishlist: RequestHandler = async (request, response) => {
  const result = await service.moveItemToWishlist(
    userIdFrom(request),
    request.body as MoveToWishlistBody,
  );
  response.status(200).json({ success: true, data: result });
};

export const clear: RequestHandler = async (request, response) => {
  await service.clearCart(userIdFrom(request));
  response.status(204).send();
};
