import { createHmac } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
const attempts = new Map<string, { count: number; expires: number }>();
export const reviewFingerprint = (value: string) => createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY).update("reviews:" + value).digest("hex");
export const reviewRequestLimit: RequestHandler = (request, response, next) => {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const body = request.body as { email?: unknown } | undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const keys: Array<[string, number]> = [[reviewFingerprint("ip:" + (request.ip || request.socket.remoteAddress || "unknown")), 30], [reviewFingerprint("email:" + email), 5]];
  for (const [key, limit] of keys) {
    const current = attempts.get(key);
    if (current && current.count >= limit) { response.setHeader("Retry-After", Math.ceil((current.expires - now) / 1000)); next(new ApiError(429, "Too many review attempts. Please try again later.", "REVIEW_RATE_LIMITED")); return; }
  }
  if (attempts.size > 10000) { next(new ApiError(429, "Review submission is busy. Please try again later.", "REVIEW_RATE_LIMITED")); return; }
  for (const [key] of keys) { const current = attempts.get(key); attempts.set(key, { count: (current?.count ?? 0) + 1, expires: current?.expires ?? now + 15 * 60000 }); }
  next();
};
