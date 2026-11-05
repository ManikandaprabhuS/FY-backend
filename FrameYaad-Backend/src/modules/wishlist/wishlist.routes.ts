import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./wishlist.controller";
import { addWishlistItemSchema } from "./wishlist.schemas";

export const wishlistRouter = Router();

wishlistRouter.get(
  "/analytics",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.EMPLOYEE),
  controller.analytics,
);

wishlistRouter.use(authenticate, authorize(UserRole.CUSTOMER));
wishlistRouter.get("/", controller.list);
wishlistRouter.post("/", validateBody(addWishlistItemSchema), controller.add);
wishlistRouter.delete("/:id", controller.remove);
