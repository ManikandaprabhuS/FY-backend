import { UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), user: vi.fn(), list: vi.fn(), duplicate: vi.fn(), create: vi.fn() }));
vi.mock("../src/config/supabase", () => ({ supabaseAdmin: { auth: { getUser: mocks.getUser } }, createUserSupabaseClient: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { user: { findUnique: mocks.user, update: vi.fn() }, frameColor: { findMany: mocks.list, findFirst: mocks.duplicate, create: mocks.create } } }));
import { app } from "../src/app";
const id = "77777777-7777-4777-8777-777777777777";
const asRole = (role: UserRole) => { mocks.getUser.mockResolvedValue({ data: { user: { id, email_confirmed_at: "2026-08-01T00:00:00Z", phone_confirmed_at: null } }, error: null }); mocks.user.mockResolvedValue({ id, role, isActive: true, isEmailVerified: true, isPhoneNumberVerified: false }); };
beforeEach(() => { vi.clearAllMocks(); asRole(UserRole.ADMIN); mocks.list.mockResolvedValue([{ name: "Black", hex: "#000000" }, { name: "White", hex: "#FFFFFF" }]); mocks.duplicate.mockResolvedValue(null); mocks.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "color", ...data })); });
it("exposes only the shared persisted catalogue plus read-only legacy lookup", async () => {
  const response = await request(app).get("/api/v1/colors");
  expect(response.status).toBe(200); expect(mocks.list).toHaveBeenCalledTimes(1);
});
it.each([UserRole.ADMIN, UserRole.EMPLOYEE])("allows %s to add a trimmed custom colour", async role => {
  asRole(role); const response = await request(app).post("/api/v1/colors").set("Authorization", "Bearer staff").send({ name: " Forest Green ", hex: "#a1b2c3" });
  expect(response.status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "Forest Green", normalizedName: "forest green", hex: "#A1B2C3" } }));
});
it("rejects customers and unauthenticated callers", async () => {
  const body = { name: "Forest Green", hex: "#A1B2C3" };
  expect((await request(app).post("/api/v1/colors").send(body)).status).toBe(401);
  asRole(UserRole.CUSTOMER); expect((await request(app).post("/api/v1/colors").set("Authorization", "Bearer customer").send(body)).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each([{ name: "" }, { name: "   " }, { name: "X" }, { name: "<script>alert(1)</script>" }, { name: "a".repeat(31) }, { hex: "red" }, { hex: "#ZZZZZZ" }, { role: "ADMIN" }])("rejects invalid colour %j", async fields => {
  const response = await request(app).post("/api/v1/colors").set("Authorization", "Bearer staff").send({ name: "Forest Green", hex: "#A1B2C3", ...fields });
  expect(response.status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
});
it.each([{ name: "black", hex: "#123456" }, { name: "New White", hex: "#FFFFFF" }])("rejects duplicate name/hex %j", async body => {
  mocks.duplicate.mockResolvedValue({ id: "existing" });
  const response = await request(app).post("/api/v1/colors").set("Authorization", "Bearer staff").send(body);
  expect(response.status).toBe(409); expect(mocks.create).not.toHaveBeenCalled();
});
