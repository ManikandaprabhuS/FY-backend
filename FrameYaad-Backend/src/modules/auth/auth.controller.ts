import { UserRole } from "@prisma/client";
import type { RequestHandler } from "express";

import { ApiError } from "../../utils/api-error";
import {
  clearAuthCookies,
  getAccessToken,
  getRefreshToken,
  setAuthCookies,
} from "../../utils/auth-cookies";
import type { z } from "zod";
import type {
  changePasswordSchema,
  customerRegistrationSchema,
  forgotPasswordSchema,
  loginSchema,
  registrationSchema,
  resetPasswordSchema,
  updateOwnProfileSchema,
} from "./auth.schemas";
import * as authService from "./auth.service";

type RegistrationBody = z.infer<typeof registrationSchema>;
type CustomerRegistrationBody = z.infer<typeof customerRegistrationSchema>;
type LoginBody = z.infer<typeof loginSchema>;
type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;
type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
type UpdateProfileBody = z.infer<typeof updateOwnProfileSchema>;

const requireAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth;
};

export const registerCustomer: RequestHandler = async (request, response) => {
  const result = await authService.registerCustomer(request.body as CustomerRegistrationBody);
  if (result.session) setAuthCookies(response, result.session);
  response.status(201).json({
    success: true,
    data: {
      user: result.user,
      emailConfirmationRequired: !result.session,
      authentication: result.session ? "httpOnlyCookie" : "emailConfirmationRequired",
    },
  });
};

export const registerAdmin: RequestHandler = async (request, response) => {
  const user = await authService.registerAdmin(request.body as RegistrationBody, request.auth?.user);
  response.status(201).json({ success: true, data: { user } });
};

const loginFor = (roles: UserRole | readonly UserRole[]): RequestHandler => async (request, response) => {
  const result = await authService.login(request.body as LoginBody, roles);
  if (!result.session) throw new ApiError(500, "Login session was not created", "SESSION_NOT_CREATED");
  setAuthCookies(response, result.session);
  response.status(200).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.session.access_token,
      authentication: "httpOnlyCookie",
      expiresInSeconds: result.session.expires_in,
    },
  });
};

export const loginCustomer = loginFor(UserRole.CUSTOMER);
export const loginAdmin = loginFor(UserRole.ADMIN);
export const loginEmployee = loginFor(UserRole.EMPLOYEE);
export const loginStaff = loginFor([UserRole.ADMIN, UserRole.EMPLOYEE]);

export const refresh: RequestHandler = async (request, response) => {
  const token = getRefreshToken(request);
  if (!token) throw new ApiError(401, "Refresh token is required", "REFRESH_TOKEN_REQUIRED");
  const result = await authService.refreshSession(token);
  if (!result.session) throw new ApiError(401, "Session cannot be refreshed", "INVALID_REFRESH_TOKEN");
  setAuthCookies(response, result.session);
  response.status(200).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.session.access_token,
      authentication: "httpOnlyCookie",
      expiresInSeconds: result.session.expires_in,
    },
  });
};

export const logout: RequestHandler = async (request, response) => {
  await authService.logout(getAccessToken(request));
  clearAuthCookies(response);
  response.status(200).json({ success: true, message: "Logged out successfully" });
};

export const me: RequestHandler = (request, response) => {
  const auth = requireAuth(request);
  response.status(200).json({ success: true, data: { user: auth.user } });
};

export const updateProfile: RequestHandler = async (request, response) => {
  const auth = requireAuth(request);
  const user = await authService.updateOwnProfile(auth.user.id, request.body as UpdateProfileBody);
  response.status(200).json({ success: true, data: { user } });
};

export const forgotPassword: RequestHandler = async (request, response) => {
  await authService.requestPasswordReset((request.body as ForgotPasswordBody).email);
  response.status(202).json({
    success: true,
    message: "If an account exists for that email, a password reset link has been sent",
  });
};

export const resetPassword: RequestHandler = async (request, response) => {
  await authService.resetPassword(request.body as ResetPasswordBody);
  clearAuthCookies(response);
  response.status(200).json({ success: true, message: "Password reset successfully; please log in again" });
};

export const changePassword: RequestHandler = async (request, response) => {
  const auth = requireAuth(request);
  await authService.changePassword(auth.user, auth.accessToken, request.body as ChangePasswordBody);
  clearAuthCookies(response);
  response.status(200).json({ success: true, message: "Password changed successfully; please log in again" });
};
