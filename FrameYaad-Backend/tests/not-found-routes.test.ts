import { describe, expect, it, vi } from "vitest";
import request from "supertest";
const product = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("../src/prisma/client", () => ({ prisma: { product: { findUnique: product } } }));
import { app } from "../src/app";

describe("clean API not-found handling", () => {
  it.each(["/api/v1/unknown-path", "/api/v1/products/public/abc123xyz", "/api/v1/products/public/undefined", "/api/v1/products/public/%E0%A4%A", "/api/v1/products/public/%3Cscript%3Ealert(1)%3C%2Fscript%3E", `/api/v1/${"a".repeat(2048)}`])("returns a safe JSON 404 for %s", async path => {
    const response = await request(app).get(path);
    expect(response.status).toBe(404);
    expect(response.type).toContain("json");
    expect(response.text).not.toContain('"stack"');
    expect(response.text).not.toContain("<script>");
    expect(response.text).not.toContain(path);
  });
  it("returns 404 for a well-formed but missing product ID", async () => {
    const response = await request(app).get("/api/v1/products/public/11111111-1111-4111-8111-111111111111");
    expect(response.status).toBe(404);
    expect(product).toHaveBeenCalled();
    expect(response.text).not.toContain('"stack"');
  });
});
