import { UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listSubscribers: vi.fn(),
  exportSubscribers: vi.fn(),
}));

vi.mock("../src/config/supabase", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
  createUserSupabaseClient: vi.fn(),
}));

vi.mock("../src/prisma/client", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate } },
}));

vi.mock("../src/modules/newsletter/newsletter.service", () => ({
  subscribe: mocks.subscribe,
  unsubscribe: mocks.unsubscribe,
  listSubscribers: mocks.listSubscribers,
  exportSubscribers: mocks.exportSubscribers,
}));

import { app } from "../src/app";
import { ApiError } from "../src/utils/api-error";

const userId = "11111111-aaaa-4111-8111-111111111111";
const baseUser = {
  id: userId,
  name: "Newsletter Staff",
  email: "staff@example.com",
  isEmailVerified: true,
  phoneNumber: null,
  isPhoneNumberVerified: false,
  addressLine: null,
  postalCode: null,
  city: null,
  state: null,
  country: null,
  gender: null,
  role: UserRole.ADMIN,
  isActive: true,
  createdById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const authenticateAs = (role: UserRole): void => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: userId, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
    error: null,
  });
  mocks.userFindUnique.mockResolvedValue({ ...baseUser, role });
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAs(UserRole.ADMIN);
  mocks.subscribe.mockResolvedValue({ resubscribed: false });
  mocks.unsubscribe.mockResolvedValue({ alreadyUnsubscribed: false });
  mocks.listSubscribers.mockResolvedValue({
    subscribers: [],
    summary: { total: 0, active: 0, unsubscribed: 0 },
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  mocks.exportSubscribers.mockResolvedValue("Email,Status,Subscribed At,Unsubscribed At");
});

describe("newsletter public APIs", () => {
  it("normalizes whitespace and case before subscribing", async () => {
    const response = await request(app)
      .post("/api/v1/newsletter/subscribe")
      .send({ email: " CUSTOMER@GMAIL.COM " });
    expect(response.status).toBe(201);
    expect(mocks.subscribe).toHaveBeenCalledWith({ email: "customer@gmail.com" });
    expect(response.body).toEqual(expect.objectContaining({ message: "Successfully subscribed to our newsletter" }));
  });

  it("returns the resubscription message", async () => {
    mocks.subscribe.mockResolvedValue({ resubscribed: true });
    const response = await request(app)
      .post("/api/v1/newsletter/subscribe")
      .send({ email: "returning@example.com" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ message: "Successfully resubscribed to our newsletter" }));
  });

  it("returns a conflict for an active duplicate", async () => {
    mocks.subscribe.mockRejectedValue(new ApiError(409, "This email is already subscribed to our newsletter", "ALREADY_SUBSCRIBED"));
    const response = await request(app)
      .post("/api/v1/newsletter/subscribe")
      .send({ email: "existing@example.com" });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('"code":"ALREADY_SUBSCRIBED"');
  });

  it.each([{}, { email: "not-an-email" }])("rejects an invalid subscription body", async (body) => {
    const response = await request(app).post("/api/v1/newsletter/subscribe").send(body);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('"code":"VALIDATION_ERROR"');
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("supports unsubscribe and already-unsubscribed responses", async () => {
    const response = await request(app)
      .post("/api/v1/newsletter/unsubscribe")
      .send({ email: "customer@example.com" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ message: "Successfully unsubscribed from our newsletter" }));

    mocks.unsubscribe.mockResolvedValue({ alreadyUnsubscribed: true });
    const repeated = await request(app)
      .post("/api/v1/newsletter/unsubscribe")
      .send({ email: "customer@example.com" });
    expect(repeated.status).toBe(200);
    expect(JSON.stringify(repeated.body)).toContain("already unsubscribed");
  });

  it("does not expose unexpected internal errors", async () => {
    mocks.subscribe.mockRejectedValue(new Error("database connection secret"));
    const response = await request(app)
      .post("/api/v1/newsletter/subscribe")
      .send({ email: "customer@example.com" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).toContain("An unexpected error occurred");
    expect(JSON.stringify(response.body)).not.toContain("database connection secret");
  });
});

describe("newsletter staff APIs", () => {
  it.each([UserRole.ADMIN, UserRole.EMPLOYEE])("allows %s to list subscribers", async (role) => {
    authenticateAs(role);
    const response = await request(app)
      .get("/api/v1/newsletter/subscribers?page=2&limit=20&search=gmail.com&status=ACTIVE")
      .set("Authorization", `Bearer ${role.toLowerCase()}`);
    expect(response.status).toBe(200);
    expect(mocks.listSubscribers).toHaveBeenCalledWith(expect.objectContaining({
      page: "2",
      limit: "20",
      search: "gmail.com",
      status: "ACTIVE",
    }));
  });

  it("rejects unauthenticated and customer subscriber-list access", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    expect((await request(app).get("/api/v1/newsletter/subscribers")).status).toBe(401);

    authenticateAs(UserRole.CUSTOMER);
    const customerResponse = await request(app)
      .get("/api/v1/newsletter/subscribers")
      .set("Authorization", "Bearer customer");
    expect(customerResponse.status).toBe(403);
  });

  it("returns a downloadable CSV to staff", async () => {
    authenticateAs(UserRole.EMPLOYEE);
    const response = await request(app)
      .get("/api/v1/newsletter/subscribers/export?status=ACTIVE")
      .set("Authorization", "Bearer employee");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("frameyaad-newsletter-subscribers.csv");
    expect(response.text).toContain("Email,Status,Subscribed At,Unsubscribed At");
  });
});
