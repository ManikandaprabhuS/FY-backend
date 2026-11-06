import { describe, expect, it } from "vitest";
import { createAdminProductPreviewSchema, createAdminVariantSchema, updateAdminVariantSchema } from "../src/modules/products/products.schemas";

const variant = { frameSize: "5x5", mountType: "NONE", glassType: "NONE", price: 100, stockQuantity: 2 };
const product = { name: "Test frame", brandName: "FrameYaad", material: "Wood", availableColors: ["Black"], variants: [variant] };

describe("optional product option images", () => {
  it("keeps legacy products and variants valid without images", () => {
    expect(createAdminProductPreviewSchema.safeParse(product).success).toBe(true);
    expect(createAdminVariantSchema.safeParse(variant).success).toBe(true);
  });

  it("accepts independent optional color and variant images", () => {
    const result = createAdminProductPreviewSchema.parse({ ...product,
      images: [{ imageUrl: "https://example.com/default.png", displayOrder: 1 }, { imageUrl: "https://example.com/black.png", displayOrder: 2, color: "Black" }],
      variants: [{ ...variant, imageUrl: "https://example.com/5x5.png" }, { ...variant, frameSize: "8x10" }],
    });
    expect(result.images[1]?.color).toBe("Black");
    expect(result.variants[0]?.imageUrl).toBe("https://example.com/5x5.png");
    expect(result.variants[1]?.imageUrl).toBeUndefined();
  });

  it("supports removing an existing variant image", () => {
    expect(updateAdminVariantSchema.parse({ imageUrl: null })).toEqual({ imageUrl: null });
  });

  it.each(["javascript:alert(1)", "data:image/png;base64,abc", "not-a-url"])("rejects an unsafe image URL: %s", imageUrl => {
    expect(createAdminVariantSchema.safeParse({ ...variant, imageUrl }).success).toBe(false);
  });
});
