import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import {ApiError} from '../../utils/api-error';
import * as controller from "./notifications.controller";

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);
notificationsRouter.use((req,_res,next)=>{if(req.auth!.user.role===UserRole.CUSTOMER&&(req.method==='DELETE'||/^\/(clear|delete)(-all)?\/?$/.test(req.path)))return next(new ApiError(403,'Customer notifications cannot be deleted.','FORBIDDEN'));next();});
notificationsRouter.get("/", controller.list);
notificationsRouter.get("/unread-count", controller.unreadCount);
notificationsRouter.patch("/read-all", controller.markAllRead);
notificationsRouter.patch("/:id/read", controller.markRead);
notificationsRouter.delete("/:id", authorize(UserRole.ADMIN, UserRole.EMPLOYEE), controller.remove);
