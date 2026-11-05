import { Router } from "express";
import { authenticate, adminOnly } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./coupon.controller";
import { createCouponSchema, updateCouponSchema, validateCouponSchema } from "./coupon.schemas";

export const couponRouter = Router();
couponRouter.post("/validate", validateBody(validateCouponSchema), controller.validate);
couponRouter.use(authenticate, adminOnly);
couponRouter.get("/", controller.list);
couponRouter.get("/:id", controller.get);
couponRouter.post("/", validateBody(createCouponSchema), controller.create);
couponRouter.put("/:id", validateBody(updateCouponSchema), controller.update);
couponRouter.patch("/:id/status", controller.status);
couponRouter.delete("/:id", controller.remove);
