import type { RequestHandler } from "express";
import type { UserRole } from "@prisma/client";

import { ApiError } from "../../utils/api-error";
import { notificationIdSchema } from "./notifications.schemas";
import * as service from "./notifications.service";

const authFrom = (request: Parameters<RequestHandler>[0]): { id: string; role: UserRole } => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return { id: request.auth.user.id, role: request.auth.user.role };
};

export const list: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const data = await service.listNotifications(auth.id, auth.role, request.query);
  response.status(200).json({ success: true, data });
};

export const unreadCount: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const count = await service.unreadCount(auth.id, auth.role);
  response.status(200).json({ success: true, data: { count } });
};

export const markRead: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const notification = await service.markRead(
    notificationIdSchema.parse(request.params.id),
    auth.id,
    auth.role,
  );
  response.status(200).json({ success: true, data: { notification } });
};

export const markAllRead: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  const updatedCount = await service.markAllRead(auth.id, auth.role);
  response.status(200).json({ success: true, data: { updatedCount } });
};

export const remove: RequestHandler = async (request, response) => {
  const auth = authFrom(request);
  await service.deleteNotification(
    notificationIdSchema.parse(request.params.id),
    auth.id,
    auth.role,
  );
  response.status(204).send();
};
