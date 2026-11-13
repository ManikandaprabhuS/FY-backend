import { Router } from "express";
import {homeBannerRouter} from "../modules/home-banner/home-banner.routes";
import {customerNotificationsRouter} from "../modules/customer-notifications/customer-notifications.routes";

import { reviewsRouter } from "../modules/reviews/reviews.routes";
import { healthRouter } from "../modules/health/health.routes";
import { authRouter } from "../modules/auth/auth.routes";
import { employeesRouter } from "../modules/employees/employees.routes";
import { usersRouter } from "../modules/users/users.routes";
import { productsRouter } from "../modules/products/products.routes";
import { addressesRouter } from "../modules/addresses/addresses.routes";
import { cartRouter } from "../modules/cart/cart.routes";
import { ordersRouter } from "../modules/orders/orders.routes";
import { colorsRouter } from "../modules/colors/colors.routes";
import { adminSearchRouter } from "../modules/admin-search/admin-search.routes";
import { wishlistRouter } from "../modules/wishlist/wishlist.routes";
import { notificationsRouter } from "../modules/notifications/notifications.routes";
import { logMethodCall } from "../middleware/method-call-logger.middleware";


import { newsletterRouter } from "../modules/newsletter/newsletter.routes";
import { appointmentRouter } from "../modules/appointment/appointment.routes";
import { siteMediaRouter } from "../modules/site-media/site-media.routes";

import { offersRouter } from "../modules/offers/offers.routes";
import { checkoutRouter } from "../modules/checkout/checkout.routes";
import {orderPhotosRouter} from "../modules/order-photos/order-photos.routes";
import {bannerImageRouter} from "../modules/home-banner/banner-image.routes";
export const apiRouter = Router();
apiRouter.use("/admin/homepage-banner/image",bannerImageRouter);
apiRouter.use("/order-photos", orderPhotosRouter);
apiRouter.use("/checkout", checkoutRouter);
apiRouter.use("/offers", offersRouter);

apiRouter.use(logMethodCall);
apiRouter.use("/home",homeBannerRouter);
apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/employees", employeesRouter);
apiRouter.use("/products", productsRouter);
apiRouter.use("/addresses", addressesRouter);
apiRouter.use("/cart", cartRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/colors", colorsRouter);
apiRouter.use("/admin", adminSearchRouter);
apiRouter.use("/wishlist", wishlistRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/customer-notifications",customerNotificationsRouter);


apiRouter.use("/newsletter", newsletterRouter);
apiRouter.use("/appointments", appointmentRouter);
apiRouter.use("/reviews", reviewsRouter);
apiRouter.use("/site-media", siteMediaRouter);
