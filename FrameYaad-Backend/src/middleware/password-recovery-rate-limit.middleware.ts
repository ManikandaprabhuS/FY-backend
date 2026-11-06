import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

import { ApiError } from "../utils/api-error";

export const createRecoveryRateLimit = (maximum: number): RequestHandler => {
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  const windowMs = 15 * 60 * 1_000;
  return (request, response, next) => {
    const body = request.body as { email?: unknown; accessToken?: unknown } | undefined;
    const identity = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const key = createHash("sha256").update(`${request.ip ?? "unknown"}:${identity}`).digest("hex");
    const now = Date.now();
    for (const [entryKey, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(entryKey);
    }
    const entry = attempts.get(key) ?? { count: 0, expiresAt: now + windowMs };
    if (entry.count >= maximum) {
      response.setHeader("Retry-After", Math.ceil((entry.expiresAt - now) / 1_000));
      next(new ApiError(429, "Too many password reset attempts. Please try again later", "PASSWORD_RESET_RATE_LIMITED"));
      return;
    }
    // Keep memory bounded if many different addresses are submitted.
    if (attempts.size >= 10_000 && !attempts.has(key)) {
      next(new ApiError(429, "Too many password reset attempts. Please try again later", "PASSWORD_RESET_RATE_LIMITED"));
      return;
    }
    entry.count += 1;
    attempts.set(key, entry);
    next();
  };
};
