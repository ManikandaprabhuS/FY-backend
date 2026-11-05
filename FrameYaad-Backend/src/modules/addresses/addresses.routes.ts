import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./addresses.controller";
import { createAddressSchema, updateAddressSchema } from "./addresses.schemas";

export const addressesRouter = Router();

addressesRouter.use(authenticate, authorize(UserRole.CUSTOMER));
addressesRouter.get("/", controller.list);
addressesRouter.get("/:id", controller.get);
addressesRouter.post("/", validateBody(createAddressSchema), controller.create);
addressesRouter.patch("/:id", validateBody(updateAddressSchema), controller.update);
addressesRouter.delete("/:id", controller.remove);
