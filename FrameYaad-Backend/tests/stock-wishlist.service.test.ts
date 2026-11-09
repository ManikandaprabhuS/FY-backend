import { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ product: vi.fn(), insert: vi.fn(), wishlist: vi.fn(), count: vi.fn(), cart: vi.fn(), deleteMany: vi.fn(), totals: vi.fn(), cartUpdate: vi.fn(), returnCart: vi.fn(), existing: vi.fn(), cartCreate: vi.fn(), cartItem: vi.fn(), itemUpdate: vi.fn(), cartUpsert: vi.fn(), color: vi.fn(), raw: vi.fn() }));
vi.mock("../src/prisma/client", () => ({
  prisma: {
    $queryRaw: mocks.raw,
    product: { findFirst: mocks.product },
    wishlist: { createMany: mocks.insert, findUniqueOrThrow: mocks.wishlist, count: mocks.count },
    frameColor: { findFirst: mocks.color },
    $transaction: (callback: (tx: unknown) => unknown) => callback({
      product: { findUnique: mocks.product },
      wishlist: { createMany: mocks.insert, findUniqueOrThrow: mocks.wishlist, count: mocks.count },
      cart: { findUnique: mocks.cart, update: mocks.cartUpdate, findUniqueOrThrow: mocks.returnCart, upsert: mocks.cartUpsert },
      cartItem: { deleteMany: mocks.deleteMany, aggregate: mocks.totals, findUnique: mocks.existing, create: mocks.cartCreate, findFirst: mocks.cartItem, update: mocks.itemUpdate },
    }),
  },
}));
import { addWishlistItem } from "../src/modules/wishlist/wishlist.service";
import { addItem, moveItemToWishlist, updateItem } from "../src/modules/cart/cart.service";
import { assertAvailableStock, availableStock } from "../src/utils/stock";
const variant = { id: "selected", color: "Black", frameSize: "5x5", isActive: true, price: new Prisma.Decimal(450), stockQuantity: 5 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.raw.mockResolvedValue([{ id: "wishlist", userId: "customer", productIdentifier: "FRAME", createdAt: new Date(), product: {}, wishlistCount: 1, alreadySaved: false }]);
  mocks.product.mockResolvedValue({ id: "product", productIdentifier: "FRAME", productName: "Frame", material: { name: "Wood", isActive: true, availableColors: ["Black"] }, variant: { ...variant, id: "primary", isActive: false }, variants: [variant] });
  mocks.insert.mockResolvedValue({ count: 1 }); mocks.wishlist.mockResolvedValue({ id: "wishlist", productIdentifier: "FRAME" }); mocks.count.mockResolvedValue(1);
  mocks.cart.mockResolvedValue({ id: "owned-cart" }); mocks.deleteMany.mockResolvedValue({ count: 1 }); mocks.totals.mockResolvedValue({ _sum: { subtotal: new Prisma.Decimal(0), quantity: 0 } });
  mocks.returnCart.mockResolvedValue({ id: "owned-cart" }); mocks.existing.mockResolvedValue(null); mocks.cartUpsert.mockResolvedValue({ id: "owned-cart" });
  mocks.cartItem.mockResolvedValue({ id: "item", cartId: "owned-cart", productIdentifier: "FRAME", selectedVariantId: "selected" }); mocks.color.mockResolvedValue({ name: "Black", hex: "#000000" });
});
it.each([0, 1, 3, 5, 6, 50])("validates stock boundary %i", value => {
  expect(availableStock(value)).toBe(value);
  if (value) expect(() => assertAvailableStock(value, value)).not.toThrow();
  expect(() => assertAvailableStock(value + 1, value)).toThrow("Requested quantity exceeds");
});
it.each([null, undefined, -1, "bad", NaN, Infinity, true])("rejects unsafe stock %s", value => expect(() => assertAvailableStock(1, value)).toThrow());
it("inserts and returns the item/count in one parameterized database statement", async () => {
  const result = await addWishlistItem("customer", { productIdentifier: "FRAME" });
  expect(result).toMatchObject({ wishlistCount: 1, alreadySaved: false, wishlistItem: { id: "wishlist" } });
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  const sql = mocks.raw.mock.calls[0]?.[0] as Prisma.Sql;
  expect(sql.sql).toContain('ON CONFLICT ("userId", "productIdentifier") DO NOTHING');
  expect(sql.values).toContain("customer"); expect(sql.values).toContain("FRAME");
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("returns a duplicate quietly without creating another row", async () => {
  mocks.raw.mockResolvedValue([{ id: "wishlist", userId: "customer", productIdentifier: "FRAME", product: {}, wishlistCount: 1, alreadySaved: true }]);
  expect(await addWishlistItem("customer", { productIdentifier: "FRAME" })).toMatchObject({ alreadySaved: true, wishlistCount: 1 });
});
it("rejects unavailable products without a second write", async () => {
  mocks.raw.mockResolvedValue([]);
  await expect(addWishlistItem("customer", { productIdentifier: "FRAME" })).rejects.toMatchObject({ statusCode: 404 });
  expect(mocks.raw).toHaveBeenCalledTimes(1);
});
it("handles the concurrent insert snapshot race with one bounded retry", async () => {
  mocks.raw.mockResolvedValueOnce([{ id: null }]).mockResolvedValueOnce([{ id: "existing", userId: "customer", productIdentifier: "FRAME", product: {}, wishlistCount: 1, alreadySaved: true }]);
  expect(await addWishlistItem("customer", { productIdentifier: "FRAME" })).toMatchObject({ alreadySaved: true });
  expect(mocks.raw).toHaveBeenCalledTimes(2);
});
it("treats malicious identifiers as bound values, never SQL text", async () => {
  const identifier = "FRAME' OR 1=1 --";
  await addWishlistItem("customer", { productIdentifier: identifier });
  const sql = mocks.raw.mock.calls[0]?.[0] as Prisma.Sql;
  expect(sql.sql).not.toContain(identifier); expect(sql.values).toContain(identifier);
});it.each([0,1])("moves a selected variant atomically, including duplicate count %i", async count => {
  mocks.insert.mockResolvedValue({ count });
  const result = await moveItemToWishlist("customer", { productIdentifier: "FRAME", variantId: "selected", color: "Black" });
  expect(result).toMatchObject({ alreadySaved: count === 0, wishlistCount: 1 });
  expect(mocks.cart).toHaveBeenCalledWith({ where: { userId: "customer" }, select: { id: true } });
  const deletion = mocks.deleteMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
  expect(deletion.where).toMatchObject({ cartId: "owned-cart", productIdentifier: "FRAME", OR: [{ selectedVariantId: "selected" }] });
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ data: [{ userId: "customer", productIdentifier: "FRAME" }] }));
});
it("does not remove cart items if the wishlist write fails", async () => {
  mocks.insert.mockRejectedValue(Error("database failed"));
  await expect(moveItemToWishlist("customer", { productIdentifier: "FRAME", variantId: "selected" })).rejects.toThrow();
  expect(mocks.deleteMany).not.toHaveBeenCalled(); expect(mocks.cartUpdate).not.toHaveBeenCalled();
});
it("avoids a cart refetch/total update when this is a locally stored cart with no server cart", async () => {
  mocks.cart.mockResolvedValue(null);
  expect(await moveItemToWishlist("customer", { productIdentifier: "FRAME", variantId: "selected" })).toMatchObject({ cart: null });
  expect(mocks.returnCart).not.toHaveBeenCalled(); expect(mocks.cartUpdate).not.toHaveBeenCalled();
});
it("blocks add quantities above selected-variant stock, including existing units", async () => {
  mocks.existing.mockResolvedValue({ id: "item", quantity: 4 });
  await expect(addItem("customer", { productIdentifier: "FRAME", variantId: "selected", quantity: 2 })).rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_STOCK" });
  expect(mocks.cartCreate).not.toHaveBeenCalled();
});
it("blocks excess quantity across other color lines and updates", async () => {
  mocks.totals.mockResolvedValue({ _sum: { quantity: 4 } });
  await expect(updateItem("customer", "item", { quantity: 2 })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  expect(mocks.itemUpdate).not.toHaveBeenCalled();
});
it("accepts a valid quantity without changing price calculation", async () => {
  await addItem("customer", { productIdentifier: "FRAME", variantId: "selected", quantity: 3 });
  const data = (mocks.cartCreate.mock.calls[0]?.[0] as { data: { subtotal: Prisma.Decimal; price: Prisma.Decimal } }).data;
  expect(Number(data.price)).toBe(450); expect(Number(data.subtotal)).toBe(1350);
});
