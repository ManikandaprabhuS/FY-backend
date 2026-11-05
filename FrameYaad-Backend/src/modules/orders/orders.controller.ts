import type { UserRole } from "@prisma/client";
import type { RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "../../utils/api-error";
import type { checkoutSchema, updateOrderStatusSchema } from "./orders.schemas";
import { orderIdSchema } from "./orders.schemas";
import * as service from "./orders.service";
import { serializeOrderView } from "./orders.select";

type CheckoutBody = z.infer<typeof checkoutSchema>;
type UpdateStatusBody = z.infer<typeof updateOrderStatusSchema>;

const authFrom = (request: Parameters<RequestHandler>[0]): { id: string; role: UserRole } => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return { id: request.auth.user.id, role: request.auth.user.role };
};
const orderIdFrom = (value: unknown): string => orderIdSchema.parse(value);

export const checkout: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const order = await service.checkout(auth.id, request.body as CheckoutBody);
  response.status(201).json({ success: true, data: { order: serializeOrderView(order) } });
};

export const list: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const data = await service.listOrders(request.query, auth.id, auth.role);
  response.status(200).json({ success: true, data: { ...data, orders: data.orders.map(serializeOrderView) } });
};

export const get: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const order = await service.getOrder(orderIdFrom(request.params.id), auth.id, auth.role);
  response.status(200).json({ success: true, data: { order: serializeOrderView(order) } });
};

export const updateStatus: RequestHandler = async (request, response) => {
  const order = await service.updateOrderStatus(
    orderIdFrom(request.params.id),
    request.body as UpdateStatusBody,
  );
  response.status(200).json({ success: true, data: { order: serializeOrderView(order) } });
};
