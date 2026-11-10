import type { UserRole } from "@prisma/client";
import type { RequestHandler } from "express";
import type { z } from "zod";

import {ORDER_STATUS_FLOW,parseStatusHistory} from "./order-status-flow";
import {enqueueOrderStatusEffects} from "./order-status-effects";
import type {cancelOrderSchema} from "./orders.schemas";
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

export const exportReport: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const data = await service.exportOrders(request.query, auth.id, auth.role);
  response.status(200).json({ success: true, data });
};

export const get: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const order = await service.getOrder(orderIdFrom(request.params.id), auth.id, auth.role);
  response.status(200).json({ success: true, data: { order: serializeOrderView(order) } });
};

export const batch: RequestHandler = async (request, response) => {
  const orders = await service.getOrdersBatch((request.body as { ids: string[] }).ids);
  response.status(200).json({ success: true, data: { orders: orders.map(serializeOrderView) } });
};

const notifyStatus=(order:{id:string;statusHistory?:unknown})=>{
  const event=parseStatusHistory(order.statusHistory).at(-1);
  if(event?.eventId)enqueueOrderStatusEffects(order.id,event.eventId);
};
export const cancel:RequestHandler=async(request,response)=>{
 const input=request.body as z.infer<typeof cancelOrderSchema>;
 const order=await service.updateOrderStatus(orderIdFrom(request.params.id),{...input,status:"CANCELLED"},authFrom(request));
 response.json({success:true,data:{order:serializeOrderView(order)}});
 notifyStatus(order);
};
export const statusFlow:RequestHandler=(_request,response)=>{response.json({success:true,data:{flow:ORDER_STATUS_FLOW}});};
export const updateStatus: RequestHandler = async (request, response) => {
  const order = await service.updateOrderStatus(
    orderIdFrom(request.params.id),
    request.body as UpdateStatusBody,
    authFrom(request),
  );
  response.status(200).json({ success: true, data: { order: serializeOrderView(order) } });
  notifyStatus(order);
};
