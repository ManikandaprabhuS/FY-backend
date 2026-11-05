import type { Session } from "@supabase/supabase-js";
import type { CookieOptions, Request, Response } from "express";

import { env } from "../config/env";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../constants/auth";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: env.COOKIE_SAME_SITE,
  secure: env.NODE_ENV === "production" || env.COOKIE_SAME_SITE === "none",
};

export const setAuthCookies = (response: Response, session: Session): void => {
  response.cookie(ACCESS_TOKEN_COOKIE, session.access_token, {
    ...cookieOptions,
    maxAge: session.expires_in * 1000,
  });
  response.cookie(REFRESH_TOKEN_COOKIE, session.refresh_token, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

export const clearAuthCookies = (response: Response): void => {
  response.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions);
  response.clearCookie(REFRESH_TOKEN_COOKIE, cookieOptions);
};

const cookiesFrom = (request: Request): Record<string, unknown> =>
  typeof request.cookies === "object" && request.cookies !== null
    ? (request.cookies as Record<string, unknown>)
    : {};

export const getAccessToken = (request: Request): string | undefined => {
  const authorization = request.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim() || undefined;
  }

  const value = cookiesFrom(request)[ACCESS_TOKEN_COOKIE];
  return typeof value === "string" ? value : undefined;
};

export const getRefreshToken = (request: Request): string | undefined => {
  const value = cookiesFrom(request)[REFRESH_TOKEN_COOKIE];
  return typeof value === "string" ? value : undefined;
};
