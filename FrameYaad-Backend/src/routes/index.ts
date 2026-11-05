import { Router } from "express";

import { healthRouter } from "../modules/health/health.routes";
import { authRouter } from "../modules/auth/auth.routes";
import { employeesRouter } from "../modules/employees/employees.routes";
import { usersRouter } from "../modules/users/users.routes";
import { productsRouter } from "../modules/products/products.routes";
import { addressesRouter } from "../modules/addresses/addresses.routes";
import { cartRouter } from "../modules/cart/cart.routes";
import { ordersRouter } from "../modules/orders/orders.routes";
import { wishlistRouter } from "../modules/wishlist/wishlist.routes";
import { notificationsRouter } from "../modules/notifications/notifications.routes";
import { logMethodCall } from "../middleware/method-call-logger.middleware";
import { couponRouter } from "../modules/coupon/coupon.routes";
import { productDiscountRouter } from "../modules/product-discount/product-discount.routes";
import { newsletterRouter } from "../modules/newsletter/newsletter.routes";
import { appointmentRouter } from "../modules/appointment/appointment.routes";

export const apiRouter = Router();

apiRouter.use(logMethodCall);
apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/employees", employeesRouter);
apiRouter.use("/products", productsRouter);
apiRouter.use("/addresses", addressesRouter);
apiRouter.use("/cart", cartRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/wishlist", wishlistRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/coupons", couponRouter);
apiRouter.use("/product-discounts", productDiscountRouter);
apiRouter.use("/newsletter", newsletterRouter);
apiRouter.use("/appointments", appointmentRouter);
