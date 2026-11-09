import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ products: vi.fn(), users: vi.fn(), colors: vi.fn(), stats: vi.fn(), search: vi.fn() }));
vi.mock("../src/prisma/client", () => ({ prisma: { product: { findMany: mocks.products }, user: { findMany: mocks.users }, frameColor: { findMany: mocks.colors }, order: { groupBy: mocks.stats }, $queryRaw: mocks.search } }));
import { productExportRows, productExportHeaders } from "../src/modules/products/products.export";
import { customerExportRows, customerExportHeaders } from "../src/modules/users/users.export";
import { csvCell, streamCsv } from "../src/utils/csv-export";
beforeEach(() => { vi.clearAllMocks(); mocks.colors.mockResolvedValue([{ name: "Black", hex: "#000000" }]); mocks.products.mockResolvedValue([]); mocks.users.mockResolvedValue([]); mocks.stats.mockResolvedValue([]); mocks.search.mockResolvedValue([]); });
async function collect(rows: AsyncIterable<unknown[]>) { const result: unknown[][] = []; for await (const row of rows) result.push(row); return result; }
const variant = { id: "variant-1", frameSize: "5x5", color: "#000000", mrp: new Prisma.Decimal(500), price: new Prisma.Decimal(449), stockQuantity: 3, isActive: true };
const product = (id: number, variants = [variant]) => ({ id: String(id), productName: "Frame", createdAt: new Date("2026-11-09"), material: { name: "Wood", material: "Oak", brandName: "FrameYaad", description: "A frame", isActive: true }, variants });
describe("complete product exports", () => {
  it("includes every variant and retains products without variants", async () => {
    mocks.products.mockResolvedValue([product(1, [variant, { ...variant, id: "v2", frameSize: "8x10" }]), product(2, [])]);
    const rows = await collect(productExportRows({ search: " Frame ", isActive: "true" }));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["1", "Frame", "FrameYaad", "A frame", "Active", "Oak", "-", "09/11/2026", "INR 449.00", "10% OFF", 6, "variant-1", "5x5", "Black", "#000000", "INR 500.00", "INR 449.00", 3, "Active"]);
    expect(rows[2]?.slice(11)).toEqual(["", "", "", "", "", "", "", ""]);
    expect(mocks.products.mock.calls[0]?.[0]).toMatchObject({ where: { material: { isActive: true }, OR: [{ productName: { contains: "Frame", mode: "insensitive" } }, { productIdentifier: { contains: "Frame", mode: "insensitive" } }] } });
    expect(productExportHeaders).toHaveLength(rows[0]!.length);
  });
  it("chunks 501 products without one query per item", async () => {
    mocks.products.mockResolvedValueOnce(Array.from({ length: 250 }, (_, i) => product(i))).mockResolvedValueOnce(Array.from({ length: 250 }, (_, i) => product(i + 250))).mockResolvedValueOnce([product(500)]);
    expect(await collect(productExportRows({}))).toHaveLength(501);
    expect(mocks.products).toHaveBeenCalledTimes(3);
    expect(mocks.colors).toHaveBeenCalledTimes(1);
    expect(mocks.products.mock.calls[1]?.[0]).toMatchObject({ take: 250, cursor: { id: "249" }, skip: 1 });
  });
});
describe("safe customer exports", () => {
  const customer = { id: "u1", name: "Customer", email: "example@example.com", phoneNumber: "123", addressLine: "One", city: "Chennai", state: "TN", country: "India", postalCode: "600001", createdAt: new Date("2026-11-09"), isActive: true, addresses: [{ addressLine: "Two", city: "Chennai", state: "TN", country: "India", postalCode: "600002" }], _count: { wishlistItems: 4 } };
  it("exports all addresses and batched order statistics, with an explicit safe select", async () => {
    mocks.users.mockResolvedValue([customer]);
    mocks.stats.mockResolvedValue([{ userId: "u1", _count: { _all: 2 }, _sum: { totalPrice: new Prisma.Decimal(1300) }, _max: { createdAt: new Date("2026-11-08") } }]);
    const rows = await collect(customerExportRows({ search: "Customer" }));
    expect(rows[0]).toEqual(["u1", "Customer", "example@example.com", "123", "One, Chennai, TN, India, 600001", "Two, Chennai, TN, India, 600002", "09/11/2026", "Active", 2, "INR 1,300.00", "08/11/2026", 4]);
    const query = JSON.stringify(mocks.users.mock.calls[0]?.[0]);
    expect(query).not.toMatch(/password|token|otp|secret/i);
    expect(customerExportHeaders).toHaveLength(rows[0]!.length);
    expect(mocks.stats).toHaveBeenCalledTimes(1);
  });
  it("chunks 501 customers with one aggregate per batch, not per customer", async () => {
    mocks.users.mockResolvedValueOnce(Array.from({ length: 250 }, (_, i) => ({ ...customer, id: String(i) }))).mockResolvedValueOnce(Array.from({ length: 250 }, (_, i) => ({ ...customer, id: String(i + 250) }))).mockResolvedValueOnce([{ ...customer, id: "500" }]);
    expect(await collect(customerExportRows({}))).toHaveLength(501);
    expect(mocks.users).toHaveBeenCalledTimes(3); expect(mocks.stats).toHaveBeenCalledTimes(3);
  });
});
describe("streamed CSV", () => {
  it.each(["=SUM(A1:A2)", "+123", "-formula", "@SUM", " \t=1"])("neutralizes formula prefix %s", value => { expect(csvCell(value).startsWith('"\'')).toBe(true); });
  it("quotes commas, quotes and line breaks", () => { expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'); });
  it.each([0, 501])("streams %i rows with no empty file", async count => {
    const app = express();
    app.get("/export", async (_req, res) => { async function* rows() { await Promise.resolve(); for (let i = 0; i < count; i++) yield [i, "=unsafe"]; } await streamCsv(res, "test", ["ID", "Name"], rows()); });
    const response = await request(app).get("/export");
    expect(response.status).toBe(count ? 200 : 204);
    if (count) { expect(response.text.split("\r\n")).toHaveLength(503); expect(response.text).toContain('"\'=unsafe"'); }
  });
});
