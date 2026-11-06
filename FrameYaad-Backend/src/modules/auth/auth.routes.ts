import { Router } from "express";
import { UserRole } from "@prisma/client";
import { ApiError } from "../../utils/api-error";
import { createPasswordRecoveryRouter } from "./password-recovery.routes";

import { authenticate, adminOnly } from "../../middleware/auth.middleware";
import { staffLoginRateLimit } from "../../middleware/staff-login-rate-limit.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./auth.controller";
import {
  changePasswordSchema,
  adminRegistrationSchema,
  customerRegistrationSchema,
  loginSchema,
  updateOwnProfileSchema,
} from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/customer/register", validateBody(customerRegistrationSchema), controller.registerCustomer);
authRouter.post("/admin/register", authenticate, adminOnly, staffLoginRateLimit, validateBody(adminRegistrationSchema), controller.registerAdmin);
authRouter.post("/customer/login", validateBody(loginSchema), controller.loginCustomer);
authRouter.post("/admin/login", staffLoginRateLimit, validateBody(loginSchema), controller.loginAdmin);
authRouter.post("/employee/login", staffLoginRateLimit, validateBody(loginSchema), controller.loginEmployee);
authRouter.post("/staff/login", staffLoginRateLimit, validateBody(loginSchema), controller.loginStaff);
authRouter.post("/refresh", controller.refresh);
authRouter.post("/logout", controller.logout);
authRouter.get("/me", authenticate, controller.me);
authRouter.patch("/profile", authenticate, validateBody(updateOwnProfileSchema), controller.updateProfile);
authRouter.use("/customer", createPasswordRecoveryRouter(UserRole.CUSTOMER));

authRouter.use("/admin", createPasswordRecoveryRouter(UserRole.ADMIN));
// Old generic endpoints cannot bypass portal selection or OTP verification.
authRouter.post(["/forgot-password", "/verify-reset-otp", "/reset-password"], (_request, _response, next) => {
  next(new ApiError(410, "Open the password reset screen for your customer or admin portal", "RECOVERY_PORTAL_REQUIRED"));
});
authRouter.post("/change-password", authenticate, validateBody(changePasswordSchema), controller.changePassword);
