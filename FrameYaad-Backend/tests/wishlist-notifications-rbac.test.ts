import { NotificationType, UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  listWishlist: vi.fn(),
  getWishlistAnalytics: vi.fn(),
  addWishlistItem: vi.fn(),
  removeWishlistItem: vi.fn(),
  listNotifications: vi.fn(),
  unreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

vi.mock("../src/config/supabase", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
  createUserSupabaseClient: vi.fn(),
}));

vi.mock("../src/prisma/client", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate } },
}));

vi.mock("../src/modules/wishlist/wishlist.service", () => ({
  listWishlist: mocks.listWishlist,
  getWishlistAnalytics: mocks.getWishlistAnalytics,
  addWishlistItem: mocks.addWishlistItem,
  removeWishlistItem: mocks.removeWishlistItem,
}));

vi.mock("../src/modules/notifications/notifications.service", () => ({
  listNotifications: mocks.listNotifications,
  unreadCount: mocks.unreadCount,
  markRead: mocks.markRead,
  markAllRead: mocks.markAllRead,
  deleteNotification: mocks.deleteNotification,
}));

import { app } from "../src/app";

const customerId = "11111111-aaaa-4111-8111-111111111111";
const employeeId = "22222222-bbbb-4222-8222-222222222222";
const wishlistId = "33333333-cccc-4333-8333-333333333333";
const notificationId = "44444444-dddd-4444-8444-444444444444";

const baseUser = {
  id: customerId,
  name: "Wishlist Customer",
  email: "wishlist@example.com",
  isEmailVerified: true,
  phoneNumber: null,
  isPhoneNumberVerified: false,
  addressLine: null,
  postalCode: null,
  city: null,
  state: null,
  country: null,
  gender: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  createdById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const authenticateAs = (role: UserRole): void => {
  const id = role === UserRole.CUSTOMER ? customerId : employeeId;
  mocks.getUser.mockResolvedValue({
    data: { user: { id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
    error: null,
  });
  mocks.userFindUnique.mockResolvedValue({ ...baseUser, id, role });
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAs(UserRole.CUSTOMER);
  mocks.listWishlist.mockResolvedValue({ wishlist: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  mocks.getWishlistAnalytics.mockResolvedValue({ products: [
    {
      productIdentifier: "FRAME-001",
      productName: "Modern Family Frame",
      wishlistUserCount: 20,
    },
  ], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
  mocks.addWishlistItem.mockResolvedValue({ wishlistItem: { id: wishlistId, productIdentifier: "FRAME-001" }, wishlistCount: 1, alreadySaved: false });
  mocks.removeWishlistItem.mockResolvedValue(undefined);
  mocks.listNotifications.mockResolvedValue({
    notifications: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  mocks.unreadCount.mockResolvedValue(2);
  mocks.markRead.mockResolvedValue({ id: notificationId, read: true });
  mocks.markAllRead.mockResolvedValue(2);
  mocks.deleteNotification.mockResolvedValue(undefined);
});

describe("wishlist ownership and notification privacy", () => {
  it("allows admin and employee wishlist analytics access but rejects customers", async () => {
    const customerResponse = await request(app)
      .get("/api/v1/wishlist/analytics")
      .set("Authorization", "Bearer customer");
    expect(customerResponse.status).toBe(403);

    authenticateAs(UserRole.EMPLOYEE);
    const employeeResponse = await request(app)
      .get("/api/v1/wishlist/analytics")
      .set("Authorization", "Bearer employee");
    expect(employeeResponse.status).toBe(200);
    const employeeBody = employeeResponse.body as {
      data: { products: Array<{ wishlistUserCount: number }> };
    };
    expect(employeeBody.data.products[0]?.wishlistUserCount).toBe(20);

    authenticateAs(UserRole.ADMIN);
    const adminResponse = await request(app)
      .get("/api/v1/wishlist/analytics")
      .set("Authorization", "Bearer admin");
    expect(adminResponse.status).toBe(200);
    expect(mocks.getWishlistAnalytics).toHaveBeenCalledTimes(2);
  });

  it("requires login and customer role for wishlist access", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    expect((await request(app).get("/api/v1/wishlist")).status).toBe(401);

    authenticateAs(UserRole.EMPLOYEE);
    expect((await request(app).get("/api/v1/wishlist").set("Authorization", "Bearer employee")).status).toBe(403);
  });

  it("uses the authenticated customer id when adding and removing wishlist items", async () => {
    const addResponse = await request(app)
      .post("/api/v1/wishlist")
      .set("Authorization", "Bearer customer")
      .send({ productIdentifier: "FRAME-001" });
    expect(addResponse.status).toBe(201);
    expect(mocks.addWishlistItem).toHaveBeenCalledWith(customerId, { productIdentifier: "FRAME-001" });

    const deleteResponse = await request(app)
      .delete(`/api/v1/wishlist/${wishlistId}`)
      .set("Authorization", "Bearer customer");
    expect(deleteResponse.status).toBe(204);
    expect(mocks.removeWishlistItem).toHaveBeenCalledWith(wishlistId, customerId);
  });

  it("allows every authenticated role to read only its own notification inbox", async () => {
    authenticateAs(UserRole.EMPLOYEE);
    const response = await request(app)
      .get(`/api/v1/notifications?read=false&type=${NotificationType.ORDER_PLACED}`)
      .set("Authorization", "Bearer employee");
    expect(response.status).toBe(200);
    expect(mocks.listNotifications).toHaveBeenCalledWith(
      employeeId,
      UserRole.EMPLOYEE,
      expect.anything(),
    );
  });

  it("uses recipient ownership for notification updates and deletion", async () => {
    const readResponse = await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Authorization", "Bearer customer");
    expect(readResponse.status).toBe(200);
    expect(mocks.markRead).toHaveBeenCalledWith(notificationId, customerId, UserRole.CUSTOMER);

    const deleteResponse = await request(app)
      .delete(`/api/v1/notifications/${notificationId}`)
      .set("Authorization", "Bearer customer");
    expect(deleteResponse.status).toBe(204);
    expect(mocks.deleteNotification).toHaveBeenCalledWith(
      notificationId,
      customerId,
      UserRole.CUSTOMER,
    );
  });

  it("returns unread count and marks all owned notifications as read", async () => {
    const countResponse = await request(app)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", "Bearer customer");
    expect(countResponse.status).toBe(200);
    expect((countResponse.body as { data: { count: number } }).data.count).toBe(2);

    const readAllResponse = await request(app)
      .patch("/api/v1/notifications/read-all")
      .set("Authorization", "Bearer customer");
    expect(readAllResponse.status).toBe(200);
    expect(mocks.markAllRead).toHaveBeenCalledWith(customerId, UserRole.CUSTOMER);
  });

  it("prevents an employee from accessing Employee Management", async () => {
    authenticateAs(UserRole.EMPLOYEE);
    const listResponse = await request(app)
      .get("/api/v1/employees")
      .set("Authorization", "Bearer employee");
    expect(listResponse.status).toBe(403);

    const response = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", "Bearer employee")
      .send({
        name: "Unauthorized Employee",
        email: "unauthorized.employee@example.com",
        password: "UnauthorizedPassword1",
      });
    expect(response.status).toBe(403);
  });

  it("allows employees to read and delete staff notifications", async () => {
    authenticateAs(UserRole.EMPLOYEE);
    const readResponse = await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Authorization", "Bearer employee");
    expect(readResponse.status).toBe(200);
    expect(mocks.markRead).toHaveBeenCalledWith(notificationId, employeeId, UserRole.EMPLOYEE);

    const deleteResponse = await request(app)
      .delete(`/api/v1/notifications/${notificationId}`)
      .set("Authorization", "Bearer employee");
    expect(deleteResponse.status).toBe(204);
    expect(mocks.deleteNotification).toHaveBeenCalledWith(
      notificationId,
      employeeId,
      UserRole.EMPLOYEE,
    );
  });
});
