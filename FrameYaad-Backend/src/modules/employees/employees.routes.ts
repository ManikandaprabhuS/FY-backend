import { Router } from "express";

import { adminOnly, authenticate } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./employees.controller";
import { adminUpdateEmployeeSchema, createEmployeeSchema } from "./employees.schemas";

export const employeesRouter = Router();

employeesRouter.use(authenticate, adminOnly);
employeesRouter.post("/", validateBody(createEmployeeSchema), controller.createEmployee);
employeesRouter.get("/", controller.listEmployees);
employeesRouter.get("/:id", controller.getEmployee);
employeesRouter.patch("/:id", validateBody(adminUpdateEmployeeSchema), controller.updateEmployee);
employeesRouter.delete("/:id", controller.deleteEmployee);
