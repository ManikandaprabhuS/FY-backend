import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./orders.controller";
import { checkoutSchema, updateOrderStatusSchema } from "./orders.schemas";

export const ordersRouter = Router();
const customersOnly = authorize(UserRole.CUSTOMER);
const orderManagers = authorize(UserRole.ADMIN, UserRole.EMPLOYEE);

ordersRouter.use(authenticate);
ordersRouter.post("/checkout", customersOnly, validateBody(checkoutSchema), controller.checkout);
ordersRouter.get("/", controller.list);
ordersRouter.get("/:id", controller.get);
ordersRouter.patch("/:id/status", orderManagers, validateBody(updateOrderStatusSchema), controller.updateStatus);
