import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { ApiError } from "../utils/api-error";

type LoginAttempt = {
  count: number;
  resetAt: number;
};

const attempts = new Map<string, LoginAttempt>();
let lastCleanupAt = Date.now();

const cleanupExpiredAttempts = (now: number) => {
  if (now - lastCleanupAt < env.STAFF_LOGIN_RATE_LIMIT_WINDOW_MS) return;

  for (const [key, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(key);
  }
  lastCleanupAt = now;
};

const getAttemptKey = (ipAddress: string, email: unknown) => {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "unknown";
  const emailFingerprint = createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 24);
  return `${ipAddress}:${emailFingerprint}`;
};

export const staffLoginRateLimit: RequestHandler = (request, response, next) => {
  const now = Date.now();
  cleanupExpiredAttempts(now);

  const ipAddress = request.ip || request.socket.remoteAddress || "unknown";
  const key = getAttemptKey(ipAddress, (request.body as { email?: unknown } | undefined)?.email);
  const existingAttempt = attempts.get(key);
  const attempt = !existingAttempt || existingAttempt.resetAt <= now
    ? { count: 0, resetAt: now + env.STAFF_LOGIN_RATE_LIMIT_WINDOW_MS }
    : existingAttempt;
  const retryAfterSeconds = Math.max(1, Math.ceil((attempt.resetAt - now) / 1_000));
  const remaining = Math.max(0, env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS - attempt.count);

  response.setHeader("RateLimit-Policy", `${env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS};w=${Math.ceil(env.STAFF_LOGIN_RATE_LIMIT_WINDOW_MS / 1_000)}`);
  response.setHeader("RateLimit-Limit", env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  response.setHeader("RateLimit-Remaining", remaining);
  response.setHeader("RateLimit-Reset", retryAfterSeconds);

  if (attempt.count >= env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    response.setHeader("Retry-After", retryAfterSeconds);
    logger.warn(
      { requestId: request.requestId, ip: ipAddress, path: request.path, retryAfterSeconds },
      "Staff login rate limit exceeded",
    );
    next(new ApiError(
      429,
      "Too many login attempts. Please try again later",
      "LOGIN_RATE_LIMIT_EXCEEDED",
      { retryAfterSeconds },
    ));
    return;
  }

  attempt.count += 1;
  attempts.set(key, attempt);
  response.setHeader(
    "RateLimit-Remaining",
    Math.max(0, env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS - attempt.count),
  );
  response.once("finish", () => {
    if (response.statusCode >= 400) return;

    const currentAttempt = attempts.get(key);
    if (!currentAttempt || currentAttempt.resetAt !== attempt.resetAt) return;
    if (currentAttempt.count <= 1) attempts.delete(key);
    else attempts.set(key, { ...currentAttempt, count: currentAttempt.count - 1 });
  });
  next();
};
