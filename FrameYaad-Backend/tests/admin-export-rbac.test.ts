import { UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), products: vi.fn(), customers: vi.fn() }));
vi.mock("../src/config/supabase", () => ({ supabaseAdmin: { auth: { getUser: mocks.auth } }, createUserSupabaseClient: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { user: { findUnique: mocks.user, update: vi.fn() } } }));
vi.mock("../src/modules/products/products.export", () => ({ productExportHeaders: ["Product"], productExportRows: mocks.products }));
vi.mock("../src/modules/users/users.export", () => ({ customerExportHeaders: ["Customer"], customerExportRows: mocks.customers }));
import { app } from "../src/app";
const id = "77777777-7777-4777-8777-777777777777";
const role = (value: UserRole) => {
  mocks.auth.mockResolvedValue({ data: { user: { id, email_confirmed_at: "2026-08-01T00:00:00Z" } }, error: null });
  mocks.user.mockResolvedValue({ id, role: value, isActive: true, isEmailVerified: true, isPhoneNumberVerified: false });
};
beforeEach(() => {
  vi.clearAllMocks(); role(UserRole.CUSTOMER);
  const rows = async function* () { await Promise.resolve(); yield ["safe export"]; };
  mocks.products.mockImplementation(rows); mocks.customers.mockImplementation(rows);
});
it.each([UserRole.ADMIN, UserRole.EMPLOYEE])("allows %s to export both complete reports", async value => {
  role(value);
  for (const path of ["/products/export", "/users/export"]) {
    const response = await request(app).get("/api/v1" + path + "?search=Frame&isActive=true").set("Authorization", "Bearer staff");
    expect(response.status).toBe(200); expect(response.type).toBe("text/csv");
  }
  expect(mocks.products).toHaveBeenCalledWith(expect.objectContaining({ search: "Frame", isActive: "true" }));
  expect(mocks.customers).toHaveBeenCalledWith(expect.objectContaining({ search: "Frame", isActive: "true" }));
});
it("rejects unauthenticated/customer exports even with a spoofed role", async () => {
  for (const path of ["/products/export", "/users/export"]) {
    expect((await request(app).get("/api/v1" + path)).status).toBe(401);
    expect((await request(app).get("/api/v1" + path + "?role=ADMIN").set("Authorization", "Bearer customer")).status).toBe(403);
  }
  expect(mocks.products).not.toHaveBeenCalled(); expect(mocks.customers).not.toHaveBeenCalled();
});
