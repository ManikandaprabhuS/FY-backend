import { Router } from "express";

import { authenticate, staffOnly } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./newsletter.controller";
import { newsletterEmailSchema } from "./newsletter.schemas";

export const newsletterRouter = Router();

newsletterRouter.post("/subscribe", validateBody(newsletterEmailSchema), controller.subscribe);
newsletterRouter.post("/unsubscribe", validateBody(newsletterEmailSchema), controller.unsubscribe);

newsletterRouter.use(authenticate, staffOnly);
newsletterRouter.get("/subscribers/export", controller.exportCsv);
newsletterRouter.get("/subscribers", controller.list);

