import { Router } from "express";

import { authenticate, staffOnly } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./appointment.controller";
import { createAppointmentSchema, updateAppointmentStatusSchema } from "./appointment.schemas";

export const appointmentRouter = Router();

appointmentRouter.post("/", validateBody(createAppointmentSchema), controller.create);

appointmentRouter.use(authenticate, staffOnly);
appointmentRouter.get("/", controller.list);
appointmentRouter.get("/:id", controller.getById);
appointmentRouter.patch("/:id/status", validateBody(updateAppointmentStatusSchema), controller.updateStatus);
