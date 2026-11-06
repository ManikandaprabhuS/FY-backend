import { createHash } from "node:crypto";
import type { PasswordRecovery } from "@prisma/client";
import { Prisma, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), raw: vi.fn(), transaction: vi.fn(), upsert: vi.fn(), find: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  send: vi.fn(), configured: vi.fn(), providerUpdate: vi.fn(),
  row: null as PasswordRecovery | null,
}));
vi.mock("node:crypto", async (original) => ({ ...await original<typeof import("node:crypto")>(), randomInt: () => 123456 }));
vi.mock("../src/prisma/client", () => ({ prisma: {
  user: { findFirst: mocks.user },
  passwordRecovery: { upsert: mocks.upsert, findUnique: mocks.find, update: mocks.update, updateMany: mocks.updateMany },
  $transaction: mocks.transaction,
} }));
vi.mock("../src/config/supabase", () => ({ supabaseAdmin: { auth: { admin: { updateUserById: mocks.providerUpdate } } } }));
vi.mock("../src/services/password-recovery-email.service", () => ({ sendPasswordRecoveryEmail: mocks.send }));
vi.mock("../src/services/email.service", () => ({ assertEmailConfigured: mocks.configured, EmailDeliveryError: class extends Error {} }));

import { completePasswordRecovery, requestRecoveryCode, verifyRecoveryCode } from "../src/modules/auth/password-recovery.service";

const customer = { id: "11111111-1111-4111-8111-111111111111", email: "customer@example.com", role: UserRole.CUSTOMER };
const admin = { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.com", role: UserRole.ADMIN };
const employee = { id: "33333333-3333-4333-8333-333333333333", email: "employee@example.com", role: UserRole.EMPLOYEE };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = null;
  mocks.user.mockImplementation(({ where }: { where: { id?: string; email?: { equals: string }; role: string } }) => Promise.resolve(
    [customer, admin, employee].find(user => user.role === where.role && (where.id ? user.id === where.id : user.email === where.email?.equals)) ?? null,
  ));
  mocks.raw.mockResolvedValue([{ key: "allowed" }]);
  const table = { upsert: mocks.upsert, findUnique: mocks.find, update: mocks.update };
  mocks.transaction.mockImplementation((operation: (transaction: { $queryRaw: typeof mocks.raw; passwordRecovery: typeof table }) => Promise<unknown>) => operation({ $queryRaw: mocks.raw, passwordRecovery: table }));
  mocks.upsert.mockImplementation(({ create }: { create: PasswordRecovery }) => { mocks.row = { ...create }; return Promise.resolve(mocks.row); });
  mocks.find.mockImplementation(({ where }: { where: { userId?: string; resetTokenHash?: string } }) => Promise.resolve(
    mocks.row && (where.userId ? where.userId === mocks.row.userId : where.resetTokenHash === mocks.row.resetTokenHash) ? { ...mocks.row } : null,
  ));
  mocks.update.mockImplementation(({ data }: { data: Partial<PasswordRecovery> }) => { mocks.row = { ...mocks.row, ...data } as PasswordRecovery; return Promise.resolve(mocks.row); });
  mocks.updateMany.mockImplementation(({ where, data }: { where: { resetTokenHash?: string }; data: Partial<PasswordRecovery> }) => {
    if (!mocks.row || (where.resetTokenHash && where.resetTokenHash !== mocks.row.resetTokenHash)) return Promise.resolve({ count: 0 });
    mocks.row = { ...mocks.row, ...data };
    return Promise.resolve({ count: 1 });
  });
  mocks.send.mockResolvedValue({ id: "resend-email-id" });
  mocks.configured.mockReturnValue(undefined);
  mocks.providerUpdate.mockResolvedValue({ error: null });
});

describe("portal-specific reset requests", () => {
  it("uses bounded remote-database transaction waits", async () => {
    await requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 15_000, timeout: 15_000 });
  });

  it("reports transaction acquisition failure without sending an OTP", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "Unable to start a transaction in the given time", { code: "P2028", clientVersion: "6.19.0" },
    ));
    await expect(requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1"))
      .rejects.toMatchObject({ statusCode: 503, code: "PASSWORD_RECOVERY_UNAVAILABLE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([customer, admin])("sends a six-digit OTP for the matching $role portal", async (user) => {
    await requestRecoveryCode(user.email, user.role, "127.0.0.1");
    expect(mocks.send).toHaveBeenCalledWith(user.email, "123456");
    expect(mocks.row?.otpHash).toHaveLength(64);
    expect(mocks.row?.otpHash).not.toBe(hash("123456"));
    expect(mocks.row?.portal).toBe(user.role);
    expect(mocks.row?.providerEmailId).toBe("resend-email-id");
    expect(mocks.row!.expiresAt.getTime() - mocks.row!.requestedAt.getTime()).toBe(600_000);
  });

  it("normalizes email on the backend", async () => {
    await requestRecoveryCode("  CUSTOMER@EXAMPLE.COM ", UserRole.CUSTOMER, "127.0.0.1");
    expect(mocks.send).toHaveBeenCalledWith(customer.email, "123456");
  });

  it.each([
    [admin.email, UserRole.CUSTOMER], [customer.email, UserRole.ADMIN],
    [employee.email, UserRole.ADMIN], ["unknown@example.com", UserRole.CUSTOMER],
  ] as const)("rejects %s on %s with the same message and no OTP", async (email, role) => {
    await expect(requestRecoveryCode(email, role, "127.0.0.1")).rejects.toMatchObject({ statusCode: 404, message: "No account found for this email." });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rate-limits requests per IP before any account can generate an OTP", async () => {
    mocks.raw.mockResolvedValueOnce([]);
    await expect(requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1")).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("enforces per-email limits/cooldown before replacing the code", async () => {
    mocks.raw.mockResolvedValueOnce([{ key: "ip" }]).mockResolvedValueOnce([]);
    await expect(requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1")).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("a new request invalidates the earlier code and reset token", async () => {
    await requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1");
    const first = mocks.row!.id;
    await verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER);
    await requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1");
    expect(mocks.row!.id).not.toBe(first);
    expect(mocks.row!.verifiedAt).toBeNull();
    expect(mocks.row!.resetTokenHash).toBeNull();
  });

  it("invalidates a code if email delivery fails", async () => {
    mocks.send.mockRejectedValueOnce(new Error("delivery failed"));
    await expect(requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1")).rejects.toMatchObject({ code: "PASSWORD_RESET_DELIVERY_FAILED" });
    expect(mocks.row?.otpHash).toBeNull();
  });
});

describe("OTP and reset-token checks", () => {
  beforeEach(async () => { await requestRecoveryCode(customer.email, UserRole.CUSTOMER, "127.0.0.1"); });

  it("returns only an opaque token after verification and rejects a reused OTP", async () => {
    const verified = await verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER);
    expect(verified.resetToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.row?.resetTokenHash).toBe(hash(verified.resetToken));
    expect(mocks.row?.otpHash).toBeNull();
    await expect(verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "INVALID_RECOVERY_OTP" });
  });

  it("rejects an expired OTP", async () => {
    mocks.row!.expiresAt = new Date(Date.now() - 1);
    await expect(verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "INVALID_RECOVERY_OTP" });
  });

  it("persists five wrong attempts and locks even a subsequent correct code", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await expect(verifyRecoveryCode(customer.email, "999999", UserRole.CUSTOMER)).rejects.toMatchObject({ code: index === 5 ? "OTP_ATTEMPTS_EXCEEDED" : "INVALID_RECOVERY_OTP" });
      expect(mocks.row?.attempts).toBe(index);
    }
    await expect(verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "OTP_ATTEMPTS_EXCEEDED" });
  });

  it("cannot skip OTP verification", async () => {
    await expect(completePasswordRecovery("x".repeat(43), "NewPassword123!", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    expect(mocks.providerUpdate).not.toHaveBeenCalled();
  });

  it("resets once with the verified token", async () => {
    const { resetToken } = await verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER);
    await completePasswordRecovery(resetToken, "NewPassword123!", UserRole.CUSTOMER);
    expect(mocks.providerUpdate).toHaveBeenCalledWith(customer.id, { password: "NewPassword123!" });
    await expect(completePasswordRecovery(resetToken, "OtherPassword123!", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    expect(mocks.providerUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects expired and cross-portal reset tokens", async () => {
    const { resetToken } = await verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER);
    await expect(completePasswordRecovery(resetToken, "NewPassword123!", UserRole.ADMIN)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    mocks.row!.resetExpiresAt = new Date(Date.now() - 1);
    await expect(completePasswordRecovery(resetToken, "NewPassword123!", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    expect(mocks.providerUpdate).not.toHaveBeenCalled();
  });

  it("does not reset if another request claims the token first", async () => {
    const { resetToken } = await verifyRecoveryCode(customer.email, "123456", UserRole.CUSTOMER);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completePasswordRecovery(resetToken, "NewPassword123!", UserRole.CUSTOMER)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    expect(mocks.providerUpdate).not.toHaveBeenCalled();
  });
});
