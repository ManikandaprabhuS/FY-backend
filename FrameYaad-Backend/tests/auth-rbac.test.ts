import { OrderStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  adminSignOut: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUser: vi.fn(),
  adminDeleteUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  refreshSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  setSession: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  userDeleteMany: vi.fn(),
  userCount: vi.fn(),
  productFindMany: vi.fn(),
  productFindUnique: vi.fn(),
  productCreate: vi.fn(),
  productUpdate: vi.fn(),
  productDelete: vi.fn(),
  productCount: vi.fn(),
  orderItemFindMany: vi.fn(),
  cartItemCount: vi.fn(),
  materialFindUnique: vi.fn(),
  variantFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/config/supabase", () => ({
  supabaseAdmin: {
    auth: {
      getUser: mocks.getUser,
      admin: {
        signOut: mocks.adminSignOut,
        createUser: mocks.adminCreateUser,
        updateUserById: mocks.adminUpdateUser,
        deleteUser: mocks.adminDeleteUser,
      },
    },
  },
  createUserSupabaseClient: () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
      refreshSession: mocks.refreshSession,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      setSession: mocks.setSession,
    },
  }),
}));

vi.mock("../src/prisma/client", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      findMany: mocks.userFindMany,
      create: mocks.userCreate,
      update: mocks.userUpdate,
      deleteMany: mocks.userDeleteMany,
      count: mocks.userCount,
    },
    product: {
      findMany: mocks.productFindMany,
      findUnique: mocks.productFindUnique,
      create: mocks.productCreate,
      update: mocks.productUpdate,
      delete: mocks.productDelete,
      count: mocks.productCount,
    },
    orderItem: { findMany: mocks.orderItemFindMany },
    cartItem: { count: mocks.cartItemCount },
    material: { findUnique: mocks.materialFindUnique },
    variant: { findUnique: mocks.variantFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { app } from "../src/app";

interface ErrorResponseBody {
  success: false;
  error: { code: string; message: string };
}

const employee = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Employee One",
  email: "employee@example.com",
  isEmailVerified: true,
  phoneNumber: null,
  isPhoneNumberVerified: false,
  addressLine: null,
  postalCode: null,
  city: null,
  state: null,
  country: null,
  gender: null,
  role: UserRole.EMPLOYEE,
  isActive: true,
  createdById: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const admin = {
  ...employee,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Admin One",
  email: "admin@example.com",
  role: UserRole.ADMIN,
};

const customer = {
  ...employee,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Customer One",
  email: "customer@example.com",
  role: UserRole.CUSTOMER,
};

const materialId = "44444444-4444-4444-8444-444444444444";
const variantId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const product = {
  id: productId,
  productIdentifier: "FRAME-001",
  productName: "Classic Frame",
  materialId,
  variantId,
  createdById: admin.id,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  material: {
    id: materialId,
    name: "Wood",
    description: null,
    brandName: "FrameYaad",
    material: "Teak",
    availableColors: ["Brown"],
    isActive: true,
  },
  variant: {
    id: variantId,
    color: "Brown",
    frameSize: "8x10",
    mountType: "Wall",
    mrp: "1200.00",
    price: "999.00",
    isActive: true,
  },
  images: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: employee.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
    error: null,
  });
  mocks.userFindUnique.mockResolvedValue(employee);
  mocks.userUpdate.mockResolvedValue(employee);
  mocks.userDeleteMany.mockResolvedValue({ count: 1 });
  mocks.adminSignOut.mockResolvedValue({ data: null, error: null });
  mocks.adminUpdateUser.mockResolvedValue({ data: { user: { id: employee.id } }, error: null });
  mocks.adminDeleteUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.setSession.mockResolvedValue({ data: { session: null, user: null }, error: null });
  mocks.materialFindUnique.mockResolvedValue({ id: materialId, isActive: true });
  mocks.variantFindUnique.mockResolvedValue({ id: variantId, isActive: true });
  mocks.productFindUnique.mockResolvedValue(product);
  mocks.productCreate.mockResolvedValue(product);
  mocks.productUpdate.mockResolvedValue(product);
  mocks.productDelete.mockResolvedValue(product);
  mocks.orderItemFindMany.mockResolvedValue([]);
  mocks.cartItemCount.mockResolvedValue(0);
});

describe("authentication validation and RBAC", () => {
  it("rejects malformed customer registration before calling Supabase", async () => {
    const response = await request(app).post("/api/v1/auth/customer/register").send({
      name: "A",
      email: "not-an-email",
      password: "short",
    });

    expect(response.status).toBe(400);
    expect((response.body as ErrorResponseBody).error.code).toBe("VALIDATION_ERROR");
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("requires authentication for admin customer management", async () => {
    const response = await request(app).get("/api/v1/users");

    expect(response.status).toBe(401);
    expect((response.body as ErrorResponseBody).error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("returns the access token while keeping the refresh token in an HttpOnly cookie", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "customer-access-token",
          refresh_token: "customer-refresh-token",
          expires_in: 3600,
        },
        user: { id: customer.id },
      },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(customer);

    const response = await request(app).post("/api/v1/auth/customer/login").send({
      email: customer.email,
      password: "CustomerPassword1",
    });

    expect(response.status).toBe(200);
    const body = response.body as {
      data: { authentication: string; accessToken?: string; user: { role: UserRole } };
    };
    expect(body.data).toMatchObject({ authentication: "httpOnlyCookie" });
    expect(body.data.accessToken).toBe("customer-access-token");
    const setCookieHeader = response.get("set-cookie") as unknown;
    const serializedCookies = Array.isArray(setCookieHeader)
      ? setCookieHeader.map(String).join("; ")
      : String(setCookieHeader);
    expect(serializedCookies).toContain("HttpOnly");
  });

  it("returns an actionable error when a customer's email is not verified", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: Object.assign(new Error("Email not confirmed"), {
        code: "email_not_confirmed",
        status: 400,
      }),
    });

    const response = await request(app).post("/api/v1/auth/customer/login").send({
      email: customer.email,
      password: "CustomerPassword1",
    });

    expect(response.status).toBe(403);
    expect((response.body as ErrorResponseBody).error).toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      message: "Please verify your email to continue",
    });
  });

  it("allows an employee to use the shared staff dashboard login", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "employee-access-token",
          refresh_token: "employee-refresh-token",
          expires_in: 3600,
        },
        user: { id: employee.id },
      },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(employee);

    const response = await request(app).post("/api/v1/auth/staff/login").send({
      email: employee.email,
      password: "EmployeePassword1",
    });

    expect(response.status).toBe(200);
    expect((response.body as { data: { user: { role: UserRole } } }).data.user.role).toBe(UserRole.EMPLOYEE);
  });

  it("rejects customers from the shared staff dashboard login", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: "customer-access-token",
          refresh_token: "customer-refresh-token",
          expires_in: 3600,
        },
        user: { id: customer.id },
      },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(customer);

    const response = await request(app).post("/api/v1/auth/staff/login").send({
      email: customer.email,
      password: "CustomerPassword1",
    });

    expect(response.status).toBe(403);
    expect((response.body as ErrorResponseBody).error.code).toBe("ROLE_LOGIN_FORBIDDEN");
  });

  it("allows an employee to access customer management", async () => {
    mocks.transaction.mockResolvedValue([[], 0]);
    const response = await request(app)
      .get("/api/v1/users")
      .set("Authorization", "Bearer employee-access-token");

    expect(response.status).toBe(200);
  });

  it("allows an employee to view only the authenticated profile endpoint", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer employee-access-token");

    expect(response.status).toBe(200);
    const body = response.body as { success: true; data: { user: { id: string; role: UserRole } } };
    expect(body.data.user).toMatchObject({ id: employee.id, role: UserRole.EMPLOYEE });
  });

  it("rejects an incorrect current password", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: new Error("bad") });

    const response = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", "Bearer employee-access-token")
      .send({ currentPassword: "WrongPassword1", newPassword: "NewPassword2" });

    expect(response.status).toBe(400);
    expect((response.body as ErrorResponseBody).error.code).toBe("CURRENT_PASSWORD_INCORRECT");
    expect(mocks.adminUpdateUser).not.toHaveBeenCalled();
  });

  it("changes a password only after current-password verification and revokes sessions", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: "verification-access-token" },
        user: { id: employee.id },
      },
      error: null,
    });

    const response = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", "Bearer employee-access-token")
      .send({ currentPassword: "OldPassword1", newPassword: "NewPassword2" });

    expect(response.status).toBe(200);
    expect(mocks.adminUpdateUser).toHaveBeenCalledWith(employee.id, { password: "NewPassword2" });
    expect(mocks.adminSignOut).toHaveBeenCalledWith("employee-access-token", "global");
  });

  it("blocks a deactivated account in authentication middleware", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...employee, isActive: false });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer employee-access-token");

    expect(response.status).toBe(403);
    expect((response.body as ErrorResponseBody).error.code).toBe("ACCOUNT_DEACTIVATED");
  });

  it("uses a non-enumerating forgot-password response", async () => {
    const response = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "someone@example.com" });

    expect(response.status).toBe(202);
    const body = response.body as { success: true; message: string };
    expect(body.message).toContain("If an account exists");
  });

  it("allows an admin to create an employee account", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: admin.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(admin);
    mocks.adminCreateUser.mockResolvedValue({
      data: { user: { id: employee.id, email_confirmed_at: "2026-08-01T00:00:00.000Z" } },
      error: null,
    });
    mocks.userCreate.mockResolvedValue(employee);

    const response = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", "Bearer admin-access-token")
      .send({ name: employee.name, email: employee.email, password: "EmployeePassword1" });

    expect(response.status).toBe(201);
    expect(mocks.adminCreateUser).toHaveBeenCalledOnce();
    expect(mocks.userCreate).toHaveBeenCalledOnce();
  });

  it("allows an admin to permanently delete an employee account", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: admin.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(admin);
    mocks.userFindFirst.mockResolvedValue(employee);

    const response = await request(app)
      .delete(`/api/v1/employees/${employee.id}`)
      .set("Authorization", "Bearer admin-access-token");

    expect(response.status).toBe(204);
    expect(mocks.adminDeleteUser).toHaveBeenCalledWith(employee.id);
    expect(mocks.userDeleteMany).toHaveBeenCalledWith({ where: { id: employee.id } });
  });

  it("rejects state-changing requests from an untrusted browser origin", async () => {
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", "https://attacker.example");

    expect(response.status).toBe(403);
    expect((response.body as ErrorResponseBody).error.code).toBe("UNTRUSTED_ORIGIN");
  });
});

describe("product CRUD RBAC", () => {
  it("rejects product reads without authentication", async () => {
    const response = await request(app).get("/api/v1/products");

    expect(response.status).toBe(401);
    expect((response.body as ErrorResponseBody).error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("allows a customer to list products", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: customer.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(customer);
    mocks.transaction.mockResolvedValue([[product], 1]);

    const response = await request(app)
      .get("/api/v1/products")
      .set("Authorization", "Bearer customer-access-token");

    expect(response.status).toBe(200);
    const body = response.body as { data: { products: Array<{ id: string }> } };
    expect(body.data.products[0]?.id).toBe(productId);
  });

  it("prevents a customer from creating products", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: customer.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(customer);

    const response = await request(app)
      .post("/api/v1/products")
      .set("Authorization", "Bearer customer-access-token")
      .send({ materialId, variantId, productIdentifier: "FRAME-001", productName: "Classic Frame" });

    expect(response.status).toBe(403);
    expect((response.body as ErrorResponseBody).error.code).toBe("FORBIDDEN");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("allows an employee to create a product with active references", async () => {
    const response = await request(app)
      .post("/api/v1/products")
      .set("Authorization", "Bearer employee-access-token")
      .send({ materialId, variantId, productIdentifier: "FRAME-001", productName: "Classic Frame" });

    expect(response.status).toBe(201);
    const createCall = mocks.productCreate.mock.calls[0] as unknown[] | undefined;
    const createArguments = createCall?.[0] as { data: { createdById: string } } | undefined;
    expect(createArguments?.data.createdById).toBe(employee.id);
  });

  it("rejects product creation with an inactive material", async () => {
    mocks.materialFindUnique.mockResolvedValue({ id: materialId, isActive: false });

    const response = await request(app)
      .post("/api/v1/products")
      .set("Authorization", "Bearer employee-access-token")
      .send({ materialId, variantId, productIdentifier: "FRAME-002", productName: "Modern Frame" });

    expect(response.status).toBe(409);
    expect((response.body as ErrorResponseBody).error.code).toBe("MATERIAL_INACTIVE");
  });

  it("allows an admin to delete a product", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: admin.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(admin);

    const response = await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set("Authorization", "Bearer admin-access-token");

    expect(response.status).toBe(204);
    expect(mocks.productDelete).toHaveBeenCalledWith({ where: { id: productId } });
  });

  it("explains why an ordered product cannot be deleted", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: admin.id, email_confirmed_at: "2026-08-01T00:00:00.000Z", phone_confirmed_at: null } },
      error: null,
    });
    mocks.userFindUnique.mockResolvedValue(admin);
    mocks.orderItemFindMany.mockResolvedValue([
      { order: { orderNumber: "FY-2345", status: OrderStatus.PROCESSING } },
    ]);

    const response = await request(app)
      .delete(`/api/v1/products/${productId}`)
      .set("Authorization", "Bearer admin-access-token");

    expect(response.status).toBe(409);
    expect((response.body as ErrorResponseBody).error.code).toBe("PRODUCT_HAS_ACTIVE_ORDERS");
    expect((response.body as ErrorResponseBody).error.message).toContain("FY-2345");
    expect((response.body as ErrorResponseBody).error.message).toContain("PROCESSING");
    expect(mocks.productDelete).not.toHaveBeenCalled();
  });
});
