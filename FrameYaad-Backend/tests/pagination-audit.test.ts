import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePagination } from "../src/utils/pagination";
import { publicCatalogQuerySchema } from "../src/modules/products/public-catalog.service";
import { wishlistLookupSchema } from "../src/modules/wishlist/wishlist.schemas";

const mocks = vi.hoisted(() => ({ raw: vi.fn(), productFind: vi.fn(), wishlistFind: vi.fn(), wishlistCount: vi.fn(), transaction: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: {
  $queryRaw: mocks.raw, $transaction: mocks.transaction,
  product: { findMany: mocks.productFind }, wishlist: { findMany: mocks.wishlistFind, count: mocks.wishlistCount },
} }));
import { listPublicCatalog } from "../src/modules/products/public-catalog.service";
import { listWishlist, lookupWishlist } from "../src/modules/wishlist/wishlist.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
  mocks.wishlistFind.mockResolvedValue([]);
  mocks.wishlistCount.mockResolvedValue(55);
});

describe("Task 1 pagination audit", () => {
  it("sets bounded defaults", () => {
    expect(parsePagination({})).toMatchObject({ page: 1, limit: 20 });
    expect(publicCatalogQuerySchema.parse({})).toMatchObject({ page: 1, limit: 20 });
  });
  it.each([{ page: 0 }, { page: -1 }, { page: 1.5 }, { page: 1_000_001 }, { page: Number.MAX_SAFE_INTEGER }, { limit: 0 }, { limit: -5 }, { limit: 101 }, { limit: "NaN" }])("rejects invalid pages/limits: %j", input => {
    expect(() => parsePagination(input)).toThrow();
    expect(publicCatalogQuerySchema.safeParse(input).success).toBe(false);
  });
  it("preserves totals beyond the old 50-product cap and bounds page results", async () => {
    mocks.raw.mockResolvedValue([{ ids: ["p51", "p52"], total: 55, facets: {} }]);
    mocks.productFind.mockResolvedValue([{ id: "p52", variants: [] }, { id: "p51", variants: [] }]);
    const result = await listPublicCatalog({ page: 26, limit: 2 });
    expect(result.pagination).toEqual({ page: 26, limit: 2, total: 55, totalPages: 28 });
    expect(result.products.map(product => product.id)).toEqual(["p51", "p52"]);
    const query = mocks.raw.mock.calls[0]?.[0] as { values: unknown[]; sql: string };
    expect(query.sql).toContain("LIMIT");
    expect(query.values).toContain(50);
  });
  it("returns empty pages without fetching an unbounded product list", async () => {
    mocks.raw.mockResolvedValue([{ ids: [], total: 0, facets: {} }]);
    const result = await listPublicCatalog({ page: 7, limit: 12 });
    expect(result.products).toEqual([]);
    expect(mocks.productFind).not.toHaveBeenCalled();
  });
  it("scopes paginated wishlist reads to the authenticated owner", async () => {
    const result = await listWishlist("customer-owner", { page: 3, limit: 20 });
    const query = mocks.wishlistFind.mock.calls[0]?.[0] as { where: unknown; skip: number; take: number };
    expect(query).toMatchObject({ where: { userId: "customer-owner" }, skip: 40, take: 20 });
    expect(result.pagination).toEqual({ page: 3, limit: 20, total: 55, totalPages: 3 });
  });
  it("keeps bounded heart lookup owned and rejects oversized batches", async () => {
    await lookupWishlist("customer-owner", ["FRAME-01"]);
    const query = mocks.wishlistFind.mock.calls[0]?.[0] as { where: unknown };
    expect(query.where).toEqual({ userId: "customer-owner", productIdentifier: { in: ["FRAME-01"] } });
    expect(wishlistLookupSchema.safeParse({ productIdentifiers: Array.from({ length: 101 }, () => "FRAME-01") }).success).toBe(false);
  });
});
