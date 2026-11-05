import { UserRole } from "@prisma/client";
import type { RequestHandler } from "express";

import { supabaseAdmin } from "../config/supabase";
import { prisma } from "../prisma/client";
import { ApiError } from "../utils/api-error";
import { getAccessToken } from "../utils/auth-cookies";
import { userViewSelect } from "../utils/user-view";

const resolveAuthentication = async (request: Parameters<RequestHandler>[0]): Promise<boolean> => {
  const accessToken = getAccessToken(request);
  if (!accessToken) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return false;

  let user = await prisma.user.findUnique({
    where: { id: data.user.id },
    select: userViewSelect,
  });

  if (!user) {
    throw new ApiError(401, "User profile is not available", "PROFILE_NOT_FOUND");
  }
  const emailVerified = Boolean(data.user.email_confirmed_at);
  const phoneVerified = Boolean(data.user.phone_confirmed_at);
  if (
    user.isEmailVerified !== emailVerified ||
    user.isPhoneNumberVerified !== phoneVerified
  ) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: emailVerified,
        isPhoneNumberVerified: phoneVerified,
      },
      select: userViewSelect,
    });
  }
  if (!user.isActive) {
    throw new ApiError(403, "Account is deactivated", "ACCOUNT_DEACTIVATED");
  }

  request.auth = { accessToken, user };
  return true;
};

export const authenticate: RequestHandler = async (request, _response, next) => {
  if (!(await resolveAuthentication(request))) {
    next(new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED"));
    return;
  }
  next();
};

export const optionalAuthenticate: RequestHandler = async (request, _response, next) => {
  const accessToken = getAccessToken(request);
  if (!accessToken) {
    next();
    return;
  }

  if (!(await resolveAuthentication(request))) {
    next(new ApiError(401, "Authentication token is invalid", "INVALID_TOKEN"));
    return;
  }
  next();
};

export const authorize = (...allowedRoles: UserRole[]): RequestHandler =>
  (request, _response, next) => {
    if (!request.auth) {
      next(new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED"));
      return;
    }
    if (!allowedRoles.includes(request.auth.user.role)) {
      next(new ApiError(403, "You do not have permission for this action", "FORBIDDEN"));
      return;
    }
    next();
  };

export const adminOnly = authorize(UserRole.ADMIN);
export const staffOnly = authorize(UserRole.ADMIN, UserRole.EMPLOYEE);
