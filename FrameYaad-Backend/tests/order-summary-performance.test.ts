import { OrderStatus, UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn(), transaction: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: {
  order: { findMany: mocks.findMany, groupBy: mocks.groupBy }, $transaction: mocks.transaction,
} }));
import { listOrders } from "../src/modules/orders/orders.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockReturnValue(Promise.resolve([]));
  mocks.groupBy.mockReturnValue(Promise.resolve([]));
  mocks.transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
});

describe("grouped order summaries", () => {
  it("keeps summary counts and totals while using two database operations", async () => {
    mocks.groupBy.mockResolvedValue([
      { status: OrderStatus.PLACED, _count: { _all: 2 } },
      { status: OrderStatus.CONFIRMED, _count: { _all: 3 } },
      { status: OrderStatus.PROCESSING, _count: { _all: 4 } },
      { status: OrderStatus.READY_TO_SHIP, _count: { _all: 5 } },
      { status: OrderStatus.DELIVERED, _count: { _all: 6 } },
    ]);
    const result = await listOrders({}, "admin-id", UserRole.ADMIN);
    expect(result.summary).toEqual({ totalCount: 20, pendingCount: 2, processingCount: 12, shippedCount: 0, deliveredCount: 6, cancelledCount: 0 });
    expect(result.pagination.total).toBe(20);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("retains customer ownership, search and status-filter semantics", async () => {
    mocks.groupBy.mockResolvedValue([
      { status: OrderStatus.PLACED, _count: { _all: 2 } },
      { status: OrderStatus.DELIVERED, _count: { _all: 6 } },
    ]);
    const result = await listOrders({ status: "DELIVERED", search: "FY-1234" }, "customer-id", UserRole.CUSTOMER);
    expect(result.pagination.total).toBe(6);
    expect(result.summary.pendingCount).toBe(2);
    const grouped = mocks.groupBy.mock.calls[0]?.[0] as { where: unknown };
    expect(grouped.where).toEqual({ userId: "customer-id", OR: [
      { orderNumber: { contains: "FY-1234", mode: "insensitive" } },
      { user: { name: { contains: "FY-1234", mode: "insensitive" } } },
      { user: { email: { contains: "FY-1234", mode: "insensitive" } } },
    ] });
    const listed = mocks.findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(listed.where).toEqual({ ...(grouped.where as object), status: "DELIVERED" });
  });

  it("returns zero counts for an empty result", async () => {
    const result = await listOrders({}, "admin-id", UserRole.ADMIN);
    expect(result.summary.totalCount).toBe(0);
    expect(result.summary.processingCount).toBe(0);
  });
});
