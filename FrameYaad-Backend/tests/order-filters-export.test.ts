import { OrderStatus, Prisma, UserRole } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn(), phones: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { order: { findMany: mocks.findMany, groupBy: mocks.groupBy }, $queryRaw: mocks.phones } }));
import { buildOrderWhere, escapeOrderSearch, normalizePhoneSearch, orderDateStart } from "../src/modules/orders/orders.filters";
import { orderListQuerySchema } from "../src/modules/orders/orders.schemas";
import { exportOrders, listOrders } from "../src/modules/orders/orders.service";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T12:00:00Z")); vi.clearAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.groupBy.mockResolvedValue([]); mocks.phones.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());
describe("order date boundaries", () => {
  it.each([["today", "2026-11-07T18:30:00.000Z"], ["7", "2026-10-31T18:30:00.000Z"], ["30", "2026-10-08T18:30:00.000Z"], ["90", "2026-08-09T18:30:00.000Z"]])("uses configured local midnight for %s", (range, expected) => {
    expect(orderDateStart(range, new Date(), "Asia/Kolkata")?.toISOString()).toBe(expected);
  });
  it("supports all-time and daylight-saving boundaries", () => {
    expect(orderDateStart("all")).toBeUndefined();
    expect(orderDateStart("7", new Date(), "America/New_York")?.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
  it("validates supported date ranges", () => {
    expect(orderListQuerySchema.safeParse({ dateFilter: "invalid" }).success).toBe(false);
    expect(orderListQuerySchema.parse({ dateFilter: "30" }).dateFilter).toBe("30");
  });
});
describe("order search/filter/export consistency", () => {
  it.each(["FY-99053085", "FY-9905", "99053085", "Mahesh", "mahesh@example.com"])("matches order/customer search %s", async search => {
    const where = await buildOrderWhere(orderListQuerySchema.parse({ search: " " + search + " ", dateFilter: "90", status: "PROCESSING" }), "admin", UserRole.ADMIN);
    expect(where.status).toBe("PROCESSING");
    expect(where.createdAt).toHaveProperty("gte");
    expect(where.OR).toEqual(expect.arrayContaining([{ orderNumber: { contains: search, mode: "insensitive" } }, { user: { name: { contains: search, mode: "insensitive" } } }, { user: { email: { contains: search, mode: "insensitive" } } }]));
  });
  it.each(["8910943111", "+91 89109-43111", "918910943111", "89109"])("normalizes phone search %s", async search => {
    mocks.phones.mockResolvedValue([{ id: "user-1", kind: "user" }, { id: "address-1", kind: "address" }]);
    const where = await buildOrderWhere(orderListQuerySchema.parse({ search }), "customer", UserRole.CUSTOMER);
    expect(where.userId).toBe("customer");
    expect(where.OR).toEqual(expect.arrayContaining([{ userId: { in: ["user-1"] } }, { userAddressId: { in: ["address-1"] } }]));
    const sql = mocks.phones.mock.calls[0]?.[0] as { values: unknown[] };
    expect(sql.values).toEqual(["%" + normalizePhoneSearch(search) + "%", "%" + normalizePhoneSearch(search) + "%"]);
  });
  it("escapes LIKE wildcards and treats script/SQL-like input as data", async () => {
    expect(escapeOrderSearch("  10%_\\  ")).toBe("10\\%\\_\\\\");
    const where = await buildOrderWhere(orderListQuerySchema.parse({ search: "' OR 1=1 -- <script>" }), "admin", UserRole.ADMIN);
    expect(where.OR).toHaveLength(3);
    expect(mocks.phones).not.toHaveBeenCalled();
  });
  it("shares all combined filters between listing and export", async () => {
    const query = { search: "FY-9905", status: OrderStatus.PROCESSING, dateFilter: "90" };
    await listOrders(query, "admin", UserRole.ADMIN);
    const listWhere = (mocks.findMany.mock.calls[0]?.[0] as { where: unknown }).where;
    await exportOrders(query, "admin", UserRole.ADMIN);
    expect((mocks.findMany.mock.calls[1]?.[0] as { where: unknown }).where).toEqual(listWhere);
    const summaryWhere = (mocks.groupBy.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(summaryWhere.createdAt).toBeDefined();
    expect(summaryWhere.OR).toBeDefined();
    expect(summaryWhere.status).toBeUndefined();
  });
  it("exports beyond the current page and a 500-row backend batch", async () => {
    const row = (index: number) => ({ id: String(index), createdAt: new Date(), orderNumber: "FY-" + index, status: OrderStatus.PROCESSING, items: [], totalPrice: new Prisma.Decimal(1300), user: { name: "Mahesh" } });
    mocks.findMany.mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => row(index))).mockResolvedValueOnce([row(500)]);
    const result = await exportOrders({ dateFilter: "7", status: "PROCESSING", search: "Mahesh" }, "admin", UserRole.ADMIN);
    expect(result.orders).toHaveLength(501);
    expect(result.summary).toEqual({ totalRevenue: 651300, orderCount: 501, averageOrderValue: 1300 });
    expect(result.range).toBe("Last 7 Days | Status: PROCESSING | Search: Mahesh");
    expect(mocks.findMany.mock.calls[1]?.[0]).toMatchObject({ cursor: { id: "499" }, skip: 1 });
  });
  it("exports an empty matching set without invalid totals", async () => {
    expect((await exportOrders({ dateFilter: "7" }, "admin", UserRole.ADMIN)).summary).toEqual({ totalRevenue: 0, orderCount: 0, averageOrderValue: 0 });
  });
});
