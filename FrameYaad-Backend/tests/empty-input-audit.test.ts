import { describe, expect, it } from "vitest";
import { registrationSchema } from "../src/modules/auth/auth.schemas";
import { createAddressSchema, updateAddressSchema } from "../src/modules/addresses/addresses.schemas";
import { adminUpdateUserSchema } from "../src/modules/users/users.schemas";
import { adminUpdateEmployeeSchema } from "../src/modules/employees/employees.schemas";
import { createAdminVariantSchema, updateAdminVariantSchema, updateAdminProductPreviewSchema } from "../src/modules/products/products.schemas";
import { createCouponSchema, updateCouponSchema } from "../src/modules/coupon/coupon.schemas";
import { updateProductDiscountSchema } from "../src/modules/product-discount/product-discount.schemas";

describe("required field audit", () => {
  const cases = [
    { module: "account", schema: registrationSchema, valid: { name: "Example", email: "test@example.com", password: "example-test-only" }, fields: ["name", "email", "password"] },
    { module: "variant", schema: createAdminVariantSchema, valid: { frameSize: "5x5", mountType: "NONE", glassType: "NONE", price: 100, stockQuantity: 0 }, fields: ["frameSize", "mountType", "glassType", "price", "stockQuantity"] },
    { module: "address", schema: createAddressSchema, valid: { addressLine: "12 Example Road", postalCode: "600040", city: "Chennai", state: "Tamil Nadu", country: "India", contactPerson: "Example", contactNumber: "9876543210" }, fields: ["addressLine", "postalCode", "city", "state", "country", "contactPerson", "contactNumber"] },
    { module: "coupon", schema: createCouponSchema, valid: { code: "TEST", couponType: "PERCENTAGE", discountType: "PERCENTAGE", discountValue: 10, startDate: "2027-01-01", endDate: "2027-12-31", expiresAt: "2027-12-31" }, fields: ["code", "couponType", "discountType", "discountValue", "startDate", "endDate", "expiresAt"] },
  ];
  for (const entry of cases) {
    for (const field of entry.fields) {
      it(`${entry.module}.${field} rejects missing, null and blank values`, () => {
        for (const value of [undefined, null, "", "   "]) {
          // Passwords are never trimmed; whitespace-only passwords still fail minimum length.
          expect(entry.schema.safeParse({ ...entry.valid, [field]: value }).success).toBe(false);
        }
      });
    }
  }
  it.each([
    ["customer", adminUpdateUserSchema], ["employee", adminUpdateEmployeeSchema],
    ["address", updateAddressSchema], ["product", updateAdminProductPreviewSchema],
    ["variant", updateAdminVariantSchema], ["coupon", updateCouponSchema], ["discount", updateProductDiscountSchema],
  ])("rejects empty %s updates", (_label, schema) => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });
  it("does not reset omitted coupon flags or activate a coupon", () => {
    expect(updateCouponSchema.parse({ description: "Updated description" })).toEqual({ description: "Updated description" });
    expect(updateCouponSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });
  it("retains intentional nullable optional fields", () => {
    expect(adminUpdateUserSchema.safeParse({ phoneNumber: null }).success).toBe(true);
    expect(updateProductDiscountSchema.safeParse({ expiresAt: null }).success).toBe(true);
  });
});
