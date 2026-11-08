import { UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), search: vi.fn() }));
vi.mock("../src/config/supabase", () => ({ supabaseAdmin: { auth: { getUser: mocks.auth } }, createUserSupabaseClient: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { user: { findUnique: mocks.user, update: vi.fn() } } }));
vi.mock("../src/modules/admin-search/admin-search.service", () => ({ searchAdmin: mocks.search }));
import { app } from "../src/app";
const id = "77777777-7777-4777-8777-777777777777";
const role = (value: UserRole) => { mocks.auth.mockResolvedValue({ data: { user: { id, email_confirmed_at: "2026-08-01T00:00:00Z", phone_confirmed_at: null } }, error: null }); mocks.user.mockResolvedValue({ id, role: value, isActive: true, isEmailVerified: true, isPhoneNumberVerified: false }); };
beforeEach(() => { vi.clearAllMocks(); role(UserRole.CUSTOMER); mocks.search.mockResolvedValue({ query: "Mahesh", kind: "text", orders: [], customers: [], counts: { orders: 0, customers: 0 } }); });
it.each([UserRole.ADMIN, UserRole.EMPLOYEE])("allows %s grouped search", async value => {
  role(value); const response = await request(app).get("/api/v1/admin/search?q=Mahesh").set("Authorization", "Bearer staff");
  expect(response.status).toBe(200); expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ q: "Mahesh" }));
});
it("rejects unauthenticated/customer access even with a spoofed role parameter", async () => {
  expect((await request(app).get("/api/v1/admin/search?q=Mahesh")).status).toBe(401);
  expect((await request(app).get("/api/v1/admin/search?q=Mahesh&role=ADMIN").set("Authorization", "Bearer customer")).status).toBe(403);
  expect(mocks.search).not.toHaveBeenCalled();
});
