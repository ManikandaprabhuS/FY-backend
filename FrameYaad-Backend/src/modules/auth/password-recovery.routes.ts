import { Router } from "express";
import { validateBody } from "../../middleware/validate.middleware";
import { createRecoveryRateLimit } from "../../middleware/password-recovery-rate-limit.middleware";
import { clearAuthCookies } from "../../utils/auth-cookies";
import { forgotPasswordSchema, resetPasswordSchema, verifyResetOtpSchema } from "./auth.schemas";
import { completePasswordRecovery, requestRecoveryCode, verifyRecoveryCode, type RecoveryRole } from "./password-recovery.service";
import type { z } from "zod";

export const createPasswordRecoveryRouter = (role: RecoveryRole) => {
  const router = Router();
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/forgot-password", validateBody(forgotPasswordSchema), async (request, response) => {
    const input = request.body as z.infer<typeof forgotPasswordSchema>;
    await requestRecoveryCode(input.email, role, request.ip ?? request.socket.remoteAddress ?? "unknown");
    response.status(202).json({ success: true, message: "A verification code has been sent to your email." });
  });
  router.post("/verify-reset-otp", createRecoveryRateLimit(20), validateBody(verifyResetOtpSchema), async (request, response) => {
    const input = request.body as z.infer<typeof verifyResetOtpSchema>;
    const data = await verifyRecoveryCode(input.email, input.otp, role);
    response.status(200).json({ success: true, data });
  });
  router.post("/reset-password", createRecoveryRateLimit(20), validateBody(resetPasswordSchema), async (request, response) => {
    const input = request.body as z.infer<typeof resetPasswordSchema>;
    await completePasswordRecovery(input.resetToken, input.newPassword, role);
    clearAuthCookies(response);
    response.status(200).json({ success: true, message: "Password reset successfully; please log in again" });
  });
  return router;
};
