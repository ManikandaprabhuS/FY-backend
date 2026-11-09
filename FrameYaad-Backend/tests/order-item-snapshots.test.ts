import { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), uniqueOrder: vi.fn(), color: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { $transaction: mocks.transaction, order: { findUnique: mocks.uniqueOrder }, frameColor: { findFirst: mocks.color } } }));
vi.mock("../src/modules/notifications/notification-events.service", () => ({ createOrderPlacedNotifications: vi.fn() }));
import { serializeOrderItem } from "../src/modules/orders/orders.select";
import { checkout } from "../src/modules/orders/orders.service";
import { addItem } from "../src/modules/cart/cart.service";
const base = () => ({
  id: "item", productIdentifier: "FRAME-001", snapshotProductId: null, snapshotProductName: null, snapshotFrameSize: null,
  snapshotVariantId: null, snapshotColorName: null, snapshotColorHex: null, snapshotMaterial: null,
  quantity: 2, price: new Prisma.Decimal(650), subtotal: new Prisma.Decimal(1300),
  product: { id: "product", productName: "Floating Frame", material: { name: "Anodized Aluminum" }, variant: { id: "variant", color: "Black", frameSize: "8 X 10", mountType: "NONE" }, images: [] },
});
beforeEach(() => { vi.clearAllMocks(); mocks.uniqueOrder.mockResolvedValue(null); mocks.color.mockResolvedValue({ name: "White", hex: "#FFFFFF" }); });
it("prefers immutable snapshots even when catalog data changes or disappears", () => {
  const snapshot = { ...base(), snapshotProductId: "original-product", snapshotProductName: "Original Frame", snapshotFrameSize: "5 X 5", snapshotVariantId: "original-variant", snapshotColorName: "White", snapshotColorHex: "#FFFFFF", snapshotMaterial: "Original Material" };
  const result = serializeOrderItem(snapshot);
  expect(result).toMatchObject({ productId: "original-product", productName: "Original Frame", frameSize: "5 X 5", colorName: "White", colorHex: "#FFFFFF", material: "Original Material" });
  expect(serializeOrderItem({ ...snapshot, product: null })).toMatchObject({ productName: "Original Frame", colorName: "White", material: "Original Material" });
  expect(result.price.toNumber()).toBe(650);
});
it("uses read-only catalog fallback for older orders and dashes for missing data", () => {
  expect(serializeOrderItem(base())).toMatchObject({ productId: "product", frameSize: "8 X 10", colorName: "Black", material: "Anodized Aluminum" });
  expect(serializeOrderItem({ ...base(), product: null })).toMatchObject({ productId: "-", frameSize: "-", colorName: "-", material: "-" });
});
it("captures the selected variant/color at checkout without changing the subtotal formula", async () => {
  const primary = { stockQuantity: 50, id: "primary", color: "Black", frameSize: "8 X 10", isActive: true, price: new Prisma.Decimal(650) };
  const chosen = { ...primary, id: "selected", frameSize: "5 X 5" };
  const create = vi.fn().mockResolvedValue({ orderNumber: "FY-1234", totalPrice: new Prisma.Decimal(1300), user: { id: "customer", name: "Customer" } });
  const tx = { userAddress: { findFirst: vi.fn().mockResolvedValue({ id: "address" }) }, cart: { findUnique: vi.fn().mockResolvedValue({ id: "cart", items: [{ productIdentifier: "FRAME-001", quantity: 2, selectedVariantId: "selected", selectedColorName: "White", selectedColorHex: "#FFFFFF", product: { id: "product", productName: "Floating Frame", material: { name: "Anodized Aluminum", isActive: true }, variant: primary, variants: [chosen] } }] }), update: vi.fn() }, order: { create }, cartItem: { deleteMany: vi.fn() } };
  mocks.transaction.mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx));
  await checkout("customer", { userAddressId: "address" });
  const captured = create.mock.calls[0]?.[0] as { data: { items: { create: unknown[] } } };
  expect(captured.data.items.create[0]).toMatchObject({ snapshotProductId: "product", snapshotProductName: "Floating Frame", snapshotFrameSize: "5 X 5", snapshotVariantId: "selected", snapshotColorName: "White", snapshotColorHex: "#FFFFFF", snapshotMaterial: "Anodized Aluminum", quantity: 2 });
  const data = create.mock.calls[0]?.[0] as { data: { totalPrice: Prisma.Decimal } };
  expect(data.data.totalPrice.toNumber()).toBe(1300);
});
it("stores validated selection metadata and keeps colour choices as separate cart keys", async () => {
  const variant = { stockQuantity: 50, id: "selected", color: "#000000", frameSize: "5 X 5", price: new Prisma.Decimal(650), isActive: true };
  const create = vi.fn(); const lookup = vi.fn().mockResolvedValue(null);
  const tx = { product: { findUnique: vi.fn().mockResolvedValue({ id: "product", productName: "Frame", productIdentifier: "FRAME-001", material: { name: "Wood", isActive: true, availableColors: ["#000000", "#FFFFFF"] }, variant, variants: [variant] }) }, cart: { upsert: vi.fn().mockResolvedValue({ id: "cart" }), update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cart" }) }, cartItem: { findUnique: lookup, create, aggregate: vi.fn().mockResolvedValue({ _sum: { subtotal: new Prisma.Decimal(650) } }) } };
  mocks.transaction.mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx));
  await addItem("customer", { productIdentifier: "FRAME-001", quantity: 1, variantId: "selected", color: "#FFFFFF" });
  const captured = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
  expect(captured.data).toMatchObject({ selectedVariantId: "selected", selectedColorName: "White", selectedColorHex: "#FFFFFF", selectionKey: "selected:#FFFFFF" });
  expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ where: { cartId_productIdentifier_selectionKey: { cartId: "cart", productIdentifier: "FRAME-001", selectionKey: "selected:#FFFFFF" } } }));
});

it("rejects checkout when combined selected-variant quantities exceed stock, without creating an order", async () => {
  const variant = { id: "selected", color: "Black", frameSize: "5x5", isActive: true, price: new Prisma.Decimal(450), stockQuantity: 5 };
  const item = { productIdentifier: "FRAME-001", quantity: 3, selectedVariantId: "selected", selectedColorName: "Black", selectedColorHex: "#000000", product: { id: "product", productName: "Frame", material: { name: "Wood", isActive: true }, variant, variants: [variant] } };
  const create = vi.fn(), remove = vi.fn();
  const tx = { userAddress: { findFirst: vi.fn().mockResolvedValue({ id: "address" }) }, cart: { findUnique: vi.fn().mockResolvedValue({ id: "cart", items: [item, { ...item, selectedColorName: "White", selectedColorHex: "#FFFFFF" }] }), update: vi.fn() }, order: { create }, cartItem: { deleteMany: remove } };
  mocks.transaction.mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx));
  await expect(checkout("customer", { userAddressId: "address" })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK", statusCode: 409 });
  expect(create).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});
