import { Router } from "express";

import { authenticate, optionalAuthenticate } from "../../middleware/auth.middleware";
import { staffLoginRateLimit } from "../../middleware/staff-login-rate-limit.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./auth.controller";
import {
  changePasswordSchema,
  customerRegistrationSchema,
  forgotPasswordSchema,
  loginSchema,
  registrationSchema,
  resetPasswordSchema,
  updateOwnProfileSchema,
} from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/customer/register", validateBody(customerRegistrationSchema), controller.registerCustomer);
authRouter.post("/admin/register", optionalAuthenticate, validateBody(registrationSchema), controller.registerAdmin);
authRouter.post("/customer/login", validateBody(loginSchema), controller.loginCustomer);
authRouter.post("/admin/login", staffLoginRateLimit, validateBody(loginSchema), controller.loginAdmin);
authRouter.post("/employee/login", staffLoginRateLimit, validateBody(loginSchema), controller.loginEmployee);
authRouter.post("/staff/login", staffLoginRateLimit, validateBody(loginSchema), controller.loginStaff);
authRouter.post("/refresh", controller.refresh);
authRouter.post("/logout", controller.logout);
authRouter.get("/me", authenticate, controller.me);
authRouter.patch("/profile", authenticate, validateBody(updateOwnProfileSchema), controller.updateProfile);
authRouter.post("/forgot-password", validateBody(forgotPasswordSchema), controller.forgotPassword);
authRouter.post("/reset-password", validateBody(resetPasswordSchema), controller.resetPassword);
authRouter.post("/change-password", authenticate, validateBody(changePasswordSchema), controller.changePassword);
