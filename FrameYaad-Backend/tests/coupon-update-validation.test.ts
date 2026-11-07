import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { coupon: { findUnique: mocks.find, update: mocks.update } } }));
import { updateCoupon } from "../src/modules/coupon/coupon.service";
const coupon = { id: "coupon", code: "TEST", description: "Example", couponType: "PERCENTAGE", discountType: "PERCENTAGE", discountValue: "10", minimumOrderValue: "0", usageLimit: 10, usagePerUser: 1,
  newUserOnly: false, festivalCoupon: false, buyOneGetOne: false, buyTwoGetOne: false, isActive: false,
  startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), expiresAt: new Date("2027-12-31"),
};
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue(coupon); mocks.update.mockResolvedValue(coupon); });
describe("partial coupon validation", () => {
  it("checks a value-only patch against the stored discount type", async () => {
    await expect(updateCoupon("coupon", { discountValue: 101 })).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("checks a date-only patch against the stored start date", async () => {
    await expect(updateCoupon("coupon", { endDate: new Date("2026-01-01") })).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("changes only supplied fields and preserves inactive status", async () => {
    await updateCoupon("coupon", { description: "New description" });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { description: "New description" } }));
  });
});
