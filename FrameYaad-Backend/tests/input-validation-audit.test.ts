import { describe, expect, it } from "vitest";
import { registrationSchema } from "../src/modules/auth/auth.schemas";
import { createAdminProductPreviewSchema, createAdminVariantSchema } from "../src/modules/products/products.schemas";
import { createCouponSchema } from "../src/modules/coupon/coupon.schemas";
import { inputDateSchema } from "../src/utils/input-schemas";
import { validateUpload } from "../src/utils/upload-validation";

const variant = { frameSize: "5x5", mountType: "NONE", glassType: "NONE", price: 100, stockQuantity: 0 };
const product = { description: "A test frame", name: "Test frame", brandName: "FrameYaad", material: "Wood", availableColors: ["Black"], variants: [variant], images: [{ imageUrl: "https://example.com/default.png", displayOrder: 1 }] };
const coupon = { code: "TEST", couponType: "PERCENTAGE", discountType: "PERCENTAGE", discountValue: 10, startDate: "2027-01-01", endDate: "2027-12-31", expiresAt: "2027-12-31" };

describe("invalid input audit", () => {
  it.each([0, -1, "100", null, Number.NaN, Number.POSITIVE_INFINITY, 10_000_000_000])("rejects invalid variant price %s", price => {
    expect(createAdminVariantSchema.safeParse({ ...variant, price }).success).toBe(false);
  });
  it.each([-1, 0.5, "1", null, 2_147_483_648])("rejects invalid stock %s", stockQuantity => {
    expect(createAdminVariantSchema.safeParse({ ...variant, stockQuantity }).success).toBe(false);
  });
  it("retains zero stock and optional color/variant images", () => {
    expect(createAdminProductPreviewSchema.safeParse(product).success).toBe(true);
    expect(createAdminVariantSchema.safeParse(variant).success).toBe(true);
  });
  it("rejects duplicate normalized frame colors", () => {
    expect(createAdminProductPreviewSchema.safeParse({ ...product, availableColors: ["Black", " black "] }).success).toBe(false);
  });
  it.each(["<script>alert(1)</script>", "a".repeat(161)])("rejects markup or long product names", name => {
    expect(createAdminProductPreviewSchema.safeParse({ ...product, name }).success).toBe(false);
  });
  it.each([{ images: [] }, { images: [{ imageUrl: "https://example.com/black.png", displayOrder: 1, color: "Black" }] }])("requires a default product image", ({ images }) => {
    expect(createAdminProductPreviewSchema.safeParse({ ...product, images }).success).toBe(false);
  });
  it.each([null, 0, true, "", "not-a-date", "2027-02-30", "2027-13-01"])("rejects malformed dates %s", date => {
    expect(inputDateSchema.safeParse(date).success).toBe(false);
  });
  it.each(["abcdefghij", "123", "<script>1234567890</script>"])("rejects invalid phone %s", phoneNumber => {
    expect(registrationSchema.safeParse({ name: "Test account", email: "test@example.com", password: "example-test-only", phoneNumber }).success).toBe(false);
  });
  it.each(["bad-email", "a".repeat(321) + "@example.com"])("rejects malformed emails", email => {
    expect(registrationSchema.safeParse({ name: "Test account", email, password: "example-test-only" }).success).toBe(false);
  });
  it.each([{ discountValue: 101 }, { discountValue: -1 }, { discountValue: 0 }, { discountType: "INVALID" }, { usageLimit: 0 }, { usageLimit: -1 }, { startDate: null }, { expiresAt: "bad" }, { endDate: "2026-01-01" }])("rejects invalid coupon %j", fields => {
    expect(createCouponSchema.safeParse({ ...coupon, ...fields }).success).toBe(false);
  });
  it.each([undefined, null, "", "   "])("rejects incomplete product descriptions: %j", description => {
    expect(createAdminProductPreviewSchema.safeParse({ ...product, description }).success).toBe(false);
  });
  it("rejects disguised and oversized uploads before storage", () => {
    expect(() => validateUpload({ mimetype: "image/png", buffer: Buffer.from("<script>bad</script>"), size: 20 })).toThrow();
    expect(() => validateUpload({ mimetype: "image/svg+xml", buffer: Buffer.from("<svg/>"), size: 6 })).toThrow();
    expect(() => validateUpload({ mimetype: "image/png", buffer: Buffer.from([137,80,78,71,13,10,26,10]), size: 11 * 1024 * 1024 })).toThrow();
    expect(() => validateUpload({ mimetype: "image/png", buffer: Buffer.from([137,80,78,71,13,10,26,10]), size: 8 })).not.toThrow();
  });
});
