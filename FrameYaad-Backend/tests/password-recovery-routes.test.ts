import express from "express";
import request from "supertest";
import { UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn(), complete: vi.fn() }));
vi.mock("../src/modules/auth/password-recovery.service", () => ({
  requestRecoveryCode: mocks.request, verifyRecoveryCode: mocks.verify, completePasswordRecovery: mocks.complete,
}));
import { createPasswordRecoveryRouter } from "../src/modules/auth/password-recovery.routes";

const app = express();
app.use(express.json());
app.use("/customer", createPasswordRecoveryRouter(UserRole.CUSTOMER));
app.use("/admin", createPasswordRecoveryRouter(UserRole.ADMIN));
app.use(((error: { statusCode?: number }, _request, response, next) => {
  void next;
  response.sendStatus(error.statusCode ?? 400);
}) as express.ErrorRequestHandler);

beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue(undefined); mocks.verify.mockResolvedValue({ resetToken: "x".repeat(43) }); mocks.complete.mockResolvedValue(undefined); });

describe("server-bound recovery portals", () => {
  it.each([["customer", UserRole.CUSTOMER], ["admin", UserRole.ADMIN]])("normalizes email and binds the %s route to its server role", async (portal, role) => {
    const result = await request(app).post(`/${portal}/forgot-password`).send({ email: "  USER@EXAMPLE.COM " });
    expect(result.status).toBe(202);
    expect(mocks.request).toHaveBeenCalledWith("user@example.com", role, expect.any(String));
  });
  it("rejects a frontend-supplied role instead of trusting it", async () => {
    const result = await request(app).post("/customer/forgot-password").send({ email: "user@example.com", role: "ADMIN" });
    expect(result.status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("returns only the one-use reset token, with no cache", async () => {
    const result = await request(app).post("/admin/verify-reset-otp").send({ email: "admin@example.com", otp: "123456" });
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body as unknown).toEqual({ success: true, data: { resetToken: "x".repeat(43) } });
    expect(mocks.verify).toHaveBeenCalledWith("admin@example.com", "123456", UserRole.ADMIN);
  });
  it("rejects a normal login token as password-reset authorization", async () => {
    const result = await request(app).post("/customer/reset-password").send({ accessToken: "normal-login-token", newPassword: "Password123!" });
    expect(result.status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("requires exactly six OTP digits", async () => {
    const result = await request(app).post("/customer/verify-reset-otp").send({ email: "customer@example.com", otp: "12345678" });
    expect(result.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
