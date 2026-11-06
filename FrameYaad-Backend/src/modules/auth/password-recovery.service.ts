import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { supabaseAdmin } from "../../config/supabase";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { assertEmailConfigured, EmailDeliveryError } from "../../services/email.service";
import { sendPasswordRecoveryEmail } from "../../services/password-recovery-email.service";

export type RecoveryRole = typeof UserRole.CUSTOMER | typeof UserRole.ADMIN;
const OTP_LIFETIME = 10 * 60_000;
const RESET_LIFETIME = 10 * 60_000;
const WINDOW = 15 * 60_000;
const COOLDOWN = 60_000;
const MAX_ATTEMPTS = 5;
// Remote database connections can exceed Prisma's default two-second acquisition wait.
// Keep transactions bounded and never retry callbacks that may have consumed an OTP.
const recoveryTransaction = async <T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(operation, { maxWait: 15_000, timeout: 15_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      throw new ApiError(503, "Password recovery is temporarily busy. Please try again shortly", "PASSWORD_RECOVERY_UNAVAILABLE");
    }
    throw error;
  }
};
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// HMAC prevents offline guessing of a six-digit code from a leaked database hash.
const otpDigest = (id: string, otp: string) => createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY)
  .update(`frameyaad:password-recovery:${id}:${otp}`).digest("hex");
const invalidCode = () => new ApiError(400, "The code is invalid or expired. Request a new code", "INVALID_RECOVERY_OTP");
const invalidToken = () => new ApiError(400, "The reset token is invalid or expired. Request a new code", "INVALID_RESET_TOKEN");

const findAccount = async (email: string, role: RecoveryRole) => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, role, isActive: true },
    select: { id: true, email: true },
  });
  if (!user) throw new ApiError(404, "No account found for this email.", "RECOVERY_ACCOUNT_NOT_FOUND");
  return user;
};

const consumeRate = async (transaction: Prisma.TransactionClient, key: string, maximum: number, now: Date, cooldown = 0) => {
  const expiry = new Date(now.getTime() + WINDOW);
  const nextAllowed = new Date(now.getTime() + cooldown);
  const rows = await transaction.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    INSERT INTO public.password_recovery_rates AS current (key, requests, window_expires_at, next_allowed_at)
    VALUES (${key}, 1, ${expiry}, ${nextAllowed})
    ON CONFLICT (key) DO UPDATE SET
      requests = CASE WHEN current.window_expires_at <= ${now} THEN 1 ELSE current.requests + 1 END,
      window_expires_at = CASE WHEN current.window_expires_at <= ${now} THEN ${expiry} ELSE current.window_expires_at END,
      next_allowed_at = ${nextAllowed}
    WHERE (current.window_expires_at <= ${now} OR current.requests < ${maximum}) AND current.next_allowed_at <= ${now}
    RETURNING key
  `);
  if (rows.length === 0) throw new ApiError(429, "Too many reset requests. Wait at least 60 seconds before resending and try again later", "PASSWORD_RESET_RATE_LIMITED");
};

export const requestRecoveryCode = async (rawEmail: string, role: RecoveryRole, ip: string): Promise<void> => {
  const email = normalizeEmail(rawEmail);
  const now = new Date();
  await recoveryTransaction(async (transaction) => {
    await consumeRate(transaction, `request:ip:${digest(ip)}`, 20, now);
  });
  const user = await findAccount(email, role);
  try { assertEmailConfigured(); } catch {
    throw new ApiError(503, "Password reset email is not configured. Please contact support", "PASSWORD_RESET_DELIVERY_FAILED");
  }
  const id = randomUUID();
  const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await recoveryTransaction(async (transaction) => {
    await consumeRate(transaction, `request:email:${digest(email)}`, 3, now, COOLDOWN);
    const data = {
      id, email, portal: role, otpHash: otpDigest(id, otp), expiresAt: new Date(now.getTime() + OTP_LIFETIME),
      attempts: 0, requestedAt: now, verifiedAt: null, resetTokenHash: null, resetExpiresAt: null,
      consumedAt: null, providerEmailId: null,
    };
    await transaction.passwordRecovery.upsert({ where: { userId: user.id }, create: { ...data, userId: user.id }, update: data });
  });
  try {
    const sent = await sendPasswordRecoveryEmail(email, otp);
    await prisma.passwordRecovery.updateMany({ where: { id }, data: { providerEmailId: sent.id } });
  } catch (error) {
    // Never leave a usable code after delivery failed or its outcome was unknown.
    await prisma.passwordRecovery.updateMany({ where: { id }, data: { otpHash: null, expiresAt: now } });
    logger.error({ providerStatus: error instanceof EmailDeliveryError ? error.providerStatus : undefined }, "Password recovery email delivery failed");
    throw new ApiError(502, "Password reset email could not be sent. Please try again later", "PASSWORD_RESET_DELIVERY_FAILED");
  }
};

export const verifyRecoveryCode = async (rawEmail: string, otp: string, role: RecoveryRole) => {
  const email = normalizeEmail(rawEmail);
  const user = await findAccount(email, role);
  const result = await recoveryTransaction(async (transaction) => {
    // Serialize guesses and verification so concurrent attempts cannot exceed five or reuse a code.
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM public.password_recoveries WHERE user_id = ${user.id} FOR UPDATE`);
    const challenge = await transaction.passwordRecovery.findUnique({ where: { userId: user.id } });
    const now = new Date();
    if (challenge?.attempts === MAX_ATTEMPTS) return { kind: "locked" } as const;
    if (!challenge || challenge.portal !== role || challenge.email !== email || !challenge.otpHash || challenge.verifiedAt || challenge.expiresAt <= now) {
      return { kind: "invalid" } as const;
    }
    const correct = timingSafeEqual(Buffer.from(challenge.otpHash, "hex"), Buffer.from(otpDigest(challenge.id, otp), "hex"));
    if (!correct) {
      const attempts = challenge.attempts + 1;
      await transaction.passwordRecovery.update({ where: { id: challenge.id }, data: { attempts, ...(attempts === MAX_ATTEMPTS ? { otpHash: null } : {}) } });
      // Return rather than throw here: failed-attempt increments must commit.
      return { kind: attempts === MAX_ATTEMPTS ? "locked" : "invalid" } as const;
    }
    const resetToken = randomBytes(32).toString("base64url");
    await transaction.passwordRecovery.update({ where: { id: challenge.id }, data: {
      otpHash: null, verifiedAt: now, resetTokenHash: digest(resetToken),
      resetExpiresAt: new Date(now.getTime() + RESET_LIFETIME),
    } });
    return { kind: "verified", resetToken } as const;
  });
  if (result.kind === "locked") throw new ApiError(429, "Too many incorrect codes. Request a new code", "OTP_ATTEMPTS_EXCEEDED");
  if (result.kind !== "verified") throw invalidCode();
  return { resetToken: result.resetToken };
};

export const completePasswordRecovery = async (resetToken: string, newPassword: string, role: RecoveryRole): Promise<void> => {
  const resetTokenHash = digest(resetToken);
  const challenge = await prisma.passwordRecovery.findUnique({ where: { resetTokenHash } });
  const now = new Date();
  if (!challenge || challenge.portal !== role || !challenge.verifiedAt || !challenge.resetExpiresAt || challenge.resetExpiresAt <= now || challenge.consumedAt) throw invalidToken();
  const user = await prisma.user.findFirst({ where: { id: challenge.userId, role, isActive: true }, select: { id: true } });
  if (!user) throw invalidToken();
  const claimed = await prisma.passwordRecovery.updateMany({
    where: { id: challenge.id, resetTokenHash, portal: role, verifiedAt: { not: null }, consumedAt: null, resetExpiresAt: { gt: now } },
    data: { consumedAt: now, resetTokenHash: null },
  });
  if (claimed.count !== 1) throw invalidToken();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) {
    // A claimed token is never reusable, including when the provider outcome is uncertain.
    throw new ApiError(400, "Password could not be reset. Request a new code and try again", "PASSWORD_RESET_FAILED");
  }
};
