import { UserRole, OrderStatus } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ orders: vi.fn(), orderCount: vi.fn(), users: vi.fn(), userCount: vi.fn(), phones: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { order: { findMany: mocks.orders, count: mocks.orderCount }, user: { findMany: mocks.users, count: mocks.userCount }, $queryRaw: mocks.phones } }));
import { adminSearchSchema, searchAdmin } from "../src/modules/admin-search/admin-search.service";
const order = { id: "order", orderNumber: "FY-99053085", status: OrderStatus.SHIPPED, user: { name: "Mahesh" } };
const customer = { id: "customer", name: "Mahesh", email: "mahesh@example.com", phoneNumber: "+91 89109-43111" };
beforeEach(() => { vi.clearAllMocks(); mocks.orders.mockResolvedValue([]); mocks.orderCount.mockResolvedValue(0); mocks.users.mockResolvedValue([]); mocks.userCount.mockResolvedValue(0); mocks.phones.mockResolvedValue([]); });
it.each(["FY-99053085", "fy-9905", "99053085"])("routes a real full/partial order number %s to Orders", async q => {
  mocks.orders.mockResolvedValue([order]); mocks.orderCount.mockResolvedValue(1);
  const data = await searchAdmin({ q: " " + q + " " });
  expect(data.kind).toBe("order"); expect(data.orders).toEqual([order]); expect(data.customers).toEqual([]);
  expect(mocks.orders).toHaveBeenCalledWith(expect.objectContaining({ take: 5, where: { orderNumber: { contains: q, mode: "insensitive" } } }));
  expect(mocks.users).not.toHaveBeenCalled();
});
it.each(["8910943111", "+91 89109-43111", "891 0943 111"])("normalizes customer phone %s", async q => {
  mocks.phones.mockResolvedValue([{ id: "customer" }]); mocks.users.mockResolvedValue([customer]); mocks.userCount.mockResolvedValue(1);
  const data = await searchAdmin({ q });
  expect(data.kind).toBe("phone"); expect(data.query).toBe("8910943111");
  expect(data.customers).toEqual([customer]); expect(data.orders).toEqual([]);
  const where = (mocks.users.mock.calls[0]?.[0] as { where: { role: UserRole; OR: unknown[] }; take: number });
  expect(where.where.role).toBe(UserRole.CUSTOMER); expect(where.take).toBe(5);
  expect(where.where.OR).toContainEqual({ id: { in: ["customer"] } });
});
it.each(["Mahesh", "mahesh@example.com"])("groups order/customer matches for %s", async q => {
  mocks.orders.mockResolvedValue([order]); mocks.orderCount.mockResolvedValue(1); mocks.users.mockResolvedValue([customer]); mocks.userCount.mockResolvedValue(1);
  const data = await searchAdmin({ q });
  expect(data.kind).toBe("text"); expect(data.counts).toEqual({ orders: 1, customers: 1 });
  expect(data.orders).toHaveLength(1); expect(data.customers).toHaveLength(1);
});
it("returns empty groups without inventing a destination", async () => {
  expect((await searchAdmin({ q: "NoSuchPersonOrOrder" })).counts).toEqual({ orders: 0, customers: 0 });
});
it("escapes wildcard characters and never interpolates text as SQL", async () => {
  await searchAdmin({ q: "%_'" });
  const query = mocks.orders.mock.calls[0]?.[0] as { where: { OR: unknown[] } };
  expect(query.where.OR).toContainEqual({ orderNumber: { contains: "\\%\\_'", mode: "insensitive" } });
  expect(mocks.phones).not.toHaveBeenCalled();
});
it.each(["", "   ", "a".repeat(121)])("rejects invalid query length", q => {
  expect(adminSearchSchema.safeParse({ q }).success).toBe(false);
});
