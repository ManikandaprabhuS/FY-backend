import { OrderStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  getCart: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  moveItemToWishlist: vi.fn(),
  clearCart: vi.fn(),
  checkout: vi.fn(),
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("../src/config/supabase", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
  createUserSupabaseClient: vi.fn(),
}));

vi.mock("../src/prisma/client", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
  },
}));

vi.mock("../src/modules/cart/cart.service", () => ({
  getCart: mocks.getCart,
  addItem: mocks.addItem,
  updateItem: mocks.updateItem,
  removeItem: mocks.removeItem,
  moveItemToWishlist: mocks.moveItemToWishlist,
  clearCart: mocks.clearCart,
}));

vi.mock("../src/modules/orders/orders.service", () => ({
  checkout: mocks.checkout,
  listOrders: mocks.listOrders,
  getOrder: mocks.getOrder,
  updateOrderStatus: mocks.updateOrderStatus,
}));

import { app } from "../src/app";

interface ErrorBody {
  error: { code: string };
}

const customerId = "77777777-7777-4777-8777-777777777777";
const employeeId = "88888888-8888-4888-8888-888888888888";
const addressId = "99999999-9999-4999-8999-999999999999";
const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cartItemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseUser = {
  id: customerId,
  name: "Cart Customer",
  email: "cart.customer@example.com",
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

const cart = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  userId: customerId,
  totalPrice: "999.00",
  items: [{ id: cartItemId, productIdentifier: "FRAME-001", quantity: 1 }],
};

const order = {
  id: orderId,
  orderNumber: "FY-TEST-0001",
  userId: customerId,
  status: OrderStatus.PLACED,
  totalPrice: "999.00",
  items: [],
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
  mocks.getCart.mockResolvedValue(cart);
  mocks.addItem.mockResolvedValue(cart);
  mocks.updateItem.mockResolvedValue(cart);
  mocks.removeItem.mockResolvedValue({ ...cart, items: [] });
  mocks.moveItemToWishlist.mockResolvedValue({
    wishlistItem: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", productIdentifier: "FRAME-001" },
    cart: { ...cart, items: [] },
  });
  mocks.clearCart.mockResolvedValue(undefined);
  mocks.checkout.mockResolvedValue(order);
  mocks.listOrders.mockResolvedValue({ orders: [order], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
  mocks.getOrder.mockResolvedValue(order);
  mocks.updateOrderStatus.mockResolvedValue({ ...order, status: OrderStatus.CONFIRMED });
});

describe("cart ownership and order RBAC", () => {
  it("rejects unauthenticated cart access", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    const response = await request(app).get("/api/v1/cart");
    expect(response.status).toBe(401);
  });

  it("allows only customers to add products to a cart", async () => {
    const customerResponse = await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", "Bearer customer-token")
      .send({ productIdentifier: "FRAME-001", quantity: 1 });
    expect(customerResponse.status).toBe(201);

    authenticateAs(UserRole.EMPLOYEE);
    const employeeResponse = await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", "Bearer employee-token")
      .send({ productIdentifier: "FRAME-001", quantity: 1 });
    expect(employeeResponse.status).toBe(403);
    expect((employeeResponse.body as ErrorBody).error.code).toBe("FORBIDDEN");
  });

  it("passes only the authenticated customer id to cart operations", async () => {
    const response = await request(app)
      .patch(`/api/v1/cart/items/${cartItemId}`)
      .set("Authorization", "Bearer customer-token")
      .send({ quantity: 3 });
    expect(response.status).toBe(200);
    expect(mocks.updateItem).toHaveBeenCalledWith(customerId, cartItemId, { quantity: 3 });
  });

  it("moves a cart product to the authenticated customer's wishlist", async () => {
    const response = await request(app)
      .post("/api/v1/cart/move-to-wishlist")
      .set("Authorization", "Bearer customer-token")
      .send({ productIdentifier: "FRAME-001" });

    expect(response.status).toBe(200);
    expect(mocks.moveItemToWishlist).toHaveBeenCalledWith(customerId, {
      productIdentifier: "FRAME-001",
    });
  });

  it("allows a customer to checkout using an address", async () => {
    const response = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", "Bearer customer-token")
      .send({ userAddressId: addressId, remark: "Handle with care" });
    expect(response.status).toBe(201);
    expect(mocks.checkout).toHaveBeenCalledWith(customerId, {
      userAddressId: addressId,
      remark: "Handle with care",
    });
  });

  it("scopes customer order listing to the authenticated customer", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", "Bearer customer-token");
    expect(response.status).toBe(200);
    expect(mocks.listOrders).toHaveBeenCalledWith(expect.anything(), customerId, UserRole.CUSTOMER);
  });

  it("prevents customers from changing order status", async () => {
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", "Bearer customer-token")
      .send({ status: OrderStatus.CONFIRMED });
    expect(response.status).toBe(403);
    expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("allows employees to list all orders and update status", async () => {
    authenticateAs(UserRole.EMPLOYEE);
    const listResponse = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", "Bearer employee-token");
    expect(listResponse.status).toBe(200);
    expect(mocks.listOrders).toHaveBeenCalledWith(expect.anything(), employeeId, UserRole.EMPLOYEE);

    const updateResponse = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set("Authorization", "Bearer employee-token")
      .send({ status: OrderStatus.CONFIRMED });
    expect(updateResponse.status).toBe(200);
    expect(mocks.updateOrderStatus).toHaveBeenCalledWith(orderId, { status: OrderStatus.CONFIRMED });
  });
});
