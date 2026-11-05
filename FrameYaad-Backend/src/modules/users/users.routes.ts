import { Router } from "express";

import { authenticate, staffOnly } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./users.controller";
import { adminUpdateUserSchema } from "./users.schemas";

export const usersRouter = Router();

usersRouter.use(authenticate, staffOnly);
usersRouter.get("/", controller.listCustomers);
usersRouter.get("/:id", controller.getCustomer);
usersRouter.patch("/:id", validateBody(adminUpdateUserSchema), controller.updateCustomer);
