import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ material: vi.fn(), product: vi.fn(), variants: vi.fn(), update: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: {
  $transaction: (callback: (transaction: unknown) => unknown) => callback({
    material: { create: mocks.material }, product: { create: mocks.product, update: mocks.update }, variant: { createMany: mocks.variants },
  }),
} }));
import { createAdminProductPreview } from "../src/modules/products/products.service";
import { createAdminProductPreviewSchema } from "../src/modules/products/products.schemas";

describe("variant batch creation", () => {
  it("uses one variant insert and retains the first variant as primary", async () => {
    mocks.material.mockResolvedValue({ id: "material" });
    mocks.product.mockResolvedValue({ id: "product" });
    mocks.variants.mockResolvedValue({ count: 3 });
    mocks.update.mockResolvedValue({ id: "product" });
    const input = createAdminProductPreviewSchema.parse({ description: "A batch test frame", name: "Batch frame", brandName: "FrameYaad", material: "Wood", availableColors: ["Black"],
      images: [{ imageUrl: "https://example.com/frame.png", displayOrder: 1 }],
      variants: ["5x5", "8x10", "10x12"].map(frameSize => ({ frameSize, mountType: "NONE", glassType: "NONE", price: 100, stockQuantity: 2 })),
    });
    await createAdminProductPreview(input, "actor");
    expect(mocks.variants).toHaveBeenCalledTimes(1);
    const batch = mocks.variants.mock.calls[0]?.[0] as { data: Array<{ id: string; frameSize: string }> };
    expect(batch.data.map(item => item.frameSize)).toEqual(["5x5", "8x10", "10x12"]);
    expect(new Set(batch.data.map(item => item.id)).size).toBe(3);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { variantId: batch.data[0]!.id } }));
  });
});
