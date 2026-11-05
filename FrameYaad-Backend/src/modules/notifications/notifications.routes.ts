import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import * as controller from "./notifications.controller";

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);
notificationsRouter.get("/", controller.list);
notificationsRouter.get("/unread-count", controller.unreadCount);
notificationsRouter.patch("/read-all", controller.markAllRead);
notificationsRouter.patch("/:id/read", controller.markRead);
notificationsRouter.delete("/:id", authorize(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.EMPLOYEE), controller.remove);
