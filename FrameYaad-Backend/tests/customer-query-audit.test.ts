import { describe, expect, it, vi } from "vitest";
import { customerPhoneLookupSchema } from "../src/modules/users/users.schemas";
const raw = vi.hoisted(() => vi.fn());
vi.mock("../src/prisma/client", () => ({ prisma: { $queryRaw: raw } }));
import { lookupCustomerByPhone } from "../src/modules/users/users.service";

describe("bounded customer lookup", () => {
  it("normalizes phone input and rejects incomplete or executable input", () => {
    expect(customerPhoneLookupSchema.parse({ phone: "+91 (98765) 43210" }).phone).toBe("919876543210");
    for (const phone of ["", "   ", "123", "1234567 OR 1=1", "<script>1234567</script>"]) {
      expect(customerPhoneLookupSchema.safeParse({ phone }).success).toBe(false);
    }
  });
  it("uses one parameterized, customer-only, single-result query", async () => {
    raw.mockResolvedValue([{ id: "customer-id", name: "Example", phoneNumber: "9876543210" }]);
    await expect(lookupCustomerByPhone("9876543210")).resolves.toMatchObject({ id: "customer-id" });
    const query = raw.mock.calls.at(-1)?.[0] as { sql: string; values: unknown[] };
    expect(query.sql).toContain("role = 'CUSTOMER'");
    expect(query.sql).toContain("LIMIT 1");
    expect(query.sql).not.toContain("9876543210");
    expect(query.values).toContain("%9876543210");
  });
  it("returns an accurate not-found error", async () => {
    raw.mockResolvedValue([]);
    await expect(lookupCustomerByPhone("9876543210")).rejects.toMatchObject({ statusCode: 404 });
  });
});
