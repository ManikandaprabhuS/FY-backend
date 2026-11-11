import { UserRole } from "@prisma/client";
import { Router } from "express";
import {z} from "zod";
import {downloadPhoto} from "../order-photos/order-photos.service";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./orders.controller";
import { checkoutSchema, orderBatchSchema, updateOrderStatusSchema, cancelOrderSchema } from "./orders.schemas";

import {checkoutRateLimit} from "./checkout-rate-limit";
import {listCustomerOrderSummaries} from "./customer-order-summary";
export const ordersRouter = Router();
const customersOnly = authorize(UserRole.CUSTOMER);
const orderManagers = authorize(UserRole.ADMIN, UserRole.EMPLOYEE);

ordersRouter.use(authenticate);
ordersRouter.post("/checkout", customersOnly, checkoutRateLimit, validateBody(checkoutSchema), controller.checkout);
ordersRouter.post("/batch", orderManagers, validateBody(orderBatchSchema), controller.batch);
ordersRouter.get("/customer-summary",customersOnly,async(req,res)=>{res.setHeader("Cache-Control","no-store");res.json({success:true,data:await listCustomerOrderSummaries(req.auth!.user.id,req.query)});});
ordersRouter.get("/", controller.list);
ordersRouter.get("/export", orderManagers, controller.exportReport);
ordersRouter.get("/status-flow",controller.statusFlow);
ordersRouter.post("/:id/cancel",customersOnly,validateBody(cancelOrderSchema),controller.cancel);
ordersRouter.get("/:id/photo/download-url", async (req,res)=>{res.set("Cache-Control","no-store");res.json({success:true,data:await downloadPhoto(z.string().uuid().parse(req.params.id),req.auth!.user)});});
ordersRouter.get("/:id", controller.get);
ordersRouter.patch("/:id/status", orderManagers, validateBody(updateOrderStatusSchema), controller.updateStatus);
