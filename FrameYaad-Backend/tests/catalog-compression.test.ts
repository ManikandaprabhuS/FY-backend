import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/products/products.service", () => ({
  listPublicProducts: () => Promise.resolve({ products: Array.from({ length: 40 }, (_, index) => ({ id: String(index), productName: "A sufficiently large public catalog product response", images: [], variants: [] })), pagination: { total: 40 } }),
}));
import { app } from "../src/app";

describe("public catalog compression", () => {
  it("compresses a public response through mounted routers", async () => {
    const response = await request(app).get("/api/v1/products/public?limit=50").set("Accept-Encoding", "gzip");
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers.vary as string).toContain("Accept-Encoding");
  });

  it("does not compress authentication or error responses", async () => {
    const response = await request(app).get("/api/v1/auth/me").set("Accept-Encoding", "gzip");
    expect(response.status).toBe(401);
    expect(response.headers["content-encoding"]).toBeUndefined();
  });
});
